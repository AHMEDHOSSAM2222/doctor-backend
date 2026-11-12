import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { pdfUpload, readUploadedPdfs, removeStoredFiles, saveDocuments, sendPdf, toDocument } from '../documents.js';
import { parsePatientInput, parseVisitInput, toId, toPatient, toVisit } from '../patients.js';

const notFound = (res) => res.status(404).json({ error: 'Patient not found' });

/** Next free numeric file number, starting at 1001. */
async function nextFileNumber(db) {
  const { max } = await db.get(
    `SELECT MAX(CAST(file_number AS UNSIGNED)) AS max FROM patients WHERE file_number REGEXP '^[0-9]+$'`,
  );
  return String(Math.max(Number(max) || 0, 1000) + 1);
}

export function patientRoutes({ db, config }) {
  const router = Router();
  router.use(requireAdmin(config));

  const getPatient = (id) => db.get('SELECT * FROM patients WHERE id = ?', [toId(id)]);
  const getVisits = (patientId) =>
    db.all('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC, id DESC', [patientId]);
  const getDocuments = (patientId) =>
    db.all('SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC, id DESC', [patientId]);
  const withVisits = async (row) => ({
    ...toPatient(row),
    visits: (await getVisits(row.id)).map(toVisit),
    documents: (await getDocuments(row.id)).map(toDocument),
  });
  const touch = (patientId) => db.run('UPDATE patients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [patientId]);
  const sendPatient = async (res, patientId, status = 200) =>
    res.status(status).json({ patient: await withVisits(await getPatient(patientId)) });

  router.get('/', async (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Math.floor(Number(req.query.offset)) || 0, 0);
    const where = search ? 'WHERE p.file_number LIKE :q OR p.full_name LIKE :q OR p.phone LIKE :q' : '';
    const params = search ? { q: `%${search}%` } : {};

    const { total } = await db.get(`SELECT COUNT(*) AS total FROM patients p ${where}`, params);
    const rows = await db.all(
      `SELECT p.*,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
              (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id) AS last_visit
       FROM patients p
       ${where}
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT :limit OFFSET :offset`,
      { ...params, limit, offset },
    );

    res.json({ patients: rows.map(toPatient), total: Number(total) });
  });

  router.get('/next-file-number', async (req, res) => {
    res.json({ fileNumber: await nextFileNumber(db) });
  });

  router.post('/', async (req, res) => {
    const data = parsePatientInput(req.body);
    if (!data.file_number) data.file_number = await nextFileNumber(db);
    const { insertId } = await db.run(
      `INSERT INTO patients (file_number, full_name, phone, date_of_birth, gender, blood_type,
                             allergies, chronic_conditions, notes)
       VALUES (:file_number, :full_name, :phone, :date_of_birth, :gender, :blood_type,
               :allergies, :chronic_conditions, :notes)`,
      data,
    );
    return sendPatient(res, insertId, 201);
  });

  router.get('/:id', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    return res.json({ patient: await withVisits(row) });
  });

  router.put('/:id', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const data = parsePatientInput(req.body);
    if (!data.file_number) data.file_number = row.file_number;
    await db.run(
      `UPDATE patients SET file_number = :file_number, full_name = :full_name, phone = :phone,
         date_of_birth = :date_of_birth, gender = :gender, blood_type = :blood_type,
         allergies = :allergies, chronic_conditions = :chronic_conditions, notes = :notes,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { ...data, id: row.id },
    );
    return sendPatient(res, row.id);
  });

  router.delete('/:id', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const storedNames = (await getDocuments(row.id)).map((doc) => doc.stored_name);
    await db.run('DELETE FROM patients WHERE id = ?', [row.id]);
    removeStoredFiles(config, storedNames);
    return res.status(204).end();
  });

  router.post('/:id/visits', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const visit = parseVisitInput(req.body);
    await db.run(
      `INSERT INTO visits (patient_id, visit_date, diagnosis, prescription, notes)
       VALUES (:patient_id, :visit_date, :diagnosis, :prescription, :notes)`,
      { ...visit, patient_id: row.id },
    );
    await touch(row.id);
    return sendPatient(res, row.id, 201);
  });

  router.put('/:id/visits/:visitId', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const visit = parseVisitInput(req.body);
    const { affectedRows } = await db.run(
      `UPDATE visits SET visit_date = :visit_date, diagnosis = :diagnosis,
         prescription = :prescription, notes = :notes
       WHERE id = :id AND patient_id = :patient_id`,
      { ...visit, id: toId(req.params.visitId), patient_id: row.id },
    );
    if (!affectedRows) return res.status(404).json({ error: 'Visit not found' });
    await touch(row.id);
    return sendPatient(res, row.id);
  });

  router.delete('/:id/visits/:visitId', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const { affectedRows } = await db.run('DELETE FROM visits WHERE id = ? AND patient_id = ?', [
      toId(req.params.visitId),
      row.id,
    ]);
    if (!affectedRows) return res.status(404).json({ error: 'Visit not found' });
    return sendPatient(res, row.id);
  });

  // ---- PDF documents ----
  const getDocument = (patientId, docId) =>
    db.get('SELECT * FROM documents WHERE id = ? AND patient_id = ?', [toId(docId), toId(patientId)]);

  router.post('/:id/documents', pdfUpload(config), async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    await saveDocuments(db, config, row.id, readUploadedPdfs(req));
    await touch(row.id);
    return sendPatient(res, row.id, 201);
  });

  router.get('/:id/documents/:docId', async (req, res) => {
    const doc = await getDocument(req.params.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    return sendPdf(res, config, doc, () => res.status(404).json({ error: 'The PDF file is missing on the server' }));
  });

  router.delete('/:id/documents/:docId', async (req, res) => {
    const row = await getPatient(req.params.id);
    if (!row) return notFound(res);
    const doc = await getDocument(row.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
    removeStoredFiles(config, [doc.stored_name]);
    await touch(row.id);
    return sendPatient(res, row.id);
  });

  return router;
}

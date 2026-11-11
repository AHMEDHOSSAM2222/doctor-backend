import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { parsePatientInput, parseVisitInput, toPatient, toVisit } from '../patients.js';

const notFound = (res) => res.status(404).json({ error: 'Patient not found' });

/** Next free numeric file number, starting at 1001. */
function nextFileNumber(db) {
  const { max } = db
    .prepare(
      `SELECT MAX(CAST(file_number AS INTEGER)) AS max FROM patients
              WHERE file_number != '' AND file_number NOT GLOB '*[^0-9]*'`,
    )
    .get();
  return String(Math.max(Number(max) || 0, 1000) + 1);
}

export function patientRoutes({ db, config }) {
  const router = Router();
  router.use(requireAdmin(config));

  const getPatient = (id) => db.prepare('SELECT * FROM patients WHERE id = ?').get(Number(id));
  const getVisits = (patientId) =>
    db.prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC, id DESC').all(patientId);
  const withVisits = (row) => ({ ...toPatient(row), visits: getVisits(row.id).map(toVisit) });

  router.get('/', (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = search ? 'WHERE p.file_number LIKE :q OR p.full_name LIKE :q OR p.phone LIKE :q' : '';
    const params = search ? { q: `%${search}%` } : {};

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM patients p ${where}`).get(params);
    const rows = db
      .prepare(
        `SELECT p.*, COUNT(v.id) AS visit_count, MAX(v.visit_date) AS last_visit
         FROM patients p LEFT JOIN visits v ON v.patient_id = p.id
         ${where}
         GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC
         LIMIT :limit OFFSET :offset`,
      )
      .all({ ...params, limit, offset });

    res.json({ patients: rows.map(toPatient), total });
  });

  router.get('/next-file-number', (req, res) => {
    res.json({ fileNumber: nextFileNumber(db) });
  });

  router.post('/', (req, res) => {
    const data = parsePatientInput(req.body);
    if (!data.file_number) data.file_number = nextFileNumber(db);
    const result = db
      .prepare(
        `INSERT INTO patients (file_number, full_name, phone, date_of_birth, gender, blood_type,
                               allergies, chronic_conditions, notes)
         VALUES (:file_number, :full_name, :phone, :date_of_birth, :gender, :blood_type,
                 :allergies, :chronic_conditions, :notes)`,
      )
      .run(data);
    res.status(201).json({ patient: withVisits(getPatient(result.lastInsertRowid)) });
  });

  router.get('/:id', (req, res) => {
    const row = getPatient(req.params.id);
    if (!row) return notFound(res);
    return res.json({ patient: withVisits(row) });
  });

  router.put('/:id', (req, res) => {
    const row = getPatient(req.params.id);
    if (!row) return notFound(res);
    const data = parsePatientInput(req.body);
    if (!data.file_number) data.file_number = row.file_number;
    db.prepare(
      `UPDATE patients SET file_number = :file_number, full_name = :full_name, phone = :phone,
         date_of_birth = :date_of_birth, gender = :gender, blood_type = :blood_type,
         allergies = :allergies, chronic_conditions = :chronic_conditions, notes = :notes,
         updated_at = datetime('now')
       WHERE id = :id`,
    ).run({ ...data, id: row.id });
    return res.json({ patient: withVisits(getPatient(row.id)) });
  });

  router.delete('/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM patients WHERE id = ?').run(Number(req.params.id));
    if (!changes) return notFound(res);
    return res.status(204).end();
  });

  router.post('/:id/visits', (req, res) => {
    const row = getPatient(req.params.id);
    if (!row) return notFound(res);
    const visit = parseVisitInput(req.body);
    db.prepare(
      `INSERT INTO visits (patient_id, visit_date, diagnosis, prescription, notes)
       VALUES (:patient_id, :visit_date, :diagnosis, :prescription, :notes)`,
    ).run({ ...visit, patient_id: row.id });
    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    return res.status(201).json({ patient: withVisits(getPatient(row.id)) });
  });

  router.put('/:id/visits/:visitId', (req, res) => {
    const row = getPatient(req.params.id);
    if (!row) return notFound(res);
    const visit = parseVisitInput(req.body);
    const { changes } = db
      .prepare(
        `UPDATE visits SET visit_date = :visit_date, diagnosis = :diagnosis,
           prescription = :prescription, notes = :notes
         WHERE id = :id AND patient_id = :patient_id`,
      )
      .run({ ...visit, id: Number(req.params.visitId), patient_id: row.id });
    if (!changes) return res.status(404).json({ error: 'Visit not found' });
    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    return res.json({ patient: withVisits(getPatient(row.id)) });
  });

  router.delete('/:id/visits/:visitId', (req, res) => {
    const row = getPatient(req.params.id);
    if (!row) return notFound(res);
    const { changes } = db
      .prepare('DELETE FROM visits WHERE id = ? AND patient_id = ?')
      .run(Number(req.params.visitId), row.id);
    if (!changes) return res.status(404).json({ error: 'Visit not found' });
    return res.json({ patient: withVisits(getPatient(row.id)) });
  });

  return router;
}

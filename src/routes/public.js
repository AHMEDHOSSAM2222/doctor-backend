import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signPatientToken, verifyPatientToken } from '../auth.js';
import { httpError, pdfUpload, readUploadedPdfs, removeStoredFiles, saveDocuments, sendPdf } from '../documents.js';
import { normalizeDigits, phonesMatch, toPublicFile } from '../patients.js';

const NO_MATCH = { error: 'No file matches this file number and phone number' };

// PDF links open in a new browser tab, so their errors are plain text in English and Arabic.
const LINK_EXPIRED =
  'This link has expired. Go back to the clinic page and open your file again.\n' +
  'انتهت صلاحية هذا الرابط. ارجع لصفحة العيادة وافتح ملفك مرة أخرى.';
const DOC_NOT_FOUND = 'This document is no longer available.\nهذا المستند لم يعد متاحًا.';

/**
 * Public endpoints used by the page the QR code opens. A patient proves the file is
 * theirs with the file number plus the phone number registered on it, so file
 * numbers alone cannot be used to read other patients' records.
 */
export function publicRoutes({ db, config }) {
  const router = Router();

  const lookupLimiter = rateLimit({
    windowMs: config.lookupWindowMinutes * 60 * 1000,
    limit: config.lookupMaxAttempts,
    skipSuccessfulRequests: true, // only failed attempts count towards the limit
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later', code: 'RATE_LIMITED' },
  });

  // Patient uploads and deletions: generous for real use, but stops a script filling the disk.
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many uploads, please try again later', code: 'RATE_LIMITED' },
  });

  /** The documents list as the patient page shows it (no stored file names). */
  const publicDocuments = (patientId) =>
    db
      .prepare('SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC, id DESC')
      .all(patientId)
      .map((row) => ({
        id: row.id,
        title: row.title,
        size: row.size,
        uploadedBy: row.uploaded_by,
        createdAt: row.created_at,
      }));

  /** Requires the access token from the lookup, sent as "Authorization: Bearer <token>". */
  const requirePatient = (req, res, next) => {
    const header = req.get('authorization') || '';
    const patientId = verifyPatientToken(header.startsWith('Bearer ') ? header.slice(7) : '', config);
    const patient = patientId && db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
    if (!patient) {
      return res.status(401).json({ error: 'Your session has ended, open your file again', code: 'EXPIRED' });
    }
    req.patientId = patient.id;
    return next();
  };

  router.post('/lookup', lookupLimiter, (req, res) => {
    const fileNumber = normalizeDigits(req.body?.fileNumber).trim();
    const phone = String(req.body?.phone || '').trim();
    if (!fileNumber || !phone) {
      return res.status(400).json({ error: 'File number and phone number are required' });
    }

    const patient = db.prepare('SELECT * FROM patients WHERE file_number = ?').get(fileNumber);
    if (!patient || !phonesMatch(patient.phone, phone)) {
      return res.status(404).json(NO_MATCH);
    }

    const visits = db
      .prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC, id DESC')
      .all(patient.id);
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...toPublicFile(patient, visits),
      documents: publicDocuments(patient.id),
      // Lets the patient open their PDFs for a limited time without typing their details again.
      access: signPatientToken(patient.id, config),
    });
  });

  // Opens one PDF from the patient's file: /api/public/documents/:id?token=<access token>
  router.get('/documents/:docId', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const patientId = verifyPatientToken(req.query.token, config);
    if (!patientId) return res.status(401).type('text/plain; charset=utf-8').send(LINK_EXPIRED);

    const doc = db
      .prepare('SELECT * FROM documents WHERE id = ? AND patient_id = ?')
      .get(Number(req.params.docId), patientId);
    const notFound = () => res.status(404).type('text/plain; charset=utf-8').send(DOC_NOT_FOUND);
    if (!doc) return notFound();
    return sendPdf(res, config, doc, notFound);
  });

  // A patient adds PDFs to their own file (for example results from another lab).
  router.post('/documents', uploadLimiter, requirePatient, pdfUpload(config), (req, res) => {
    const pdfs = readUploadedPdfs(req);
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM documents WHERE patient_id = ? AND uploaded_by = 'patient'")
      .get(req.patientId);
    if (count + pdfs.length > config.patientMaxUploads) {
      throw httpError(
        400,
        `You can add up to ${config.patientMaxUploads} documents to your file. Ask the clinic for help.`,
        'UPLOAD_LIMIT',
      );
    }
    saveDocuments(db, config, req.patientId, pdfs, 'patient');
    db.prepare("UPDATE patients SET updated_at = datetime('now') WHERE id = ?").run(req.patientId);
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({ documents: publicDocuments(req.patientId) });
  });

  // A patient can remove documents they added themselves, never the clinic's.
  router.delete('/documents/:docId', uploadLimiter, requirePatient, (req, res) => {
    const doc = db
      .prepare('SELECT * FROM documents WHERE id = ? AND patient_id = ?')
      .get(Number(req.params.docId), req.patientId);
    if (!doc) return res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
    if (doc.uploaded_by !== 'patient') {
      return res.status(403).json({ error: 'Only documents you added can be deleted', code: 'NOT_YOURS' });
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    removeStoredFiles(config, [doc.stored_name]);
    res.set('Cache-Control', 'no-store');
    return res.json({ documents: publicDocuments(req.patientId) });
  });

  return router;
}

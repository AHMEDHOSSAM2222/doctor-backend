import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signPatientToken, verifyPatientToken } from '../auth.js';
import { sendPdf } from '../documents.js';
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
    const documents = db
      .prepare('SELECT * FROM documents WHERE patient_id = ? ORDER BY created_at DESC, id DESC')
      .all(patient.id)
      .map(({ id, title, size, created_at: createdAt }) => ({ id, title, size, createdAt }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      ...toPublicFile(patient, visits),
      documents,
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

  return router;
}

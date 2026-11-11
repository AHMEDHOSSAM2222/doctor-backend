import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { normalizeDigits, phonesMatch, toPublicFile } from '../patients.js';

const NO_MATCH = { error: 'No file matches this file number and phone number' };

/**
 * Public endpoint opened from the QR code page. A patient proves the file is
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
    res.set('Cache-Control', 'no-store');
    return res.json(toPublicFile(patient, visits));
  });

  return router;
}

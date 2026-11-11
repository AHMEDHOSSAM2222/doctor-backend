// PDF documents attached to patient files: upload parsing, validation, storage and serving.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

export const MAX_FILES_PER_UPLOAD = 10;
const MAX_TITLE = 200;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Express middleware that reads up to 10 PDFs from the multipart field "files" into memory. */
export function pdfUpload(config) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: MAX_FILES_PER_UPLOAD },
  }).array('files', MAX_FILES_PER_UPLOAD);

  return (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(httpError(413, `Each PDF must be ${config.maxUploadMb} MB or smaller`));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(httpError(400, `Upload up to ${MAX_FILES_PER_UPLOAD} PDFs at a time`));
      }
      return next(err);
    });
}

// Browsers send file names as UTF-8, but the multipart parser reads them as latin1.
const decodeFileName = (name) => {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? name : utf8;
};

const isPdf = (buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';

/**
 * Validates the uploaded files and pairs each with its title.
 * Titles come from the repeated "titles" form field; the file name is used when a title is empty.
 */
export function readUploadedPdfs(req) {
  const files = req.files || [];
  if (!files.length) throw httpError(400, 'Choose at least one PDF file');
  const titles = [].concat(req.body?.titles ?? []);

  return files.map((file, index) => {
    const originalName = decodeFileName(file.originalname || 'document.pdf');
    if (!isPdf(file.buffer)) throw httpError(400, `"${originalName}" is not a PDF file`);
    const title = String(titles[index] ?? '').trim() || originalName.replace(/\.pdf$/i, '');
    return {
      title: title.slice(0, MAX_TITLE),
      originalName: originalName.slice(0, 255),
      buffer: file.buffer,
      size: file.size,
    };
  });
}

/** Writes PDFs to disk and records them for a patient. Removes written files if anything fails. */
export function saveDocuments(db, config, patientId, pdfs) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const written = [];
  const insert = db.prepare(
    'INSERT INTO documents (patient_id, title, original_name, stored_name, size) VALUES (?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const pdf of pdfs) {
      const storedName = `${crypto.randomUUID()}.pdf`;
      fs.writeFileSync(path.join(config.uploadDir, storedName), pdf.buffer, { flag: 'wx' });
      written.push(storedName);
      insert.run(patientId, pdf.title, pdf.originalName, storedName, pdf.size);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    removeStoredFiles(config, written);
    throw err;
  }
}

export function removeStoredFiles(config, storedNames) {
  for (const name of storedNames) {
    fs.rm(path.join(config.uploadDir, name), { force: true }, () => {});
  }
}

export const toDocument = (row) => ({
  id: row.id,
  title: row.title,
  originalName: row.original_name,
  size: row.size,
  createdAt: row.created_at,
});

// RFC 5987 encoding so Arabic titles survive as the downloaded file name.
const encodeRfc5987 = (value) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Streams a stored PDF so the browser shows it in its PDF viewer. */
export function sendPdf(res, config, row, onMissing) {
  const asciiName = row.title.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'document';
  res.sendFile(
    path.join(config.uploadDir, row.stored_name),
    {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${asciiName}.pdf"; filename*=UTF-8''${encodeRfc5987(row.title)}.pdf`,
        'Cache-Control': 'private, no-store',
      },
      cacheControl: false,
    },
    (err) => {
      if (err && !res.headersSent) onMissing(err);
    },
  );
}

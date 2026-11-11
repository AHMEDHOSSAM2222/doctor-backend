// Validation and mapping helpers for patient files and visits.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const GENDERS = ['', 'male', 'female'];
const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 5000;

const text = (value, field, { required = false, max = MAX_TEXT } = {}) => {
  const str = value == null ? '' : String(value).trim();
  if (required && !str) throw new ValidationError(`${field} is required`);
  if (str.length > max) throw new ValidationError(`${field} is too long (max ${max} characters)`);
  return str;
};

const date = (value, field, { required = false } = {}) => {
  const str = text(value, field, { required, max: 10 });
  if (str && (!DATE_RE.test(str) || Number.isNaN(Date.parse(str)))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`);
  }
  return str || null;
};

const oneOf = (value, field, allowed) => {
  const str = text(value, field, { max: 10 });
  if (!allowed.includes(str))
    throw new ValidationError(`${field} must be one of: ${allowed.filter(Boolean).join(', ')}`);
  return str || null;
};

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits, typed by Arabic phone keyboards, to 0-9. */
export const normalizeDigits = (value) =>
  String(value ?? '').replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** Keeps only the digits of a phone number. */
export const phoneDigits = (value) => normalizeDigits(value).replace(/\D/g, '');

/**
 * Compares two phone numbers while tolerating country codes and leading zeros,
 * e.g. "01012345678" matches "+20 101 234 5678".
 */
export function phonesMatch(a, b) {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (x.length < 7 || y.length < 7) return false;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return longer.endsWith(shorter);
}

export function parsePatientInput(body = {}) {
  const phone = text(body.phone, 'Phone', { required: true, max: 30 });
  if (phoneDigits(phone).length < 7) throw new ValidationError('Phone must contain at least 7 digits');
  return {
    file_number: normalizeDigits(text(body.fileNumber, 'File number', { max: 50 })),
    full_name: text(body.fullName, 'Full name', { required: true, max: 200 }),
    phone,
    date_of_birth: date(body.dateOfBirth, 'Date of birth'),
    gender: oneOf(body.gender, 'Gender', GENDERS),
    blood_type: oneOf(body.bloodType, 'Blood type', BLOOD_TYPES),
    allergies: text(body.allergies, 'Allergies') || null,
    chronic_conditions: text(body.chronicConditions, 'Chronic conditions') || null,
    notes: text(body.notes, 'Notes') || null,
  };
}

export function parseVisitInput(body = {}) {
  const visit = {
    visit_date: date(body.visitDate, 'Visit date') || new Date().toISOString().slice(0, 10),
    diagnosis: text(body.diagnosis, 'Diagnosis') || null,
    prescription: text(body.prescription, 'Prescription') || null,
    notes: text(body.notes, 'Notes') || null,
  };
  if (!visit.diagnosis && !visit.prescription && !visit.notes) {
    throw new ValidationError('Enter a diagnosis, prescription or notes for the visit');
  }
  return visit;
}

export const toPatient = (row) => ({
  id: row.id,
  fileNumber: row.file_number,
  fullName: row.full_name,
  phone: row.phone,
  dateOfBirth: row.date_of_birth,
  gender: row.gender,
  bloodType: row.blood_type,
  allergies: row.allergies,
  chronicConditions: row.chronic_conditions,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.visit_count !== undefined && { visitCount: row.visit_count }),
  ...(row.last_visit !== undefined && { lastVisit: row.last_visit }),
});

export const toVisit = (row) => ({
  id: row.id,
  visitDate: row.visit_date,
  diagnosis: row.diagnosis,
  prescription: row.prescription,
  notes: row.notes,
  createdAt: row.created_at,
});

/** The subset of a patient file that is shown on the public lookup page. */
export function toPublicFile(patientRow, visitRows) {
  // Internal ids, the phone number and timestamps are not sent to the public page.
  const { id, phone, createdAt, ...patient } = toPatient(patientRow);
  const visits = visitRows.map((row) => {
    const { id: _id, createdAt: _createdAt, ...visit } = toVisit(row);
    return visit;
  });
  return { patient, visits };
}

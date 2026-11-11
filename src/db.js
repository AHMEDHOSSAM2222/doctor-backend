import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  file_number        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name          TEXT NOT NULL,
  phone              TEXT NOT NULL,
  date_of_birth      TEXT,
  gender             TEXT,
  blood_type         TEXT,
  allergies          TEXT,
  chronic_conditions TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date   TEXT NOT NULL,
  diagnosis    TEXT,
  prescription TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_date);
`;

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Creates the first admin account from env settings when no admin exists yet. */
export function seedAdmin(db, username, password) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM admins').get();
  if (count > 0) return false;
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  console.log(`[db] Created admin account "${username}". Change the password after first login.`);
  return true;
}

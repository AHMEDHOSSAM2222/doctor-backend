import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load variables from .env when present (Node 22 built-in, no dotenv needed).
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set: using a random secret, admin logins will reset on restart.');
}

const resolvePath = (value) => (path.isAbsolute(value) ? value : path.join(rootDir, value));

/** MySQL connection from DATABASE_URL (mysql://user:password@host:3306/name) or the MYSQL_* variables. */
function databaseConnection() {
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    return {
      host: url.hostname,
      port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  }
  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT) || 3306,
    user: env.MYSQL_USER || 'root',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'doctor_clinic',
  };
}

export const config = {
  isProduction,
  port: Number(env.PORT) || 4000,
  database: databaseConnection(),
  // Folder where uploaded patient PDFs are stored. Keep it on a persistent disk and back it up with the database.
  uploadDir: resolvePath(env.UPLOAD_DIR || 'data/uploads'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB) || 20,
  // How long a patient can open their PDFs after entering their file number and phone.
  patientAccessMinutes: Number(env.PATIENT_ACCESS_MINUTES) || 30,
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  // Set to the number of reverse proxies in front of the app (e.g. 1 on Render/Railway/Nginx)
  // so rate limiting sees the real client IP.
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  // Comma separated list of allowed frontend origins, or "*" to allow all.
  corsOrigins: (env.CORS_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  adminUsername: env.ADMIN_USERNAME || 'admin',
  adminPassword: env.ADMIN_PASSWORD || 'admin123',
  // Max patient lookups per IP in the window below (protects patient files from guessing).
  lookupMaxAttempts: Number(env.LOOKUP_MAX_ATTEMPTS) || 10,
  lookupWindowMinutes: Number(env.LOOKUP_WINDOW_MINUTES) || 15,
};

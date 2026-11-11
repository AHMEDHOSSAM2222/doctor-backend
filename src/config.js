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

const resolveDbPath = (value) => {
  if (value === ':memory:') return value;
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
};

export const config = {
  isProduction,
  port: Number(env.PORT) || 4000,
  dbPath: resolveDbPath(env.DB_PATH || 'data/clinic.db'),
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

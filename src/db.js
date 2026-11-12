import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { hashPassword } from './auth.js';

const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');

/** The CREATE TABLE statements from schema.sql, one per entry. */
function schemaStatements() {
  return fs
    .readFileSync(SCHEMA_FILE, 'utf8')
    .split(/;\s*$/m)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

/**
 * Small helpers over a mysql2 pool or connection, so queries read the same everywhere:
 * `all` returns rows, `get` the first row, `run` the result ({ insertId, affectedRows }).
 * Parameters are `?` with an array, or `:name` with an object.
 */
function helpers(runner) {
  return {
    all: async (sql, params = []) => (await runner.query(sql, params))[0],
    get: async (sql, params = []) => (await runner.query(sql, params))[0][0],
    run: async (sql, params = []) => (await runner.query(sql, params))[0],
  };
}

/** Creates the database if it is missing (needs the CREATE privilege; skipped quietly otherwise). */
async function ensureDatabase(connection) {
  const { database, ...withoutDatabase } = connection;
  if (!database) return;
  let admin;
  try {
    admin = await mysql.createConnection(withoutDatabase);
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch {
    // The database usually exists already; a real connection problem is reported by the pool below.
  } finally {
    await admin?.end().catch(() => {});
  }
}

/**
 * Connects to MySQL, creates the tables if needed and returns the database helpers.
 * `connection` is { host, port, user, password, database }.
 */
export async function openDatabase(connection) {
  await ensureDatabase(connection);

  const pool = mysql.createPool({
    ...connection,
    charset: 'utf8mb4',
    connectionLimit: 10,
    namedPlaceholders: true,
    // DATE and DATETIME columns come back as "YYYY-MM-DD" / "YYYY-MM-DD HH:MM:SS" strings (UTC).
    dateStrings: true,
    timezone: 'Z',
  });
  // Store and compare every timestamp in UTC, whatever the server's own time zone is.
  pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

  for (const statement of schemaStatements()) {
    await pool.query(statement);
  }

  return {
    ...helpers(pool),
    /** Runs `fn(tx)` in a transaction; `tx` has the same helpers. Rolls back if `fn` throws. */
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(helpers(conn));
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Creates the first admin account from env settings when no admin exists yet. */
export async function seedAdmin(db, username, password) {
  const { count } = await db.get('SELECT COUNT(*) AS count FROM admins');
  if (count > 0) return false;
  await db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hashPassword(password)]);
  console.log(`[db] Created admin account "${username}". Change the password after first login.`);
  return true;
}

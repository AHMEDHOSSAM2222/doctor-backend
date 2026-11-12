// Test helper: each test file gets its own throwaway MySQL database.
//
// Point the tests at a MySQL server with TEST_DATABASE_URL (the database name in it is ignored):
//   TEST_DATABASE_URL=mysql://user:password@127.0.0.1:3306 npm test
// The user needs permission to create and drop databases.
import mysql from 'mysql2/promise';
import { openDatabase, seedAdmin } from '../src/db.js';

function serverConnection() {
  const url = new URL(process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306');
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** Creates a fresh database with an admin account; call `drop()` when the tests are done. */
export async function createTestDatabase({ username = 'admin', password = 'secret123' } = {}) {
  const server = serverConnection();
  const database = `doctor_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  let db;
  try {
    db = await openDatabase({ ...server, database });
  } catch (err) {
    throw new Error(
      `The tests need a MySQL server. Set TEST_DATABASE_URL=mysql://user:password@host:3306 (${err.code || err.message})`,
    );
  }
  await seedAdmin(db, username, password);

  return {
    db,
    async drop() {
      await db.close();
      const conn = await mysql.createConnection(server);
      await conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(database)}`);
      await conn.end();
    },
  };
}

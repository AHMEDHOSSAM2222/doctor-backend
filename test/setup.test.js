import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadOrCreateSecret, seedAdmin } from '../src/db.js';
import { createTestDatabase } from './mysql.js';

let testDb;
before(async () => {
  testDb = await createTestDatabase();
});
after(() => testDb.drop());

test('creates the login secret once and keeps it', async () => {
  const first = await loadOrCreateSecret(testDb.db, 'jwt_secret');
  const second = await loadOrCreateSecret(testDb.db, 'jwt_secret');
  assert.equal(first.length, 96);
  assert.equal(first, second);
});

test('needs a password for the first admin account', async () => {
  assert.equal(await seedAdmin(testDb.db, 'admin', null), false, 'nothing to do while an admin exists');
  await testDb.db.run('DELETE FROM admins');
  await assert.rejects(seedAdmin(testDb.db, 'admin', null), /ADMIN_PASSWORD/);
  assert.equal(await seedAdmin(testDb.db, 'admin', 'a-strong-password'), true);
});

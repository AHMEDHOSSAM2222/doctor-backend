import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase } from './mysql.js';
import { phonesMatch } from '../src/patients.js';

const config = {
  jwtSecret: 'test-secret',
  jwtExpiresIn: '1h',
  corsOrigins: ['*'],
  trustProxy: false,
  lookupMaxAttempts: 5,
  lookupWindowMinutes: 15,
  patientAccessMinutes: 30,
  maxUploadMb: 1,
  uploadDir: '/nonexistent-uploads-not-used-here',
};

let testDb;
let server;
let baseUrl;
let token;

const api = async (method, path, body, auth = true) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
};

before(async () => {
  testDb = await createTestDatabase();
  const { db } = testDb;
  server = createApp({ db, config }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await testDb.drop();
});

describe('phonesMatch', () => {
  test('tolerates country codes, spaces and leading zeros', () => {
    assert.ok(phonesMatch('01012345678', '+20 101 234 5678'));
    assert.ok(phonesMatch('+201012345678', '01012345678'));
    assert.ok(phonesMatch('010-1234-5678', '01012345678'));
  });
  test('accepts Arabic-Indic digits typed on Arabic keyboards', () => {
    assert.ok(phonesMatch('01012345678', '٠١٠١٢٣٤٥٦٧٨'));
    assert.ok(phonesMatch('01012345678', '۰۱۰۱۲۳۴۵۶۷۸'));
  });
  test('rejects different or too-short numbers', () => {
    assert.ok(!phonesMatch('01012345678', '01012345679'));
    assert.ok(!phonesMatch('01012345678', '5678'));
    assert.ok(!phonesMatch('', ''));
  });
});

describe('auth', () => {
  test('rejects a wrong password', async () => {
    const { status } = await api('POST', '/api/auth/login', { username: 'admin', password: 'nope' }, false);
    assert.equal(status, 401);
  });

  test('logs in and returns a token', async () => {
    const { status, data } = await api('POST', '/api/auth/login', { username: 'admin', password: 'secret123' }, false);
    assert.equal(status, 200);
    assert.ok(data.token);
    token = data.token;
  });

  test('protects patient routes', async () => {
    const { status } = await api('GET', '/api/patients', null, false);
    assert.equal(status, 401);
  });
});

describe('patients and public lookup', () => {
  let patientId;

  test('creates a patient with an auto-generated file number', async () => {
    const { status, data } = await api('POST', '/api/patients', {
      fullName: 'Mona Ali',
      phone: '01012345678',
      dateOfBirth: '1990-05-01',
      gender: 'female',
      bloodType: 'O+',
      allergies: 'Penicillin',
    });
    assert.equal(status, 201);
    assert.equal(data.patient.fileNumber, '1001');
    patientId = data.patient.id;
  });

  test('validates required fields', async () => {
    const { status, data } = await api('POST', '/api/patients', { fullName: '', phone: '0101' });
    assert.equal(status, 400);
    assert.match(data.error, /Phone|Full name/);
  });

  test('rejects duplicate file numbers', async () => {
    const { status } = await api('POST', '/api/patients', { fileNumber: '1001', fullName: 'X', phone: '0123456789' });
    assert.equal(status, 409);
  });

  test('rejects dates that do not exist instead of failing in MySQL', async () => {
    const { status, data } = await api('POST', '/api/patients', {
      fullName: 'Bad Date',
      phone: '0123456789',
      dateOfBirth: '2026-02-30',
    });
    assert.equal(status, 400);
    assert.match(data.error, /Date of birth/);
  });

  test('treats non-numeric ids as not found', async () => {
    assert.equal((await api('GET', '/api/patients/abc')).status, 404);
    assert.equal((await api('DELETE', `/api/patients/${patientId}/visits/1e3`)).status, 404);
  });

  test('stores Arabic text and keeps file numbers unique regardless of case', async () => {
    const created = await api('POST', '/api/patients', {
      fileNumber: 'A-12',
      fullName: 'منى علي حسن',
      phone: '01099887766',
      notes: 'حساسية من البنسلين',
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.patient.fullName, 'منى علي حسن');
    assert.equal(created.data.patient.notes, 'حساسية من البنسلين');
    assert.match(created.data.patient.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const createdAt = Date.parse(`${created.data.patient.createdAt.replace(' ', 'T')}Z`);
    assert.ok(Math.abs(createdAt - Date.now()) < 60_000, 'timestamps are stored in UTC');

    const duplicate = await api('POST', '/api/patients', { fileNumber: 'a-12', fullName: 'X', phone: '0123456789' });
    assert.equal(duplicate.status, 409);
    await api('DELETE', `/api/patients/${created.data.patient.id}`);
  });

  test('adds visits and lists patients', async () => {
    await api('POST', `/api/patients/${patientId}/visits`, {
      visitDate: '2026-01-10',
      diagnosis: 'Flu',
      prescription: 'Rest and fluids',
    });
    const { status, data } = await api('POST', `/api/patients/${patientId}/visits`, {
      visitDate: '2026-03-02',
      diagnosis: 'Follow-up',
    });
    assert.equal(status, 201);
    assert.equal(data.patient.visits.length, 2);
    assert.equal(data.patient.visits[0].visitDate, '2026-03-02');

    const list = await api('GET', '/api/patients?search=mona');
    assert.equal(list.data.total, 1);
    assert.equal(list.data.patients[0].visitCount, 2);
  });

  test('returns the file for the right file number and phone', async () => {
    const { status, data } = await api(
      'POST',
      '/api/public/lookup',
      { fileNumber: '1001', phone: '+20 101 234 5678' },
      false,
    );
    assert.equal(status, 200);
    assert.equal(data.patient.fullName, 'Mona Ali');
    assert.equal(data.patient.allergies, 'Penicillin');
    assert.equal(data.visits.length, 2);
    assert.equal(data.patient.phone, undefined, 'phone is not echoed back');
    assert.equal(data.patient.id, undefined, 'internal id is not exposed');
  });

  test('accepts a file number typed in Arabic digits', async () => {
    const { status } = await api('POST', '/api/public/lookup', { fileNumber: '١٠٠١', phone: '٠١٠١٢٣٤٥٦٧٨' }, false);
    assert.equal(status, 200);
  });

  test('does not reveal a file when the phone is wrong', async () => {
    const { status, data } = await api(
      'POST',
      '/api/public/lookup',
      { fileNumber: '1001', phone: '01099999999' },
      false,
    );
    assert.equal(status, 404);
    assert.equal(data.patient, undefined);
  });

  test('rate limits repeated failed lookups', async () => {
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await api('POST', '/api/public/lookup', { fileNumber: `9${i}`, phone: '01000000000' }, false);
    }
    assert.equal(last.status, 429);
    assert.equal(last.data.code, 'RATE_LIMITED');
  });

  test('deletes a patient and their visits', async () => {
    const { status } = await api('DELETE', `/api/patients/${patientId}`);
    assert.equal(status, 204);
    const { status: after } = await api('GET', `/api/patients/${patientId}`);
    assert.equal(after, 404);
  });
});

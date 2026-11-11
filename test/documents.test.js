import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase, seedAdmin } from '../src/db.js';

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-uploads-'));
const config = {
  jwtSecret: 'test-secret',
  jwtExpiresIn: '1h',
  corsOrigins: ['*'],
  trustProxy: false,
  lookupMaxAttempts: 50,
  lookupWindowMinutes: 15,
  patientAccessMinutes: 30,
  patientMaxUploads: 3,
  maxUploadMb: 1,
  uploadDir,
};

const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const storedFiles = () => fs.readdirSync(uploadDir);

let server;
let baseUrl;
let token;

const api = async (method, urlPath, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};

const upload = async (patientId, files) => {
  const form = new FormData();
  for (const { name, buffer, title = '', type = 'application/pdf' } of files) {
    form.append('files', new Blob([buffer], { type }), name);
    form.append('titles', title);
  }
  const res = await fetch(`${baseUrl}/api/patients/${patientId}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, data: await res.json() };
};

before(async () => {
  const db = openDatabase(':memory:');
  seedAdmin(db, 'admin', 'secret123');
  server = createApp({ db, config }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  ({
    data: { token },
  } = await api('POST', '/api/auth/login', { username: 'admin', password: 'secret123' }));
});

after(() => {
  server.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('patient PDF documents', () => {
  let patientA;
  let patientB;
  let docIds;
  let access;

  test('uploads PDFs with titles, using the file name when no title is given', async () => {
    patientA = (await api('POST', '/api/patients', { fullName: 'Patient A', phone: '01011111111' })).data.patient;
    patientB = (await api('POST', '/api/patients', { fullName: 'Patient B', phone: '01022222222' })).data.patient;
    assert.deepEqual(patientA.documents, []);

    const { status, data } = await upload(patientA.id, [
      { name: 'scan_0012.pdf', buffer: pdf('blood'), title: 'Blood test March 2026' },
      { name: 'تحليل.pdf', buffer: pdf('arabic') },
    ]);
    assert.equal(status, 201);
    const titles = data.patient.documents.map((d) => d.title).sort();
    assert.deepEqual(titles, ['Blood test March 2026', 'تحليل']);
    assert.equal(storedFiles().length, 2);
    docIds = Object.fromEntries(data.patient.documents.map((d) => [d.title, d.id]));
  });

  test('rejects files that are not PDFs, even with a .pdf name', async () => {
    const { status, data } = await upload(patientA.id, [
      { name: 'ok.pdf', buffer: pdf('fine') },
      { name: 'fake.pdf', buffer: Buffer.from('MZ not a pdf') },
    ]);
    assert.equal(status, 400);
    assert.match(data.error, /fake\.pdf.*not a PDF/);
    assert.equal(storedFiles().length, 2, 'nothing from the rejected upload is stored');
  });

  test('rejects PDFs over the size limit', async () => {
    const big = Buffer.concat([pdf('big'), Buffer.alloc(1024 * 1024 + 10)]);
    const { status, data } = await upload(patientA.id, [{ name: 'big.pdf', buffer: big }]);
    assert.equal(status, 413);
    assert.match(data.error, /1 MB or smaller/);
  });

  test('rejects an upload with no files', async () => {
    const { status } = await upload(patientA.id, []);
    assert.equal(status, 400);
  });

  test('admin can open a PDF', async () => {
    const res = await fetch(`${baseUrl}/api/patients/${patientA.id}/documents/${docIds['Blood test March 2026']}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /^inline; filename="Blood test March 2026\.pdf"/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), pdf('blood'));
  });

  test('patient lookup lists the PDFs and returns a temporary access token', async () => {
    const res = await fetch(`${baseUrl}/api/public/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileNumber: patientA.fileNumber, phone: '01011111111' }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.documents.length, 2);
    assert.equal(data.documents[0].stored_name, undefined);
    assert.equal(data.documents[0].originalName, undefined);
    assert.ok(data.access.token);
    assert.ok(Date.parse(data.access.expiresAt) > Date.now());
    access = data.access;
  });

  test('patient opens their PDF with the access token', async () => {
    const id = docIds['تحليل'];
    const res = await fetch(`${baseUrl}/api/public/documents/${id}?token=${access.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''%D8%AA%D8%AD%D9%84%D9%8A%D9%84\.pdf/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), pdf('arabic'));
  });

  test('PDF links need a valid token', async () => {
    const id = docIds['تحليل'];
    for (const query of ['', '?token=', '?token=garbage']) {
      const res = await fetch(`${baseUrl}/api/public/documents/${id}${query}`);
      assert.equal(res.status, 401);
      assert.match(await res.text(), /expired/);
    }
  });

  test("a patient's token cannot open another patient's PDF", async () => {
    const { data } = await upload(patientB.id, [{ name: 'b.pdf', buffer: pdf('patient b') }]);
    const bDocId = data.patient.documents[0].id;
    const res = await fetch(`${baseUrl}/api/public/documents/${bDocId}?token=${access.token}`);
    assert.equal(res.status, 404);
  });

  test('a patient token is not an admin login', async () => {
    const res = await fetch(`${baseUrl}/api/patients`, { headers: { authorization: `Bearer ${access.token}` } });
    assert.equal(res.status, 401);
  });

  test('deleting a PDF removes it from disk', async () => {
    const before = storedFiles().length;
    const { status, data } = await api('DELETE', `/api/patients/${patientA.id}/documents/${docIds['تحليل']}`);
    assert.equal(status, 200);
    assert.equal(data.patient.documents.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(storedFiles().length, before - 1);
  });

  test('deleting a patient removes all of their PDFs from disk', async () => {
    const before = storedFiles().length;
    const { status } = await api('DELETE', `/api/patients/${patientA.id}`);
    assert.equal(status, 204);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(storedFiles().length, before - 1);
  });
});

describe('patients adding their own PDFs', () => {
  let patient;
  let patientToken;
  let staffDocId;

  const lookup = async () => {
    const res = await fetch(`${baseUrl}/api/public/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileNumber: patient.fileNumber, phone: '01033333333' }),
    });
    return res.json();
  };

  const patientUpload = async (files, bearer = patientToken) => {
    const form = new FormData();
    for (const { name, buffer, title = '' } of files) {
      form.append('files', new Blob([buffer], { type: 'application/pdf' }), name);
      form.append('titles', title);
    }
    const res = await fetch(`${baseUrl}/api/public/documents`, {
      method: 'POST',
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      body: form,
    });
    return { status: res.status, data: await res.json() };
  };

  const patientDelete = async (docId) => {
    const res = await fetch(`${baseUrl}/api/public/documents/${docId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${patientToken}` },
    });
    return { status: res.status, data: await res.json() };
  };

  before(async () => {
    patient = (await api('POST', '/api/patients', { fullName: 'Patient C', phone: '01033333333' })).data.patient;
    const staff = await upload(patient.id, [
      { name: 'clinic.pdf', buffer: pdf('clinic report'), title: 'Clinic report' },
    ]);
    staffDocId = staff.data.patient.documents[0].id;
    patientToken = (await lookup()).access.token;
  });

  test('a patient uploads a PDF to their own file', async () => {
    const { status, data } = await patientUpload([
      { name: 'outside-lab.pdf', buffer: pdf('outside lab'), title: 'Outside lab results' },
    ]);
    assert.equal(status, 201);
    const added = data.documents.find((d) => d.title === 'Outside lab results');
    assert.equal(added.uploadedBy, 'patient');
    assert.equal(data.documents.find((d) => d.id === staffDocId).uploadedBy, 'staff');
    assert.equal(added.stored_name, undefined);

    // Staff see it in the dashboard, marked as added by the patient.
    const { data: admin } = await api('GET', `/api/patients/${patient.id}`);
    assert.equal(admin.patient.documents.find((d) => d.id === added.id).uploadedBy, 'patient');

    // And the patient can open it with the same access token.
    const res = await fetch(`${baseUrl}/api/public/documents/${added.id}?token=${patientToken}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), pdf('outside lab'));
  });

  test('uploading needs the patient access token', async () => {
    assert.equal((await patientUpload([{ name: 'x.pdf', buffer: pdf('x') }], null)).status, 401);
    assert.equal((await patientUpload([{ name: 'x.pdf', buffer: pdf('x') }], 'garbage')).data.code, 'EXPIRED');
    assert.equal(
      (await patientUpload([{ name: 'x.pdf', buffer: pdf('x') }], token)).status,
      401,
      'admin token refused',
    );
  });

  test('patients can only upload real PDFs', async () => {
    const { status, data } = await patientUpload([{ name: 'photo.pdf', buffer: Buffer.from('\xff\xd8 jpeg') }]);
    assert.equal(status, 400);
    assert.equal(data.code, 'NOT_PDF');
  });

  test('patients have a limit on how many PDFs they can add', async () => {
    const { status, data } = await patientUpload([
      { name: 'a.pdf', buffer: pdf('a') },
      { name: 'b.pdf', buffer: pdf('b') },
      { name: 'c.pdf', buffer: pdf('c') },
    ]);
    assert.equal(status, 400);
    assert.equal(data.code, 'UPLOAD_LIMIT');
    assert.equal((await patientUpload([{ name: 'a.pdf', buffer: pdf('a') }])).status, 201, 'still under the limit');
  });

  test("patients can delete PDFs they added, but not the clinic's", async () => {
    const file = await lookup();
    const own = file.documents.find((d) => d.uploadedBy === 'patient');
    const before = storedFiles().length;

    const refused = await patientDelete(staffDocId);
    assert.equal(refused.status, 403);
    assert.equal(refused.data.code, 'NOT_YOURS');

    const { status, data: after } = await patientDelete(own.id);
    assert.equal(status, 200);
    assert.ok(!after.documents.some((d) => d.id === own.id));
    assert.ok(after.documents.some((d) => d.id === staffDocId));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(storedFiles().length, before - 1);
  });

  test('a patient cannot delete documents in another file', async () => {
    const other = (await api('POST', '/api/patients', { fullName: 'Patient D', phone: '01044444444' })).data.patient;
    const { data } = await upload(other.id, [{ name: 'd.pdf', buffer: pdf('d') }]);
    const { status } = await patientDelete(data.patient.documents[0].id);
    assert.equal(status, 404);
  });
});

describe('database migration', () => {
  test('adds uploaded_by to documents tables created before patient uploads', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const file = path.join(uploadDir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY, patient_id INTEGER, title TEXT, original_name TEXT,
              stored_name TEXT, size INTEGER, created_at TEXT DEFAULT (datetime('now')));
              INSERT INTO documents (patient_id, title, original_name, stored_name, size) VALUES (1, 't', 'o', 's', 1);`);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('SELECT uploaded_by FROM documents').get().uploaded_by, 'staff');
    db.close();
  });
});

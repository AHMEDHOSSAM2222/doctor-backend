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

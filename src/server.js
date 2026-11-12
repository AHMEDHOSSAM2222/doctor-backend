import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { loadOrCreateSecret, openDatabase, seedAdmin } from './db.js';

const stop = (...lines) => {
  for (const line of lines) console.error(line);
  process.exit(1);
};

// Uploaded PDFs must be writable before anything else starts.
try {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.accessSync(config.uploadDir, fs.constants.W_OK);
} catch (err) {
  stop(
    `Cannot write to the PDF folder ${config.uploadDir} (${err.code}).`,
    'On Railway, add the variable RAILWAY_RUN_UID=0 to this service. Elsewhere, check who owns the folder.',
  );
}

let db;
try {
  db = await openDatabase(config.database);
} catch (err) {
  const { host, port, user, database } = config.database;
  stop(
    `Cannot connect to MySQL at ${host}:${port} (database "${database}", user "${user}").`,
    `${err.code || ''} ${err.message}`.trim(),
    'Check DATABASE_URL or the MYSQL_* settings, and that MySQL is running.',
  );
}

config.jwtSecret ||= await loadOrCreateSecret(db, 'jwt_secret');
try {
  await seedAdmin(db, config.adminUsername, config.adminPassword);
} catch (err) {
  stop(err.message);
}

const app = createApp({ db, config });
app.listen(config.port, () => {
  console.log(`Doctor backend listening on http://localhost:${config.port}`);
});

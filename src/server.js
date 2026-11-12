import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase, seedAdmin } from './db.js';

let db;
try {
  db = await openDatabase(config.database);
} catch (err) {
  const { host, port, user, database } = config.database;
  console.error(`Cannot connect to MySQL at ${host}:${port} (database "${database}", user "${user}").`);
  console.error(`${err.code || ''} ${err.message}`.trim());
  console.error('Check DATABASE_URL or the MYSQL_* settings in .env, and that MySQL is running.');
  process.exit(1);
}
await seedAdmin(db, config.adminUsername, config.adminPassword);

const app = createApp({ db, config });
app.listen(config.port, () => {
  console.log(`Doctor backend listening on http://localhost:${config.port}`);
});

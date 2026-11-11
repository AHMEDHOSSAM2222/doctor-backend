import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase, seedAdmin } from './db.js';

const db = openDatabase(config.dbPath);
seedAdmin(db, config.adminUsername, config.adminPassword);

const app = createApp({ db, config });
app.listen(config.port, () => {
  console.log(`Doctor backend listening on http://localhost:${config.port}`);
});

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authRoutes } from './routes/auth.js';
import { patientRoutes } from './routes/patients.js';
import { publicRoutes } from './routes/public.js';

export function createApp({ db, config }) {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes({ db, config }));
  app.use('/api/patients', patientRoutes({ db, config }));
  app.use('/api/public', publicRoutes({ db, config }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY' && /uq_patients_file_number/.test(err.message)) {
      return res.status(409).json({ error: 'This file number is already used by another patient' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { hashPassword, requireAdmin, signToken, verifyPassword } from '../auth.js';
import { ValidationError } from '../patients.js';

export function authRoutes({ db, config }) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const admin = username && (await db.get('SELECT * FROM admins WHERE username = ?', [username]));
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    return res.json({ token: signToken(admin, config), admin: { username: admin.username } });
  });

  router.get('/me', requireAdmin(config), (req, res) => {
    res.json({ admin: { username: req.admin.username } });
  });

  router.post('/change-password', requireAdmin(config), async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const admin = await db.get('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      return res.status(400).json({ error: 'Current password is wrong' });
    }
    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');
    await db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), admin.id]);
    return res.json({ ok: true });
  });

  return router;
}

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function signToken(admin, config) {
  return jwt.sign({ sub: String(admin.id), username: admin.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Express middleware: rejects requests without a valid admin Bearer token. */
export function requireAdmin(config) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.admin = { id: Number(payload.sub), username: payload.username };
      return next();
    } catch {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
  };
}

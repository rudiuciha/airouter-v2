const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { read, write } = require('../utils/storage');

const router = express.Router();

// ── Login rate limiting ──────────────────────────────────────────
// Track failed login attempts per IP to prevent brute force
const _loginAttempts = new Map(); // { ip: { count, resetAt } }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = _loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    _loginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = _loginAttempts.get(ip);
  if (record && now <= record.resetAt) {
    record.count++;
  } else {
    _loginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MS });
  }
}

function resetLoginAttempts(ip) {
  _loginAttempts.delete(ip);
}

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of _loginAttempts) {
    if (now > record.resetAt) _loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

// ── Routes ───────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const rateCheck = checkLoginRateLimit(ip);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Too many login attempts. Try again in ${rateCheck.retryAfter} seconds.`,
      retryAfter: rateCheck.retryAfter,
    });
  }

  const { password } = req.body;
  if (!password) return res.status(400).json({ error:'Password required' });

  const config = read('config');
  if (!bcrypt.compareSync(password, config.passwordHash)) {
    recordFailedLogin(ip);
    return res.status(401).json({
      error: 'Invalid password',
      attemptsRemaining: rateCheck.remaining - 1,
    });
  }

  // Success — reset rate limit
  resetLoginAttempts(ip);

  const secret = config.jwtSecret || process.env.JWT_SECRET || 'changeme';
  res.json({
    token: jwt.sign({ role:'admin' }, secret, { expiresIn:'7d' }),
    expiresIn:'7d',
  });
});

router.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error:'Both currentPassword and newPassword required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error:'New password must be at least 8 characters' });
  }
  const config = read('config');
  if (!bcrypt.compareSync(currentPassword, config.passwordHash)) {
    return res.status(401).json({ error:'Invalid current password' });
  }
  config.passwordHash = bcrypt.hashSync(newPassword, 10);
  write('config', config);
  res.json({ ok:true });
});

module.exports = router;

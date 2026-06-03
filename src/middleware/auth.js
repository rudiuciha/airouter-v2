// middleware/auth.js
const jwt = require('jsonwebtoken');
const { read } = require('../utils/storage');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error:'No token' });
  const secret = read('config')?.jwtSecret || process.env.JWT_SECRET || 'changeme';
  try { req.user = jwt.verify(token, secret); next(); }
  catch { res.status(401).json({ error:'Invalid or expired token' }); }
}

module.exports = { authMiddleware };

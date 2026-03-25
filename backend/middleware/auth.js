// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET not set' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { wallet: payload.wallet, roles: payload.roles || ['user'] };
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  const adminWallet = process.env.ADMIN_WALLET_ADDRESS;
  if (!adminWallet) return res.status(500).json({ error: 'ADMIN_WALLET_ADDRESS not set' });
  if (req.user?.wallet !== adminWallet) return res.status(403).json({ error: 'Forbidden' });
  return next();
}

module.exports = { authMiddleware, adminMiddleware };
const jwt = require('jsonwebtoken');
const { runWithUser } = require('../services/anthropicClient');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Nicht eingeloggt. Bitte anmelden.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    // Trägt den eingeloggten Nutzernamen durch den gesamten (auch asynchron
    // verschachtelten) weiteren Request - notwendig für das Token-Nutzungs-Tracking
    // in services/anthropicClient.js, ohne dass jede Funktion einen extra Parameter braucht.
    runWithUser(decoded.username, next);
  } catch (e) {
    return res.status(401).json({ error: 'Sitzung abgelaufen oder ungültig. Bitte erneut anmelden.' });
  }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur für Administratoren.' });
  }
  next();
}
module.exports = { requireAuth, requireAdmin };

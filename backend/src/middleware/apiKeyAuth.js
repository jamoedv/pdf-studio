module.exports = (req, res, next) => {
  const expectedKey = process.env.TOOL_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({ error: 'Server nicht korrekt konfiguriert (TOOL_API_KEY fehlt)' });
  }

  const xApiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const providedKey = xApiKey || bearerKey;

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Ungültiger oder fehlender API-Key. Header "X-API-Key" oder "Authorization: Bearer <key>" erforderlich.' });
  }

  next();
};

module.exports = (req, res, next) => {
  const providedKey = req.headers['x-api-key'];
  const expectedKey = process.env.TOOL_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({ error: 'Server nicht korrekt konfiguriert (TOOL_API_KEY fehlt)' });
  }

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Ungültiger oder fehlender API-Key. Header "X-API-Key" erforderlich.' });
  }

  next();
};

const express = require('express');
const router = express.Router();
const { getAdapter, bot } = require('../services/teamsBotService');

// WICHTIG: Diese Route muss OHNE requireAuth erreichbar sein - der Bot Framework
// Connector authentifiziert sich über sein eigenes Token-Verfahren (JWT im
// Authorization-Header, von adapter.process() geprüft), nicht über euer Portal-Login.
// Muss deshalb, wie /onedrive/callback, VOR den requireAuth-Routern registriert werden.
router.post('/messages', async (req, res) => {
  try {
    const adapter = getAdapter();
    await adapter.process(req, res, (context) => bot.run(context));
  } catch (error) {
    // Fehlende TEAMS_BOT_*-Konfiguration darf NICHT den ganzen Server lahmlegen -
    // nur diese eine Route antwortet dann mit einer klaren Fehlermeldung.
    console.error('Teams-Bot nicht verfügbar:', error.message);
    res.status(503).json({ error: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { adapter, bot } = require('../services/teamsBotService');

// WICHTIG: Diese Route muss OHNE requireAuth erreichbar sein - der Bot Framework
// Connector authentifiziert sich über sein eigenes Token-Verfahren (JWT im
// Authorization-Header, von adapter.process() geprüft), nicht über euer Portal-Login.
// Muss deshalb, wie /onedrive/callback, VOR den requireAuth-Routern registriert werden.
router.post('/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

module.exports = router;

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { verifyDownloadToken } = require('../services/teamsDownloadService');

// Muss OHNE requireAuth erreichbar sein - Teams-Nutzer haben kein Portal-Login,
// die Autorisierung läuft über den signierten, zeitlich befristeten Token selbst.
router.get('/teams-download/:token', (req, res) => {
  try {
    const filePath = verifyDownloadToken(req.params.token);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Datei nicht mehr verfügbar (evtl. abgelaufen).');
    }

    const filename = path.basename(filePath);
    res.download(filePath, filename);
  } catch (error) {
    res.status(401).send('Link ist ungültig oder abgelaufen (gültig für 30 Minuten nach Erzeugung).');
  }
});

module.exports = router;

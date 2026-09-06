const express = require('express');
const router = express.Router();
const graphService = require('../services/graphService');
const tokenStore = require('../services/graphTokenService');

// WICHTIG: Diese Route MUSS öffentlich (ohne requireAuth) und VOR allen anderen
// Routern in server.js registriert werden. Microsofts Redirect kommt ohne
// Authorization-Header - würde sie von einem der anderen Router (die alle
// pauschal requireAuth für JEDE Anfrage unter /api/v1 anwenden) abgefangen,
// bekäme man fälschlich "Nicht eingeloggt" statt der eigentlichen Callback-Logik.
router.get('/onedrive/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) throw new Error(error_description || error);

    const username = graphService.verifyState(state);
    const tokens = await graphService.exchangeCodeForTokens(code);
    tokenStore.saveTokens(username, tokens);

    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:80px;">
      <p>Erfolgreich mit Microsoft verbunden. Dieses Fenster schließt sich automatisch...</p>
      <script>
        if (window.opener) { window.opener.postMessage({ type: 'onedrive-connected' }, '*'); }
        setTimeout(() => window.close(), 1500);
      </script>
    </body></html>`);
  } catch (error) {
    res.status(500).send(`<p>Fehler bei der Verbindung: ${error.message}</p>`);
  }
});

module.exports = router;

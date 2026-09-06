const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const graphService = require('../services/graphService');
const tokenStore = require('../services/graphTokenService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// --- Verbindung herstellen -------------------------------------------------

// Liefert die Microsoft-Login-URL, die das Frontend in einem Popup öffnet.
router.get('/onedrive/auth-url', requireAuth, (req, res) => {
  try {
    const url = graphService.getAuthUrl(req.user.username);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Hinweis: Die /onedrive/callback-Route liegt in einem eigenen, früh geladenen
// Router (routes/onedrive-callback.js), da sie OHNE requireAuth erreichbar sein
// muss (Microsofts Redirect hat keinen Authorization-Header).

router.get('/onedrive/status', requireAuth, (req, res) => {
  res.json({ connected: tokenStore.isConnected(req.user.username) });
});

// Diagnose: zeigt exakt, welche Microsoft-Identität Graph gerade auflöst
// (persönliches Konto vs. Tenant-Mitglied) - hilfreich bei Lizenz-/Kontext-Problemen.
router.get('/onedrive/whoami', requireAuth, async (req, res) => {
  try {
    const accessToken = await graphService.getValidAccessToken(req.user.username);
    const fetchRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await fetchRes.json();
    res.json({ identity: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/onedrive/disconnect', requireAuth, (req, res) => {
  tokenStore.disconnect(req.user.username);
  res.json({ success: true });
});

// --- Durchsuchen ------------------------------------------------------------

router.get('/onedrive/browse', requireAuth, async (req, res) => {
  try {
    const items = await graphService.listOneDrive(req.user.username, req.query.folderId);
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/onedrive/sharepoint/sites', requireAuth, async (req, res) => {
  try {
    const sites = await graphService.listSharePointSites(req.user.username);
    res.json({ sites });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback für frisch angelegte Seiten, die noch nicht in der Such-Indexierung auftauchen.
router.post('/onedrive/sharepoint/site-by-url', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url erforderlich' });
    const site = await graphService.getSiteByUrl(req.user.username, url);
    res.json({ site });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/onedrive/sharepoint/browse', requireAuth, async (req, res) => {
  try {
    const { siteId, folderId, driveId } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId erforderlich' });
    const items = await graphService.listSharePointFolder(req.user.username, siteId, folderId, driveId);
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Import: Datei aus OneDrive/SharePoint auf den Server laden ------------
// Gibt eine fileId (Serverpfad) zurück, kompatibel mit dem restlichen Portal
// (z.B. direkt im Assistenten oder bei der klassischen Verarbeitung nutzbar).

router.post('/onedrive/import', requireAuth, async (req, res) => {
  try {
    const { itemId, driveId, filename } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId erforderlich' });

    const safeName = (filename || 'datei.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
    await graphService.downloadItem(req.user.username, { driveId, itemId }, destPath);

    res.json({ fileId: destPath, filename: filename || safeName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Export: lokal erzeugte Datei nach OneDrive/SharePoint hochladen -------

router.post('/onedrive/export', requireAuth, async (req, res) => {
  try {
    const { fileId, filename, driveId, folderId } = req.body;
    if (!fileId || !filename) return res.status(400).json({ error: 'fileId und filename erforderlich' });

    const result = await graphService.uploadItem(req.user.username, { driveId, folderId, filename }, fileId);
    res.json({ success: true, webUrl: result.webUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

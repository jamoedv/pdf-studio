const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const templateStorage = require('../services/templateStorageService');

router.use(requireAuth);

// Vorlage speichern (neu) oder aktualisieren (wenn id mitgeschickt wird)
router.post('/document-templates/library', (req, res) => {
  try {
    const { name, html, id } = req.body;
    if (!name || !html) return res.status(400).json({ error: 'name und html erforderlich' });

    if (id) {
      const updated = templateStorage.updateTemplate(id, { name, html });
      if (!updated) return res.status(404).json({ error: 'Vorlage nicht gefunden' });
      return res.json(updated);
    }

    const record = templateStorage.saveTemplate(name, html);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alle gespeicherten Vorlagen auflisten (nur Metadaten, kein html)
router.get('/document-templates/library', (req, res) => {
  try {
    res.json({ templates: templateStorage.listTemplates() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eine Vorlage inkl. html-Inhalt laden
router.get('/document-templates/library/:id', (req, res) => {
  try {
    const record = templateStorage.getTemplate(req.params.id);
    if (!record) return res.status(404).json({ error: 'Vorlage nicht gefunden' });
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vorlage löschen
router.delete('/document-templates/library/:id', (req, res) => {
  try {
    const ok = templateStorage.deleteTemplate(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Vorlage nicht gefunden' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

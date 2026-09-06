const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const workflowStorage = require('../services/workflowStorageService');

router.use(requireAuth);

// Alle gespeicherten Workflows auflisten (Metadaten)
router.get('/workflows', (req, res) => {
  try {
    res.json({ workflows: workflowStorage.listWorkflows() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Einen Workflow inkl. Konfiguration laden
router.get('/workflows/:id', (req, res) => {
  try {
    const record = workflowStorage.getWorkflow(req.params.id);
    if (!record) return res.status(404).json({ error: 'Workflow nicht gefunden' });
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Workflow bearbeiten (Name, Beschreibung, Schritte, Konfiguration)
router.put('/workflows/:id', (req, res) => {
  try {
    const { name, description, steps, config } = req.body;
    const updated = workflowStorage.updateWorkflow(req.params.id, { name, description, steps, config });
    if (!updated) return res.status(404).json({ error: 'Workflow nicht gefunden' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Workflow löschen
router.delete('/workflows/:id', (req, res) => {
  try {
    const ok = workflowStorage.deleteWorkflow(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Workflow nicht gefunden' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

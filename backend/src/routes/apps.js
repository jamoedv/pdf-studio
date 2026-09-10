const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const workflowStorage = require('../services/workflowStorageService');
const agentEngine = require('../services/agentEngine');
const { runWithUser } = require('../services/anthropicClient');

router.use(requireAuth);

function isPowerUserOrAdmin(req) {
  return req.user.role === 'poweruser' || req.user.role === 'admin';
}

// Eigene Apps + fuer mich freigegebene Apps.
router.get('/apps', (req, res) => {
  const username = req.user.username;
  const owned = workflowStorage.listOwnedBy(username);
  const shared = workflowStorage.listSharedWith(username);
  res.json({ owned, shared });
});

// Name/Beschreibung nachtraeglich anpassen - nur Besitzer oder Admin.
router.patch('/apps/:id', (req, res) => {
  const wf = workflowStorage.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
  if (wf.ownerUsername !== req.user.username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { name, description } = req.body;
  const updated = workflowStorage.renameApp(req.params.id, name, description);
  res.json({ workflow: updated });
});

// Freigeben/Entziehen fuer einen einzelnen Nutzer - nur Poweruser/Admin, die
// die App auch besitzen (oder generell Admin).
router.post('/apps/:id/share', (req, res) => {
  const wf = workflowStorage.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!isPowerUserOrAdmin(req) || (wf.ownerUsername !== req.user.username && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Keine Berechtigung zum Freigeben' });
  }
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username erforderlich' });
  const updated = workflowStorage.shareWorkflow(req.params.id, username);
  res.json({ workflow: updated });
});

router.delete('/apps/:id/share/:username', (req, res) => {
  const wf = workflowStorage.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!isPowerUserOrAdmin(req) || (wf.ownerUsername !== req.user.username && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const updated = workflowStorage.unshareWorkflow(req.params.id, req.params.username);
  res.json({ workflow: updated });
});

// "Fuer alle freigeben" umschalten.
router.patch('/apps/:id/public', (req, res) => {
  const wf = workflowStorage.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!isPowerUserOrAdmin(req) || (wf.ownerUsername !== req.user.username && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const updated = workflowStorage.setPublic(req.params.id, !!req.body.isPublic);
  res.json({ workflow: updated });
});

// App ausfuehren: Datei(en) hochladen -> Assistent bekommt eine Anweisung, die
// auf genau diesen Workflow verweist (er ruft sich dessen Konfiguration selbst
// per get_workflow ab, genau wie im normalen Chat).
router.post('/apps/:id/run', async (req, res) => {
  try {
    const wf = workflowStorage.getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
    if (!workflowStorage.canRun(wf, req.user.username)) {
      return res.status(403).json({ error: 'Keine Berechtigung, diese App auszuführen' });
    }

    const { fileIds, history, message } = req.body;
    const effectiveMessage = message || `Führe den gespeicherten Workflow "${wf.name}" (id: ${wf.id}) mit der/den angehängten Datei(en) aus.`;

    const result = await runWithUser(req.user.username, () =>
      agentEngine.runAgentLoop({ history: history || [], message: effectiveMessage, fileIds })
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

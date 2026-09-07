const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const watchedFolderService = require('../services/watchedFolderService');
const teamsConvRefStore = require('../services/teamsConversationRefStore');

router.use(requireAuth);

router.get('/watched-folders', (req, res) => {
  const watches = watchedFolderService.listWatches(req.user.username);
  res.json({ watches });
});

router.post('/watched-folders', (req, res) => {
  try {
    const { source, siteId, driveId, folderId, folderLabel, instruction, destination, notifyEmail, notifyTeamsUserId } = req.body;
    if (!source || !folderId || !instruction) {
      return res.status(400).json({ error: 'source, folderId und instruction sind erforderlich' });
    }
    const watch = watchedFolderService.createWatch({
      username: req.user.username,
      source, siteId, driveId, folderId, folderLabel, instruction, destination, notifyEmail, notifyTeamsUserId,
    });
    res.json({ watch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/watched-folders/:id', (req, res) => {
  const watch = watchedFolderService.getWatch(req.params.id);
  if (!watch || watch.username !== req.user.username) return res.status(404).json({ error: 'Nicht gefunden' });
  const updated = watchedFolderService.updateWatch(req.params.id, req.body);
  res.json({ watch: updated });
});

router.delete('/watched-folders/:id', (req, res) => {
  const watch = watchedFolderService.getWatch(req.params.id);
  if (!watch || watch.username !== req.user.username) return res.status(404).json({ error: 'Nicht gefunden' });
  watchedFolderService.deleteWatch(req.params.id);
  res.json({ success: true });
});

// Für die Auswahl im Portal: welche Teams-Kontakte kennt der Bot bereits
// (haben ihm schon mal geschrieben), damit man einen davon für Benachrichtigungen wählen kann.
router.get('/watched-folders-teams-contacts', (req, res) => {
  res.json({ contacts: teamsConvRefStore.listKnownContacts() });
});

module.exports = router;

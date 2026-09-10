const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');
const agentEngine = require('../services/agentEngine');
const { runWithUser } = require('../services/anthropicClient');

router.use(requireAuth);

router.post('/assistant/upload', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Keine Dateien hochgeladen' });
    const files = req.files.map((f) => ({ fileId: f.path, filename: f.originalname }));
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/assistant/chat', async (req, res) => {
  try {
    const { history, message, fileIds, model } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message erforderlich' });

    // WICHTIG: Ohne diesen Nutzerkontext wuesste agentEngine (z.B. beim Speichern
    // eines Workflows) nicht, wer der aktuelle Nutzer ist - ownerUsername bliebe leer.
    const result = await runWithUser(req.user.username, () =>
      agentEngine.runAgentLoop({ history, message, fileIds, model })
    );
    res.json(result);
  } catch (error) {
    console.error('Assistant chat error:', error.message);
    res.status(500).json({ error: error.message, reply: 'Entschuldigung, da ist etwas schiefgelaufen.' });
  }
});

module.exports = router;

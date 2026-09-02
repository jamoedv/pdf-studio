const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
router.use(requireAuth);
const upload = require('../middleware/upload');
const queueService = require('../services/queueService');
const pdfService = require('../services/pdfService');

router.post('/summarize', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await pdfService.summarizePDF(req.file.path);
    res.json(result);
  } catch (error) {
    console.error('Summarize error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/redact', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const useAI = req.body.useAI !== 'false';
    let customTerms = [];
    if (req.body.customTerms) {
      try {
        customTerms = JSON.parse(req.body.customTerms);
      } catch (e) {
        customTerms = req.body.customTerms.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const job = await queueService.addJob('redact', {
      inputPath: req.file.path,
      options: { useAI, customTerms }
    });

    res.json(job);
  } catch (error) {
    console.error('Redact error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

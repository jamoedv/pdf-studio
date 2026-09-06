const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');
const examGradingService = require('../services/examGradingService');
const { withUserContext } = require('../services/anthropicClient');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

router.use(requireAuth);

// Musterlösung hochladen -> strukturiertes Bewertungsschema extrahieren (zur Prüfung/Korrektur durch den Trainer)
router.post('/exam-grading/answer-key', upload.single('file'), withUserContext, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Musterlösung (Datei) erforderlich' });
    const answerKey = await examGradingService.extractAnswerKey(req.file.path);
    res.json(answerKey);
  } catch (error) {
    console.error('Answer-key extraction error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Einen einzelnen Antwortbogen gegen ein Bewertungsschema bewerten
router.post('/exam-grading/grade', upload.single('file'), withUserContext, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Antwortbogen (Datei) erforderlich' });
    const { answerKey } = req.body;
    if (!answerKey) return res.status(400).json({ error: 'answerKey erforderlich' });

    const parsedKey = JSON.parse(answerKey);
    const result = await examGradingService.gradeSubmission(parsedKey, req.file.path);
    result.filename = req.file.originalname;
    res.json(result);
  } catch (error) {
    console.error('Grading error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Notenübersicht mehrerer bewerteter Bögen als Excel exportieren
router.post('/exam-grading/export-excel', async (req, res, next) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results (Array) erforderlich' });
    }
    const outputPath = path.join(process.env.PROCESSED_DIR || 'processed', `notenuebersicht_${uuidv4()}.xlsx`);
    await examGradingService.exportResultsToExcel(results, outputPath);
    res.json({ outputPath });
  } catch (error) {
    console.error('Excel export error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

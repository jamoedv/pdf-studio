const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
router.use(requireAuth);
const upload = require('../middleware/upload');
const pdfService = require('../services/pdfService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

router.post('/extract-tables', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    for (const file of req.files) {
      try {
        const outputPath = path.join(process.env.PROCESSED_DIR || 'processed', `tables_${uuidv4()}.xlsx`);
        const result = await pdfService.extractTables(file.path, outputPath);
        results.push({ filename: file.originalname, ...result });
      } catch (err) {
        results.push({ filename: file.originalname, error: err.message });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Extract tables error:', error.message);
    res.status(500).json({ error: 'Tabellen-Extraktion fehlgeschlagen: ' + error.message });
  }
});

router.post('/extract-keyvalues', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const generateReport = req.body.generateReport === 'true';

    const results = [];
    for (const file of req.files) {
      try {
        let reportOutputPath = null;
        if (generateReport) {
          reportOutputPath = path.join(process.env.PROCESSED_DIR || 'processed', `keyvalues_report_${uuidv4()}.pdf`);
        }
        const result = await pdfService.extractKeyValues(file.path, generateReport, reportOutputPath);
        results.push({ filename: file.originalname, ...result });
      } catch (err) {
        results.push({ filename: file.originalname, error: err.message });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Extract keyvalues error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/compare', upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.files?.fileA || !req.files?.fileB) {
      return res.status(400).json({ error: 'Beide Dateien (fileA, fileB) erforderlich' });
    }
    const generateReport = req.body.generateReport === 'true';
    let reportOutputPath = null;
    if (generateReport) {
      reportOutputPath = path.join(process.env.PROCESSED_DIR || 'processed', `compare_report_${uuidv4()}.pdf`);
    }
    const result = await pdfService.compareRevisions(req.files.fileA[0].path, req.files.fileB[0].path, generateReport, reportOutputPath);
    res.json(result);
  } catch (error) {
    console.error('Compare error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/extract-standards', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const generateReport = req.body.generateReport === 'true';

    const results = [];
    for (const file of req.files) {
      try {
        let reportOutputPath = null;
        if (generateReport) {
          reportOutputPath = path.join(process.env.PROCESSED_DIR || 'processed', `standards_report_${uuidv4()}.pdf`);
        }
        const result = await pdfService.extractStandards(file.path, generateReport, reportOutputPath);
        results.push({ filename: file.originalname, ...result });
      } catch (err) {
        results.push({ filename: file.originalname, error: err.message });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Extract standards error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

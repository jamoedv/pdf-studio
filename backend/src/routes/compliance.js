const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { requireAuth } = require('../middleware/requireAuth');
const pdfService = require('../services/pdfService');

router.use(requireAuth);

router.post('/compliance-check', upload.fields([
  { name: 'reference', maxCount: 1 },
  { name: 'reports', maxCount: 20 }
]), async (req, res, next) => {
  try {
    if (!req.files?.reference || !req.files?.reports) {
      return res.status(400).json({ error: 'Referenzdatei (reference) und mindestens ein Prüfbericht (reports) erforderlich' });
    }

    const referencePath = req.files.reference[0].path;
    const reportPaths = req.files.reports.map(f => f.path);

    const generateReport = req.body.generateReport === 'true';
    let reportOutputPath = null;
    if (generateReport) {
      const path = require('path');
      reportOutputPath = path.join(process.env.PROCESSED_DIR || 'processed', `compliance_report_${Date.now()}.pdf`);
    }

    const result = await pdfService.checkCompliance(referencePath, reportPaths, generateReport, reportOutputPath);
    res.json(result);
  } catch (error) {
    console.error('Compliance check error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

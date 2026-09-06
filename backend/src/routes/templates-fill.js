const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const templateService = require('../services/templateService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

router.use(requireAuth);

// Platzhalter aus HTML-Vorlage erkennen
router.post('/document-templates/detect-placeholders', (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'html erforderlich' });
    const placeholders = templateService.extractPlaceholders(html);
    res.json({ placeholders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Einzeldokument ausfüllen
router.post('/document-templates/fill', async (req, res, next) => {
  try {
    const { html, values } = req.body;
    if (!html || !values) return res.status(400).json({ error: 'html und values erforderlich' });

    const filled = templateService.fillPlaceholders(html, values);
    const outputPath = path.join(process.env.PROCESSED_DIR || 'processed', `template_${uuidv4()}.pdf`);
    await templateService.renderHtmlToPdf(filled, outputPath);

    res.json({ outputPath });
  } catch (error) {
    next(error);
  }
});

// Massenerstellung aus Excel
const multer = require('multer');
const upload = multer({ dest: process.env.UPLOAD_DIR || 'uploads' });

router.post('/document-templates/fill-batch', upload.single('excel'), async (req, res, next) => {
  try {
    const { html } = req.body;
    if (!html || !req.file) return res.status(400).json({ error: 'html und excel-Datei erforderlich' });

    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel-Datei enthält keine Zeilen' });
    }

    const valuesArray = rows.map(row => {
      const strRow = {};
      for (const [k, v] of Object.entries(row)) {
        strRow[k] = String(v);
      }
      return strRow;
    });

    const outputDir = process.env.PROCESSED_DIR || 'processed';
    const outputFiles = await templateService.generateFromTemplate(html, valuesArray, outputDir, 'batch');

    res.json({ count: outputFiles.length, files: outputFiles });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

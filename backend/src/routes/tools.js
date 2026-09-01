const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const queueService = require('../services/queueService');
const pdfService = require('../services/pdfService');
const path = require('path');

router.use(apiKeyAuth);

const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

function buildDownloadUrl(outputPath) {
  if (!outputPath) return null;
  const filename = outputPath.split('/').pop();
  return `${BASE_URL}/api/v1/download/${filename}`;
}

async function waitForJob(jobId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await queueService.getJobStatus(jobId);
    if (status.status === 'completed') return status.data;
    if (status.status === 'failed') throw new Error('Verarbeitung fehlgeschlagen');
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Zeitüberschreitung bei der Verarbeitung');
}

// --- Synchrone Job-basierte Tools ---

router.post('/compress', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich (Feld "file")' });
    const { compressionLevel = 'medium' } = req.body;
    const job = await queueService.addJob('compress', { inputPath: req.file.path, compressionLevel });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/merge', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) return res.status(400).json({ error: 'Mindestens 2 Dateien erforderlich (Feld "files")' });
    const inputPaths = req.files.map(f => f.path);
    const job = await queueService.addJob('merge', { inputPaths });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/split', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { mode = 'every', pagesPerSplit = 1, ranges = '' } = req.body;
    const job = await queueService.addJob('split', { inputPath: req.file.path, options: { mode, pagesPerSplit: parseInt(pagesPerSplit), ranges } });
    const data = await waitForJob(job.jobId);
    const downloadUrls = (data.files || []).map(buildDownloadUrl);
    res.json({ ...data, downloadUrls });
  } catch (error) { next(error); }
});

router.post('/convert-images-to-pdf', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Mindestens 1 Bild erforderlich' });
    const inputPaths = req.files.map(f => f.path);
    const job = await queueService.addJob('convert', { inputPaths, conversionType: 'imagesToPDF' });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/convert-pdf-to-images', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { format = 'jpeg' } = req.body;
    const job = await queueService.addJob('pdfToImages', { inputPath: req.file.path, format });
    const data = await waitForJob(job.jobId);
    const downloadUrls = (data.files || []).map(buildDownloadUrl);
    res.json({ ...data, downloadUrls });
  } catch (error) { next(error); }
});

router.post('/rotate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { degrees = 90 } = req.body;
    const job = await queueService.addJob('rotate', { inputPath: req.file.path, degrees: parseInt(degrees) });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/watermark', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { text = 'CONFIDENTIAL' } = req.body;
    const job = await queueService.addJob('watermark', { inputPath: req.file.path, text, options: {} });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/set-password', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Passwort erforderlich' });
    const job = await queueService.addJob('setPassword', { inputPath: req.file.path, password });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/remove-password', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Passwort erforderlich' });
    const job = await queueService.addJob('removePassword', { inputPath: req.file.path, password });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/metadata', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { title, author, subject } = req.body;
    const job = await queueService.addJob('metadata', { inputPath: req.file.path, meta: { title, author, subject } });
    const data = await waitForJob(job.jobId);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/ocr', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const { language = 'deu+eng' } = req.body;
    const job = await queueService.addJob('ocr', { inputPath: req.file.path, language });
    const data = await waitForJob(job.jobId, 180000);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

router.post('/redact', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const useAI = req.body.useAI !== 'false';
    let customTerms = [];
    if (req.body.customTerms) {
      try { customTerms = JSON.parse(req.body.customTerms); }
      catch (e) { customTerms = req.body.customTerms.split(',').map(t => t.trim()).filter(Boolean); }
    }
    const job = await queueService.addJob('redact', { inputPath: req.file.path, options: { useAI, customTerms } });
    const data = await waitForJob(job.jobId, 180000);
    res.json({ ...data, downloadUrl: buildDownloadUrl(data.outputPath) });
  } catch (error) { next(error); }
});

// --- Direkte (nicht-Queue-basierte) Tools ---

router.post('/summarize', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const result = await pdfService.summarizePDF(req.file.path);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/extract-keyvalues', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const result = await pdfService.extractKeyValues(req.file.path, false, null);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/extract-standards', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const result = await pdfService.extractStandards(req.file.path, false, null);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/extract-tables', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei erforderlich' });
    const outputPath = path.join(process.env.PROCESSED_DIR || 'processed', `tables_${Date.now()}.xlsx`);
    const result = await pdfService.extractTables(req.file.path, outputPath);
    res.json({ ...result, downloadUrl: buildDownloadUrl(result.outputPath) });
  } catch (error) { next(error); }
});

router.post('/compare', upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]), async (req, res, next) => {
  try {
    if (!req.files?.fileA || !req.files?.fileB) return res.status(400).json({ error: 'Beide Dateien (fileA, fileB) erforderlich' });
    const result = await pdfService.compareRevisions(req.files.fileA[0].path, req.files.fileB[0].path, false, null);
    res.json(result);
  } catch (error) { next(error); }
});

module.exports = router;

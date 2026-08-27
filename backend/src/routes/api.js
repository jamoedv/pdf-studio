const express = require('express');
const path = require('path');
const router = express.Router();
const upload = require('../middleware/upload');
const queueService = require('../services/queueService');
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

router.use(limiter);

router.post('/compress', upload.single('file'), async (req, res, next) => {
  try {
    const { compressionLevel = 'medium' } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const job = await queueService.addJob('compress', {
      inputPath: req.file.path,
      compressionLevel
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/merge', upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'At least 2 files required' });
    }
    const inputPaths = req.files.map(f => f.path);
    const job = await queueService.addJob('merge', { inputPaths });
    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/split', upload.single('file'), async (req, res, next) => {
  try {
    const { mode = 'every', pagesPerSplit = 1, ranges = '' } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const job = await queueService.addJob('split', {
      inputPath: req.file.path,
      options: {
        mode,
        pagesPerSplit: parseInt(pagesPerSplit),
        ranges
      }
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/convert', upload.array('files', 10), async (req, res, next) => {
  try {
    const { conversionType } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const inputPaths = req.files.map(f => f.path);
    const job = await queueService.addJob('convert', { inputPaths, conversionType });
    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/rotate', upload.single('file'), async (req, res, next) => {
  try {
    const { degrees = 90 } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const job = await queueService.addJob('rotate', {
      inputPath: req.file.path,
      degrees: parseInt(degrees)
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/watermark', upload.single('file'), async (req, res, next) => {
  try {
    const { text = 'CONFIDENTIAL' } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const job = await queueService.addJob('watermark', {
      inputPath: req.file.path,
      text,
      options: {}
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});
router.post('/set-password', upload.single('file'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!password) return res.status(400).json({ error: 'Password required' });

    const job = await queueService.addJob('setPassword', {
      inputPath: req.file.path,
      password
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/remove-password', upload.single('file'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!password) return res.status(400).json({ error: 'Password required' });

    const job = await queueService.addJob('removePassword', {
      inputPath: req.file.path,
      password
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});

router.post('/pdf-to-images', upload.single('file'), async (req, res, next) => {
  try {
    const { format = 'jpeg' } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const job = await queueService.addJob('pdfToImages', {
      inputPath: req.file.path,
      format
    });

    res.json(job);
  } catch (error) {
    next(error);
  }
});
router.get('/job/:jobId', async (req, res, next) => {
  try {
    const status = await queueService.getJobStatus(req.params.jobId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.get('/download/:filename', (req, res) => {
  const processedDir = process.env.PROCESSED_DIR || 'processed';
  const file = path.resolve(processedDir, req.params.filename);
  res.download(file);
});

module.exports = router;

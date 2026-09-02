const Queue = require('bull');
const dotenv = require('dotenv');
const pdfService = require('../services/pdfService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const redisClient = require('../services/redisClient');

dotenv.config();

const pdfQueue = new Queue('pdf-processing', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});

pdfQueue.client.setMaxListeners(30);

const processedDir = process.env.PROCESSED_DIR || 'processed';

async function logHistory(job, result) {
  try {
    const entry = {
      id: job.id,
      type: job.name,
      timestamp: new Date().toISOString(),
      summary: buildSummary(job.name, job.data, result),
      outputPath: result.outputPath || (result.files ? result.files[0] : null),
      fileCount: result.files ? result.files.length : 1,
      username: job.data.username || 'unbekannt'
    };
    await redisClient.lpush('history', JSON.stringify(entry));
    await redisClient.ltrim('history', 0, 49);
  } catch (e) {
    console.error('History logging failed:', e.message);
  }
}

function buildSummary(type, data, result) {
  switch (type) {
    case 'compress': return `Komprimiert (${data.compressionLevel}) — ${result.savings || 0}% gespart`;
    case 'merge': return `${result.fileCount || '?'} PDFs zusammengeführt`;
    case 'split': return `In ${result.splitCount || '?'} Teile aufgeteilt`;
    case 'convert': return `Konvertiert`;
    case 'rotate': return `Um ${data.degrees}° gedreht`;
    case 'watermark': return `Wasserzeichen "${data.text}" hinzugefügt`;
    case 'setPassword': return `Passwort gesetzt`;
    case 'removePassword': return `Passwort entfernt`;
    case 'pdfToImages': return `In ${result.pageCount || '?'} Bilder umgewandelt`;
    case 'metadata': return `Metadaten aktualisiert`;
    case 'ocr': return `Texterkennung (OCR) angewendet`;
    case 'workflow': return `Workflow: ${(data.steps || []).map(s => s.action).join(' → ')}`;
    default: return type;
  }
}

pdfQueue.process('compress', async (job) => {
  const { inputPath, compressionLevel } = job.data;
  const outputPath = path.join(processedDir, `compressed_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.compressPDF(inputPath, outputPath, compressionLevel);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('merge', async (job) => {
  const { inputPaths } = job.data;
  const outputPath = path.join(processedDir, `merged_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.mergePDFs(inputPaths, outputPath);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('split', async (job) => {
  const { inputPath, options } = job.data;
  const jobPrefix = uuidv4().slice(0, 8);
  job.progress(20);
  const result = await pdfService.splitPDF(inputPath, processedDir, options, jobPrefix);
  job.progress(100);
  return result;
});

pdfQueue.process('convert', async (job) => {
  const { inputPaths, conversionType } = job.data;
  const outputPath = path.join(processedDir, `converted_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.imagesToPDF(inputPaths, outputPath);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('rotate', async (job) => {
  const { inputPath, degrees } = job.data;
  const outputPath = path.join(processedDir, `rotated_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.rotatePDF(inputPath, outputPath, degrees);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('watermark', async (job) => {
  const { inputPath, text, options } = job.data;
  const outputPath = path.join(processedDir, `watermarked_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.addWatermark(inputPath, outputPath, text, options);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('setPassword', async (job) => {
  const { inputPath, password } = job.data;
  const outputPath = path.join(processedDir, `protected_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.setPassword(inputPath, outputPath, password);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('removePassword', async (job) => {
  const { inputPath, password } = job.data;
  const outputPath = path.join(processedDir, `unprotected_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.removePassword(inputPath, outputPath, password);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('pdfToImages', async (job) => {
  const { inputPath, format } = job.data;
  const filePrefix = uuidv4().slice(0, 8);
  job.progress(20);
  const result = await pdfService.pdfToImages(inputPath, processedDir, format, filePrefix);
  job.progress(100);
  return result;
});

pdfQueue.process('metadata', async (job) => {
  const { inputPath, meta } = job.data;
  const outputPath = path.join(processedDir, `metadata_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.setMetadata(inputPath, outputPath, meta);
  job.progress(100);
  return { ...result, outputPath };
});

pdfQueue.process('ocr', async (job) => {
  const { inputPath, language } = job.data;
  const outputPath = path.join(processedDir, `ocr_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.ocrPDF(inputPath, outputPath, language);
  job.progress(100);
  return { ...result, outputPath };
});

// Mehrstufiger Workflow: führt mehrere Aktionen nacheinander aus,
// Ergebnis von Schritt N wird automatisch Eingabe von Schritt N+1
pdfQueue.process('workflow', async (job) => {
  const { fileInputs, steps, password } = job.data;
  const totalSteps = steps.length;
  const stepResults = [];

  let currentPath = fileInputs.length === 1 ? fileInputs[0] : null;
  let currentPaths = fileInputs.length > 1 ? fileInputs : fileInputs;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isLast = i === steps.length - 1;
    job.progress(Math.round((i / totalSteps) * 100));

    let result;
    let outputPath;

    switch (step.action) {
      case 'merge': {
        if (!currentPaths || currentPaths.length < 2) {
          throw new Error('Zusammenführen benötigt mindestens 2 Dateien');
        }
        outputPath = path.join(processedDir, `wf_merge_${uuidv4()}.pdf`);
        result = await pdfService.mergePDFs(currentPaths, outputPath);
        currentPath = outputPath;
        currentPaths = null;
        break;
      }
      case 'convert': {
        if (step.options?.direction === 'toPDF') {
          if (!currentPaths || currentPaths.length < 1) throw new Error('Keine Bilder zum Konvertieren');
          outputPath = path.join(processedDir, `wf_convert_${uuidv4()}.pdf`);
          result = await pdfService.imagesToPDF(currentPaths, outputPath);
          currentPath = outputPath;
          currentPaths = null;
        } else {
          if (!isLast) throw new Error('PDF zu Bildern kann nur als letzter Schritt genutzt werden');
          const outDir = path.join(processedDir, `wf_images_${uuidv4()}`);
          const wfPrefix = `wf_${uuidv4().slice(0, 8)}`;
          result = await pdfService.pdfToImages(currentPath, processedDir, 'jpeg', wfPrefix);
          stepResults.push({ action: step.action, ...result });
          job.progress(100);
          return { steps: stepResults, files: result.files, multiOutput: true };
        }
        break;
      }
      case 'compress': {
        outputPath = path.join(processedDir, `wf_compress_${uuidv4()}.pdf`);
        result = await pdfService.compressPDF(currentPath, outputPath, step.options?.level || 'medium');
        currentPath = outputPath;
        break;
      }
      case 'rotate': {
        outputPath = path.join(processedDir, `wf_rotate_${uuidv4()}.pdf`);
        result = await pdfService.rotatePDF(currentPath, outputPath, step.options?.degrees || 90);
        currentPath = outputPath;
        break;
      }
      case 'watermark': {
        outputPath = path.join(processedDir, `wf_watermark_${uuidv4()}.pdf`);
        result = await pdfService.addWatermark(currentPath, outputPath, step.options?.text || 'CONFIDENTIAL');
        currentPath = outputPath;
        break;
      }
      case 'password': {
        if (!password) throw new Error('Kein Passwort angegeben');
        outputPath = path.join(processedDir, `wf_password_${uuidv4()}.pdf`);
        if (step.options?.mode === 'remove') {
          result = await pdfService.removePassword(currentPath, outputPath, password);
        } else {
          result = await pdfService.setPassword(currentPath, outputPath, password);
        }
        currentPath = outputPath;
        break;
      }
      case 'metadata': {
        outputPath = path.join(processedDir, `wf_metadata_${uuidv4()}.pdf`);
        result = await pdfService.setMetadata(currentPath, outputPath, step.options || {});
        currentPath = outputPath;
        break;
      }
      case 'ocr': {
        outputPath = path.join(processedDir, `wf_ocr_${uuidv4()}.pdf`);
        result = await pdfService.ocrPDF(currentPath, outputPath, step.options?.language || 'deu+eng');
        currentPath = outputPath;
        break;
      }
      case 'extract-keyvalues': {
        const reportPath = path.join(processedDir, `wf_keyvalues_${uuidv4()}.pdf`);
        result = await pdfService.extractKeyValues(currentPath, true, reportPath);
        currentPath = reportPath;
        break;
      }
      case 'extract-standards': {
        const reportPath = path.join(processedDir, `wf_standards_${uuidv4()}.pdf`);
        result = await pdfService.extractStandards(currentPath, true, reportPath);
        currentPath = reportPath;
        break;
      }
      case 'split': {
        if (!isLast) throw new Error('Aufteilen kann nur als letzter Schritt genutzt werden');
        const prefix = uuidv4().slice(0, 8);
        result = await pdfService.splitPDF(currentPath, processedDir, step.options || {}, prefix);
        stepResults.push({ action: step.action, ...result });
        job.progress(100);
        return { steps: stepResults, files: result.files, multiOutput: true };
      }
      default:
        throw new Error(`Unbekannte Aktion: ${step.action}`);
    }

    stepResults.push({ action: step.action, ...result });
  }

  job.progress(100);
  return { steps: stepResults, outputPath: currentPath, multiOutput: false };
});

pdfQueue.process('redact', async (job) => {
  const { inputPath, options } = job.data;
  const outputPath = path.join(processedDir, `redacted_${uuidv4()}.pdf`);
  job.progress(20);
  const result = await pdfService.redactPDF(inputPath, outputPath, options);
  job.progress(100);
  return { ...result, outputPath };
});

async function updateStats(job, result) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await redisClient.incr('stats:totalJobs');
    await redisClient.hincrby('stats:byType', job.name, 1);
    await redisClient.hincrby('stats:daily', today, 1);

    if (job.data.username) {
      await redisClient.hincrby('stats:byUser', job.data.username, 1);
    }

    if (job.name === 'compress' && result.originalSize && result.compressedSize) {
      const savedBytes = Math.max(0, result.originalSize - result.compressedSize);
      await redisClient.incrby('stats:totalStorageSavedBytes', savedBytes);
    }
  } catch (e) {
    console.error('Stats update failed:', e.message);
  }
}

pdfQueue.on('completed', (job, result) => {
  logHistory(job, result);
  updateStats(job, result);
});

console.log('🔧 PDF Worker started, waiting for jobs...');

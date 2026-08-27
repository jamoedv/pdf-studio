const Queue = require('bull');
const dotenv = require('dotenv');
const pdfService = require('../services/pdfService');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const pdfQueue = new Queue('pdf-processing', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});

const processedDir = process.env.PROCESSED_DIR || 'processed';

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
  const outDir = path.join(processedDir, `images_${uuidv4()}`);
  job.progress(20);
  const result = await pdfService.pdfToImages(inputPath, outDir, format);
  job.progress(100);
  return result;
});
console.log('🔧 PDF Worker started, waiting for jobs...');

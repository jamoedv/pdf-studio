const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

class PDFService {

  async compressPDF(inputPath, outputPath, compressionLevel = 'medium') {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const compressedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50
    });

    await fs.writeFile(outputPath, compressedBytes);

    const originalSize = (await fs.stat(inputPath)).size;
    const compressedSize = (await fs.stat(outputPath)).size;
    const savings = originalSize > 0
      ? ((1 - compressedSize / originalSize) * 100).toFixed(1)
      : 0;

    return {
      originalSize,
      compressedSize,
      savings: parseFloat(savings),
      compressionLevel
    };
  }

  async mergePDFs(inputPaths, outputPath) {
    const mergedPdf = await PDFDocument.create();

    for (const inputPath of inputPaths) {
      const pdfBytes = await fs.readFile(inputPath);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();
    await fs.writeFile(outputPath, mergedBytes);

    return {
      pageCount: mergedPdf.getPageCount(),
      fileCount: inputPaths.length
    };
  }

  async splitPDF(inputPath, outputDir, options = {}, prefix = '') {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    const { mode = 'every', pagesPerSplit = 1, ranges = '' } = options;
    const outputFiles = [];

    await fs.mkdir(outputDir, { recursive: true });

    const filePrefix = prefix ? `${prefix}_` : '';

    if (mode === 'ranges' && ranges.trim()) {
      const parts = ranges.split(',').map(p => p.trim()).filter(Boolean);
      const selectedPages = [];

      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(n => parseInt(n.trim()));
          for (let p = start; p <= end; p++) {
            if (p >= 1 && p <= totalPages) selectedPages.push(p - 1);
          }
        } else {
          const p = parseInt(part);
          if (p >= 1 && p <= totalPages) selectedPages.push(p - 1);
        }
      }

      if (selectedPages.length === 0) {
        throw new Error('Keine gültigen Seiten angegeben');
      }

      const newPdf = await PDFDocument.create();
      const copiedPages = await newPdf.copyPages(pdfDoc, selectedPages);
      copiedPages.forEach(page => newPdf.addPage(page));

      const safeLabel = ranges.replace(/[^0-9,-]/g, '').slice(0, 30);
      const outPath = path.join(outputDir, `extracted_${filePrefix}${safeLabel}.pdf`);
      const pdfBytesOut = await newPdf.save();
      await fs.writeFile(outPath, pdfBytesOut);
      outputFiles.push(outPath);

      return {
        totalPages,
        extractedPages: selectedPages.length,
        splitCount: 1,
        files: outputFiles
      };
    }

    let pageGroups = [];
    for (let i = 0; i < totalPages; i += pagesPerSplit) {
      const endPage = Math.min(i + pagesPerSplit, totalPages);
      const pages = [];
      for (let p = i; p < endPage; p++) pages.push(p);
      pageGroups.push({ label: `${i + 1}-${endPage}`, pages });
    }

    for (const group of pageGroups) {
      const newPdf = await PDFDocument.create();
      const copiedPages = await newPdf.copyPages(pdfDoc, group.pages);
      copiedPages.forEach(page => newPdf.addPage(page));

      const outPath = path.join(outputDir, `split_${filePrefix}${group.label}.pdf`);
      const splitBytes = await newPdf.save();
      await fs.writeFile(outPath, splitBytes);
      outputFiles.push(outPath);
    }

    return {
      totalPages,
      splitCount: outputFiles.length,
      files: outputFiles
    };
  }

  async imagesToPDF(imagePaths, outputPath) {
    const pdfDoc = await PDFDocument.create();

    for (const imagePath of imagePaths) {
      const imageBytes = await fs.readFile(imagePath);
      const ext = path.extname(imagePath).toLowerCase();

      let image;
      if (ext === '.jpg' || ext === '.jpeg') {
        image = await pdfDoc.embedJpg(imageBytes);
      } else if (ext === '.png') {
        image = await pdfDoc.embedPng(imageBytes);
      } else {
        continue;
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, pdfBytes);

    return {
      pageCount: pdfDoc.getPageCount(),
      imageCount: imagePaths.length
    };
  }

  async rotatePDF(inputPath, outputPath, degrees = 90) {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    pages.forEach(page => {
      const currentRotation = page.getRotation().angle;
      page.setRotation({ angle: (currentRotation + degrees) % 360, type: 'degrees' });
    });

    const rotatedBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, rotatedBytes);

    return {
      pageCount: pdfDoc.getPageCount(),
      degrees
    };
  }

  async addWatermark(inputPath, outputPath, text = 'CONFIDENTIAL', options = {}) {
    const { opacity = 0.3, fontSize = 50, color = { r: 0.5, g: 0.5, b: 0.5 } } = options;
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 2 - (text.length * fontSize) / 4,
        y: height / 2,
        size: fontSize,
        opacity,
        color: rgb(color.r, color.g, color.b),
        rotate: { angle: 45, type: 'degrees' }
      });
    }

    const watermarkedBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, watermarkedBytes);

    return {
      pageCount: pdfDoc.getPageCount(),
      text
    };
  }
async setPassword(inputPath, outputPath, password) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    await execPromise(`qpdf --encrypt "${password}" "${password}" 256 -- "${inputPath}" "${outputPath}"`);

    return { protected: true };
  }

  async removePassword(inputPath, outputPath, password) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    await execPromise(`qpdf --password="${password}" --decrypt "${inputPath}" "${outputPath}"`);

    return { protected: false };
  }

  async pdfToImages(inputPath, outputDir, format = 'jpeg') {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const fsSync = require('fs');

    await fs.mkdir(outputDir, { recursive: true });

    const outputPrefix = path.join(outputDir, 'page');
    const formatFlag = format === 'png' ? '-png' : '-jpeg';

    await execPromise(`pdftoppm ${formatFlag} -r 150 "${inputPath}" "${outputPrefix}"`);

    const allFiles = await fs.readdir(outputDir);
    const imageFiles = allFiles
      .filter(f => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.png')))
      .sort()
      .map(f => path.join(outputDir, f));

    return {
      pageCount: imageFiles.length,
      files: imageFiles
    };
  }
}

module.exports = new PDFService();

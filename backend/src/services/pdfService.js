const { PDFDocument, rgb, PDFName, PDFNumber, PDFRawStream } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

class PDFService {

  getCompressionSettings(level) {
    const settings = {
      low: { quality: 90, scale: 1.0 },
      medium: { quality: 75, scale: 0.9 },
      high: { quality: 60, scale: 0.75 },
      maximum: { quality: 40, scale: 0.5 }
    };
    return settings[level] || settings.medium;
  }

  async compressPDF(inputPath, outputPath, compressionLevel = 'medium') {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const { quality, scale } = this.getCompressionSettings(compressionLevel);

    let imagesProcessed = 0;
    const indirectObjects = pdfDoc.context.enumerateIndirectObjects();

    for (const [ref, obj] of indirectObjects) {
      try {
        if (!(obj instanceof PDFRawStream)) continue;

        const dict = obj.dict;
        const subtype = dict.get(PDFName.of('Subtype'));
        const filter = dict.get(PDFName.of('Filter'));

        const isImage = subtype && subtype.toString() === '/Image';
        const filterName = filter ? filter.toString() : '';
        const isJpeg = filterName.includes('DCTDecode');

        if (!isImage || !isJpeg) continue;

        const originalBytes = obj.getContents();
        if (!originalBytes || originalBytes.length < 2000) continue; // zu klein, lohnt nicht

        const image = sharp(Buffer.from(originalBytes));
        const metadata = await image.metadata();

        let pipeline = image.jpeg({ quality, mozjpeg: true });

        if (scale < 1 && metadata.width) {
          pipeline = pipeline.resize({
            width: Math.round(metadata.width * scale),
            withoutEnlargement: true
          });
        }

        const newBytes = await pipeline.toBuffer();

        // Nur ersetzen, wenn tatsächlich kleiner
        if (newBytes.length < originalBytes.length) {
          const newMeta = await sharp(newBytes).metadata();

          dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
          dict.set(PDFName.of('Width'), PDFNumber.of(newMeta.width));
          dict.set(PDFName.of('Height'), PDFNumber.of(newMeta.height));

          const newStream = PDFRawStream.of(dict, newBytes);
          pdfDoc.context.assign(ref, newStream);
          imagesProcessed++;
        }
      } catch (e) {
        // Einzelnes Bild fehlgeschlagen -> überspringen, Rest der PDF bleibt unangetastet
        continue;
      }
    }

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
      compressionLevel,
      imagesProcessed
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

  async pdfToImages(inputPath, outputDir, format = 'jpeg', prefix = '') {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    await fs.mkdir(outputDir, { recursive: true });

    const filePrefix = prefix ? `${prefix}_` : '';
    const outputPrefix = path.join(outputDir, `${filePrefix}page`);
    const formatFlag = format === 'png' ? '-png' : '-jpeg';

    await execPromise(`pdftoppm ${formatFlag} -r 150 "${inputPath}" "${outputPrefix}"`);

    const allFiles = await fs.readdir(outputDir);
    const imageFiles = allFiles
      .filter(f => f.startsWith(`${filePrefix}page`) && (f.endsWith('.jpg') || f.endsWith('.png')))
      .sort()
      .map(f => path.join(outputDir, f));

    return {
      pageCount: imageFiles.length,
      files: imageFiles
    };
  }
  async setMetadata(inputPath, outputPath, meta = {}) {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    if (meta.title) pdfDoc.setTitle(meta.title);
    if (meta.author) pdfDoc.setAuthor(meta.author);
    if (meta.subject) pdfDoc.setSubject(meta.subject);
    pdfDoc.setModificationDate(new Date());

    const newBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, newBytes);

    return {
      title: meta.title || null,
      author: meta.author || null,
      subject: meta.subject || null
    };
  }

  async ocrPDF(inputPath, outputPath, language = 'deu+eng') {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    // ocrmypdf wäre ideal, aber falls nicht verfügbar: eigener Tesseract-Weg
    try {
      await execPromise(`ocrmypdf --language ${language} --skip-text "${inputPath}" "${outputPath}"`);
      return { ocrApplied: true, method: 'ocrmypdf' };
    } catch (e) {
      throw new Error('OCR fehlgeschlagen: ' + e.message);
    }
  }
}

module.exports = new PDFService();

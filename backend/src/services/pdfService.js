const { PDFDocument, rgb, PDFName, PDFNumber, PDFRawStream, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

function parseClaudeJSON(responseText) {
  let cleaned = responseText.replace(/```json|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Keine gültige JSON-Antwort erhalten');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(cleaned);
}

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
        if (!originalBytes || originalBytes.length < 2000) continue;

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

    try {
      await execPromise(`ocrmypdf --language ${language} --skip-text "${inputPath}" "${outputPath}"`);
      return { ocrApplied: true, method: 'ocrmypdf' };
    } catch (e) {
      throw new Error('OCR fehlgeschlagen: ' + e.message);
    }
  }

  async extractPdfText(inputPath) {
    const { PDFParse } = require('pdf-parse');
    const dataBuffer = await fs.readFile(inputPath);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    return result.text || '';
  }

  async generateReportPDF(outputPath, title, sections) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([595, 842]);
    let y = 800;

    const checkPageBreak = (needed = 20) => {
      if (y < needed) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
    };

    page.drawText(this.sanitizeForPDF(title), { x: 50, y, size: 18, font: boldFont });
    y -= 30;
    page.drawText(`Erstellt am ${new Date().toLocaleDateString('de-DE')}`, { x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 30;

    for (const section of sections) {
      checkPageBreak(40);
      page.drawText(this.sanitizeForPDF(section.heading), { x: 50, y, size: 13, font: boldFont });
      y -= 22;

      for (const line of section.lines) {
        checkPageBreak(18);
        const safeLine = this.sanitizeForPDF(line);
        const wrapped = safeLine.length > 95 ? safeLine.slice(0, 95) + '...' : safeLine;
        page.drawText(wrapped, { x: 50, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 16;
      }
      y -= 14;
    }

    const bytes = await doc.save();
    await fs.writeFile(outputPath, bytes);
    return outputPath;
  }

  sanitizeForPDF(text) {
    if (!text) return '';
    return text
      .replace(/µ/g, 'u')
      .replace(/±/g, '+/-')
      .replace(/°/g, ' deg')
      .replace(/[^\x00-\x7F\u00A0-\u00FF]/g, '?');
  }

  async extractTables(inputPath, outputPath) {
    const XLSX = require('xlsx');
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const text = (await this.extractPdfText(inputPath)).slice(0, 15000);

    if (!text.trim()) {
      throw new Error('Kein Text im PDF gefunden (evtl. gescannt — vorher OCR anwenden)');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: `Du extrahierst Tabellen aus technischem Dokumenttext (Datenblätter, Prüfberichte, Spezifikationen).

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown):
{
  "tables": [
    {
      "title": "kurzer Titel der Tabelle",
      "headers": ["Spalte1", "Spalte2"],
      "rows": [["Wert1", "Wert2"]]
    }
  ]
}

Erkenne auch Tabellen, die durch Text-Layout angedeutet sind. Wenn keine Tabellen erkennbar sind, gib ein leeres "tables" Array zurück. Erfinde keine Werte.`,
      messages: [{ role: 'user', content: text }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = parseClaudeJSON(responseText);

    const workbook = XLSX.utils.book_new();
    if (!parsed.tables || parsed.tables.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['Keine Tabellen gefunden']]);
      XLSX.utils.book_append_sheet(workbook, ws, 'Ergebnis');
    } else {
      parsed.tables.forEach((table, i) => {
        const sheetData = [table.headers, ...table.rows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const sheetName = (table.title || `Tabelle ${i + 1}`).slice(0, 31);
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      });
    }

    XLSX.writeFile(workbook, outputPath);

    return { tableCount: parsed.tables ? parsed.tables.length : 0, tables: parsed.tables || [], outputPath };
  }

  async extractKeyValues(inputPath, generateReport = false, reportOutputPath = null) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const text = (await this.extractPdfText(inputPath)).slice(0, 15000);

    if (!text.trim()) {
      throw new Error('Kein Text im PDF gefunden (evtl. gescannt — vorher OCR anwenden)');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: `Du extrahierst technische Kennwerte aus Dokumenten (Datenblätter, Zeichnungen, Spezifikationen, Prüfberichte).

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "documentType": "Einschätzung, z.B. Datenblatt/Prüfbericht/Zeichnung/Spezifikation",
  "fields": [{"key": "Feldname", "value": "gefundener Wert"}]
}

Achte besonders auf: Teilenummer/Artikelnummer, Revision/Version, Material, Toleranzen, Maße/Dimensionen, elektrische/mechanische Kennwerte, Hersteller, Gültigkeitsdatum. Erfinde nichts.`,
      messages: [{ role: 'user', content: text }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const result = parseClaudeJSON(responseText);

    if (generateReport && reportOutputPath) {
      const lines = result.fields && result.fields.length > 0
        ? result.fields.map(f => `${f.key}: ${f.value}`)
        : ['Keine Kennwerte gefunden.'];
      await this.generateReportPDF(reportOutputPath, `Kennwerte-Bericht — ${result.documentType || ''}`, [
        { heading: 'Extrahierte Kennwerte', lines }
      ]);
      result.outputPath = reportOutputPath;
    }

    return result;
  }

  async compareRevisions(pathA, pathB, generateReport = false, reportOutputPath = null) {
    const { diffWords } = require('diff');
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const [textA, textB] = await Promise.all([
      this.extractPdfText(pathA),
      this.extractPdfText(pathB)
    ]);

    const diff = diffWords(textA, textB);
    const segments = diff.map(part => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
      value: part.value
    }));

    const addedCount = segments.filter(s => s.type === 'added').length;
    const removedCount = segments.filter(s => s.type === 'removed').length;

    let summary = 'Keine wesentlichen Unterschiede gefunden.';
    if (addedCount > 0 || removedCount > 0) {
      const changedText = segments
        .filter(s => s.type !== 'unchanged')
        .map(s => `${s.type === 'added' ? '+' : '-'} ${s.value.trim()}`)
        .join('\n')
        .slice(0, 4000);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        system: 'Du bekommst eine Liste von Textänderungen zwischen zwei Dokumentversionen (+ = hinzugefügt, - = entfernt). Fasse in 2-3 Sätzen auf Deutsch zusammen, was sich inhaltlich geändert hat. Antworte NUR mit der Zusammenfassung, kein JSON, kein Markdown.',
        messages: [{ role: 'user', content: changedText }]
      });
      summary = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    }

    const result = { segments, summary, addedCount, removedCount };

    if (generateReport && reportOutputPath) {
      const changeLines = segments
        .filter(s => s.type !== 'unchanged')
        .slice(0, 100)
        .map(s => `${s.type === 'added' ? '[+] ' : '[-] '}${s.value.trim()}`)
        .filter(l => l.length > 4);

      await this.generateReportPDF(reportOutputPath, 'Revisions-Vergleichsbericht', [
        { heading: 'Zusammenfassung', lines: [summary, `${addedCount} Ergänzungen, ${removedCount} Entfernungen`] },
        { heading: 'Änderungen im Detail', lines: changeLines.length > 0 ? changeLines : ['Keine Änderungen.'] }
      ]);
      result.outputPath = reportOutputPath;
    }

    return result;
  }

  async extractStandards(inputPath, generateReport = false, reportOutputPath = null) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const text = (await this.extractPdfText(inputPath)).slice(0, 15000);

    if (!text.trim()) {
      throw new Error('Kein Text im PDF gefunden (evtl. gescannt — vorher OCR anwenden)');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: `Du findest Normen- und Standard-Referenzen in technischen Dokumenten (z.B. ISO, DIN, EN, IEC, ANSI, ASTM, VDE, VDI).

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "standards": [
    {"reference": "z.B. ISO 9001:2015", "context": "kurzer Satz-Ausschnitt"}
  ]
}

Nur tatsächlich im Text vorhandene, klar erkennbare Normen-Referenzen. Keine Duplikate. Wenn keine gefunden werden, leeres Array zurückgeben.`,
      messages: [{ role: 'user', content: text }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const result = parseClaudeJSON(responseText);

    if (generateReport && reportOutputPath) {
      const lines = result.standards && result.standards.length > 0
        ? result.standards.map(s => `${s.reference} — ${s.context}`)
        : ['Keine Normen-Referenzen gefunden.'];
      await this.generateReportPDF(reportOutputPath, 'Normen-Referenzen-Bericht', [
        { heading: 'Gefundene Normen', lines }
      ]);
      result.outputPath = reportOutputPath;
    }

    return result;
  }

  async summarizePDF(inputPath) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const text = (await this.extractPdfText(inputPath)).slice(0, 15000);

    if (!text.trim()) {
      throw new Error('Kein Text im PDF gefunden (evtl. gescannt — vorher OCR anwenden)');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: `Du fasst Dokumente knapp und praezise auf Deutsch zusammen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "summary": "3-5 Saetze Zusammenfassung",
  "keyPoints": ["wichtigster Punkt 1", "Punkt 2", "Punkt 3"],
  "documentType": "kurze Einschaetzung, z.B. Vertrag/Bericht/Datenblatt"
}`,
      messages: [{ role: 'user', content: text }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return parseClaudeJSON(responseText);
  }

  async getWordPositions(inputPath) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    const xml2js = require('xml2js');

    const { stdout } = await execPromise(`pdftotext -bbox-layout "${inputPath}" -`, { maxBuffer: 1024 * 1024 * 20 });

    const parser = new xml2js.Parser({ explicitCharkey: false });
    const parsed = await parser.parseStringPromise(stdout);

    const pages = [];
    const docPages = parsed.html.body[0].doc[0].page || [];

    for (const page of docPages) {
      const pageWidth = parseFloat(page.$.width);
      const pageHeight = parseFloat(page.$.height);
      const words = [];

      const flows = page.flow || [];
      for (const flow of flows) {
        const blocks = flow.block || [];
        for (const block of blocks) {
          const lines = block.line || [];
          for (const line of lines) {
            const lineWords = line.word || [];
            for (const word of lineWords) {
              const text = typeof word === 'string' ? word : (word._ || '');
              words.push({
                text,
                xMin: parseFloat(word.$.xMin),
                yMin: parseFloat(word.$.yMin),
                xMax: parseFloat(word.$.xMax),
                yMax: parseFloat(word.$.yMax)
              });
            }
          }
        }
      }

      pages.push({ width: pageWidth, height: pageHeight, words });
    }

    return pages;
  }

  findSensitiveMatches(pages, customTerms = []) {
    const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const phoneRegex = /\b(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

    const matches = [];

    pages.forEach((page, pageIndex) => {
      const fullText = page.words.map(w => w.text).join(' ');

      const findAndMark = (regex, type) => {
        let m;
        while ((m = regex.exec(fullText)) !== null) {
          matches.push({ pageIndex, matchedText: m[0], type });
        }
      };

      findAndMark(ibanRegex, 'iban');
      findAndMark(emailRegex, 'email');
      findAndMark(phoneRegex, 'phone');

      customTerms.forEach(term => {
        if (term && fullText.includes(term)) {
          matches.push({ pageIndex, matchedText: term, type: 'custom' });
        }
      });
    });

    return matches;
  }

  async findSensitiveNamesWithAI(pages) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const fullText = pages.map(p => p.words.map(w => w.text).join(' ')).join('\n').slice(0, 12000);

    if (!fullText.trim()) return [];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: `Finde Personennamen und Adressen in diesem Dokumenttext, die als sensible/personenbezogene Daten geschwärzt werden sollten.

Antworte AUSSCHLIESSLICH mit JSON: {"terms": ["exakter Name 1", "exakte Adresse 2"]}

Gib NUR exakte Textstellen zurück, die WÖRTLICH im Text vorkommen. Keine allgemeinen Begriffe, keine Firmennamen, keine Produktbezeichnungen — nur Personennamen und private Adressen. Wenn nichts gefunden wird, leeres Array.`,
      messages: [{ role: 'user', content: fullText }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const parsed = parseClaudeJSON(responseText);
      return parsed.terms || [];
    } catch (e) {
      return [];
    }
  }

  async findValuesForCustomTerms(pages, customTerms) {
    if (!customTerms || customTerms.length === 0) return [];

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const fullText = pages.map(p => p.words.map(w => w.text).join(' ')).join('\n').slice(0, 12000);
    if (!fullText.trim()) return [];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: `Der Nutzer hat folgende Suchbegriffe angegeben, die auf sensible Informationen hinweisen (z.B. ein Spaltenname einer Tabelle, ein Feldname, ein Themenbereich): ${customTerms.join(', ')}.

Finde alle EXAKTEN Werte im Dokumenttext, die inhaltlich zu diesen Begriffen gehoeren. Beispiel: wenn "Pruefnummer" angegeben ist und im Text Werte wie "P-005", "P-006" als Pruefnummern vorkommen, gib genau diese Werte zurueck (nicht das Wort "Pruefnummer" selbst).

Antworte AUSSCHLIESSLICH mit JSON: {"terms": ["Wert1", "Wert2"]}

Nur woertlich im Text vorkommende Werte. Wenn nichts Passendes gefunden wird, leeres Array.`,
      messages: [{ role: 'user', content: fullText }]
    });

    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const parsed = parseClaudeJSON(responseText);
      return parsed.terms || [];
    } catch (e) {
      return [];
    }
  }

  findWordBoxesForMatches(pages, matches) {
    const boxesByPage = {};

    matches.forEach(match => {
      const page = pages[match.pageIndex];
      if (!page) return;

      const searchWords = match.matchedText.split(/\s+/).filter(Boolean);
      if (searchWords.length === 0) return;

      for (let i = 0; i <= page.words.length - searchWords.length; i++) {
        let allMatch = true;
        for (let j = 0; j < searchWords.length; j++) {
          const pageWord = page.words[i + j].text.replace(/[.,;:!?]$/, '');
          if (!pageWord.includes(searchWords[j].replace(/[.,;:!?]$/, ''))) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          const wordsInMatch = page.words.slice(i, i + searchWords.length);
          const xMin = Math.min(...wordsInMatch.map(w => w.xMin));
          const yMin = Math.min(...wordsInMatch.map(w => w.yMin));
          const xMax = Math.max(...wordsInMatch.map(w => w.xMax));
          const yMax = Math.max(...wordsInMatch.map(w => w.yMax));

          if (!boxesByPage[match.pageIndex]) boxesByPage[match.pageIndex] = [];
          boxesByPage[match.pageIndex].push({ xMin, yMin, xMax, yMax, pageWidth: page.width, pageHeight: page.height });
        }
      }
    });

    return boxesByPage;
  }

  async redactPDF(inputPath, outputPath, options = {}) {
    const { useAI = true, customTerms = [] } = options;
    const DPI = 150;

    const pages = await this.getWordPositions(inputPath);
    const regexMatches = this.findSensitiveMatches(pages, customTerms);
    const aiTerms = useAI ? await this.findSensitiveNamesWithAI(pages) : [];
    const aiMatches = this.findSensitiveMatches(pages, aiTerms);
    const customValueTerms = await this.findValuesForCustomTerms(pages, customTerms);
    const customValueMatches = this.findSensitiveMatches(pages, customValueTerms);
    const allMatches = [...regexMatches, ...aiMatches, ...customValueMatches];

    const boxesByPage = this.findWordBoxesForMatches(pages, allMatches);
    const totalRedactions = Object.values(boxesByPage).reduce((sum, arr) => sum + arr.length, 0);

    const tmpDir = path.join(path.dirname(outputPath), `redact_tmp_${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    await execPromise(`pdftoppm -jpeg -r ${DPI} "${inputPath}" "${path.join(tmpDir, 'page')}"`);

    const allFiles = await fs.readdir(tmpDir);
    const imageFiles = allFiles.filter(f => f.startsWith('page')).sort();

    const redactedImagePaths = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const imgPath = path.join(tmpDir, imageFiles[i]);
      const boxes = boxesByPage[i] || [];

      let image = sharp(imgPath);
      const metadata = await image.metadata();
      const scaleX = metadata.width / (boxes[0]?.pageWidth || metadata.width);
      const scaleY = metadata.height / (boxes[0]?.pageHeight || metadata.height);

      if (boxes.length > 0) {
        const svgRects = boxes.map(b => {
          const x = b.xMin * scaleX;
          const y = b.yMin * scaleY;
          const w = (b.xMax - b.xMin) * scaleX;
          const h = (b.yMax - b.yMin) * scaleY;
          return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`;
        }).join('');

        const svgOverlay = Buffer.from(
          `<svg width="${metadata.width}" height="${metadata.height}">${svgRects}</svg>`
        );

        image = image.composite([{ input: svgOverlay, top: 0, left: 0 }]);
      }

      const redactedPath = path.join(tmpDir, `redacted_${i}.jpg`);
      await image.jpeg({ quality: 90 }).toFile(redactedPath);
      redactedImagePaths.push(redactedPath);
    }

    const result = await this.imagesToPDF(redactedImagePaths, outputPath);

    await fs.rm(tmpDir, { recursive: true, force: true });

    return {
      pageCount: result.pageCount,
      redactionCount: totalRedactions,
      foundTerms: [...new Set(allMatches.map(m => m.matchedText))]
    };
  }
}

module.exports = new PDFService();

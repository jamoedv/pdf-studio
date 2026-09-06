const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const examGradingService = require('./examGradingService'); // reuse pdftoppm + vision helpers
const templateService = require('./templateService');
const templateStorage = require('./templateStorageService');
const pdfService = require('./pdfService');

function parseClaudeJSON(text) {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const useArr = startArr !== -1 && (start === -1 || startArr < start);
  if (useArr) {
    const end = cleaned.lastIndexOf(']');
    return JSON.parse(cleaned.slice(startArr, end + 1));
  }
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return { text: cleaned };
  return JSON.parse(cleaned.slice(start, end + 1));
}

class AssistantToolsService {
  // Erzeugt einen eindeutigen Ausgabepfad im gleichen Ordner wie die Ausgabedateien der übrigen App.
  outputPath(outputDir, suffix, ext = 'pdf') {
    return path.join(outputDir, `assistant_${suffix}_${uuidv4().slice(0, 8)}.${ext}`);
  }

  async compressPdf(fileId, level, outputDir) {
    const out = this.outputPath(outputDir, 'compressed');
    await pdfService.compressPDF(fileId, out, level || 'medium');
    return out;
  }

  async mergePdfs(fileIds, outputDir) {
    const out = this.outputPath(outputDir, 'merged');
    await pdfService.mergePDFs(fileIds, out);
    return out;
  }

  async splitPdf(fileId, options, outputDir) {
    const dir = path.join(outputDir, `split_${uuidv4().slice(0, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    const result = await pdfService.splitPDF(fileId, dir, options || {}, 'split');
    return result.files;
  }

  async rotatePdf(fileId, degrees, outputDir) {
    const out = this.outputPath(outputDir, 'rotated');
    await pdfService.rotatePDF(fileId, out, degrees || 90);
    return out;
  }

  async addWatermark(fileId, text, outputDir) {
    const out = this.outputPath(outputDir, 'watermarked');
    await pdfService.addWatermark(fileId, out, text || 'ENTWURF');
    return out;
  }

  async setPassword(fileId, password, outputDir) {
    const out = this.outputPath(outputDir, 'protected');
    await pdfService.setPassword(fileId, out, password);
    return out;
  }

  async removePassword(fileId, password, outputDir) {
    const out = this.outputPath(outputDir, 'unlocked');
    await pdfService.removePassword(fileId, out, password);
    return out;
  }

  async setMetadata(fileId, meta, outputDir) {
    const out = this.outputPath(outputDir, 'metadata');
    await pdfService.setMetadata(fileId, out, meta || {});
    return out;
  }

  async ocrPdf(fileId, language, outputDir) {
    const out = this.outputPath(outputDir, 'ocr');
    await pdfService.ocrPDF(fileId, out, language || 'deu+eng');
    return out;
  }

  async convertPdfToImages(fileId, format, outputDir) {
    const dir = path.join(outputDir, `images_${uuidv4().slice(0, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    const result = await pdfService.pdfToImages(fileId, dir, format || 'jpeg', 'page');
    return result.files;
  }

  async convertImagesToPdf(fileIds, outputDir) {
    const out = this.outputPath(outputDir, 'converted');
    await pdfService.imagesToPDF(fileIds, out);
    return out;
  }

  // Liest ein Dokument (bildbasiert, funktioniert auch bei gescannten/handschriftlichen PDFs)
  // und beantwortet eine frei formulierte Anweisung dazu.
  async analyzeDocument(filePath, instruction) {
    const anthropicClient = require('./anthropicClient');

    // Günstiger Weg zuerst: hat das PDF einen echten Text-Layer, brauchen wir keine
    // teure Bilderkennung. Nur bei Scans/Handschrift (kein extrahierbarer Text) auf
    // Bilder zurückfallen - Bild-Tokens kosten ein Vielfaches von Text-Tokens.
    const text = await pdfService.extractPdfText(filePath).catch(() => '');
    const useVision = !text || text.trim().length < 50;

    const content = useVision
      ? [...examGradingService.buildImageBlocks(await examGradingService.pdfToBase64Images(filePath)), { type: 'text', text: instruction }]
      : [{ type: 'text', text: text.slice(0, 15000) }, { type: 'text', text: instruction }];

    if (useVision && content.length <= 1) throw new Error('Dokument konnte nicht gelesen werden');

    const response = await anthropicClient.createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: `Du analysierst Dokumente (${useVision ? 'Bilder der Seiten werden dir gezeigt, auch handschriftliche/gescannte Inhalte' : 'der Textinhalt wird dir als reiner Text gegeben'}). Befolge die Anweisung des Nutzers präzise. Wenn eine strukturierte Antwort (JSON) verlangt wird, antworte AUSSCHLIESSLICH mit dem JSON-Objekt/Array, sonst mit klarem Fließtext. Erfinde keine Informationen, die nicht im Dokument stehen.`,
      messages: [{ role: 'user', content }],
    }, 'assistant-analyze-document');

    const responseText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return parseClaudeJSON(responseText);
    } catch {
      return { text: responseText };
    }
  }

  async compareDocuments(filePathA, filePathB, instruction) {
    const anthropicClient = require('./anthropicClient');

    const textA = await pdfService.extractPdfText(filePathA).catch(() => '');
    const textB = await pdfService.extractPdfText(filePathB).catch(() => '');
    const bothHaveText = textA.trim().length >= 50 && textB.trim().length >= 50;

    let content;
    if (bothHaveText) {
      content = [
        { type: 'text', text: `DOKUMENT A:\n${textA.slice(0, 12000)}` },
        { type: 'text', text: `DOKUMENT B:\n${textB.slice(0, 12000)}` },
        { type: 'text', text: instruction },
      ];
    } else {
      const imagesA = await examGradingService.pdfToBase64Images(filePathA);
      const imagesB = await examGradingService.pdfToBase64Images(filePathB);
      content = [
        { type: 'text', text: 'DOKUMENT A:' },
        ...examGradingService.buildImageBlocks(imagesA),
        { type: 'text', text: 'DOKUMENT B:' },
        ...examGradingService.buildImageBlocks(imagesB),
        { type: 'text', text: instruction },
      ];
    }

    const response = await anthropicClient.createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: `Du vergleichst zwei Dokumente (${bothHaveText ? 'als reiner Text' : 'Bilder der Seiten werden dir gezeigt'}). Befolge die Anweisung des Nutzers präzise. Wenn eine strukturierte Antwort (JSON) verlangt wird, antworte AUSSCHLIESSLICH mit dem JSON-Objekt/Array, sonst mit klarem Fließtext.`,
      messages: [{ role: 'user', content }],
    }, 'assistant-compare-documents');

    const responseText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return parseClaudeJSON(responseText);
    } catch {
      return { text: responseText };
    }
  }

  // Füllt eine Vorlage (per templateId aus der Bibliothek ODER per rohem html) mit einem
  // oder mehreren Werte-Sets und erzeugt entsprechend viele PDFs.
  async fillTemplate({ templateId, html, values }, outputDir) {
    let templateHtml = html;
    if (!templateHtml && templateId) {
      const record = templateStorage.getTemplate(templateId);
      if (!record) throw new Error(`Vorlage mit id ${templateId} nicht gefunden`);
      templateHtml = record.html;
    }
    if (!templateHtml) throw new Error('templateId oder html erforderlich');

    const valuesArray = Array.isArray(values) ? values : [values];
    await fs.mkdir(outputDir, { recursive: true });

    const outputFiles = await templateService.generateFromTemplate(templateHtml, valuesArray, outputDir, 'assistant');
    return { outputFiles, count: outputFiles.length };
  }

  async generatePdf(html, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `assistant_${uuidv4().slice(0, 8)}.pdf`);
    await templateService.renderHtmlToPdf(html, outputPath);
    return { outputPath };
  }

  // Erzeugt eine Excel-Datei aus einer Liste von Datensätzen (jede Zeile = ein Objekt).
  async exportExcel(rows, sheetName, outputDir) {
    const XLSX = require('xlsx');
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows (nicht-leeres Array) erforderlich');

    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `assistant_export_${uuidv4().slice(0, 8)}.xlsx`);

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, (sheetName || 'Daten').slice(0, 31));
    XLSX.writeFile(workbook, outputPath);

    return { outputPath };
  }
}

module.exports = new AssistantToolsService();

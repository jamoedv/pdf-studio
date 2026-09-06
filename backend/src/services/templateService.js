const puppeteer = require('puppeteer');

class TemplateService {

  extractPlaceholders(html) {
    const regex = /\{\{(.*?)\}\}/g;
    const matches = new Set();
    let m;
    while ((m = regex.exec(html)) !== null) {
      matches.add(m[1].trim());
    }
    return [...matches];
  }

  fillPlaceholders(html, values) {
    let filled = html;
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      filled = filled.replace(regex, value || '');
    }
    return filled;
  }

  async renderHtmlToPdf(html, outputPath) {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
      const page = await browser.newPage();

      // Vorlagen, die eine eigene @page-Regel mitbringen (z.B. Zertifikate im
      // A4-Querformat mit vollflächigem Layout), sollen ihre Seitengröße und
      // ihr Padding selbst bestimmen - keine zusätzlichen Standard-Ränder/Abstände.
      const hasCustomPageSize = /@page\b/i.test(html);

      const fullHtml = hasCustomPageSize
        ? `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
          </style>
        </head>
        <body>${html}</body>
        </html>
      `
        : `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; padding: 40px; }
            h1 { font-size: 24px; margin-bottom: 16px; }
            h2 { font-size: 18px; margin-bottom: 12px; }
            p { margin: 0 0 12px; }
            ul, ol { margin: 0 0 12px; padding-left: 24px; }
          </style>
        </head>
        <body>${html}</body>
        </html>
      `;
      await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

      const pdfOptions = hasCustomPageSize
        ? { path: outputPath, printBackground: true, preferCSSPageSize: true }
        : {
            path: outputPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
          };

      await page.pdf(pdfOptions);
    } finally {
      await browser.close();
    }
    return outputPath;
  }

  async generateFromTemplate(html, valuesArray, outputDir, prefix = 'doc') {
    const fs = require('fs').promises;
    const path = require('path');
    const { v4: uuidv4 } = require('uuid');

    await fs.mkdir(outputDir, { recursive: true });
    const outputFiles = [];

    for (let i = 0; i < valuesArray.length; i++) {
      const filledHtml = this.fillPlaceholders(html, valuesArray[i]);
      const outPath = path.join(outputDir, `${prefix}_${i + 1}_${uuidv4().slice(0, 6)}.pdf`);
      await this.renderHtmlToPdf(filledHtml, outPath);
      outputFiles.push(outPath);
    }

    return outputFiles;
  }
}

module.exports = new TemplateService();

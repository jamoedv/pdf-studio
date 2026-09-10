const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const sharp = require('sharp');
const execPromise = util.promisify(exec);

// Anthropics Grenze für MEHRERE Bilder in einer Anfrage liegt bei 2000px je Kante
// (compare_documents schickt immer mehrere Bilder auf einmal). 200 DPI erzeugt bei
// einer A4-Seite bereits ~2338px Höhe - das reicht schon aus, um die Grenze zu
// reißen. 1568px ist zusätzlich Anthropics eigene Qualitäts-Empfehlung (mehr bringt
// laut deren Dokumentation keine bessere Erkennung, nur mehr Tokens).
const MAX_IMAGE_DIMENSION = 1568;

function parseClaudeJSON(text) {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Konnte KI-Antwort nicht als JSON lesen');
  return JSON.parse(cleaned.slice(start, end + 1));
}

class ExamGradingService {
  // Rendert ein PDF als Serie von Bildern (Base64-JPEG) für die visuelle KI-Analyse
  // - notwendig für gescannte/handschriftliche Bögen, da hier reine Textextraktion nicht funktioniert.
  // Verkleinert jede Seite automatisch, falls sie Anthropics Bildgrößen-Grenze
  // überschreiten würde (siehe MAX_IMAGE_DIMENSION oben) - vorher lief das bei
  // mehrseitigen/hochauflösenden PDFs bei compare_documents in einen Fehler.
  async pdfToBase64Images(pdfPath, dpi = 200) {
    const tmpDir = path.join(path.dirname(pdfPath), `examimg_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tmpDir, { recursive: true });
    try {
      await execPromise(`pdftoppm -jpeg -r ${dpi} "${pdfPath}" "${path.join(tmpDir, 'page')}"`);
      const files = (await fs.readdir(tmpDir)).filter((f) => f.startsWith('page')).sort();
      const images = [];
      for (const f of files) {
        let buffer = await fs.readFile(path.join(tmpDir, f));
        const meta = await sharp(buffer).metadata();
        if ((meta.width || 0) > MAX_IMAGE_DIMENSION || (meta.height || 0) > MAX_IMAGE_DIMENSION) {
          buffer = await sharp(buffer)
            .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: 'inside' })
            .jpeg({ quality: 90 })
            .toBuffer();
        }
        images.push(buffer.toString('base64'));
      }
      return images;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  buildImageBlocks(base64Images) {
    return base64Images.map((data) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    }));
  }

  // Liest die Musterlösung (Bild-basiert) und extrahiert eine strukturierte Bewertungsvorlage.
  async extractAnswerKey(modelSolutionPath) {
    const anthropicClient = require('./anthropicClient');

    const images = await this.pdfToBase64Images(modelSolutionPath);
    if (images.length === 0) throw new Error('Musterlösung konnte nicht gelesen werden');

    const systemPrompt = `Du liest die Musterlösung einer Prüfung (Bilder der Seiten werden dir gezeigt) und erstellst daraus ein strukturiertes Bewertungsschema.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "questions": [
    {
      "number": "Fragenummer, z.B. '1' oder '3b'",
      "type": "mc" | "open",
      "questionText": "Kurze Zusammenfassung der Frage (falls erkennbar)",
      "correctAnswer": "bei type=mc: die korrekte Option (z.B. 'B' oder der Antworttext)",
      "keyPoints": ["bei type=open: Liste der erwarteten Kernaussagen/Stichpunkte für volle Punktzahl"],
      "maxPoints": Zahl
    }
  ]
}

Erkenne bei Multiple-Choice-Fragen die als richtig markierte/eingekreiste Option. Bei offenen Fragen liste die inhaltlichen Kernpunkte auf, die für die Bewertung relevant sind. Wenn keine Punktzahl erkennbar ist, schätze eine sinnvolle Punktzahl (MC meist 1 Punkt, offene Fragen 2-5 je nach Umfang).`;

    const response = await anthropicClient.createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          ...this.buildImageBlocks(images),
          { type: 'text', text: 'Erstelle das Bewertungsschema aus dieser Musterlösung.' },
        ],
      }],
    }, 'exam-grading-answerkey');

    const responseText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return parseClaudeJSON(responseText);
  }

  // Bewertet einen einzelnen Antwortbogen (Bild-basiert) gegen das Bewertungsschema.
  async gradeSubmission(answerKey, submissionPath) {
    const anthropicClient = require('./anthropicClient');

    const images = await this.pdfToBase64Images(submissionPath);
    if (images.length === 0) throw new Error('Antwortbogen konnte nicht gelesen werden');

    const systemPrompt = `Du bewertest einen ausgefüllten Prüfungsbogen (teilweise handschriftlich) anhand eines vorgegebenen Bewertungsschemas.

Bewertungsschema (JSON): ${JSON.stringify(answerKey)}

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "studentName": "erkannter Name auf dem Bogen, oder 'Unbekannt'",
  "questions": [
    {
      "number": "Fragenummer wie im Schema",
      "detectedAnswer": "erkannte Antwort/Auswahl (so genau wie möglich transkribiert)",
      "points": Zahl (vergebene Punkte),
      "maxPoints": Zahl (aus dem Schema),
      "confidence": "high" | "low",
      "note": "kurze Begründung, besonders bei Teilpunkten oder wenn confidence=low (z.B. schwer lesbare Handschrift, mehrdeutige Antwort)"
    }
  ],
  "totalScore": Zahl,
  "maxScore": Zahl
}

Wichtig:
- Bei Multiple-Choice: volle Punktzahl nur bei eindeutig korrekt markierter Antwort, sonst 0.
- Bei offenen/handschriftlichen Fragen: vergleiche den erkannten Inhalt mit den erwarteten Kernpunkten und vergib anteilig Punkte (Teilpunkte sind erlaubt und erwünscht).
- Setze confidence auf "low", wenn die Handschrift schwer lesbar ist, die Antwort mehrdeutig ist, oder du bei der Punktevergabe unsicher bist — der Trainer soll solche Fälle gezielt manuell nachprüfen können.
- Erfinde keine Antworten, die nicht erkennbar sind — transkribiere nur, was wirklich auf dem Bogen steht.`;

    const response = await anthropicClient.createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          ...this.buildImageBlocks(images),
          { type: 'text', text: 'Bewerte diesen Antwortbogen anhand des Bewertungsschemas.' },
        ],
      }],
    }, 'exam-grading-submission');

    const responseText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return parseClaudeJSON(responseText);
  }

  // Erzeugt eine Notenübersicht als Excel-Datei aus mehreren Bewertungsergebnissen.
  async exportResultsToExcel(results, outputPath) {
    const XLSX = require('xlsx');

    const allQuestionNumbers = [...new Set(results.flatMap((r) => (r.questions || []).map((q) => q.number)))];

    const rows = results.map((r) => {
      const row = {
        Name: r.studentName || 'Unbekannt',
        Datei: r.filename || '',
        Gesamtpunkte: r.totalScore,
        Maximalpunkte: r.maxScore,
        Prozent: r.maxScore ? Math.round((r.totalScore / r.maxScore) * 1000) / 10 : '',
        'Manuell prüfen': (r.questions || []).some((q) => q.confidence === 'low') ? 'JA' : '',
      };
      for (const num of allQuestionNumbers) {
        const q = (r.questions || []).find((qq) => qq.number === num);
        row[`Frage ${num}`] = q ? `${q.points}/${q.maxPoints}` : '';
      }
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Notenübersicht');
    XLSX.writeFile(workbook, outputPath);

    return outputPath;
  }
}

module.exports = new ExamGradingService();

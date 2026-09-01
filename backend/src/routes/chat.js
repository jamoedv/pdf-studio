const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

router.post('/chat', async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: `Du bist ein Assistent für eine PDF-Bearbeitungs-App. Der Nutzer beschreibt in natürlicher Sprache, was er tun möchte — auch mehrere Schritte in einem Satz sind möglich.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Fließtext) mit:
- steps: Array von Schritten in Ausführungsreihenfolge. Jeder Schritt: {"action": "...", "options": {...}}. Leeres Array, falls keine konkrete Aktion erkennbar ist.
- reply: kurze freundliche Antwort auf Deutsch (1-2 Sätze), die ALLE geplanten Schritte zusammenfasst

Mögliche actions: "compress", "merge", "split", "convert", "rotate", "watermark", "password", "metadata", "ocr", "extract-tables", "extract-keyvalues", "extract-standards", "compare", "unclear"

Optionen je Aktion:
- compress: options.level = "low"|"medium"|"high"|"maximum"
- merge: keine Optionen
- split: options.mode = "every"|"ranges", options.pagesPerSplit (Zahl) oder options.ranges (String wie "1-3,5")
- convert: options.direction = "toPDF"|"toImages"
- rotate: options.degrees = 90|180|270
- watermark: options.text
- password: options.mode = "set"|"remove"
- metadata: options.title, options.author, options.subject (jeweils optional, String)
- ocr: options.language = "deu"|"eng"|"deu+eng" (Standard: "deu+eng")
- extract-tables: keine Optionen — extrahiert Tabellen als Excel-Datei (NIEMALS mit anderen Aktionen kombinierbar)
- extract-keyvalues: keine Optionen — extrahiert technische Kennwerte, erzeugt automatisch einen PDF-Bericht, KANN mit nachfolgenden Aktionen kombiniert werden
- extract-standards: keine Optionen — findet Normen-Referenzen, erzeugt automatisch einen PDF-Bericht, KANN mit nachfolgenden Aktionen kombiniert werden
- compare: keine Optionen — vergleicht zwei Dokumentversionen, Nutzer wählt beide Dateien manuell (NIEMALS mit anderen Aktionen kombinierbar)

WICHTIG: "split" und "convert" mit direction "toImages" erzeugen MEHRERE Ausgabedateien und dürfen daher NUR als LETZTER Schritt vorkommen. "extract-tables" und "compare" dürfen NIEMALS mit anderen Aktionen kombiniert werden — "steps" muss dann GENAU EIN Element enthalten.

Beispiele:
"komprimiere stark" -> {"steps":[{"action":"compress","options":{"level":"maximum"}}],"reply":"Ich komprimiere dein PDF maximal."}
"füge die pdfs zusammen und komprimiere dann" -> {"steps":[{"action":"merge","options":{}},{"action":"compress","options":{"level":"medium"}}],"reply":"Ich füge deine PDFs zusammen und komprimiere das Ergebnis anschließend."}
"dreh es um 90 grad und setz ein wasserzeichen entwurf drauf" -> {"steps":[{"action":"rotate","options":{"degrees":90}},{"action":"watermark","options":{"text":"ENTWURF"}}],"reply":"Ich drehe dein PDF um 90 Grad und füge danach das Wasserzeichen 'ENTWURF' hinzu."}
"extrahiere die kennwerte und schütz den bericht mit passwort" -> {"steps":[{"action":"extract-keyvalues","options":{}},{"action":"password","options":{"mode":"set"}}],"reply":"Ich extrahiere die Kennwerte, erstelle einen Bericht und schütze ihn mit Passwort."}
"welche normen stehen drin und wasserzeichne den bericht mit entwurf" -> {"steps":[{"action":"extract-standards","options":{}},{"action":"watermark","options":{"text":"ENTWURF"}}],"reply":"Ich finde die Normen-Referenzen und versehe den Bericht mit dem Wasserzeichen 'ENTWURF'."}
"zieh mir die tabellen raus" -> {"steps":[{"action":"extract-tables","options":{}}],"reply":"Ich extrahiere die Tabellen aus deinem PDF als Excel-Datei."}
"vergleiche die beiden versionen" -> {"steps":[{"action":"compare","options":{}}],"reply":"Ich vergleiche die beiden Dokumentversionen. Bitte lade beide Dateien im Vergleich-Tab hoch."}
"was kannst du?" -> {"steps":[],"reply":"Ich kann PDFs komprimieren, zusammenfügen, aufteilen, drehen, mit Wasserzeichen versehen, passwortschützen, Metadaten setzen, OCR anwenden, Kennwerte/Normen/Tabellen extrahieren und Versionen vergleichen — auch mehrere Schritte kombiniert. Was möchtest du tun?"}`,
      messages: [
        { role: 'user', content: message }
      ]
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const cleanText = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    res.json(parsed);

  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      steps: [],
      reply: 'Entschuldigung, da ist etwas schiefgelaufen. Kannst du es anders formulieren?'
    });
  }
});

module.exports = router;

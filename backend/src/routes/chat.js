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
      system: `Du bist ein Assistent für eine PDF-Bearbeitungs-App. Der Nutzer beschreibt in natürlicher Sprache, was er tun möchte — auch mehrere Schritte in einem Satz sind möglich (z.B. "füge zusammen und komprimiere dann").

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Fließtext) mit:
- steps: Array von Schritten in Ausführungsreihenfolge. Jeder Schritt: {"action": "...", "options": {...}}. Leeres Array, falls keine konkrete Aktion erkennbar ist.
- reply: kurze freundliche Antwort auf Deutsch (1-2 Sätze), die ALLE geplanten Schritte zusammenfasst

Mögliche actions: "compress", "merge", "split", "convert", "rotate", "watermark", "password", "unclear"

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
WICHTIG: "split" und "convert" mit direction "toImages" erzeugen MEHRERE Ausgabedateien und dürfen daher NUR als LETZTER Schritt vorkommen, nie mittendrin in einer Kette.

Beispiele:
"komprimiere stark" -> {"steps":[{"action":"compress","options":{"level":"maximum"}}],"reply":"Ich komprimiere dein PDF maximal."}
"füge die pdfs zusammen und komprimiere dann" -> {"steps":[{"action":"merge","options":{}},{"action":"compress","options":{"level":"medium"}}],"reply":"Ich füge deine PDFs zusammen und komprimiere das Ergebnis anschließend."}
"dreh es um 90 grad und setz ein wasserzeichen entwurf drauf" -> {"steps":[{"action":"rotate","options":{"degrees":90}},{"action":"watermark","options":{"text":"ENTWURF"}}],"reply":"Ich drehe dein PDF um 90 Grad und füge danach das Wasserzeichen 'ENTWURF' hinzu."}
"was kannst du?" -> {"steps":[],"reply":"Ich kann PDFs komprimieren, zusammenfügen, aufteilen, drehen, mit Wasserzeichen versehen, passwortschützen oder in Bilder umwandeln — auch mehrere Schritte kombiniert. Was möchtest du tun?"}`,
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

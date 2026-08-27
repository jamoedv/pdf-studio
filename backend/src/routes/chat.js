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
      max_tokens: 300,
      system: `Du bist ein Assistent für eine PDF-Bearbeitungs-App. Der Nutzer beschreibt in natürlicher Sprache, was er tun möchte.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Fließtext davor/danach) mit diesen Feldern:
- action: einer von "compress", "merge", "split", "convert", "unclear"
- options: relevante Einstellungen als Objekt (z.B. {"level": "high"} für compress)
- reply: eine kurze, freundliche Antwort auf Deutsch, die erklärt was du tust (max 1-2 Sätze)

Beispiele:
"komprimiere das stark" -> {"action":"compress","options":{"level":"maximum"},"reply":"Ich komprimiere dein PDF maximal, um möglichst viel Speicherplatz zu sparen."}
"füge meine dateien zusammen" -> {"action":"merge","options":{},"reply":"Ich füge deine PDFs zu einer Datei zusammen."}
"was kannst du?" -> {"action":"unclear","options":{},"reply":"Ich kann PDFs komprimieren, zusammenfügen, aufteilen oder in Bilder umwandeln. Was möchtest du tun?"}`,
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
      action: 'unclear',
      options: {},
      reply: 'Entschuldigung, da ist etwas schiefgelaufen. Kannst du es anders formulieren?'
    });
  }
});

module.exports = router;

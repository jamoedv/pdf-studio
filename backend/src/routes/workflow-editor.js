const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const agentEngine = require('../services/agentEngine');
const workflowStorage = require('../services/workflowStorageService');
const { runWithUser, getCurrentUsername, createMessage } = require('../services/anthropicClient');

router.use(requireAuth);

const EDITOR_EXCLUDED_TOOLS = new Set(['save_workflow', 'list_workflows', 'get_workflow', 'save_template', 'list_templates', 'get_template']);

// KI schlaegt aus einer freien Beschreibung eine strukturierte Schritt-Liste vor -
// der Nutzer sieht/bearbeitet das Ergebnis danach ganz normal im Editor, es wird
// NICHTS automatisch ausgefuehrt oder gespeichert.
router.post('/workflow-editor/suggest-steps', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'description erforderlich' });

    const tools = agentEngine.TOOLS.filter((t) => !EDITOR_EXCLUDED_TOOLS.has(t.name));
    const toolsList = tools
      .map((t) => `- ${t.name}: ${t.description} (Parameter: ${JSON.stringify(t.input_schema.properties || {})})`)
      .join('\n');

    const systemPrompt = `Du bist ein Workflow-Planer für ein PDF-Verarbeitungsportal. Der Nutzer beschreibt in freier Sprache, was ein wiederverwendbarer Workflow tun soll. Übersetze das in eine strukturierte Liste von Schritten.

Verfügbare Werkzeuge:
${toolsList}

Antworte AUSSCHLIESSLICH mit einem JSON-Array, keine Erklärung, kein Markdown, kein Codeblock:
[
  { "title": "Kurzer Titel", "tool": "werkzeug_name", "params": { ... }, "inputSource": "upload" },
  { "title": "Kurzer Titel", "instruction": "Freitext-Anweisung für Schritte, die eigenes Urteilsvermögen brauchen" }
]

Nutze "tool" NUR wenn ein Werkzeug aus der Liste eindeutig passt UND alle nötigen Parameter aus der Beschreibung klar hervorgehen oder sinnvoll erschlossen werden können (fileId/fileIds NIEMALS in "params" aufnehmen, das übernimmt "inputSource"). Nutze sonst "instruction" für Schritte, die Lesen/Vergleichen/Bewerten/Zusammenfassen/mehrere Quellen zusammenführen erfordern - dafür reicht eine klare Anweisung ohne festes Werkzeug. "inputSource" bei Werkzeug-Schritten: "upload" für den ersten Schritt oder eine neue hochgeladene Datei, sonst "step:N" (N = 1-basierter Index des Schritts, dessen Ergebnis genutzt wird).`;

    const response = await createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: description }],
    }, 'workflow-editor-suggest');

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const cleaned = text.replace(/```json|```/g, '').trim();
    let steps;
    try {
      steps = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Die KI-Antwort konnte nicht als Schritt-Liste gelesen werden. Bitte nochmal versuchen oder Beschreibung präzisieren.' });
    }
    res.json({ steps });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Werkzeug-Definitionen fürs Frontend, damit die Formulare dort automatisch aus
// denselben input_schema-Beschreibungen gebaut werden, die auch der Chat-Assistent
// nutzt - keine doppelte Pflege der Parameter-Listen an zwei Stellen.
// list_workflows/get_workflow/save_workflow selbst ergeben als Editor-Baustein
// keinen Sinn (sie SIND der Editor) und werden rausgefiltert.
router.get('/workflow-editor/tools', (req, res) => {
  const tools = agentEngine.TOOLS.filter((t) => !EDITOR_EXCLUDED_TOOLS.has(t.name));
  res.json({ tools });
});

// Baut aus der strukturierten Schritt-Liste des Editors eine praezise, unmiss-
// verstaendliche Anweisung fuer die bestehende Agenten-Schleife - nutzt also
// dieselbe Ausfuehrung wie der normale Chat, nur mit einem exakt vorgegebenen Plan
// statt dass die KI daraus erst selbst einen Plan ableiten muss.
function buildInstructionFromSteps(steps) {
  const lines = steps.map((step, i) => {
    const n = i + 1;
    if (step.tool) {
      const inputNote = step.inputSource === 'upload' || !step.inputSource
        ? 'die hochgeladene(n) Datei(en)'
        : `das Ergebnis von Schritt ${step.inputSource.replace('step:', '')}`;
      return `Schritt ${n} - "${step.title}": Nutze GENAU das Werkzeug "${step.tool}" mit GENAU diesen Parametern: ${JSON.stringify(step.params || {})}. Eingabe: ${inputNote}.`;
    }
    return `Schritt ${n} - "${step.title}": Freie Anweisung, entscheide selbst mit passenden Werkzeugen: ${step.instruction}`;
  });
  return `Führe folgende Schritte GENAU in dieser Reihenfolge aus:\n\n${lines.join('\n')}\n\nBei Schritten mit fest vorgegebenem Werkzeug/Parametern weiche NICHT davon ab (außer bei der fileId, die du aus dem jeweils vorherigen Schritt-Ergebnis übernimmst, sofern angegeben).`;
}

// Testlauf eines NOCH NICHT gespeicherten Entwurfs - direkt mit Steps/Config im
// Request-Body, damit man im Editor probieren kann, bevor man speichert.
router.post('/workflow-editor/test-run', async (req, res) => {
  try {
    const { steps, fileIds } = req.body;
    if (!steps || steps.length === 0) return res.status(400).json({ error: 'Mindestens ein Schritt erforderlich' });

    const message = buildInstructionFromSteps(steps);
    const result = await runWithUser(req.user.username, () =>
      agentEngine.runAgentLoop({ history: [], message, fileIds: fileIds || [] })
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Speichert einen im Editor gebauten Workflow. "steps" enthaelt die vollen,
// strukturierten Schritt-Daten (Werkzeug/Parameter/Anweisung) UND client-seitig
// bereits einen Anzeige-Titel - das reicht bereits im bestehenden steps-Format
// (title/description), zusaetzlich landet die volle Struktur in "config" fuer
// spaeteres erneutes Bearbeiten im Editor.
router.post('/workflow-editor/save', (req, res) => {
  try {
    const { name, description, steps } = req.body;
    if (!name || !steps || steps.length === 0) {
      return res.status(400).json({ error: 'name und mindestens ein Schritt erforderlich' });
    }
    const displaySteps = steps.map((s) => ({
      title: s.title,
      description: s.tool ? `${s.tool}(${JSON.stringify(s.params || {})})` : s.instruction,
    }));
    const config = { editorSteps: steps, instruction: buildInstructionFromSteps(steps) };
    const record = workflowStorage.saveWorkflow(name, description, config, displaySteps, req.user.username);
    res.json({ workflow: record });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Aktualisiert einen bestehenden, im Editor gebauten Workflow (Schritte neu setzen).
router.patch('/workflow-editor/:id', (req, res) => {
  const wf = workflowStorage.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
  if (wf.ownerUsername !== req.user.username && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { name, description, steps } = req.body;
  const displaySteps = steps.map((s) => ({
    title: s.title,
    description: s.tool ? `${s.tool}(${JSON.stringify(s.params || {})})` : s.instruction,
  }));
  const config = { editorSteps: steps, instruction: buildInstructionFromSteps(steps) };
  const updated = workflowStorage.updateWorkflow(req.params.id, { name, description, steps: displaySteps, config });
  res.json({ workflow: updated });
});

module.exports = router;

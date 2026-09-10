const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const agentEngine = require('../services/agentEngine');
const workflowStorage = require('../services/workflowStorageService');
const { runWithUser, createMessage } = require('../services/anthropicClient');
const { SOURCE_NODE_ID, buildInstructionFromGraph, toDisplaySteps } = require('../services/workflowGraphExecutor');

router.use(requireAuth);

const EDITOR_EXCLUDED_TOOLS = new Set(['save_workflow', 'list_workflows', 'get_workflow', 'save_template', 'list_templates', 'get_template']);

// Werkzeug-Definitionen fürs Frontend, damit Formulare/Eingabe-Anschlüsse dort
// automatisch aus denselben input_schema-Beschreibungen gebaut werden wie beim
// Chat-Assistenten - keine doppelte Pflege an zwei Stellen.
router.get('/workflow-editor/tools', (req, res) => {
  const tools = agentEngine.TOOLS.filter((t) => !EDITOR_EXCLUDED_TOOLS.has(t.name));
  res.json({ tools });
});

// --- KI-Vorschlag -------------------------------------------------------------

router.post('/workflow-editor/suggest-graph', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'description erforderlich' });

    const tools = agentEngine.TOOLS.filter((t) => !EDITOR_EXCLUDED_TOOLS.has(t.name));
    const toolsList = tools
      .map((t) => `- ${t.name}: ${t.description} (Parameter: ${JSON.stringify(t.input_schema.properties || {})})`)
      .join('\n');

    const systemPrompt = `Du bist ein Workflow-Planer für ein PDF-Verarbeitungsportal. Der Nutzer beschreibt in freier Sprache einen wiederverwendbaren Ablauf. Übersetze das in einen Verarbeitungs-Graphen aus Knoten und Verbindungen - auch parallele Pfade sind möglich (z.B. zwei Dokumente unabhängig analysieren, dann deren Ergebnisse in einem Knoten zusammenführen).

Verfügbare Werkzeuge:
${toolsList}

Es gibt immer einen impliziten Start-Knoten mit der id "upload" (die hochgeladene(n) Datei(en)) - referenziere ihn als "source" in Kanten, lege ihn selbst NICHT in "nodes" an.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, keine Erklärung, kein Markdown, kein Codeblock:
{
  "nodes": [
    { "id": "n1", "title": "Kurzer Titel", "tool": "werkzeug_name", "params": { ... } },
    { "id": "n2", "title": "Kurzer Titel", "instruction": "Freitext für Schritte, die Urteilsvermögen brauchen" }
  ],
  "edges": [
    { "source": "upload", "target": "n1" },
    { "source": "n1", "target": "n2", "targetHandle": "optionaler Parameter-Name bei mehreren Eingängen, z.B. fileIdA" }
  ]
}

Nutze "tool" NUR wenn ein Werkzeug eindeutig passt und Parameter klar hervorgehen (fileId/fileIdA/fileIdB/fileIds NIEMALS in "params", das übernehmen die Kanten). Nutze sonst "instruction". Bei Werkzeugen mit mehreren Datei-Parametern (z.B. compare_documents mit fileIdA/fileIdB) MUSS "targetHandle" pro eingehender Kante den jeweiligen Parameter-Namen angeben. Erzeuge parallele Pfade (mehrere Kanten von "upload" oder von einem gemeinsamen Vorgänger), wenn die Beschreibung das nahelegt (z.B. "vergleiche zwei Dokumente", "verarbeite beide Dateien unabhängig"). WICHTIG: Wenn mehrere unterschiedliche hochgeladene Dateien gebraucht werden (z.B. Klausur UND Musterlösung), erzeuge fuer jede eine EIGENE Kante von "upload" mit jeweils eigenem "targetHandle" - nie beide Datei-Rollen ueber dieselbe Kante.`;

    const response = await createMessage({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: description }],
    }, 'workflow-editor-suggest');

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const cleaned = text.replace(/```json|```/g, '').trim();
    let graph;
    try {
      graph = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Die KI-Antwort konnte nicht gelesen werden. Bitte nochmal versuchen oder Beschreibung präzisieren.' });
    }
    res.json(graph);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Testlauf / Speichern -----------------------------------------------------

// uploadAssignments (optional): { "knotenId:parameterName": "dateiname.pdf" } -
// erzeugt aus den benannten Upload-Slots im Frontend, wenn mehrere unterschiedliche
// Dateien gebraucht werden (siehe workflowGraphUtils.js im Frontend).
router.post('/workflow-editor/test-run', async (req, res) => {
  try {
    const { nodes, edges, fileIds, uploadAssignments, history, message } = req.body;

    let effectiveMessage = message;
    if (!effectiveMessage) {
      if (!nodes || nodes.length === 0) return res.status(400).json({ error: 'Mindestens ein Knoten erforderlich' });
      effectiveMessage = buildInstructionFromGraph([{ id: SOURCE_NODE_ID }, ...nodes], edges || [], uploadAssignments);
    }

    const result = await runWithUser(req.user.username, () =>
      agentEngine.runAgentLoop({ history: history || [], message: effectiveMessage, fileIds: message ? [] : (fileIds || []) })
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/workflow-editor/save', (req, res) => {
  try {
    const { name, description, nodes, edges, sourceMode } = req.body;
    if (!name || !nodes || nodes.length === 0) {
      return res.status(400).json({ error: 'name und mindestens ein Knoten erforderlich' });
    }
    const fullNodes = [{ id: SOURCE_NODE_ID }, ...nodes];
    buildInstructionFromGraph(fullNodes, edges || []); // nur zur Zirkelbezug-Pruefung beim Speichern
    const config = { editorGraph: { nodes, edges: edges || [], sourceMode: sourceMode || 'upload' } };
    const record = workflowStorage.saveWorkflow(name, description, config, toDisplaySteps(fullNodes), req.user.username);
    res.json({ workflow: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/workflow-editor/:id', (req, res) => {
  try {
    const wf = workflowStorage.getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ error: 'Nicht gefunden' });
    if (wf.ownerUsername !== req.user.username && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const { name, description, nodes, edges, sourceMode } = req.body;
    const fullNodes = [{ id: SOURCE_NODE_ID }, ...nodes];
    buildInstructionFromGraph(fullNodes, edges || []); // nur zur Zirkelbezug-Pruefung
    const config = { editorGraph: { nodes, edges: edges || [], sourceMode: sourceMode || 'upload' } };
    const updated = workflowStorage.updateWorkflow(req.params.id, { name, description, steps: toDisplaySteps(fullNodes), config });
    res.json({ workflow: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;

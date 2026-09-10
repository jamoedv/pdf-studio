const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const agentEngine = require('../services/agentEngine');
const workflowStorage = require('../services/workflowStorageService');
const { runWithUser, createMessage } = require('../services/anthropicClient');

router.use(requireAuth);

const EDITOR_EXCLUDED_TOOLS = new Set(['save_workflow', 'list_workflows', 'get_workflow', 'save_template', 'list_templates', 'get_template']);
const SOURCE_NODE_ID = 'upload';

// Werkzeug-Definitionen fürs Frontend, damit Formulare/Eingabe-Anschlüsse dort
// automatisch aus denselben input_schema-Beschreibungen gebaut werden wie beim
// Chat-Assistenten - keine doppelte Pflege an zwei Stellen.
router.get('/workflow-editor/tools', (req, res) => {
  const tools = agentEngine.TOOLS.filter((t) => !EDITOR_EXCLUDED_TOOLS.has(t.name));
  res.json({ tools });
});

// --- Graph -> Ausfuehrungs-Anweisung -----------------------------------------
//
// Baut aus Knoten+Kanten eine praezise Anweisung fuer die bestehende Agenten-
// Schleife. Ermittelt per topologischer Sortierung, welche Knoten unabhaengig
// voneinander (parallel) bearbeitet werden koennen, und welche auf Ergebnisse
// anderer Knoten warten muessen (z.B. ein Vergleichs-Knoten mit zwei Eingaengen).

function topologicalGroups(nodes, edges) {
  const nodeIds = nodes.map((n) => n.id);
  const incoming = new Map(nodeIds.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (e.source === SOURCE_NODE_ID) continue; // Upload ist immer sofort "verfuegbar"
    if (incoming.has(e.target)) incoming.get(e.target).add(e.source);
  }

  const done = new Set([SOURCE_NODE_ID]);
  const groups = [];
  let remaining = nodeIds.filter((id) => id !== SOURCE_NODE_ID);

  while (remaining.length > 0) {
    const ready = remaining.filter((id) => [...incoming.get(id)].every((dep) => done.has(dep)));
    if (ready.length === 0) {
      throw new Error('Der Ablauf enthält einen Zirkelbezug (Knoten hängen gegenseitig voneinander ab) - bitte Verbindungen prüfen.');
    }
    groups.push(ready);
    ready.forEach((id) => done.add(id));
    remaining = remaining.filter((id) => !ready.includes(id));
  }
  return groups;
}

function describeInputs(nodeId, edges, nodesById) {
  const incomingEdges = edges.filter((e) => e.target === nodeId);
  if (incomingEdges.length === 0) return 'hochgeladene Datei(en)';
  return incomingEdges
    .map((e) => {
      const label = e.targetHandle ? `${e.targetHandle} = ` : '';
      const sourceDesc = e.source === SOURCE_NODE_ID ? 'hochgeladene Datei(en)' : `Ergebnis von Knoten "${nodesById.get(e.source)?.title}"`;
      return `${label}${sourceDesc}`;
    })
    .join(', ');
}

function buildInstructionFromGraph(nodes, edges) {
  const realNodes = nodes.filter((n) => n.id !== SOURCE_NODE_ID);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const groups = topologicalGroups(nodes, edges);

  const groupTexts = groups.map((groupIds, gi) => {
    const lines = groupIds.map((id) => {
      const node = nodesById.get(id);
      const inputDesc = describeInputs(id, edges, nodesById);
      if (node.tool) {
        return `- Knoten "${node.title}": Nutze GENAU das Werkzeug "${node.tool}" mit GENAU diesen Parametern: ${JSON.stringify(node.params || {})}. Eingabe: ${inputDesc}.`;
      }
      return `- Knoten "${node.title}": Freie Anweisung, entscheide selbst mit passenden Werkzeugen: ${node.instruction} (Eingabe: ${inputDesc})`;
    });
    const parallelNote = groupIds.length > 1 ? ' (diese Knoten sind unabhängig voneinander, bearbeite sie in einem Zug parallel)' : '';
    return `Gruppe ${gi + 1}${parallelNote}:\n${lines.join('\n')}`;
  });

  return `Führe den folgenden Ablauf aus. Bearbeite die Gruppen der Reihe nach; Knoten innerhalb derselben Gruppe hängen nicht voneinander ab.\n\n${groupTexts.join('\n\n')}\n\nWeiche bei Knoten mit fest vorgegebenem Werkzeug/Parametern NICHT davon ab (außer bei fileId-Werten, die du aus den angegebenen Eingaben übernimmst).`;
}

function toDisplaySteps(nodes) {
  return nodes.filter((n) => n.id !== SOURCE_NODE_ID).map((n) => ({
    title: n.title,
    description: n.tool ? `${n.tool}(${JSON.stringify(n.params || {})})` : n.instruction,
  }));
}

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

Nutze "tool" NUR wenn ein Werkzeug eindeutig passt und Parameter klar hervorgehen (fileId/fileIdA/fileIdB/fileIds NIEMALS in "params", das übernehmen die Kanten). Nutze sonst "instruction". Bei Werkzeugen mit mehreren Datei-Parametern (z.B. compare_documents mit fileIdA/fileIdB) MUSS "targetHandle" pro eingehender Kante den jeweiligen Parameter-Namen angeben. Erzeuge parallele Pfade (mehrere Kanten von "upload" oder von einem gemeinsamen Vorgänger), wenn die Beschreibung das nahelegt (z.B. "vergleiche zwei Dokumente", "verarbeite beide Dateien unabhängig").`;

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

router.post('/workflow-editor/test-run', async (req, res) => {
  try {
    const { nodes, edges, fileIds } = req.body;
    if (!nodes || nodes.length === 0) return res.status(400).json({ error: 'Mindestens ein Knoten erforderlich' });

    const message = buildInstructionFromGraph([{ id: SOURCE_NODE_ID }, ...nodes], edges || []);
    const result = await runWithUser(req.user.username, () =>
      agentEngine.runAgentLoop({ history: [], message, fileIds: fileIds || [] })
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/workflow-editor/save', (req, res) => {
  try {
    const { name, description, nodes, edges } = req.body;
    if (!name || !nodes || nodes.length === 0) {
      return res.status(400).json({ error: 'name und mindestens ein Knoten erforderlich' });
    }
    const fullNodes = [{ id: SOURCE_NODE_ID }, ...nodes];
    const instruction = buildInstructionFromGraph(fullNodes, edges || []); // wirft bei Zirkelbezug
    const config = { editorGraph: { nodes, edges: edges || [] }, instruction };
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
    const { name, description, nodes, edges } = req.body;
    const fullNodes = [{ id: SOURCE_NODE_ID }, ...nodes];
    const instruction = buildInstructionFromGraph(fullNodes, edges || []);
    const config = { editorGraph: { nodes, edges: edges || [] }, instruction };
    const updated = workflowStorage.updateWorkflow(req.params.id, { name, description, steps: toDisplaySteps(fullNodes), config });
    res.json({ workflow: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;

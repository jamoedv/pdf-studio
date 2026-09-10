const SOURCE_NODE_ID = 'upload';

// Ermittelt per topologischer Sortierung, welche Knoten unabhaengig voneinander
// (parallel) bearbeitet werden koennen, und welche auf Ergebnisse anderer Knoten
// warten muessen.
function topologicalGroups(nodes, edges) {
  const nodeIds = nodes.map((n) => n.id);
  const incoming = new Map(nodeIds.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (e.source === SOURCE_NODE_ID) continue;
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

// uploadAssignments (optional): { "knotenId:parameterName": "dateiname.pdf" }
// Erlaubt es, bei mehreren hochgeladenen Dateien EXAKT festzulegen, welche Datei
// zu welchem Parameter gehoert, statt dass die KI das anhand von Dateinamen raten muss.
function describeInputs(nodeId, edges, nodesById, uploadAssignments) {
  const incomingEdges = edges.filter((e) => e.target === nodeId);
  if (incomingEdges.length === 0) return 'hochgeladene Datei(en)';
  return incomingEdges
    .map((e) => {
      const label = e.targetHandle ? `${e.targetHandle} = ` : '';
      let sourceDesc;
      if (e.source === SOURCE_NODE_ID) {
        const slotKey = `${e.target}:${e.targetHandle || 'Eingabe'}`;
        const assignedFilename = uploadAssignments?.[slotKey];
        sourceDesc = assignedFilename
          ? `GENAU die hochgeladene Datei mit dem Namen "${assignedFilename}"`
          : 'hochgeladene Datei(en)';
      } else {
        sourceDesc = `Ergebnis von Knoten "${nodesById.get(e.source)?.title}"`;
      }
      return `${label}${sourceDesc}`;
    })
    .join(', ');
}

// Baut aus Knoten+Kanten eine praezise, unmissverstaendliche Anweisung fuer die
// bestehende Agenten-Schleife - nutzt also dieselbe Ausfuehrung wie der normale
// Chat, nur mit einem exakt vorgegebenen Plan statt dass die KI ihn selbst
// aus einem Gespraech ableiten muss. Wird sowohl beim Speichern (generische
// Vorlage ohne Datei-Zuordnung) als auch bei jeder tatsaechlichen Ausfuehrung
// (mit den konkreten, gerade hochgeladenen Dateinamen) neu aufgerufen.
function buildInstructionFromGraph(nodes, edges, uploadAssignments) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const groups = topologicalGroups(nodes, edges);

  const groupTexts = groups.map((groupIds, gi) => {
    const lines = groupIds.map((id) => {
      const node = nodesById.get(id);
      const inputDesc = describeInputs(id, edges, nodesById, uploadAssignments);
      if (node.tool) {
        return `- Knoten "${node.title}": Nutze GENAU das Werkzeug "${node.tool}" mit GENAU diesen Parametern: ${JSON.stringify(node.params || {})}. Eingabe: ${inputDesc}.`;
      }
      return `- Knoten "${node.title}": Freie Anweisung, entscheide selbst mit passenden Werkzeugen: ${node.instruction} (Eingabe: ${inputDesc})`;
    });
    const parallelNote = groupIds.length > 1 ? ' (diese Knoten sind unabhängig voneinander, bearbeite sie in einem Zug parallel)' : '';
    return `Gruppe ${gi + 1}${parallelNote}:\n${lines.join('\n')}`;
  });

  return `Führe den folgenden Ablauf aus. Bearbeite die Gruppen der Reihe nach; Knoten innerhalb derselben Gruppe hängen nicht voneinander ab.\n\n${groupTexts.join('\n\n')}\n\nWeiche bei Knoten mit fest vorgegebenem Werkzeug/Parametern NICHT davon ab (außer bei fileId-Werten, die du aus den angegebenen Eingaben übernimmst). Falls eine Eingabe eine GENAU benannte Datei nennt, verwechsle sie nicht mit einer anderen hochgeladenen Datei.`;
}

function toDisplaySteps(nodes) {
  return nodes.filter((n) => n.id !== SOURCE_NODE_ID).map((n) => ({
    title: n.title,
    description: n.tool ? `${n.tool}(${JSON.stringify(n.params || {})})` : n.instruction,
  }));
}

module.exports = { SOURCE_NODE_ID, topologicalGroups, buildInstructionFromGraph, toDisplaySteps };

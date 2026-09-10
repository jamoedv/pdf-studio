// Ermittelt, ob ein Workflow-Graph MEHRERE unterschiedliche hochgeladene Dateien
// braucht (z.B. compare_documents mit fileIdA UND fileIdB, beide vom "upload"-
// Startknoten aus verbunden) - in dem Fall reicht eine generische Mehrfach-Upload-
// Zone nicht, weil sonst nicht klar ist, welche Datei zu welchem Parameter gehört.
// Gibt null zurück, wenn eine einfache generische Upload-Zone ausreicht (0 oder 1
// Verbindung vom Upload-Knoten).
export function getUploadSlots(nodes, edges) {
  const fromUpload = (edges || []).filter((e) => e.source === 'upload');
  if (fromUpload.length <= 1) return null;

  const nodesById = new Map((nodes || []).map((n) => [n.id, n]));
  return fromUpload.map((e) => {
    const targetNode = nodesById.get(e.target);
    const handleLabel = e.targetHandle || 'Eingabe';
    return {
      key: `${e.target}:${handleLabel}`,
      target: e.target,
      targetHandle: e.targetHandle,
      label: `${targetNode?.title || e.target} — ${handleLabel}`,
    };
  });
}

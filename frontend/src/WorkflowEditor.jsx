import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState,
  Handle, Position, MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2, Wrench, MessageSquareText, Play, Save, Loader2, Upload, Download, X, FileInput, Cloud } from 'lucide-react';
import { getUploadSlots } from './workflowGraphUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const FILE_REF_FIELDS = new Set(['fileId', 'fileIdA', 'fileIdB', 'fileIds']);
let idCounter = 0;
const newId = () => `n${Date.now()}-${idCounter++}`;

// --- Eigene Knoten-Typen -------------------------------------------------

function SourceNode({ data }) {
  return (
    <div
      onClick={data.onToggle}
      className="px-4 py-3 bg-slate-900 text-white rounded-xl shadow-sm text-sm font-medium flex items-center gap-2 cursor-pointer hover:bg-slate-800"
    >
      {data.mode === 'cloud' ? <Cloud className="w-4 h-4" /> : <FileInput className="w-4 h-4" />}
      {data.mode === 'cloud' ? 'OneDrive/SharePoint-Datei' : 'Hochgeladene Datei(en)'}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ToolNode({ data }) {
  const fileHandles = data.tool
    ? Object.keys(data.tool.input_schema.properties || {}).filter((k) => FILE_REF_FIELDS.has(k))
    : ['fileId'];
  return (
    <div
      onClick={data.onOpen}
      className="px-4 py-3 bg-white border-2 border-slate-200 rounded-xl shadow-sm text-sm min-w-[180px] cursor-pointer hover:border-blue-300"
    >
      <div className="flex items-center gap-1.5 mb-1">
        {data.isInstruction ? <MessageSquareText className="w-3.5 h-3.5 text-slate-400" /> : <Wrench className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-medium text-slate-800 truncate">{data.title}</span>
      </div>
      <p className="text-xs text-slate-400 truncate">{data.isInstruction ? (data.instruction || 'Freie Anweisung...') : data.toolName}</p>

      {fileHandles.length > 1 && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-0.5">
          {fileHandles.map((h) => (
            <p key={h} className="text-[10px] text-slate-400 truncate">
              <span className="font-medium text-slate-500">{data.fieldLabels?.[h] || h}</span>
            </p>
          ))}
        </div>
      )}

      {fileHandles.length <= 1 ? (
        <Handle type="target" position={Position.Left} />
      ) : (
        fileHandles.map((h, i) => (
          <Handle
            key={h}
            type="target"
            position={Position.Left}
            id={h}
            style={{ top: `${((i + 1) / (fileHandles.length + 1)) * 100}%` }}
            title={data.fieldLabels?.[h] || h}
          />
        ))
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { source: SourceNode, tool: ToolNode };

export default function WorkflowEditor({ authFetch, existingWorkflow, onClose, onSaved }) {
  const [name, setName] = useState(existingWorkflow?.name || '');
  const [description, setDescription] = useState(existingWorkflow?.description || '');
  const [availableTools, setAvailableTools] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [openNodeId, setOpenNodeId] = useState(null);
  const [suggestPrompt, setSuggestPrompt] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [sourceMode, setSourceMode] = useState(existingWorkflow?.config?.editorGraph?.sourceMode || 'upload');

  const [pendingFiles, setPendingFiles] = useState([]);
  const [slotFiles, setSlotFiles] = useState({});
  const [running, setRunning] = useState(false);
  const [testReply, setTestReply] = useState('');
  const [testOutputFiles, setTestOutputFiles] = useState([]);
  const [testHistory, setTestHistory] = useState([]);
  const [testAnswer, setTestAnswer] = useState('');

  const initialGraph = existingWorkflow?.config?.editorGraph;
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialGraph ? initialGraph.nodes.map(toFlowNode) : [{ id: 'upload', type: 'source', position: { x: 40, y: 200 }, data: {} }]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    (initialGraph?.edges || []).map((e) => ({ ...e, id: e.id || `${e.source}-${e.target}-${e.targetHandle || ''}`, markerEnd: { type: MarkerType.ArrowClosed } }))
  );

  function toFlowNode(n) {
    return { id: n.id, type: 'tool', position: n.position || { x: 300, y: 200 }, data: rawToNodeData(n) };
  }

  function rawToNodeData(n) {
    return {
      title: n.title,
      tool: null, // wird nach dem Laden der Tools nachtraeglich ergaenzt
      toolName: n.tool,
      isInstruction: !n.tool,
      instruction: n.instruction,
      params: n.params || {},
      fieldLabels: n.fieldLabels || {},
    };
  }

  useEffect(() => {
    authFetch(`${API_URL}/workflow-editor/tools`)
      .then((r) => r.json())
      .then((d) => setAvailableTools(d.tools || []))
      .catch(() => setError('Werkzeug-Liste konnte nicht geladen werden'));
    authFetch(`${API_URL}/document-templates/library`)
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {});
  }, [authFetch]);

  // Sobald die Werkzeug-Liste da ist, das passende Schema in bestehende Knoten
  // nachtragen (fuer geladene/vorgeschlagene Graphen).
  useEffect(() => {
    if (availableTools.length === 0) return;
    setNodes((prev) => prev.map((n) => {
      if (n.type !== 'tool' || n.data.tool || !n.data.toolName) return n;
      const tool = availableTools.find((t) => t.name === n.data.toolName);
      return tool ? { ...n, data: { ...n.data, tool } } : n;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTools]);

  // Quell-Knoten (Upload vs. Cloud) immer mit aktuellem Modus + Umschalt-Callback
  // synchron halten.
  useEffect(() => {
    setNodes((prev) => prev.map((n) => (
      n.id === 'upload'
        ? { ...n, data: { mode: sourceMode, onToggle: () => setSourceMode((m) => (m === 'upload' ? 'cloud' : 'upload')) } }
        : n
    )));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  const openNode = useCallback((id) => setOpenNodeId(id), []);

  // onOpen-Callback in jedem Knoten aktuell halten (schliesst sonst ueber eine
  // veraltete openNode-Referenz).
  useEffect(() => {
    setNodes((prev) => prev.map((n) => (n.type === 'tool' ? { ...n, data: { ...n.data, onOpen: () => openNode(n.id) } } : n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNode]);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [setEdges]);

  const addNode = (tool) => {
    const id = newId();
    const isInstruction = !tool;
    setNodes((prev) => [...prev, {
      id, type: 'tool', position: { x: 300 + Math.random() * 200, y: 100 + Math.random() * 300 },
      data: {
        title: tool ? tool.name : 'Freie Anweisung',
        tool: tool || null,
        toolName: tool?.name,
        isInstruction,
        instruction: '',
        params: {},
        onOpen: () => openNode(id),
      },
    }]);
    setShowAddPicker(false);
  };

  const updateNodeData = (id, updates) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n)));
  };

  const removeNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setOpenNodeId(null);
  };

  const toGraphPayload = () => ({
    sourceMode,
    nodes: nodes.filter((n) => n.id !== 'upload').map((n) => ({
      id: n.id,
      title: n.data.title,
      tool: n.data.isInstruction ? undefined : n.data.toolName,
      params: n.data.isInstruction ? undefined : n.data.params,
      fieldLabels: n.data.isInstruction ? undefined : n.data.fieldLabels,
      instruction: n.data.isInstruction ? n.data.instruction : undefined,
      position: n.position,
    })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle })),
  });

  const uploadOneFile = async (file) => {
    const formData = new FormData();
    formData.append('files', file);
    const res = await authFetch(`${API_URL}/assistant/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.files[0];
  };

  const handleFileSelect = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    try {
      const formData = new FormData();
      selected.forEach((f) => formData.append('files', f));
      const res = await authFetch(`${API_URL}/assistant/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPendingFiles((prev) => [...prev, ...data.files]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSlotFileSelect = async (slotKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadOneFile(file);
      setSlotFiles((prev) => ({ ...prev, [slotKey]: uploaded }));
    } catch (err) {
      setError(err.message);
    }
  };

  const currentGraphPayload = toGraphPayload();
  const uploadSlots = getUploadSlots(currentGraphPayload.nodes, currentGraphPayload.edges);
  const canTestRun = uploadSlots ? uploadSlots.every((s) => slotFiles[s.key]) : pendingFiles.length > 0;

  const testRun = async (continuationMessage) => {
    setRunning(true);
    setError('');
    if (!continuationMessage) {
      setTestReply('');
      setTestOutputFiles([]);
    }
    try {
      const payload = toGraphPayload();
      const fileIds = continuationMessage ? [] : (uploadSlots ? uploadSlots.map((s) => slotFiles[s.key]) : pendingFiles);
      const uploadAssignments = uploadSlots
        ? Object.fromEntries(uploadSlots.map((s) => [s.key, slotFiles[s.key]?.filename]))
        : undefined;
      const res = await authFetch(`${API_URL}/workflow-editor/test-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          fileIds,
          uploadAssignments,
          history: continuationMessage ? testHistory : [],
          message: continuationMessage || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestReply(data.reply);
      setTestOutputFiles(data.outputFiles || []);
      setTestHistory(data.history || []);
      setTestAnswer('');
    } catch (err) {
      setError(err.message);
    }
    setRunning(false);
  };

  const downloadTestFile = async (filePath) => {
    const filename = filePath.split(/[/\\]/).pop();
    const res = await authFetch(`${API_URL}/download/${encodeURIComponent(filename)}`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  };

  const suggestGraph = async () => {
    if (!suggestPrompt.trim()) return;
    setSuggesting(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/workflow-editor/suggest-graph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: suggestPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const idMap = new Map();
      const newNodes = (data.nodes || []).map((n, i) => {
        const id = newId();
        idMap.set(n.id, id);
        const tool = availableTools.find((t) => t.name === n.tool);
        return {
          id, type: 'tool',
          position: { x: 320 + (i % 3) * 220, y: 60 + Math.floor(i / 3) * 160 },
          data: {
            title: n.title, tool: tool || null, toolName: n.tool,
            isInstruction: !n.tool, instruction: n.instruction || '', params: n.params || {},
            onOpen: () => openNode(id),
          },
        };
      });
      const newEdges = (data.edges || []).map((e) => ({
        id: `${e.source}-${e.target}-${e.targetHandle || ''}`,
        source: e.source === 'upload' ? 'upload' : idMap.get(e.source),
        target: idMap.get(e.target),
        targetHandle: e.targetHandle,
        markerEnd: { type: MarkerType.ArrowClosed },
      }));

      setNodes((prev) => [...prev, ...newNodes]);
      setEdges((prev) => [...prev, ...newEdges]);
      setSuggestPrompt('');
    } catch (err) {
      setError(err.message);
    }
    setSuggesting(false);
  };

  const save = async () => {
    if (!name.trim() || nodes.length <= 1) {
      setError('Name und mindestens ein Knoten (außer dem Upload-Startpunkt) erforderlich.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const url = existingWorkflow ? `${API_URL}/workflow-editor/${existingWorkflow.id}` : `${API_URL}/workflow-editor/save`;
      const method = existingWorkflow ? 'PATCH' : 'POST';
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, ...toGraphPayload() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data.workflow);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const openNode_data = nodes.find((n) => n.id === openNodeId)?.data;

  return (
    <div className="max-w-6xl mx-auto">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Name des Workflows"
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200"
        />
        <input
          value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kurze Beschreibung..."
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 flex gap-2">
        <textarea
          value={suggestPrompt} onChange={(e) => setSuggestPrompt(e.target.value)}
          placeholder='z.B. "Vergleiche zwei Dokumente unabhängig und fasse Abweichungen zusammen"'
          rows={1}
          className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
        />
        <button
          onClick={suggestGraph} disabled={!suggestPrompt.trim() || suggesting}
          className="px-4 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-40 flex items-center gap-2 flex-shrink-0"
        >
          {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Vorschlagen'}
        </button>
      </div>

      <div className="relative bg-slate-50 border border-slate-200 rounded-xl mb-4" style={{ height: '460px' }}>
        <ReactFlow
          nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} nodeTypes={nodeTypes} fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>

        <div className="absolute top-3 right-3">
          <button
            onClick={() => setShowAddPicker((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-4 h-4" /> Knoten hinzufügen
          </button>
          {showAddPicker && (
            <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
              <button onClick={() => addNode(null)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100">
                <MessageSquareText className="w-4 h-4 text-slate-400" /> Freie Anweisung
              </button>
              {availableTools.map((tool) => (
                <button key={tool.name} onClick={() => addNode(tool)} className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                  <Wrench className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span><span className="font-medium">{tool.name}</span><span className="block text-xs text-slate-400 truncate">{tool.description}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {openNodeId && openNode_data && (
        <NodeConfigPanel
          data={openNode_data}
          templates={templates}
          onChange={(updates) => updateNodeData(openNodeId, updates)}
          onDelete={() => removeNode(openNodeId)}
          onClose={() => setOpenNodeId(null)}
        />
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Testlauf</p>
        {uploadSlots ? (
          <div className="space-y-2 mb-3">
            {uploadSlots.map((slot) => (
              <div key={slot.key}>
                <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1 block">{slot.label}</label>
                {slotFiles[slot.key] ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs">
                    <span className="truncate text-slate-600">📄 {slotFiles[slot.key].filename}</span>
                    <button onClick={() => setSlotFiles((prev) => { const n = { ...prev }; delete n[slot.key]; return n; })} className="text-slate-400 hover:text-red-600 flex-shrink-0"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 py-2 border-2 border-dashed border-slate-200 rounded-lg text-xs text-slate-500 hover:border-slate-300 cursor-pointer bg-white">
                    <Upload className="w-3.5 h-3.5" /> Datei wählen
                    <input type="file" className="hidden" onChange={(e) => handleSlotFileSelect(slot.key, e)} />
                  </label>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 bg-white mb-3">
              <Upload className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500">Testdatei(en) hochladen</span>
              <input type="file" multiple className="hidden" onChange={handleFileSelect} />
            </label>
            {pendingFiles.length > 0 && (
              <div className="mb-3 space-y-1">{pendingFiles.map((f, i) => <p key={i} className="text-xs text-slate-500">📄 {f.filename}</p>)}</div>
            )}
          </>
        )}
        <button
          onClick={() => testRun()} disabled={!canTestRun || running}
          className="w-full py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {running ? <><Loader2 className="w-4 h-4 animate-spin" />Läuft...</> : <><Play className="w-4 h-4" />Testen</>}
        </button>
        {testReply && (
          <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700">
            {testReply}
            {testOutputFiles.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {testOutputFiles.map((f, i) => {
                  const fname = f.split(/[/\\]/).pop();
                  return (
                    <button key={i} onClick={() => downloadTestFile(f)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100">
                      <span className="truncate">{fname}</span><Download className="w-3.5 h-3.5 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
            {testOutputFiles.length === 0 && (
              <div className="mt-2.5 flex gap-2">
                <input
                  value={testAnswer}
                  onChange={(e) => setTestAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && testAnswer.trim() && testRun(testAnswer)}
                  placeholder="Antwort..."
                  className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                />
                <button
                  onClick={() => testRun(testAnswer)}
                  disabled={!testAnswer.trim() || running}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-md text-xs font-medium hover:bg-slate-800 disabled:opacity-40"
                >
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Senden'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {existingWorkflow ? 'Änderungen speichern' : 'Als App speichern'}
        </button>
        <button onClick={onClose} className="px-4 py-2.5 text-slate-500 text-sm hover:text-slate-700">Abbrechen</button>
      </div>
    </div>
  );
}

function NodeConfigPanel({ data, templates, onChange, onDelete, onClose }) {
  const allProps = data.tool ? Object.entries(data.tool.input_schema.properties || {}) : [];
  const fileFields = allProps.filter(([key]) => FILE_REF_FIELDS.has(key)).map(([key]) => key);
  const configurableProps = allProps.filter(([key]) => !FILE_REF_FIELDS.has(key));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <input
          value={data.title} onChange={(e) => onChange({ title: e.target.value })}
          className="text-sm font-semibold text-slate-800 outline-none border-b border-transparent focus:border-slate-300"
        />
        <div className="flex items-center gap-1">
          <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {data.isInstruction ? (
        <textarea
          value={data.instruction} onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder='z.B. "Vergleiche die Werte aus den Eingängen und markiere Abweichungen"'
          rows={3}
          className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
      ) : (
        <div className="space-y-2.5">
          {fileFields.length > 1 && (
            <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
              <p className="text-[11px] font-medium text-amber-800 mb-1.5">Eingänge benennen (wichtig bei mehreren Dateien, z.B. "Klausur" statt "fileIdA")</p>
              <div className="space-y-1.5">
                {fileFields.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[11px] text-amber-700 font-mono w-16 flex-shrink-0">{key}</span>
                    <input
                      value={data.fieldLabels?.[key] || ''}
                      onChange={(e) => onChange({ fieldLabels: { ...data.fieldLabels, [key]: e.target.value } })}
                      placeholder={`z.B. "Klausur"`}
                      className="flex-1 px-2 py-1 bg-white border border-amber-200 rounded text-xs outline-none focus:ring-2 focus:ring-amber-200"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {configurableProps.length === 0 && <p className="text-xs text-slate-400">Dieses Werkzeug braucht keine weiteren Parameter.</p>}
          {configurableProps.map(([key, schema]) => (
            <ParamField
              key={key} paramKey={key} schema={schema}
              required={(data.tool.input_schema.required || []).includes(key)}
              value={data.params?.[key]}
              onChange={(val) => onChange({ params: { ...data.params, [key]: val } })}
              templates={templates}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParamField({ paramKey, schema, required, value, onChange, templates }) {
  const label = `${paramKey}${required ? ' *' : ''}`;

  if (paramKey === 'templateId') {
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">Vorlage</label>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200">
          <option value="" disabled>Vorlage wählen...</option>
          {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {(templates || []).length === 0 && <p className="text-[11px] text-amber-600 mt-0.5">Noch keine Vorlagen im Vorlagen-Editor gespeichert.</p>}
      </div>
    );
  }

  if (schema.enum) {
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200">
          <option value="" disabled>Wählen...</option>
          {schema.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
      </div>
    );
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
        <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200" />
        {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
      </div>
    );
  }
  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4" />
        <span className="text-sm text-slate-600">{label}</span>
      </label>
    );
  }
  if (schema.type === 'array' || schema.type === 'object') {
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label} (JSON)</label>
        <textarea
          value={value !== undefined ? JSON.stringify(value) : ''}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* erst bei gueltigem JSON uebernehmen */ } }}
          rows={2} placeholder="[...]"
          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
        {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
      </div>
    );
  }
  return (
    <div>
      <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200" />
      {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
    </div>
  );
}

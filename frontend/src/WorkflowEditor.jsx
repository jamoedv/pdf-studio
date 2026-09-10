import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Wrench, MessageSquareText, Play, Save, Loader2, Upload, Download, X, ChevronDown } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

// Felder, die ein fileId/fileIds referenzieren, werden NICHT als normales
// Formularfeld gezeigt - die Verkettung (Upload vs. Ergebnis eines vorherigen
// Schritts) wird stattdessen ueber einen eigenen Auswahl-Schalter geloest.
const FILE_REF_FIELDS = new Set(['fileId', 'fileIdA', 'fileIdB', 'fileIds']);

let stepIdCounter = 0;
const newStepId = () => `step-${Date.now()}-${stepIdCounter++}`;

export default function WorkflowEditor({ authFetch, existingWorkflow, onClose, onSaved }) {
  const [name, setName] = useState(existingWorkflow?.name || '');
  const [description, setDescription] = useState(existingWorkflow?.description || '');
  const [steps, setSteps] = useState(() => existingWorkflow?.config?.editorSteps?.map((s) => ({ ...s, id: newStepId() })) || []);
  const [availableTools, setAvailableTools] = useState([]);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Testlauf
  const [pendingFiles, setPendingFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [testReply, setTestReply] = useState('');
  const [testOutputFiles, setTestOutputFiles] = useState([]);

  useEffect(() => {
    authFetch(`${API_URL}/workflow-editor/tools`)
      .then((r) => r.json())
      .then((d) => setAvailableTools(d.tools || []))
      .catch(() => setError('Werkzeug-Liste konnte nicht geladen werden'));
  }, [authFetch]);

  const addToolStep = (tool) => {
    setSteps((prev) => [...prev, {
      id: newStepId(),
      title: tool.name,
      tool: tool.name,
      params: {},
      inputSource: 'upload',
    }]);
    setShowAddPicker(false);
  };

  const addInstructionStep = () => {
    setSteps((prev) => [...prev, {
      id: newStepId(),
      title: 'Freie Anweisung',
      instruction: '',
    }]);
    setShowAddPicker(false);
  };

  const updateStep = (id, updates) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const removeStep = (id) => setSteps((prev) => prev.filter((s) => s.id !== id));

  const moveStep = (index, direction) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
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

  const testRun = async () => {
    setRunning(true);
    setError('');
    setTestReply('');
    setTestOutputFiles([]);
    try {
      const res = await authFetch(`${API_URL}/workflow-editor/test-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps, fileIds: pendingFiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestReply(data.reply);
      setTestOutputFiles(data.outputFiles || []);
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

  const save = async () => {
    if (!name.trim() || steps.length === 0) {
      setError('Name und mindestens ein Schritt erforderlich.');
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
        body: JSON.stringify({ name, description, steps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data.workflow);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="space-y-3 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name des Workflows"
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Kurze Beschreibung, was der Workflow tut..."
          rows={2}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
      </div>

      <div className="space-y-3 mb-4">
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            index={index}
            total={steps.length}
            tool={availableTools.find((t) => t.name === step.tool)}
            onUpdate={(updates) => updateStep(step.id, updates)}
            onRemove={() => removeStep(step.id)}
            onMove={(dir) => moveStep(index, dir)}
          />
        ))}
      </div>

      <div className="relative mb-8">
        <button
          onClick={() => setShowAddPicker((prev) => !prev)}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-500 hover:border-slate-300"
        >
          <Plus className="w-4 h-4" /> Schritt hinzufügen
        </button>
        {showAddPicker && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-72 overflow-y-auto">
            <button
              onClick={addInstructionStep}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100"
            >
              <MessageSquareText className="w-4 h-4 text-slate-400" /> Freie Anweisung (KI entscheidet selbst)
            </button>
            {availableTools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => addToolStep(tool)}
                className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Wrench className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium">{tool.name}</span>
                  <span className="block text-xs text-slate-400">{tool.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Testlauf</p>
        <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 bg-white mb-3">
          <Upload className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500">Testdatei(en) hochladen</span>
          <input type="file" multiple className="hidden" onChange={handleFileSelect} />
        </label>
        {pendingFiles.length > 0 && (
          <div className="mb-3 space-y-1">
            {pendingFiles.map((f, i) => <p key={i} className="text-xs text-slate-500">📄 {f.filename}</p>)}
          </div>
        )}
        <button
          onClick={testRun}
          disabled={steps.length === 0 || running}
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
                    <button
                      key={i}
                      onClick={() => downloadTestFile(f)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <span className="truncate">{fname}</span>
                      <Download className="w-3.5 h-3.5 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {existingWorkflow ? 'Änderungen speichern' : 'Als App speichern'}
        </button>
        <button onClick={onClose} className="px-4 py-2.5 text-slate-500 text-sm hover:text-slate-700">
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function StepCard({ step, index, total, tool, onUpdate, onRemove, onMove }) {
  const isToolStep = !!step.tool;
  const configurableProps = tool
    ? Object.entries(tool.input_schema.properties || {}).filter(([key]) => !FILE_REF_FIELDS.has(key))
    : [];
  const hasFileRefField = tool && Object.keys(tool.input_schema.properties || {}).some((k) => FILE_REF_FIELDS.has(k));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium flex items-center justify-center flex-shrink-0">{index + 1}</span>
          {isToolStep ? <Wrench className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <MessageSquareText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
          <input
            value={step.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-sm font-medium text-slate-800 outline-none border-b border-transparent focus:border-slate-300 min-w-0"
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
          <button onClick={onRemove} className="p-1 text-slate-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {!isToolStep && (
        <textarea
          value={step.instruction}
          onChange={(e) => onUpdate({ instruction: e.target.value })}
          placeholder='z.B. "Vergleiche die Werte aus den vorherigen Schritten und markiere Abweichungen"'
          rows={2}
          className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
      )}

      {isToolStep && (
        <div className="space-y-2.5">
          {hasFileRefField && (
            <div>
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">Eingabe</label>
              <select
                value={step.inputSource}
                onChange={(e) => onUpdate({ inputSource: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="upload">Hochgeladene Datei</option>
                {Array.from({ length: index }, (_, i) => (
                  <option key={i} value={`step:${i + 1}`}>Ergebnis von Schritt {i + 1}</option>
                ))}
              </select>
            </div>
          )}

          {configurableProps.map(([key, schema]) => (
            <ParamField
              key={key}
              paramKey={key}
              schema={schema}
              required={(tool.input_schema.required || []).includes(key)}
              value={step.params?.[key]}
              onChange={(val) => onUpdate({ params: { ...step.params, [key]: val } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParamField({ paramKey, schema, required, value, onChange }) {
  const label = `${paramKey}${required ? ' *' : ''}`;

  if (schema.enum) {
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200"
        >
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
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200"
        />
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
    // Seltene, komplexere Parameter (z.B. rows/values bei Excel-Export/Vorlagen) -
    // Rohtext als JSON, fuer Phase 1 bewusst einfach gehalten.
    return (
      <div>
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label} (JSON)</label>
        <textarea
          value={value !== undefined ? JSON.stringify(value) : ''}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* Tippen erlauben, erst bei gueltigem JSON uebernehmen */ } }}
          rows={2}
          placeholder="[...]"
          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
        {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 block">{label}</label>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-200"
      />
      {schema.description && <p className="text-[11px] text-slate-400 mt-0.5">{schema.description}</p>}
    </div>
  );
}

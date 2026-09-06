import React, { useState, useRef } from 'react';
import { Send, Paperclip, X, Loader2, Bot, User, Download, Sparkles, BookOpen, Trash2, FileText, Workflow, ChevronDown, ChevronRight, Pencil, Plus, Check as CheckIcon, Cloud } from 'lucide-react';
import OneDriveBrowser from './OneDriveBrowser';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function Assistant({ authFetch, downloadFile }) {
  const [displayMessages, setDisplayMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const fileInputRef = useRef(null);

  // Bibliothek (Vorlagen + Workflows)
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTab, setLibraryTab] = useState('workflows');
  const [templates, setTemplates] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState(null);
  const [editingWorkflowId, setEditingWorkflowId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [showOneDrivePicker, setShowOneDrivePicker] = useState(false);
  const [oneDriveSaveTarget, setOneDriveSaveTarget] = useState(null);
  const [oneDriveExportError, setOneDriveExportError] = useState('');

  const openLibrary = async () => {
    setShowLibrary(true);
    setLibraryLoading(true);
    try {
      const [tRes, wRes] = await Promise.all([
        authFetch(`${API_URL}/document-templates/library`),
        authFetch(`${API_URL}/workflows`),
      ]);
      const tData = await tRes.json();
      const wData = await wRes.json();
      setTemplates(tData.templates || []);
      setWorkflows(wData.workflows || []);
    } catch (err) {
      setError(err.message);
    }
    setLibraryLoading(false);
  };

  const deleteWorkflow = async (id) => {
    if (!window.confirm('Diesen Workflow wirklich löschen?')) return;
    await authFetch(`${API_URL}/workflows/${id}`, { method: 'DELETE' });
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  const deleteTemplateFromLibrary = async (id) => {
    if (!window.confirm('Diese Vorlage wirklich löschen?')) return;
    await authFetch(`${API_URL}/document-templates/library/${id}`, { method: 'DELETE' });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const useWorkflowInChat = (workflow) => {
    setInput(`Nutze den Workflow "${workflow.name}" für die folgenden neuen Dateien: `);
    setShowLibrary(false);
  };

  const useTemplateInChat = (template) => {
    setInput(`Nutze die Vorlage "${template.name}" (templateId: ${template.id}) und fülle sie mit: `);
    setShowLibrary(false);
  };

  const startEditWorkflow = (w) => {
    setEditingWorkflowId(w.id);
    setExpandedWorkflowId(w.id);
    setEditDraft({
      name: w.name,
      description: w.description,
      steps: (w.steps || []).map((s) => ({ ...s })),
      configText: JSON.stringify(w.config || {}, null, 2),
    });
  };

  const cancelEditWorkflow = () => {
    setEditingWorkflowId(null);
    setEditDraft(null);
  };

  const updateDraftStep = (idx, field, value) => {
    setEditDraft((prev) => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: value };
      return { ...prev, steps };
    });
  };

  const addDraftStep = () => {
    setEditDraft((prev) => ({ ...prev, steps: [...prev.steps, { title: '', description: '' }] }));
  };

  const insertDraftStepAfter = (idx) => {
    setEditDraft((prev) => {
      const steps = [...prev.steps];
      steps.splice(idx + 1, 0, { title: '', description: '' });
      return { ...prev, steps };
    });
  };

  const removeDraftStep = (idx) => {
    setEditDraft((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  };

  const saveWorkflowEdit = async () => {
    setSavingWorkflow(true);
    try {
      let config;
      try {
        config = JSON.parse(editDraft.configText);
      } catch {
        setError('Die Konfiguration ist kein gültiges JSON — bitte prüfen.');
        setSavingWorkflow(false);
        return;
      }
      const res = await authFetch(`${API_URL}/workflows/${editingWorkflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editDraft.name, description: editDraft.description, steps: editDraft.steps, config }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || 'Speichern fehlgeschlagen');
      setWorkflows((prev) => prev.map((w) => (w.id === editingWorkflowId ? updated : w)));
      setEditingWorkflowId(null);
      setEditDraft(null);
    } catch (err) {
      setError(err.message);
    }
    setSavingWorkflow(false);
  };

  const resetChat = () => {
    setDisplayMessages([]);
    setHistory([]);
    setPendingFiles([]);
    setError('');
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));
      const res = await authFetch(`${API_URL}/assistant/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      setPendingFiles((prev) => [...prev, ...data.files]);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const handleFileSelect = async (e) => {
    await uploadFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDraggingOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setIsDraggingOver(false);
  };
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const importFromOneDrive = async (item) => {
    setShowOneDrivePicker(false);
    setUploading(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/onedrive/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.itemId, driveId: item.driveId, filename: item.filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import fehlgeschlagen');
      setPendingFiles((prev) => [...prev, { fileId: data.fileId, filename: data.filename }]);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const openSaveToOneDrive = (outputFilePath) => {
    setOneDriveSaveTarget(outputFilePath);
    setOneDriveExportError('');
    setShowOneDrivePicker(true);
  };

  const exportToOneDrive = async (dest) => {
    setShowOneDrivePicker(false);
    if (!oneDriveSaveTarget) return;
    try {
      const filename = oneDriveSaveTarget.split(/[/\\]/).pop();
      const res = await authFetch(`${API_URL}/onedrive/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: oneDriveSaveTarget, filename, driveId: dest.driveId, folderId: dest.folderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export fehlgeschlagen');
    } catch (err) {
      setOneDriveExportError(err.message);
    }
    setOneDriveSaveTarget(null);
  };

  const removePendingFile = (idx) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userText = input.trim();
    const attachedFiles = pendingFiles;

    setDisplayMessages((prev) => [...prev, { role: 'user', text: userText, files: attachedFiles }]);
    setInput('');
    setPendingFiles([]);
    setSending(true);
    setError('');

    try {
      const res = await authFetch(`${API_URL}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, message: userText, fileIds: attachedFiles, model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Antwort fehlgeschlagen');

      setHistory(data.history || []);
      setDisplayMessages((prev) => [...prev, { role: 'assistant', text: data.reply, outputFiles: data.outputFiles || [], model: data.model }]);
    } catch (err) {
      setError(err.message);
      setDisplayMessages((prev) => [...prev, { role: 'assistant', text: `Fehler: ${err.message}`, isError: true }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      className="flex flex-col h-[70vh] bg-white border border-slate-200 rounded-xl overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-10 bg-blue-900/5 border-2 border-dashed border-blue-400 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-blue-900" />
            <p className="text-sm font-medium text-blue-900">Dateien hier ablegen</p>
          </div>
        </div>
      )}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
        <Sparkles className="w-4 h-4 text-blue-900" />
        <p className="text-sm font-medium text-slate-700">Assistent (Beta)</p>
        <span className="text-xs text-slate-400 flex-1">— beschreib deine Aufgabe frei, lade Dateien an</span>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
          title="Modell für diese Anfragen (zum Testen/Vergleichen)"
        >
          <option value="claude-haiku-4-5">Haiku 4.5 (günstig/schnell)</option>
          <option value="claude-sonnet-4-5">Sonnet 4.5 (Standard)</option>
          <option value="claude-sonnet-4-6">Sonnet 4.6 (neu)</option>
        </select>
        <button
          onClick={resetChat}
          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          title="Verlauf zurücksetzen, spart Tokens bei langen Sitzungen"
        >
          Neuer Chat
        </button>
        <button
          onClick={openLibrary}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Bibliothek
        </button>
      </div>

      {showLibrary && (
        <div className="border-b border-slate-100 bg-white max-h-64 overflow-y-auto">
          <div className="flex items-center gap-1 p-2 border-b border-slate-100 sticky top-0 bg-white">
            <button
              onClick={() => setLibraryTab('workflows')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${libraryTab === 'workflows' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
            >
              <Workflow className="w-3.5 h-3.5 inline mr-1" /> Workflows ({workflows.length})
            </button>
            <button
              onClick={() => setLibraryTab('templates')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${libraryTab === 'templates' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
            >
              <FileText className="w-3.5 h-3.5 inline mr-1" /> Vorlagen ({templates.length})
            </button>
            <button onClick={() => setShowLibrary(false)} className="ml-auto text-slate-400 hover:text-slate-600 p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2 space-y-1.5">
            {libraryLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
            ) : libraryTab === 'workflows' ? (
              workflows.length === 0 ? (
                <p className="text-xs text-slate-400 p-2">Noch keine Workflows gespeichert — sag dem Assistenten "speichere das als Workflow", nachdem eine Aufgabe erfolgreich war.</p>
              ) : (
                workflows.map((w) => (
                  <div key={w.id} className="bg-slate-50 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between gap-2 p-2">
                      <button
                        onClick={() => setExpandedWorkflowId(expandedWorkflowId === w.id ? null : w.id)}
                        className="flex items-center gap-1.5 min-w-0 text-left flex-1"
                      >
                        {(w.steps || []).length > 0 && (
                          expandedWorkflowId === w.id
                            ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{w.name}</p>
                          <p className="text-xs text-slate-400 truncate">{w.description}</p>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => useWorkflowInChat(w)} className="px-2.5 py-1 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950">
                          Nutzen
                        </button>
                        <button onClick={() => startEditWorkflow(w)} className="p-1.5 text-slate-400 hover:text-blue-900">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteWorkflow(w.id)} className="p-1.5 text-slate-300 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingWorkflowId === w.id ? (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-200 mt-1">
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Name"
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <textarea
                          value={editDraft.description}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, description: e.target.value }))}
                          placeholder="Beschreibung"
                          rows={2}
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                        />

                        <p className="text-xs font-medium text-slate-500 pt-1">Schritte</p>
                        {editDraft.steps.map((step, si) => (
                          <div key={si} className="flex items-start gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-1">{si + 1}</span>
                            <div className="flex-1 space-y-1">
                              <input
                                value={step.title}
                                onChange={(e) => updateDraftStep(si, 'title', e.target.value)}
                                placeholder="Titel"
                                className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                              />
                              <input
                                value={step.description || ''}
                                onChange={(e) => updateDraftStep(si, 'description', e.target.value)}
                                placeholder="Beschreibung (optional)"
                                className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </div>
                            <button onClick={() => insertDraftStepAfter(si)} className="p-1 text-slate-300 hover:text-blue-900 flex-shrink-0 mt-1" title="Schritt danach einfügen">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => removeDraftStep(si)} className="p-1 text-slate-300 hover:text-red-600 flex-shrink-0 mt-1" title="Schritt löschen">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button onClick={addDraftStep} className="flex items-center gap-1 text-xs text-blue-900 font-medium hover:underline">
                          <Plus className="w-3.5 h-3.5" /> Schritt am Ende hinzufügen
                        </button>

                        <p className="text-xs font-medium text-slate-500 pt-1">Konfiguration (JSON)</p>
                        <textarea
                          value={editDraft.configText}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, configText: e.target.value }))}
                          rows={5}
                          spellCheck={false}
                          className="w-full px-2 py-1.5 bg-slate-900 text-emerald-300 font-mono border border-slate-200 rounded-md text-xs outline-none resize-y"
                        />

                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={cancelEditWorkflow} className="px-3 py-1.5 text-slate-500 text-xs font-medium hover:text-slate-700">
                            Abbrechen
                          </button>
                          <button
                            onClick={saveWorkflowEdit}
                            disabled={savingWorkflow}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950 disabled:opacity-50"
                          >
                            {savingWorkflow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckIcon className="w-3.5 h-3.5" />}
                            Speichern
                          </button>
                        </div>
                      </div>
                    ) : expandedWorkflowId === w.id && (w.steps || []).length > 0 && (
                      <div className="px-4 pb-3 pt-1">
                        {w.steps.map((step, si) => (
                          <div key={si} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-5 h-5 rounded-full bg-blue-900 text-white text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                                {si + 1}
                              </div>
                              {si < w.steps.length - 1 && <div className="w-px flex-1 bg-slate-300 my-0.5" style={{ minHeight: '14px' }} />}
                            </div>
                            <div className="pb-3 min-w-0">
                              <p className="text-xs font-medium text-slate-700">{step.title}</p>
                              {step.description && <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : templates.length === 0 ? (
              <p className="text-xs text-slate-400 p-2">Noch keine Vorlagen in der Bibliothek.</p>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg">
                  <p className="text-xs font-medium text-slate-700 truncate">{t.name}</p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => useTemplateInChat(t)} className="px-2.5 py-1 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950">
                      Nutzen
                    </button>
                    <button onClick={() => deleteTemplateFromLibrary(t.id)} className="p-1.5 text-slate-300 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {displayMessages.length === 0 && (
          <div className="text-center py-10">
            <Bot className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              Beschreib eine mehrstufige Aufgabe, z.B. "Bewerte diese 15 Klausuren anhand der Musterlösung und erstell mir eine Excel-Übersicht" — lade dazu die passenden Dateien hoch.
            </p>
          </div>
        )}

        {displayMessages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-900 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
            )}
            <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm ${
              msg.role === 'user' ? 'bg-blue-900 text-white' : msg.isError ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-50 text-slate-700'
            }`}>
              <p className="whitespace-pre-wrap">{msg.text}</p>
              {msg.model && (
                <p className="text-[10px] text-slate-400 mt-1.5">{msg.model}</p>
              )}
              {msg.files && msg.files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.files.map((f, fi) => (
                    <span key={fi} className="text-xs bg-white/20 px-2 py-0.5 rounded-md">{f.filename}</span>
                  ))}
                </div>
              )}
              {msg.outputFiles && msg.outputFiles.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  {msg.outputFiles.map((filePath, fi) => {
                    const filename = filePath.split(/[/\\]/).pop();
                    return (
                      <div key={fi} className="flex items-center gap-1.5">
                        <button
                          onClick={() => downloadFile(filePath)}
                          className="flex-1 flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors min-w-0"
                        >
                          <span className="truncate">{filename}</span>
                          <Download className="w-3.5 h-3.5 flex-shrink-0" />
                        </button>
                        <button
                          onClick={() => openSaveToOneDrive(filePath)}
                          className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-100 flex-shrink-0"
                          title="Nach OneDrive/SharePoint speichern"
                        >
                          <Cloud className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-slate-500" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-blue-900 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-slate-50 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <span className="text-sm text-slate-400">arbeitet daran…</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {pendingFiles.map((f, i) => (
            <span key={i} className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md">
              {f.filename}
              <button onClick={() => removePendingFile(i)} className="text-slate-400 hover:text-red-600">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-slate-100 flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors flex-shrink-0"
          title="Dateien anhängen"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </button>
        <input ref={fileInputRef} type="file" multiple accept=".pdf" className="hidden" onChange={handleFileSelect} />

        <button
          onClick={() => { setOneDriveSaveTarget(null); setShowOneDrivePicker(true); }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors flex-shrink-0"
          title="Aus OneDrive/SharePoint wählen"
        >
          <Cloud className="w-4 h-4" />
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Beschreib deine Aufgabe..."
          rows={1}
          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />

        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-blue-900 text-white hover:bg-blue-950 transition-colors disabled:opacity-40 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {showOneDrivePicker && (
        <OneDriveBrowser
          authFetch={authFetch}
          mode={oneDriveSaveTarget ? 'save' : 'pick'}
          onSelect={importFromOneDrive}
          onSaveHere={exportToOneDrive}
          onClose={() => { setShowOneDrivePicker(false); setOneDriveSaveTarget(null); }}
        />
      )}
      {oneDriveExportError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100">
          <p className="text-xs text-red-600">{oneDriveExportError}</p>
        </div>
      )}
    </div>
  );
}

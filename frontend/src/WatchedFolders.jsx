import React, { useState, useEffect, useCallback } from 'react';
import { Folder, Cloud, Building2, Mail, MessageSquare, Trash2, Plus, X, Loader2, ArrowRight } from 'lucide-react';
import OneDriveBrowser from './OneDriveBrowser';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function WatchedFolders({ authFetch }) {
  const [watches, setWatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState('');

  // Formular-Zustand für eine neue Überwachung
  const [instruction, setInstruction] = useState('');
  const [sourceFolder, setSourceFolder] = useState(null); // { source, siteId, siteLabel, driveId, folderId, folderLabel }
  const [destFolder, setDestFolder] = useState(null);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [teamsContacts, setTeamsContacts] = useState([]);
  const [notifyTeamsUserId, setNotifyTeamsUserId] = useState('');
  const [pickerMode, setPickerMode] = useState(null); // 'source' | 'destination' | null
  const [saving, setSaving] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [savedTemplates, setSavedTemplates] = useState([]);

  const loadWatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/watched-folders`);
      const data = await res.json();
      setWatches(data.watches || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [authFetch]);

  const loadTeamsContacts = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/watched-folders-teams-contacts`);
      const data = await res.json();
      setTeamsContacts(data.contacts || []);
    } catch {
      // Nicht kritisch - Teams-Benachrichtigung bleibt dann einfach leer wählbar
    }
  }, [authFetch]);

  const loadLibrary = useCallback(async () => {
    try {
      const [wfRes, tplRes] = await Promise.all([
        authFetch(`${API_URL}/workflows`),
        authFetch(`${API_URL}/document-templates/library`),
      ]);
      const wfData = await wfRes.json();
      const tplData = await tplRes.json();
      setSavedWorkflows(wfData.workflows || []);
      setSavedTemplates(tplData.templates || []);
    } catch {
      // Nicht kritisch - Bibliotheks-Auswahl bleibt dann einfach leer
    }
  }, [authFetch]);

  useEffect(() => { loadWatches(); loadTeamsContacts(); loadLibrary(); }, [loadWatches, loadTeamsContacts, loadLibrary]);

  const resetForm = () => {
    setInstruction('');
    setSourceFolder(null);
    setDestFolder(null);
    setNotifyEmail('');
    setNotifyTeamsUserId('');
    setShowNewForm(false);
  };

  const createWatch = async () => {
    if (!sourceFolder || !instruction.trim()) {
      setError('Bitte Quell-Ordner wählen und eine Anweisung eingeben.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/watched-folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourceFolder.source,
          siteId: sourceFolder.siteId,
          driveId: sourceFolder.driveId,
          folderId: sourceFolder.folderId,
          folderLabel: sourceFolder.folderLabel,
          instruction: instruction.trim(),
          destination: destFolder ? {
            source: destFolder.source,
            siteId: destFolder.siteId,
            driveId: destFolder.driveId,
            folderId: destFolder.folderId,
            folderLabel: destFolder.folderLabel,
          } : null,
          notifyEmail: notifyEmail.trim() || null,
          notifyTeamsUserId: notifyTeamsUserId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Speichern');
      resetForm();
      loadWatches();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const deleteWatch = async (id) => {
    if (!window.confirm('Diese Überwachung wirklich löschen?')) return;
    try {
      await authFetch(`${API_URL}/watched-folders/${id}`, { method: 'DELETE' });
      loadWatches();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (watch) => {
    try {
      await authFetch(`${API_URL}/watched-folders/${watch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !watch.active }),
      });
      loadWatches();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Automatische Ordner-Überwachung</h2>
          <p className="text-sm text-slate-500 mt-1">Neue Dateien in einem OneDrive/SharePoint-Ordner werden automatisch verarbeitet — ganz ohne Chat-Nachricht.</p>
        </div>
        {!showNewForm && (
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950"
          >
            <Plus className="w-4 h-4" /> Neue Überwachung
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {showNewForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">1. Welcher Ordner soll überwacht werden?</label>
            {sourceFolder ? (
              <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg text-sm">
                {sourceFolder.source === 'sharepoint' ? <Building2 className="w-4 h-4 text-slate-400" /> : <Cloud className="w-4 h-4 text-slate-400" />}
                <span className="flex-1">{sourceFolder.siteLabel ? `${sourceFolder.siteLabel} / ` : ''}{sourceFolder.folderLabel}</span>
                <button onClick={() => setSourceFolder(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button
                onClick={() => setPickerMode('source')}
                className="w-full flex items-center justify-center gap-2 p-2.5 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-500 hover:border-slate-300"
              >
                <Folder className="w-4 h-4" /> Ordner auswählen
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">2. Was soll mit neuen Dateien passieren?</label>

            {(savedWorkflows.length > 0 || savedTemplates.length > 0) && (
              <div className="flex gap-2 mb-2">
                {savedWorkflows.length > 0 && (
                  <select
                    onChange={(e) => {
                      const wf = savedWorkflows.find((w) => w.id === e.target.value);
                      if (wf) setInstruction(`Führe den gespeicherten Workflow "${wf.name}" (id: ${wf.id}) mit dieser Datei aus.`);
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="" disabled>Aus Workflow-Bibliothek übernehmen...</option>
                    {savedWorkflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>{wf.name}</option>
                    ))}
                  </select>
                )}
                {savedTemplates.length > 0 && (
                  <select
                    onChange={(e) => {
                      const tpl = savedTemplates.find((t) => t.id === e.target.value);
                      if (tpl) setInstruction(`Fülle die gespeicherte Vorlage "${tpl.name}" (id: ${tpl.id}) mit den Daten aus dieser Datei und erzeuge ein PDF.`);
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="" disabled>Aus Vorlagen-Bibliothek übernehmen...</option>
                    {savedTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder='z.B. "Komprimiere jede neue PDF" oder "Lies die Rechnung aus und trage Betrag/Datum in eine Excel-Übersicht ein"'
              rows={3}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
            <p className="text-xs text-slate-400 mt-1">Noch keinen passenden Workflow? Erledige die Aufgabe einmal im Assistenten und lass sie dort als Workflow speichern — danach steht sie hier zur Auswahl.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">3. Ergebnis speichern (optional)</label>
            {destFolder ? (
              <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg text-sm">
                {destFolder.source === 'sharepoint' ? <Building2 className="w-4 h-4 text-slate-400" /> : <Cloud className="w-4 h-4 text-slate-400" />}
                <span className="flex-1">{destFolder.siteLabel ? `${destFolder.siteLabel} / ` : ''}{destFolder.folderLabel}</span>
                <button onClick={() => setDestFolder(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button
                onClick={() => setPickerMode('destination')}
                className="w-full flex items-center justify-center gap-2 p-2.5 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-500 hover:border-slate-300"
              >
                <ArrowRight className="w-4 h-4" /> Ziel-Ordner wählen (sonst nur Benachrichtigung ohne Ablage)
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">4. Benachrichtigung (optional)</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type="email"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  placeholder="deine@email.de"
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <select
                  value={notifyTeamsUserId}
                  onChange={(e) => setNotifyTeamsUserId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Keine Teams-Benachrichtigung</option>
                  {teamsContacts.map((c) => (
                    <option key={c.teamsUsername} value={c.teamsUsername}>{c.displayName || c.teamsUsername}</option>
                  ))}
                </select>
              </div>
              {teamsContacts.length === 0 && (
                <p className="text-xs text-slate-400">Für Teams-Benachrichtigungen musst du dem Bot vorher einmal in Teams geschrieben haben.</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={createWatch}
              disabled={saving}
              className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
            >
              {saving ? 'Speichere...' : 'Überwachung starten'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-slate-500 text-sm hover:text-slate-700">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : watches.length === 0 && !showNewForm ? (
        <p className="text-sm text-slate-400 text-center py-12">Noch keine Ordner-Überwachung eingerichtet.</p>
      ) : (
        <div className="space-y-2">
          {watches.map((watch) => (
            <div key={watch.id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg">
              {watch.source === 'sharepoint' ? <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <Cloud className="w-4 h-4 text-slate-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{watch.folderLabel}</p>
                <p className="text-xs text-slate-400 truncate">{watch.instruction}</p>
              </div>
              <button
                onClick={() => toggleActive(watch)}
                className={`px-2 py-1 rounded-md text-xs font-medium flex-shrink-0 ${watch.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}
              >
                {watch.active ? 'Aktiv' : 'Pausiert'}
              </button>
              <button onClick={() => deleteWatch(watch.id)} className="text-slate-400 hover:text-red-600 flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pickerMode && (
        <OneDriveBrowser
          authFetch={authFetch}
          mode="save"
          confirmLabel="Diesen Ordner wählen"
          onSaveHere={(picked) => {
            if (pickerMode === 'source') setSourceFolder(picked);
            else setDestFolder(picked);
            setPickerMode(null);
          }}
          onClose={() => setPickerMode(null)}
        />
      )}
    </div>
  );
}

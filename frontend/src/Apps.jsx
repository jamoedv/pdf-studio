import React, { useState, useEffect, useCallback } from 'react';
import { Play, Settings, X, Loader2, Upload, Download, Users, Globe, Pencil, Check } from 'lucide-react';
import Modal from './Modal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function Apps({ authFetch, currentUser }) {
  const [owned, setOwned] = useState([]);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manageApp, setManageApp] = useState(null); // Workflow-Objekt oder null
  const [runApp, setRunApp] = useState(null);

  const isPowerUserOrAdmin = currentUser?.role === 'poweruser' || currentUser?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/apps`);
      const data = await res.json();
      setOwned(data.owned || []);
      setShared(data.shared || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const shareBadge = (wf) => {
    if (wf.isPublic) return { text: 'Für alle freigegeben', className: 'bg-blue-50 text-blue-700' };
    if ((wf.authorizedUsers || []).length > 0) return { text: `Freigegeben für ${wf.authorizedUsers.length}`, className: 'bg-emerald-50 text-emerald-700' };
    return { text: 'Nicht freigegeben', className: 'bg-slate-100 text-slate-400' };
  };

  const AppCard = ({ wf, canManage }) => {
    const badge = canManage ? shareBadge(wf) : null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-slate-800">{wf.name}</h3>
          {badge && <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${badge.className}`}>{badge.text}</span>}
        </div>
        <p className="text-xs text-slate-500 mb-3 line-clamp-2">{wf.description}</p>
        {wf.steps?.length > 0 && (
          <p className="text-[11px] text-slate-400 mb-3 truncate">{wf.steps.map((s) => s.title).join(' → ')}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRunApp(wf)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-medium hover:bg-blue-950"
          >
            <Play className="w-3.5 h-3.5" /> Ausführen
          </button>
          {canManage && isPowerUserOrAdmin && (
            <button
              onClick={() => setManageApp(wf)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div className="mb-8">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Meine Apps</p>
            {owned.length === 0 ? (
              <p className="text-sm text-slate-400">Noch keine eigenen Apps. Erledige eine Aufgabe im Assistenten und lass sie als Workflow speichern — sie taucht dann hier auf.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {owned.map((wf) => <AppCard key={wf.id} wf={wf} canManage />)}
              </div>
            )}
          </div>

          {shared.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Für mich freigegeben</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {shared.map((wf) => <AppCard key={wf.id} wf={wf} canManage={false} />)}
              </div>
            </div>
          )}
        </>
      )}

      {manageApp && (
        <ManageAppModal
          authFetch={authFetch}
          app={manageApp}
          onClose={() => setManageApp(null)}
          onSaved={() => { setManageApp(null); load(); }}
        />
      )}

      {runApp && (
        <RunAppModal
          authFetch={authFetch}
          app={runApp}
          onClose={() => setRunApp(null)}
        />
      )}
    </div>
  );
}

function ManageAppModal({ authFetch, app, onClose, onSaved }) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description || '');
  const [isPublic, setIsPublic] = useState(app.isPublic);
  const [authorizedUsers, setAuthorizedUsers] = useState(app.authorizedUsers || []);
  const [allUsernames, setAllUsernames] = useState([]);
  const [addUsername, setAddUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authFetch(`${API_URL}/auth/usernames`)
      .then((r) => r.json())
      .then((d) => setAllUsernames(d.usernames || []))
      .catch(() => {});
  }, [authFetch]);

  const saveNameDescription = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/apps/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const togglePublic = async (value) => {
    setIsPublic(value);
    try {
      await authFetch(`${API_URL}/apps/${app.id}/public`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: value }),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const addUser = async () => {
    const username = addUsername.trim();
    if (!username || authorizedUsers.includes(username)) return;
    try {
      const res = await authFetch(`${API_URL}/apps/${app.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setAuthorizedUsers((prev) => [...prev, username]);
      setAddUsername('');
    } catch (err) {
      setError(err.message);
    }
  };

  const removeUser = async (username) => {
    try {
      await authFetch(`${API_URL}/apps/${app.id}/share/${username}`, { method: 'DELETE' });
      setAuthorizedUsers((prev) => prev.filter((u) => u !== username));
    } catch (err) {
      setError(err.message);
    }
  };

  const pickableUsernames = allUsernames.filter((u) => !authorizedUsers.includes(u));

  return (
    <Modal title="App verwalten" onClose={onClose} maxWidth="max-w-lg">
      <div className="p-5 space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1.5 block">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1.5 block">Beschreibung</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />
        </div>
        <button
          onClick={saveNameDescription}
          disabled={saving}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Speichere...' : 'Name/Beschreibung speichern'}
        </button>

        <div className="border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => togglePublic(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-slate-700 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-slate-400" />Für alle Nutzer freigeben</span>
          </label>
        </div>

        {!isPublic && (
          <div className="border-t border-slate-100 pt-4">
            <label className="text-xs font-medium text-slate-500 mb-1.5 block flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />Einzelne Nutzer freigeben
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {authorizedUsers.map((u) => (
                <span key={u} className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs text-slate-600">
                  {u}
                  <button onClick={() => removeUser(u)} className="hover:text-red-600"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                list="all-usernames"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addUser()}
                placeholder="Nutzername..."
                className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
              />
              <datalist id="all-usernames">
                {pickableUsernames.map((u) => <option key={u} value={u} />)}
              </datalist>
              <button onClick={addUser} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800">
                Hinzufügen
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RunAppModal({ authFetch, app, onClose }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [outputFiles, setOutputFiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [needsAnswer, setNeedsAnswer] = useState(false);
  const [answer, setAnswer] = useState('');

  const handleFileSelect = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    setError('');
    try {
      const formData = new FormData();
      selected.forEach((f) => formData.append('files', f));
      const res = await authFetch(`${API_URL}/assistant/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      setPendingFiles((prev) => [...prev, ...data.files]);
    } catch (err) {
      setError(err.message);
    }
  };

  const run = async (continuationMessage) => {
    setRunning(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/apps/${app.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: continuationMessage ? [] : pendingFiles,
          history: continuationMessage ? history : [],
          message: continuationMessage || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ausführung fehlgeschlagen');

      setReply(data.reply);
      setOutputFiles(data.outputFiles || []);
      setHistory(data.history || []);
      setNeedsAnswer((data.outputFiles || []).length === 0);
      setAnswer('');
    } catch (err) {
      setError(err.message);
    }
    setRunning(false);
  };

  const downloadFile = async (filePath) => {
    try {
      const filename = filePath.split(/[/\\]/).pop();
      const res = await authFetch(`${API_URL}/download/${encodeURIComponent(filename)}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Download fehlgeschlagen: ' + err.message);
    }
  };

  return (
    <Modal title={app.name} onClose={onClose} maxWidth="max-w-lg">
      <div className="p-5 space-y-4">
        {app.description && <p className="text-sm text-slate-500">{app.description}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!reply && (
          <>
            <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-300">
              <Upload className="w-5 h-5 text-slate-400" />
              <span className="text-sm text-slate-500">Datei(en) hierher ziehen oder klicken</span>
              <input type="file" multiple className="hidden" onChange={handleFileSelect} />
            </label>

            {pendingFiles.length > 0 && (
              <div className="space-y-1">
                {pendingFiles.map((f, i) => (
                  <p key={i} className="text-xs text-slate-500 truncate">📄 {f.filename}</p>
                ))}
              </div>
            )}

            <button
              onClick={() => run()}
              disabled={pendingFiles.length === 0 || running}
              className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {running ? <><Loader2 className="w-4 h-4 animate-spin" />Läuft...</> : 'Ausführen'}
            </button>
          </>
        )}

        {reply && (
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700">{reply}</div>

            {outputFiles.length > 0 && (
              <div className="space-y-1.5">
                {outputFiles.map((f, i) => {
                  const name = f.split(/[/\\]/).pop();
                  return (
                    <button
                      key={i}
                      onClick={() => downloadFile(f)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <span className="truncate">{name}</span>
                      <Download className="w-3.5 h-3.5 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}

            {needsAnswer && (
              <div className="flex gap-2">
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && answer.trim() && run(answer)}
                  placeholder="Antwort..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
                <button
                  onClick={() => run(answer)}
                  disabled={!answer.trim() || running}
                  className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-40"
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Senden'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

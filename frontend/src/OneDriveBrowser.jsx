import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Folder, FileText, ChevronRight, Cloud, Building2, RefreshCw, LogOut } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function OneDriveBrowser({ authFetch, mode, onSelect, onSaveHere, onClose }) {
  const [connected, setConnected] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [source, setSource] = useState('onedrive'); // 'onedrive' | 'sharepoint'
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]); // [{id, name}]
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [siteUrlInput, setSiteUrlInput] = useState('');
  const [siteUrlLoading, setSiteUrlLoading] = useState(false);

  const currentFolderId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : undefined;

  const checkStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/onedrive/status`);
      const data = await res.json();
      setConnected(!!data.connected);
    } catch {
      setConnected(false);
    }
  }, [authFetch]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'onedrive-connected') {
        setConnected(true);
        checkStatus();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [checkStatus]);

  const connect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/onedrive/auth-url`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verbindung fehlgeschlagen');
      const popup = window.open(data.url, 'onedrive-connect', 'width=500,height=650');

      // postMessage zwischen Popup und Hauptfenster ist browserabhängig nicht immer
      // zuverlässig - deshalb zusätzlich alle 2s den Status abfragen, bis verbunden
      // (oder das Popup geschlossen wurde) oder ein Timeout erreicht ist.
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const statusRes = await authFetch(`${API_URL}/onedrive/status`);
          const statusData = await statusRes.json();
          if (statusData.connected) {
            clearInterval(poll);
            setConnected(true);
            setConnecting(false);
            if (popup && !popup.closed) popup.close();
            return;
          }
        } catch {
          // Netzwerkfehler beim Poll ignorieren, nächster Versuch folgt
        }
        if ((popup && popup.closed) || attempts >= 30) {
          clearInterval(poll);
          setConnecting(false);
        }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  };

  const loadFolder = useCallback(async (folderId, siteId, driveId) => {
    setLoading(true);
    setError('');
    try {
      let url;
      if (source === 'sharepoint') {
        const sid = siteId || selectedSite?.id;
        if (!sid) { setItems([]); setLoading(false); return; }
        const params = new URLSearchParams({ siteId: sid });
        if (folderId) params.set('folderId', folderId);
        if (driveId) params.set('driveId', driveId);
        url = `${API_URL}/onedrive/sharepoint/browse?${params}`;
      } else {
        url = `${API_URL}/onedrive/browse${folderId ? `?folderId=${folderId}` : ''}`;
      }
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [authFetch, source, selectedSite]);

  const loadSites = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/onedrive/sharepoint/sites`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
      setSites(data.sites || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!connected) return;
    setBreadcrumb([]);
    setSelectedSite(null);
    setItems([]);
    if (source === 'onedrive') loadFolder(undefined);
    else loadSites();
  }, [connected, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSiteByUrl = async () => {
    setSiteUrlLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/onedrive/sharepoint/site-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Seite konnte nicht geladen werden');
      setSiteUrlInput('');
      pickSite(data.site);
    } catch (err) {
      setError(err.message);
    }
    setSiteUrlLoading(false);
  };

  const pickSite = (site) => {
    setSelectedSite(site);
    setBreadcrumb([]);
    loadFolder(undefined, site.id, undefined);
  };

  // "item" ist entweder eine Dokumentbibliothek (isDrive, auf Seiten-Wurzel-Ebene)
  // oder ein normaler Unterordner innerhalb einer bereits gewählten Bibliothek.
  const openFolder = (item) => {
    const driveId = item.isDrive ? item.driveId : (breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].driveId : item.driveId);
    const newCrumb = [...breadcrumb, { id: item.id, name: item.name, driveId }];
    setBreadcrumb(newCrumb);
    loadFolder(item.isDrive ? undefined : item.id, selectedSite?.id, driveId);
  };

  const goToBreadcrumb = (idx) => {
    const newCrumb = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(newCrumb);
    const last = newCrumb[newCrumb.length - 1];
    loadFolder(last ? last.id : undefined, selectedSite?.id, last?.driveId);
  };

  const disconnect = async () => {
    if (!window.confirm('Microsoft-Verbindung wirklich trennen?')) return;
    try {
      await authFetch(`${API_URL}/onedrive/disconnect`, { method: 'DELETE' });
      setConnected(false);
      setSelectedSite(null);
      setBreadcrumb([]);
      setItems([]);
      setSites([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const goToRootOfSource = () => {
    setBreadcrumb([]);
    if (source === 'sharepoint' && selectedSite) loadFolder(undefined, selectedSite.id, undefined);
    else if (source === 'onedrive') loadFolder(undefined);
  };

  const handleItemClick = (item) => {
    if (item.isFolder) {
      openFolder(item);
    } else if (mode === 'pick') {
      onSelect({
        itemId: item.id,
        driveId: source === 'sharepoint' ? item.driveId : undefined,
        filename: item.name,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-medium text-slate-700">
            {mode === 'save' ? 'Speicherort wählen' : 'Datei auswählen'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {connected === null ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : !connected ? (
          <div className="p-8 text-center">
            <Cloud className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-500 mb-4">Noch nicht mit Microsoft verbunden.</p>
            <button
              onClick={connect}
              disabled={connecting}
              className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
            >
              {connecting ? 'Warte auf Anmeldung im Popup...' : 'Mit Microsoft verbinden'}
            </button>
            {connecting && (
              <p className="text-xs text-slate-400 mt-2">Falls sich kein Popup geöffnet hat, prüfe deinen Popup-Blocker.</p>
            )}
            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 p-2 border-b border-slate-100">
              <button
                onClick={() => setSource('onedrive')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 ${source === 'onedrive' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              >
                <Cloud className="w-3.5 h-3.5" /> OneDrive
              </button>
              <button
                onClick={() => setSource('sharepoint')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 ${source === 'sharepoint' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              >
                <Building2 className="w-3.5 h-3.5" /> SharePoint
              </button>
              <button onClick={goToRootOfSource} className="p-1.5 text-slate-400 hover:text-slate-600" title="Aktualisieren">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={disconnect} className="ml-auto p-1.5 text-slate-400 hover:text-red-600" title="Verbindung trennen">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {source === 'sharepoint' && !selectedSite ? (
            <div className="flex-1 overflow-y-auto p-2">
                <div className="p-2 mb-2 border-b border-slate-100">
                  <p className="text-xs text-slate-400 mb-1.5">Seite nicht in der Liste? (z.B. gerade erst angelegt)</p>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={siteUrlInput}
                      onChange={(e) => setSiteUrlInput(e.target.value)}
                      placeholder="https://firma.sharepoint.com/sites/Team"
                      className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <button
                      onClick={addSiteByUrl}
                      disabled={siteUrlLoading || !siteUrlInput.trim()}
                      className="px-3 py-1.5 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950 disabled:opacity-50 flex-shrink-0"
                    >
                      {siteUrlLoading ? '...' : 'Öffnen'}
                    </button>
                  </div>
                </div>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : sites.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">Keine SharePoint-Seiten gefunden.</p>
                ) : (
                  sites.map((site) => (
                    <button
                      key={site.id}
                      onClick={() => pickSite(site)}
                      className="w-full flex items-center gap-2 p-2.5 hover:bg-slate-50 rounded-lg text-left"
                    >
                      <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="text-sm text-slate-700 truncate">{site.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 px-3 py-2 text-xs text-slate-400 border-b border-slate-50 overflow-x-auto">
                  {source === 'sharepoint' ? (
                    <>
                      <button onClick={() => { setSelectedSite(null); setBreadcrumb([]); }} className="hover:text-slate-700 flex-shrink-0">
                        ← Alle Seiten
                      </button>
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      <button onClick={goToRootOfSource} className="hover:text-slate-700 flex-shrink-0 font-medium text-slate-500">
                        {selectedSite?.name}
                      </button>
                    </>
                  ) : (
                    <button onClick={goToRootOfSource} className="hover:text-slate-700 flex-shrink-0 font-medium text-slate-500">
                      OneDrive
                    </button>
                  )}
                  {breadcrumb.map((crumb, idx) => (
                    <React.Fragment key={crumb.id}>
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      <button onClick={() => goToBreadcrumb(idx)} className="hover:text-slate-700 flex-shrink-0 truncate max-w-[100px]">
                        {crumb.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-2 min-h-[240px]">
                  {loading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                  ) : items.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">Ordner ist leer.</p>
                  ) : (
                    items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        disabled={!item.isFolder && mode === 'save'}
                        className="w-full flex items-center gap-2 p-2.5 hover:bg-slate-50 rounded-lg text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {item.isDrive ? (
                          <Building2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        ) : item.isFolder ? (
                          <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        )}
                        <span className="text-sm text-slate-700 truncate flex-1">{item.name}</span>
                        {item.isFolder && <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>

                {mode === 'save' && (
                  <div className="p-3 border-t border-slate-100">
                    <button
                      onClick={() => onSaveHere({
                        driveId: source === 'sharepoint' ? (breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].driveId : undefined) : undefined,
                        folderId: currentFolderId,
                      })}
                      disabled={source === 'sharepoint' && breadcrumb.length === 0}
                      className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {source === 'sharepoint' && breadcrumb.length === 0 ? 'Bitte erst eine Bibliothek öffnen' : 'Hier speichern'}
                    </button>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-xs text-red-600 px-3 pb-2">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Loader2, Download, Save, RefreshCw, DollarSign, Users, Building2, Trash2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function UsageReport({ authFetch }) {
  const [groupBy, setGroupBy] = useState('username');
  const [summary, setSummary] = useState([]);
  const [costCenters, setCostCenters] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [draftCostCenters, setDraftCostCenters] = useState({});
  const [savingUser, setSavingUser] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [costCenterFilter, setCostCenterFilter] = useState('');
  const [usernames, setUsernames] = useState([]);
  const [deletingUser, setDeletingUser] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ groupBy });
      if (fromDate) params.set('from', new Date(fromDate).toISOString());
      if (toDate) params.set('to', new Date(toDate + 'T23:59:59').toISOString());
      if (usernameFilter) params.set('username', usernameFilter);
      if (costCenterFilter) params.set('costCenter', costCenterFilter);

      const [summaryRes, ccRes, namesRes] = await Promise.all([
        authFetch(`${API_URL}/usage/summary?${params}`),
        authFetch(`${API_URL}/usage/cost-centers`),
        authFetch(`${API_URL}/usage/usernames`),
      ]);
      const summaryData = await summaryRes.json();
      const ccData = await ccRes.json();
      const namesData = await namesRes.json();
      if (!summaryRes.ok) throw new Error(summaryData.error || 'Laden fehlgeschlagen');
      setSummary(summaryData.summary || []);
      setCostCenters(ccData.costCenters || {});
      setUsernames(namesData.usernames || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [groupBy]);
  useEffect(() => {
    const timer = setTimeout(load, 400);
    return () => clearTimeout(timer);
  }, [usernameFilter, costCenterFilter]);

  const deleteUserRecords = async (username) => {
    if (!window.confirm(`Alle Nutzungsdaten für "${username}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    setDeletingUser(username);
    try {
      const res = await authFetch(`${API_URL}/usage/records?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Löschen fehlgeschlagen');
      await load();
    } catch (err) {
      setError(err.message);
    }
    setDeletingUser(null);
  };

  const saveCostCenter = async (username) => {
    const value = draftCostCenters[username];
    if (value === undefined) return;
    setSavingUser(username);
    try {
      const res = await authFetch(`${API_URL}/usage/cost-centers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, costCenter: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setCostCenters(data.costCenters);
    } catch (err) {
      setError(err.message);
    }
    setSavingUser(null);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', new Date(fromDate).toISOString());
      if (toDate) params.set('to', new Date(toDate + 'T23:59:59').toISOString());
      const res = await authFetch(`${API_URL}/usage/export.csv?${params}`);
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nutzung_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
    setExporting(false);
  };

  const totalCost = summary.reduce((sum, r) => sum + r.estimatedCostUSD, 0);
  const totalCalls = summary.reduce((sum, r) => sum + r.calls, 0);

  return (
    <div className="space-y-4">
      {/* Kennzahlen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <DollarSign className="w-4 h-4" />
            <p className="text-xs font-medium uppercase tracking-wide">Geschätzte Kosten</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">${totalCost.toFixed(2)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <RefreshCw className="w-4 h-4" />
            <p className="text-xs font-medium uppercase tracking-wide">KI-Aufrufe</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{totalCalls}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            {groupBy === 'username' ? <Users className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
            <p className="text-xs font-medium uppercase tracking-wide">{groupBy === 'username' ? 'Aktive Nutzer' : 'Kostenstellen'}</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{summary.length}</p>
        </div>
      </div>

      {/* Steuerung */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setGroupBy('username')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${groupBy === 'username' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Nach Nutzer
          </button>
          <button
            onClick={() => setGroupBy('costCenter')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${groupBy === 'costCenter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Nach Kostenstelle
          </button>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Nutzer</label>
          <input
            type="text"
            list="usage-usernames-list"
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
            placeholder="Freitext..."
            className="w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
          />
          <datalist id="usage-usernames-list">
            {usernames.map((u) => <option key={u} value={u} />)}
          </datalist>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Kostenstelle</label>
          <input
            type="text"
            value={costCenterFilter}
            onChange={(e) => setCostCenterFilter(e.target.value)}
            placeholder="Freitext..."
            className="w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Von</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Bis</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md text-xs font-medium hover:bg-slate-200">
          Aktualisieren
        </button>

        <button
          onClick={exportCsv}
          disabled={exporting}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-xs font-medium hover:bg-blue-950 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          CSV-Export
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      {/* Tabelle */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : summary.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">Noch keine Nutzungsdaten im gewählten Zeitraum.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium whitespace-nowrap">{groupBy === 'username' ? 'Nutzer' : 'Kostenstelle'}</th>
                {groupBy === 'username' && <th className="px-4 py-3 font-medium whitespace-nowrap">Kostenstelle</th>}
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Aufrufe</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Input-Tokens</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Output-Tokens</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Cache gelesen</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Geschätzte Kosten</th>
                {groupBy === 'username' && <th className="px-4 py-3 font-medium w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.key} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700">{row.key}</td>
                  {groupBy === 'username' && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={draftCostCenters[row.key] !== undefined ? draftCostCenters[row.key] : (costCenters[row.key] || '')}
                          onChange={(e) => setDraftCostCenters((prev) => ({ ...prev, [row.key]: e.target.value }))}
                          placeholder="z.B. KST-1000"
                          className="w-28 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <button
                          onClick={() => saveCostCenter(row.key)}
                          disabled={savingUser === row.key}
                          className="p-1.5 text-slate-400 hover:text-blue-900"
                          title="Kostenstelle speichern"
                        >
                          {savingUser === row.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-slate-500">{row.calls}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{row.inputTokens.toLocaleString('de-DE')}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{row.outputTokens.toLocaleString('de-DE')}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{row.cacheReadTokens.toLocaleString('de-DE')}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">${row.estimatedCostUSD.toFixed(2)}</td>
                  {groupBy === 'username' && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteUserRecords(row.key)}
                        disabled={deletingUser === row.key}
                        className="p-1.5 text-slate-300 hover:text-red-600"
                        title={`Alle Daten für "${row.key}" löschen`}
                      >
                        {deletingUser === row.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

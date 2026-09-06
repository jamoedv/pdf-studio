import React, { useState } from 'react';
import {
  Upload, X, Loader2, AlertCircle, Check, Download, ChevronDown, ChevronRight,
  FileText, Sparkles, Pencil, Trash2, Plus, FileSpreadsheet, AlertTriangle
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function onDropFiles(e, callback) {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    callback(e.dataTransfer.files);
  }
}
const onDragOverPrevent = (e) => e.preventDefault();

export default function ExamGrading({ authFetch, downloadFile }) {
  // Schritt 1: Musterlösung -> Bewertungsschema
  const [modelFile, setModelFile] = useState(null);
  const [extractingKey, setExtractingKey] = useState(false);
  const [answerKey, setAnswerKey] = useState(null);
  const [keyError, setKeyError] = useState('');

  // Schritt 2: Antwortbögen
  const [submissions, setSubmissions] = useState([]);

  // Schritt 3: Bewertung
  const [grading, setGrading] = useState(false);
  const [results, setResults] = useState([]);
  const [expandedIdx, setExpandedIdx] = useState(null);

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const extractAnswerKey = async () => {
    if (!modelFile) return;
    setExtractingKey(true);
    setKeyError('');
    try {
      const formData = new FormData();
      formData.append('file', modelFile);
      const res = await authFetch(`${API_URL}/exam-grading/answer-key`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraktion fehlgeschlagen');
      setAnswerKey(data);
    } catch (err) {
      setKeyError(err.message);
    }
    setExtractingKey(false);
  };

  const updateQuestion = (idx, field, value) => {
    setAnswerKey((prev) => {
      const questions = [...prev.questions];
      questions[idx] = { ...questions[idx], [field]: value };
      return { ...prev, questions };
    });
  };

  const removeQuestion = (idx) => {
    setAnswerKey((prev) => ({ ...prev, questions: prev.questions.filter((_, i) => i !== idx) }));
  };

  const addQuestion = () => {
    setAnswerKey((prev) => ({
      ...prev,
      questions: [...(prev?.questions || []), { number: '', type: 'mc', correctAnswer: '', keyPoints: [], maxPoints: 1 }],
    }));
  };

  const addSubmissions = (fileList) => {
    setSubmissions((prev) => [...prev, ...Array.from(fileList)]);
  };

  const removeSubmission = (idx) => {
    setSubmissions((prev) => prev.filter((_, i) => i !== idx));
  };

  const runGrading = async () => {
    if (!answerKey || submissions.length === 0) return;
    setGrading(true);
    const collected = [];
    setResults(submissions.map((f) => ({ filename: f.name, status: 'pending' })));

    for (let i = 0; i < submissions.length; i++) {
      const file = submissions[i];
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('answerKey', JSON.stringify(answerKey));
        const res = await authFetch(`${API_URL}/exam-grading/grade`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Bewertung fehlgeschlagen');
        collected.push({ ...data, status: 'done' });
      } catch (err) {
        collected.push({ filename: file.name, status: 'error', error: err.message });
      }
      setResults([...collected, ...submissions.slice(i + 1).map((f) => ({ filename: f.name, status: 'pending' }))]);
    }

    setGrading(false);
  };

  const exportExcel = async () => {
    const done = results.filter((r) => r.status === 'done');
    if (done.length === 0) return;
    setExporting(true);
    setExportError('');
    try {
      const res = await authFetch(`${API_URL}/exam-grading/export-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: done }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export fehlgeschlagen');
      downloadFile(data.outputPath);
    } catch (err) {
      setExportError(err.message);
    }
    setExporting(false);
  };

  const doneResults = results.filter((r) => r.status === 'done');
  const needsReviewCount = doneResults.filter((r) => (r.questions || []).some((q) => q.confidence === 'low')).length;

  return (
    <div className="space-y-4">
      {/* Schritt 1: Musterlösung */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Schritt 1 · Musterlösung</p>

        {!answerKey ? (
          <div className="space-y-3">
            <label className="block cursor-pointer" onDragOver={onDragOverPrevent} onDrop={(e) => onDropFiles(e, (files) => setModelFile(files[0] || null))}>
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                <FileText className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-500">{modelFile ? modelFile.name : 'Musterlösung wählen oder hierher ziehen (PDF)'}</p>
                <p className="text-xs text-slate-400 mt-1">Die KI liest Fragen, richtige Antworten und Punktzahlen aus</p>
              </div>
              <input type="file" accept=".pdf" className="hidden" onChange={(e) => setModelFile(e.target.files[0] || null)} />
            </label>
            <button
              onClick={extractAnswerKey}
              disabled={extractingKey || !modelFile}
              className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {extractingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Bewertungsschema erstellen
            </button>
            {keyError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700">{keyError}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{answerKey.questions.length} Fragen erkannt — bitte prüfen und bei Bedarf korrigieren</p>
              <button onClick={() => setAnswerKey(null)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Neu einlesen
              </button>
            </div>

            <div className="space-y-2">
              {answerKey.questions.map((q, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={q.number}
                      onChange={(e) => updateQuestion(idx, 'number', e.target.value)}
                      placeholder="Nr."
                      className="w-14 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <select
                      value={q.type}
                      onChange={(e) => updateQuestion(idx, 'type', e.target.value)}
                      className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="mc">Multiple Choice</option>
                      <option value="open">Offen / handschriftlich</option>
                    </select>
                    <input
                      type="number"
                      value={q.maxPoints}
                      onChange={(e) => updateQuestion(idx, 'maxPoints', Number(e.target.value))}
                      placeholder="Punkte"
                      className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <span className="text-xs text-slate-400 flex-1 truncate">{q.questionText}</span>
                    <button onClick={() => removeQuestion(idx)} className="text-slate-300 hover:text-red-600 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {q.type === 'mc' ? (
                    <input
                      value={q.correctAnswer || ''}
                      onChange={(e) => updateQuestion(idx, 'correctAnswer', e.target.value)}
                      placeholder="Richtige Antwort (z.B. B)"
                      className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  ) : (
                    <input
                      value={(q.keyPoints || []).join(', ')}
                      onChange={(e) => updateQuestion(idx, 'keyPoints', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      placeholder="Erwartete Kernpunkte, kommagetrennt"
                      className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  )}
                </div>
              ))}
            </div>

            <button onClick={addQuestion} className="flex items-center gap-1.5 text-xs text-blue-900 font-medium hover:underline">
              <Plus className="w-3.5 h-3.5" /> Frage hinzufügen
            </button>
          </div>
        )}
      </div>

      {/* Schritt 2 & 3: Antwortbögen + Bewertung */}
      {answerKey && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Schritt 2 · Antwortbögen bewerten</p>

          <label className="block cursor-pointer mb-3" onDragOver={onDragOverPrevent} onDrop={(e) => onDropFiles(e, addSubmissions)}>
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
              <Upload className="w-6 h-6 mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500">Antwortbögen wählen oder hierher ziehen (PDF, mehrere möglich — 10–20 auf einmal)</p>
            </div>
            <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => addSubmissions(e.target.files)} />
          </label>

          {submissions.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {submissions.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-600 truncate">{f.name}</span>
                  <button onClick={() => removeSubmission(i)} className="text-slate-400 hover:text-red-600 flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={runGrading}
            disabled={grading || submissions.length === 0}
            className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {grading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {grading ? `Bewerte ${results.filter(r => r.status !== 'pending').length}/${submissions.length}...` : `${submissions.length} Bögen bewerten`}
          </button>
        </div>
      )}

      {/* Ergebnisse */}
      {results.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Ergebnisse</p>
            {needsReviewCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                {needsReviewCount} Bogen zur manuellen Prüfung markiert
              </span>
            )}
          </div>

          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => r.status === 'done' && setExpandedIdx(expandedIdx === i ? null : i)}
                  className="w-full flex items-center justify-between gap-3 p-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {r.status === 'done' && (expandedIdx === i ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />)}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{r.studentName || r.filename}</p>
                      <p className="text-xs text-slate-400 truncate">{r.filename}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {r.status === 'pending' && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                    {r.status === 'error' && <span className="text-xs text-red-600">{r.error}</span>}
                    {r.status === 'done' && (
                      <>
                        {(r.questions || []).some((q) => q.confidence === 'low') && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        )}
                        <span className="text-sm font-semibold text-slate-700">{r.totalScore} / {r.maxScore}</span>
                      </>
                    )}
                  </div>
                </button>

                {expandedIdx === i && r.status === 'done' && (
                  <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50">
                    {(r.questions || []).map((q, qi) => (
                      <div key={qi} className={`flex items-start justify-between gap-3 p-2.5 rounded-md ${q.confidence === 'low' ? 'bg-amber-50 border border-amber-200' : 'bg-white border border-slate-100'}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-600">Frage {q.number}: <span className="font-normal text-slate-500">{q.detectedAnswer}</span></p>
                          {q.note && <p className="text-xs text-slate-400 mt-0.5">{q.note}</p>}
                        </div>
                        <span className={`text-xs font-semibold flex-shrink-0 ${q.confidence === 'low' ? 'text-amber-700' : 'text-slate-600'}`}>
                          {q.points}/{q.maxPoints}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {doneResults.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={exportExcel}
                disabled={exporting}
                className="w-full py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Notenübersicht als Excel exportieren
              </button>
              {exportError && <p className="text-xs text-red-600 mt-2">{exportError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

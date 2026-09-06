import React, { useState, useCallback, useEffect } from 'react';
import { Node } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, Pilcrow,
  List, ListOrdered, Quote, Link2, Unlink,
  AlignLeft, AlignCenter, AlignRight,
  Table as TableIcon, Rows, Columns, Trash2,
  Undo2, Redo2, Plus, Download, Loader2, AlertCircle, Check,
  Upload, X, FileSpreadsheet, Sparkles, Image as ImageIcon, Award, Code2
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

// Roher HTML-Block: bewahrt beliebiges HTML (Divs, SVG, Inline-CSS, ...) unverändert,
// statt es durch das eingeschränkte TipTap-Schema zu normalisieren.
const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      content: { default: '' },
    };
  },
  parseHTML() {
    return [{
      tag: 'div[data-raw-html-block]',
      getAttrs: (el) => ({ content: el.innerHTML }),
    }];
  },
  renderHTML({ node }) {
    const div = document.createElement('div');
    div.setAttribute('data-raw-html-block', 'true');
    div.innerHTML = node.attrs.content || '';
    return div;
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-raw-html-block', 'true');
      dom.style.position = 'relative';
      dom.innerHTML = node.attrs.content || '';

      const badge = document.createElement('div');
      badge.textContent = 'Roher HTML-Block — Bearbeitung über </> HTML-Quellcode';
      badge.style.cssText = 'position:absolute; top:-22px; left:0; font-size:11px; color:#94a3b8; font-family:sans-serif; opacity:0; transition:opacity .15s; pointer-events:none;';
      dom.style.outline = '1px dashed transparent';
      dom.addEventListener('mouseenter', () => { badge.style.opacity = '1'; dom.style.outline = '1px dashed #cbd5e1'; });
      dom.addEventListener('mouseleave', () => { badge.style.opacity = '0'; dom.style.outline = '1px dashed transparent'; });
      dom.appendChild(badge);

      return { dom };
    };
  },
});

const FONT_FAMILIES = [
  { label: 'Standard', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
];

const FONT_SIZES = [
  { label: 'Standard', value: '' },
  { label: '10px', value: '10px' },
  { label: '12px', value: '12px' },
  { label: '14px', value: '14px' },
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '24px', value: '24px' },
  { label: '32px', value: '32px' },
  { label: '48px', value: '48px' },
];

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-blue-900 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-slate-200 mx-1" />;
}

export default function TemplateEditor({ authFetch, downloadFile }) {
  const [fieldName, setFieldName] = useState('');
  const [placeholders, setPlaceholders] = useState([]);
  const [mode, setMode] = useState('single'); // 'single' | 'batch'
  const [values, setValues] = useState({});
  const [excelFile, setExcelFile] = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [aiMatchInfo, setAiMatchInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Vorlagen-Bibliothek
  const [templateName, setTemplateName] = useState('Unbenannte Vorlage');
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [showHtmlSource, setShowHtmlSource] = useState(false);
  const [htmlSourceValue, setHtmlSourceValue] = useState('');

  // Mehrere Dokumente (KI) -> n ausgefüllte PDFs
  const [batchDocs, setBatchDocs] = useState([]);
  const [batchDocResults, setBatchDocResults] = useState([]);
  const [batchDocRunning, setBatchDocRunning] = useState(false);

  const detectPlaceholders = useCallback((text) => {
    const matches = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
    const unique = [...new Set(matches)];
    setPlaceholders(unique);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      TextStyle,
      FontFamily,
      FontSize,
      RawHtmlBlock,
    ],
    content: `
      <h2>Meine Vorlage</h2>
      <p>Sehr geehrte/r {{Name}},</p>
      <p>hier steht Ihr Vorlagentext…</p>
    `,
    onUpdate: ({ editor }) => detectPlaceholders(editor.getHTML()),
  });

  useEffect(() => {
    if (editor) detectPlaceholders(editor.getHTML());
  }, [editor, detectPlaceholders]);

  const insertPlaceholder = () => {
    if (!fieldName.trim() || !editor) return;
    editor.chain().focus().insertContent(`{{${fieldName.trim()}}}`).run();
    setFieldName('');
  };

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL eingeben', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const handleValueChange = (name, val) => {
    setValues(prev => ({ ...prev, [name]: val }));
  };

  const extractFromDocument = async () => {
    if (!sourceFile) return;
    setExtracting(true);
    setExtractError('');
    setAiMatchInfo(null);
    try {
      const formData = new FormData();
      formData.append('files', sourceFile);
      formData.append('targetFields', placeholders.join(','));
      formData.append('generateReport', 'false');
      const res = await authFetch(`${API_URL}/extract-keyvalues`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraktion fehlgeschlagen');
      const r = data.results && data.results[0];
      if (!r || r.error) throw new Error((r && r.error) || 'Keine Werte im Dokument gefunden');

      const newValues = { ...values };
      const matched = [];
      const unmatched = [];
      placeholders.forEach((p) => {
        const norm = (s) => s.trim().toLowerCase();
        const fields = r.fields || [];
        const field = fields.find(f => norm(f.key) === norm(p))
          || fields.find(f => norm(f.key).includes(norm(p)) || norm(p).includes(norm(f.key)));
        if (field) {
          newValues[p] = field.value;
          matched.push(p);
        } else {
          unmatched.push(p);
        }
      });
      setValues(newValues);
      setAiMatchInfo({ matched, unmatched, documentType: r.documentType });
      setMode('single');
    } catch (err) {
      setExtractError(err.message);
    }
    setExtracting(false);
  };

  const fetchTemplateLibrary = async () => {
    setLibraryLoading(true);
    try {
      const res = await authFetch(`${API_URL}/document-templates/library`);
      const data = await res.json();
      if (res.ok) setSavedTemplates(data.templates || []);
    } catch (err) {
      // still show the panel; error is non-critical for browsing
    }
    setLibraryLoading(false);
  };

  const openLibrary = () => {
    setShowLibrary(true);
    fetchTemplateLibrary();
  };

  const saveTemplate = async () => {
    if (!editor || !templateName.trim()) return;
    setSaving(true);
    setSaveNotice('');
    try {
      const res = await authFetch(`${API_URL}/document-templates/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName.trim(), html: getContentForOutput(), id: currentTemplateId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setCurrentTemplateId(data.id);
      setSaveNotice('Gespeichert');
      setTimeout(() => setSaveNotice(''), 2000);
    } catch (err) {
      setSaveNotice(err.message);
    }
    setSaving(false);
  };

  const loadTemplate = async (id) => {
    try {
      const res = await authFetch(`${API_URL}/document-templates/library/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
      const looksComplex = /<!DOCTYPE|<html[\s>]|<div[\s>]|<style[\s>]|<svg[\s>]/i.test(data.html);
      if (looksComplex) {
        setRawHtmlContent(data.html);
      } else {
        editor.commands.setContent(data.html);
      }
      detectPlaceholders(editor.getHTML());
      setTemplateName(data.name);
      setCurrentTemplateId(data.id);
      setValues({});
      setResult(null);
      setAiMatchInfo(null);
      setShowLibrary(false);
    } catch (err) {
      setSaveNotice(err.message);
    }
  };

  const deleteTemplate = async (id) => {
    if (!window.confirm('Diese Vorlage wirklich löschen?')) return;
    try {
      await authFetch(`${API_URL}/document-templates/library/${id}`, { method: 'DELETE' });
      setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      // ignore, list stays as-is
    }
  };

  const startNewTemplate = () => {
    editor.commands.setContent('<p></p>');
    setTemplateName('Unbenannte Vorlage');
    setCurrentTemplateId(null);
    setValues({});
    setResult(null);
    setAiMatchInfo(null);
    setShowLibrary(false);
  };

  const addBatchDocs = (fileList) => {
    setBatchDocs((prev) => [...prev, ...Array.from(fileList)]);
  };

  const removeBatchDoc = (idx) => {
    setBatchDocs((prev) => prev.filter((_, i) => i !== idx));
  };

  // Für jedes hochgeladene Quelldokument: Werte per KI extrahieren, dann Vorlage damit befüllen
  const runBatchFromDocuments = async () => {
    if (!editor || batchDocs.length === 0) return;
    setBatchDocRunning(true);
    setBatchDocResults(batchDocs.map((f) => ({ filename: f.name, status: 'pending' })));

    const html = getContentForOutput();
    const results = [];

    for (let i = 0; i < batchDocs.length; i++) {
      const file = batchDocs[i];
      try {
        const formData = new FormData();
        formData.append('files', file);
        formData.append('targetFields', placeholders.join(','));
        formData.append('generateReport', 'false');
        const extractRes = await authFetch(`${API_URL}/extract-keyvalues`, { method: 'POST', body: formData });
        const extractData = await extractRes.json();
        if (!extractRes.ok) throw new Error(extractData.error || 'Extraktion fehlgeschlagen');
        const r = extractData.results && extractData.results[0];
        if (!r || r.error) throw new Error((r && r.error) || 'Keine Werte gefunden');

        const norm = (s) => s.trim().toLowerCase();
        const fields = r.fields || [];
        const docValues = {};
        placeholders.forEach((p) => {
          const field = fields.find((f) => norm(f.key) === norm(p))
            || fields.find((f) => norm(f.key).includes(norm(p)) || norm(p).includes(norm(f.key)));
          docValues[p] = field ? field.value : '';
        });

        const fillRes = await authFetch(`${API_URL}/document-templates/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, values: docValues }),
        });
        const fillData = await fillRes.json();
        if (!fillRes.ok) throw new Error(fillData.error || 'Erstellung fehlgeschlagen');

        results.push({ filename: file.name, status: 'done', outputPath: fillData.outputPath, values: docValues });
      } catch (err) {
        results.push({ filename: file.name, status: 'error', error: err.message });
      }
      setBatchDocResults([...results, ...batchDocs.slice(i + 1).map((f) => ({ filename: f.name, status: 'pending' }))]);
    }

    setBatchDocRunning(false);
  };

  const setRawHtmlContent = (html) => {
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'rawHtmlBlock', attrs: { content: html } }],
    });
  };

  const getSoleRawHtmlContent = () => {
    if (!editor) return null;
    const doc = editor.state.doc;
    const rawBlocks = [];
    let onlyRawPlusEmpty = true;
    doc.forEach((child) => {
      if (child.type.name === 'rawHtmlBlock') {
        rawBlocks.push(child);
      } else if (!(child.type.name === 'paragraph' && child.content.size === 0)) {
        onlyRawPlusEmpty = false;
      }
    });
    return (onlyRawPlusEmpty && rawBlocks.length === 1) ? rawBlocks[0].attrs.content : null;
  };

  // Für PDF-Erzeugung/Speichern: bei einem reinen HTML-Block den Original-Inhalt
  // 1:1 verwenden (kein Wrapper-Div, kein automatisch angehängter Leer-Absatz,
  // der sonst z.B. ein exakt A4-großes Zertifikat auf eine 2. Seite drücken würde).
  const getContentForOutput = () => {
    const soleRaw = getSoleRawHtmlContent();
    return soleRaw !== null ? soleRaw : editor.getHTML();
  };

  const openHtmlSource = () => {
    if (!editor) return;
    const soleRaw = getSoleRawHtmlContent();
    setHtmlSourceValue(soleRaw !== null ? soleRaw : editor.getHTML());
    setShowHtmlSource(true);
  };

  const applyHtmlSource = () => {
    if (!editor) return;
    setRawHtmlContent(htmlSourceValue);
    detectPlaceholders(editor.getHTML());
    setShowHtmlSource(false);
  };

  const cancelHtmlSource = () => {
    setShowHtmlSource(false);
  };

  const insertImage = (e) => {
    const file = e.target.files[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const CERTIFICATE_TEMPLATE = `
    <div style="text-align:center; border: 6px double #1e3a8a; padding: 48px 40px;">
      <p style="text-align:center;">
        <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiB2aWV3Qm94PSIwIDAgMTIwIDEyMCI+PGNpcmNsZSBjeD0iNjAiIGN5PSI2MCIgcj0iNTYiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2NiZDVlMSIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtZGFzaGFycmF5PSI2IDYiLz48dGV4dCB4PSI2MCIgeT0iNjUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMyIgZmlsbD0iIzk0YTNiOCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TE9HTzwvdGV4dD48L3N2Zz4=" width="90" />
      </p>
      <h1 style="font-size: 30px; letter-spacing: 2px; color:#1e3a8a; margin: 24px 0 4px;">TEILNAHMEZERTIFIKAT</h1>
      <p style="color:#64748b; margin: 0 0 32px;">wird hiermit verliehen an</p>
      <h2 style="font-size: 26px; margin: 0 0 32px; font-style: italic;">{{Name}}</h2>
      <p style="font-size: 15px; line-height: 1.8; max-width: 480px; margin: 0 auto 32px;">
        für die erfolgreiche Teilnahme am Kurs<br/>
        <strong>{{Kurs}}</strong><br/>
        am {{Datum}} (Dauer: {{Dauer}})
      </p>
      <table style="width:100%; margin-top: 48px; border: none;">
        <tr>
          <td style="border:none; text-align:center; width:50%;">
            <p style="border-top: 1px solid #cbd5e1; padding-top: 6px; margin: 0 40px;">{{Trainer}}<br/><span style="font-size:12px; color:#94a3b8;">Trainer/in</span></p>
          </td>
          <td style="border:none; text-align:center; width:50%;">
            <p style="border-top: 1px solid #cbd5e1; padding-top: 6px; margin: 0 40px;">{{Datum}}<br/><span style="font-size:12px; color:#94a3b8;">Datum</span></p>
          </td>
        </tr>
      </table>
    </div>
  `;

  const loadCertificateTemplate = () => {
    if (!editor) return;
    if (placeholders.length > 0 || editor.getText().trim().length > 0) {
      if (!window.confirm('Aktueller Inhalt wird durch die Zertifikatsvorlage ersetzt. Fortfahren?')) return;
    }
    setRawHtmlContent(CERTIFICATE_TEMPLATE);
    detectPlaceholders(editor.getHTML());
    setTemplateName('Teilnahmezertifikat');
    setCurrentTemplateId(null);
    setValues({});
    setResult(null);
    setAiMatchInfo(null);
  };

  const fillSingle = async () => {
    if (!editor) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await authFetch(`${API_URL}/document-templates/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: getContentForOutput(), values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Erstellen des Dokuments');
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const fillBatch = async () => {
    if (!editor || !excelFile) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('html', getContentForOutput());
      formData.append('excel', excelFile);
      const res = await authFetch(`${API_URL}/document-templates/fill-batch`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler bei der Massen-Erstellung');
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!editor) return null;

  const inTable = editor.isActive('table');

  return (
    <div>
      {/* Vorlagen-Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-3 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="flex-1 min-w-[160px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="Name der Vorlage"
        />
        <button
          onClick={saveTemplate}
          disabled={saving || !templateName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {currentTemplateId ? 'Speichern' : 'Als neue Vorlage speichern'}
        </button>
        <button
          onClick={openLibrary}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Bibliothek
        </button>
        <button
          onClick={loadCertificateTemplate}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors"
        >
          <Award className="w-3.5 h-3.5" />
          Zertifikatsvorlage laden
        </button>
        <button
          onClick={startNewTemplate}
          className="flex items-center gap-1.5 px-3 py-2 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Neu
        </button>
        {saveNotice && <span className="text-xs text-slate-400">{saveNotice}</span>}
      </div>

      {/* Bibliotheks-Panel */}
      {showLibrary && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Gespeicherte Vorlagen</p>
            <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          {libraryLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : savedTemplates.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Noch keine Vorlagen gespeichert.</p>
          ) : (
            <div className="space-y-2">
              {savedTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{t.name}</p>
                    <p className="text-xs text-slate-400">{new Date(t.updatedAt || t.createdAt).toLocaleString('de-DE')}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => loadTemplate(t.id)} className="px-3 py-1.5 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950">
                      Öffnen
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="p-1.5 text-slate-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-t-xl p-2 flex items-center gap-0.5 flex-wrap">
        <ToolbarButton title="Rückgängig" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Wiederholen" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarDivider />

        <select
          value={editor.getAttributes('textStyle').fontFamily || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) editor.chain().focus().setFontFamily(val).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
          className="h-8 px-2 bg-white border border-slate-200 rounded-md text-xs text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 max-w-[130px]"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={editor.getAttributes('textStyle').fontSize || ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) editor.chain().focus().setFontSize(val).run();
            else editor.chain().focus().unsetFontSize().run();
          }}
          className="h-8 px-2 bg-white border border-slate-200 rounded-md text-xs text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 w-20"
        >
          {FONT_SIZES.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>

        <ToolbarDivider />

        <ToolbarButton title="Fett" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Kursiv" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Unterstrichen" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Durchgestrichen" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton title="Absatz" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Überschrift 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Überschrift 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Überschrift 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton title="Aufzählung" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Nummerierte Liste" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Zitat" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton title="Linksbündig" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Zentriert" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton title="Rechtsbündig" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton title="Link" active={editor.isActive('link')} onClick={setLink}>
          <Link2 className="w-4 h-4" />
        </ToolbarButton>
        {editor.isActive('link') && (
          <ToolbarButton title="Link entfernen" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Unlink className="w-4 h-4" />
          </ToolbarButton>
        )}

        <ToolbarDivider />

        <ToolbarButton title="Tabelle einfügen" onClick={insertTable}>
          <TableIcon className="w-4 h-4" />
        </ToolbarButton>

        <label title="Bild einfügen" className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-500 hover:bg-slate-100 cursor-pointer">
          <ImageIcon className="w-4 h-4" />
          <input type="file" accept="image/*" className="hidden" onChange={insertImage} />
        </label>

        <ToolbarButton title="HTML-Quellcode" active={showHtmlSource} onClick={openHtmlSource}>
          <Code2 className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        <input
          type="text"
          value={fieldName}
          onChange={(e) => setFieldName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && insertPlaceholder()}
          placeholder="Feldname"
          className="ml-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 w-32"
        />
        <button
          onClick={insertPlaceholder}
          disabled={!fieldName.trim()}
          className="ml-1 flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-900 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Platzhalter
        </button>
      </div>

      {/* Table context toolbar */}
      {inTable && (
        <div className="bg-slate-50 border-x border-b border-slate-200 px-2 py-1.5 flex items-center gap-0.5 flex-wrap text-xs">
          <span className="text-slate-400 px-2">Tabelle:</span>
          <ToolbarButton title="Zeile davor einfügen" onClick={() => editor.chain().focus().addRowBefore().run()}>
            <Rows className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton title="Zeile danach einfügen" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton title="Zeile löschen" onClick={() => editor.chain().focus().deleteRow().run()}>
            <Trash2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton title="Spalte davor einfügen" onClick={() => editor.chain().focus().addColumnBefore().run()}>
            <Columns className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton title="Spalte danach einfügen" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton title="Spalte löschen" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <Trash2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton title="Kopfzeile umschalten" active={editor.isActive('tableHeader')} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
            <span className="text-[10px] font-bold">H</span>
          </ToolbarButton>
          <ToolbarButton title="Zellen verbinden" onClick={() => editor.chain().focus().mergeCells().run()}>
            <span className="text-[10px] font-bold">⊔</span>
          </ToolbarButton>
          <ToolbarButton title="Zelle teilen" onClick={() => editor.chain().focus().splitCell().run()}>
            <span className="text-[10px] font-bold">⊓</span>
          </ToolbarButton>
          <ToolbarDivider />
          <button
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-50 rounded-md text-xs font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Tabelle löschen
          </button>
        </div>
      )}

      {/* HTML-Quellcode-Editor */}
      {showHtmlSource && (
        <div className="bg-slate-900 border-x border-b border-slate-200 rounded-b-xl p-0 overflow-hidden">
          <textarea
            value={htmlSourceValue}
            onChange={(e) => setHtmlSourceValue(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[320px] p-4 bg-slate-900 text-emerald-300 font-mono text-xs leading-relaxed outline-none resize-y"
          />
          <div className="flex items-center justify-end gap-2 p-3 bg-slate-800">
            <button onClick={cancelHtmlSource} className="px-3 py-1.5 text-slate-300 hover:text-white text-sm font-medium">
              Abbrechen
            </button>
            <button onClick={applyHtmlSource} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">
              <Check className="w-3.5 h-3.5" />
              Übernehmen
            </button>
          </div>
        </div>
      )}

      {/* Editor content */}
      {!showHtmlSource && (
      <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl p-6 min-h-[320px] tiptap-editor-wrapper">
        <EditorContent editor={editor} />
      </div>
      )}

      {/* Detected placeholders */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Erkannte Platzhalter</p>
        {placeholders.length === 0 ? (
          <p className="text-sm text-slate-400">Noch keine Platzhalter im Text (z. B. {'{{Name}}'})</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {placeholders.map((p) => (
              <span key={p} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md font-mono">
                {`{{${p}}}`}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fill mode switch */}
      {placeholders.length > 0 && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-4 w-fit flex-wrap">
            <button
              onClick={() => setMode('single')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Einzeln ausfüllen
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${mode === 'ai' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Aus Dokument (KI)
            </button>
            <button
              onClick={() => setMode('batch')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'batch' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Massen-Erstellung (Excel)
            </button>
            <button
              onClick={() => setMode('multidoc')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${mode === 'multidoc' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Mehrere Dokumente (KI)
            </button>
          </div>

          {mode === 'multidoc' && (
            <div className="space-y-3">
              <label className="block cursor-pointer" onDragOver={onDragOverPrevent} onDrop={(e) => onDropFiles(e, addBatchDocs)}>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                  <Sparkles className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-500">Quelldokumente wählen oder hierher ziehen (PDF, mehrere möglich)</p>
                  <p className="text-xs text-slate-400 mt-1">Für jedes Dokument wird die Vorlage einmal automatisch befüllt</p>
                </div>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => addBatchDocs(e.target.files)}
                />
              </label>

              {batchDocs.length > 0 && (
                <div className="space-y-1.5">
                  {batchDocs.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2">
                      <span className="text-sm text-slate-600 truncate">{f.name}</span>
                      <button onClick={() => removeBatchDoc(i)} className="text-slate-400 hover:text-red-600 flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={runBatchFromDocuments}
                disabled={batchDocRunning || batchDocs.length === 0}
                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {batchDocRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {batchDocRunning ? `Erstelle ${batchDocResults.filter(r => r.status !== 'pending').length}/${batchDocs.length}...` : `${batchDocs.length} Dokument${batchDocs.length !== 1 ? 'e' : ''} erstellen`}
              </button>

              {batchDocResults.length > 0 && (
                <div className="space-y-2 pt-2">
                  {batchDocResults.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 truncate">{r.filename}</p>
                        {r.status === 'error' && <p className="text-xs text-red-600 truncate">{r.error}</p>}
                        {r.status === 'pending' && <p className="text-xs text-slate-400">Wird verarbeitet…</p>}
                      </div>
                      {r.status === 'pending' && <Loader2 className="w-4 h-4 animate-spin text-slate-400 flex-shrink-0" />}
                      {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                      {r.status === 'done' && (
                        <button
                          onClick={() => downloadFile(r.outputPath)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950 flex-shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'ai' && (
            <div className="space-y-3">
              <label className="block cursor-pointer" onDragOver={onDragOverPrevent} onDrop={(e) => onDropFiles(e, (files) => setSourceFile(files[0] || null))}>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                  <Sparkles className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-500">{sourceFile ? sourceFile.name : 'Quelldokument wählen oder hierher ziehen (PDF)'}</p>
                  <p className="text-xs text-slate-400 mt-1">Die KI liest das Dokument und befüllt passende Platzhalter automatisch</p>
                </div>
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setSourceFile(e.target.files[0] || null)}
                />
              </label>
              {sourceFile && (
                <button onClick={() => setSourceFile(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
                  <X className="w-3 h-3" /> Datei entfernen
                </button>
              )}
              <button
                onClick={extractFromDocument}
                disabled={extracting || !sourceFile}
                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Werte extrahieren
              </button>
              {extractError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{extractError}</p>
                </div>
              )}
            </div>
          )}

          {mode === 'single' && aiMatchInfo && (
            <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-900">
              <p className="font-medium mb-1">
                {aiMatchInfo.matched.length} von {aiMatchInfo.matched.length + aiMatchInfo.unmatched.length} Platzhaltern automatisch befüllt
                {aiMatchInfo.documentType ? ` (${aiMatchInfo.documentType})` : ''}.
              </p>
              {aiMatchInfo.unmatched.length > 0 && (
                <p>Bitte manuell prüfen: {aiMatchInfo.unmatched.join(', ')}</p>
              )}
            </div>
          )}

          {mode === 'single' ? (
            <div className="space-y-3">
              {placeholders.map((p) => (
                <div key={p}>
                  <label className="text-xs text-slate-500 mb-1.5 block">{p}</label>
                  <input
                    type="text"
                    value={values[p] || ''}
                    onChange={(e) => handleValueChange(p, e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              ))}
              <button
                onClick={fillSingle}
                disabled={loading}
                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                PDF erstellen
              </button>
            </div>
          ) : mode === 'batch' ? (
            <div className="space-y-3">
              <label className="block cursor-pointer" onDragOver={onDragOverPrevent} onDrop={(e) => onDropFiles(e, (files) => setExcelFile(files[0] || null))}>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                  <FileSpreadsheet className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-500">{excelFile ? excelFile.name : 'Excel-Datei wählen oder hierher ziehen (.xlsx)'}</p>
                  <p className="text-xs text-slate-400 mt-1">Spaltenüberschriften müssen den Platzhaltern entsprechen</p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setExcelFile(e.target.files[0] || null)}
                />
              </label>
              {excelFile && (
                <button onClick={() => setExcelFile(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
                  <X className="w-3 h-3" /> Datei entfernen
                </button>
              )}
              <button
                onClick={fillBatch}
                disabled={loading || !excelFile}
                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Alle erstellen
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (result.outputPath || (result.files && result.files.length > 0)) && (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
            <p className="font-medium text-slate-700 text-sm">
              Fertig erstellt{result.count ? ` (${result.count} Dokument${result.count !== 1 ? 'e' : ''})` : ''}
            </p>
          </div>
          {result.files && result.files.length > 0 ? (
            <div className="space-y-2">
              {result.files.map((filePath, i) => {
                const filename = filePath.split('/').pop();
                return (
                  <button
                    key={i}
                    onClick={() => downloadFile(filePath)}
                    className="w-full py-2.5 px-3 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{filename}</span>
                    <Download className="w-4 h-4 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          ) : result.outputPath ? (
            <button
              onClick={() => downloadFile(result.outputPath)}
              className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Herunterladen
            </button>
          ) : null}
        </div>
      )}

      <style>{`
        .tiptap-editor-wrapper .ProseMirror { outline: none; min-height: 260px; }
        .tiptap-editor-wrapper h1 { font-size: 1.5rem; font-weight: 600; margin: 0.5em 0; }
        .tiptap-editor-wrapper h2 { font-size: 1.25rem; font-weight: 600; margin: 0.5em 0; }
        .tiptap-editor-wrapper h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5em 0; }
        .tiptap-editor-wrapper p { margin: 0.5em 0; line-height: 1.6; }
        .tiptap-editor-wrapper ul, .tiptap-editor-wrapper ol { padding-left: 1.5em; margin: 0.5em 0; }
        .tiptap-editor-wrapper blockquote { border-left: 3px solid #e2e8f0; padding-left: 1em; color: #64748b; margin: 0.5em 0; }
        .tiptap-editor-wrapper a { color: #1e3a8a; text-decoration: underline; }
        .tiptap-editor-wrapper img { max-width: 100%; height: auto; }
        .tiptap-editor-wrapper table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .tiptap-editor-wrapper table td, .tiptap-editor-wrapper table th {
          border: 1px solid #cbd5e1; padding: 0.5em 0.75em; position: relative; vertical-align: top;
        }
        .tiptap-editor-wrapper table th { background-color: #f1f5f9; font-weight: 600; text-align: left; }
        .tiptap-editor-wrapper .selectedCell { background-color: #dbeafe; }
        .tiptap-editor-wrapper .column-resize-handle {
          background-color: #1e3a8a; bottom: 0; position: absolute; right: -2px; top: 0; width: 4px; pointer-events: none;
        }
      `}</style>
    </div>
  );
}

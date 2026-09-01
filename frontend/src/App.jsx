import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Scissors, Image as ImageIcon, Download, X, Check, Loader2, Send, Sparkles, AlertCircle, RotateCw, Stamp, Lock, ArrowUp, ArrowDown, Tag, History, Bookmark, Trash2, ScanText, Table2, KeyRound, GitCompare, BookMarked, MoreHorizontal, PanelRightClose, PanelRightOpen, MessageSquareText, ShieldOff } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const CompressIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const MergeIconSVG = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

const categories = [
  {
    id: 'basics',
    label: 'Grundfunktionen',
    tabs: [
      { id: 'compress', icon: CompressIcon, label: 'Compress' },
      { id: 'merge', icon: MergeIconSVG, label: 'Merge' },
      { id: 'split', icon: Scissors, label: 'Split' },
      { id: 'convert', icon: ImageIcon, label: 'Convert' },
    ]
  },
  {
    id: 'edit',
    label: 'Bearbeiten',
    tabs: [
      { id: 'rotate', icon: RotateCw, label: 'Rotate' },
      { id: 'watermark', icon: Stamp, label: 'Watermark' },
      { id: 'password', icon: Lock, label: 'Password' },
      { id: 'metadata', icon: Tag, label: 'Metadata' },
    ]
  },
  {
    id: 'analyze',
    label: 'Analyse',
    tabs: [
      { id: 'ocr', icon: ScanText, label: 'OCR' },
      { id: 'summarize', icon: MessageSquareText, label: 'Zusammenfassung' },
      { id: 'extract-tables', icon: Table2, label: 'Tabellen' },
      { id: 'extract-keyvalues', icon: KeyRound, label: 'Kennwerte' },
      { id: 'compare', icon: GitCompare, label: 'Vergleich' },
      { id: 'extract-standards', icon: BookMarked, label: 'Normen' },
      { id: 'redact', icon: ShieldOff, label: 'Redaktion' },
    ]
  }
];

const tabs = categories.flatMap(c => c.tabs);

function findCategoryForTab(tabId) {
  const cat = categories.find(c => c.tabs.some(t => t.id === tabId));
  return cat ? cat.id : 'basics';
}

export default function App() {
  const [activeTab, setActiveTab] = useState('compress');
  const [activeCategory, setActiveCategory] = useState('basics');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [compressionLevel, setCompressionLevel] = useState('medium');
  const [splitMode, setSplitMode] = useState('every');
  const [pagesPerSplit, setPagesPerSplit] = useState(1);
  const [splitRanges, setSplitRanges] = useState('');
  const [rotateDegrees, setRotateDegrees] = useState(90);
  const [watermarkText, setWatermarkText] = useState('ENTWURF');
  const [convertDirection, setConvertDirection] = useState('toPDF');
  const [passwordMode, setPasswordMode] = useState('set');
  const [password, setPassword] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthor, setMetaAuthor] = useState('');
  const [metaSubject, setMetaSubject] = useState('');
  const [ocrLanguage, setOcrLanguage] = useState('deu+eng');
  const [compareFileB, setCompareFileB] = useState(null);
  const [extractionResult, setExtractionResult] = useState(null);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [extractionError, setExtractionError] = useState(null);
  const [generateReport, setGenerateReport] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [selectedBatchFiles, setSelectedBatchFiles] = useState({});
  const [redactUseAI, setRedactUseAI] = useState(true);
  const [redactCustomTerms, setRedactCustomTerms] = useState('');

  const SINGLE_FILE_TABS = ['compress', 'rotate', 'watermark', 'password', 'metadata', 'ocr', 'redact'];
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! Sag mir einfach, was ich mit deinen PDFs machen soll — auch mehrere Schritte in einem Satz, z.B. "füge zusammen und komprimiere dann stark". Lad dann noch deine Datei(en) hoch.' }
  ]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingSteps, setPendingSteps] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const pollRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/history`);
      const data = await res.json();
      setHistoryEntries(data);
    } catch (err) {
      setHistoryEntries([]);
    }
    setHistoryLoading(false);
  };

  const toggleHistory = () => {
    setShowHistory(prev => !prev);
    if (!showHistory) loadHistory();
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch(`${API_URL}/templates`);
      const data = await res.json();
      setTemplates(data);
    } catch (err) {
      setTemplates([]);
    }
  };

  const toggleTemplates = () => {
    setShowTemplates(prev => !prev);
    if (!showTemplates) loadTemplates();
  };

  const saveCurrentAsTemplate = async () => {
    if (!pendingSteps || !saveTemplateName.trim()) return;
    try {
      await fetch(`${API_URL}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveTemplateName, steps: pendingSteps })
      });
      setSaveTemplateName('');
      setShowSaveTemplate(false);
      setMessages(prev => [...prev, { role: 'assistant', text: `Vorlage "${saveTemplateName}" gespeichert. Du findest sie unter "Vorlagen".` }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Vorlage konnte nicht gespeichert werden.' }]);
    }
  };

  const deleteTemplate = async (id) => {
    try {
      await fetch(`${API_URL}/templates/${id}`, { method: 'DELETE' });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      // stumm fehlschlagen
    }
  };

  const useTemplate = (template) => {
    setPendingSteps(template.steps);
    setShowTemplates(false);
    setMessages(prev => [...prev, { role: 'assistant', text: `Vorlage "${template.name}" geladen: ${template.steps.map(s => s.action).join(' → ')}. Lad jetzt deine Datei(en) hoch.` }]);
  };

  const updateStepOption = (index, key, value) => {
    setPendingSteps(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], options: { ...updated[index].options, [key]: value } };
      return updated;
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleFileUpload = (e) => {
    const newFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index, direction) => {
    setFiles(prev => {
      const newFiles = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newFiles.length) return prev;
      [newFiles[index], newFiles[targetIndex]] = [newFiles[targetIndex], newFiles[index]];
      return newFiles;
    });
  };

  const addFiles = (fileList) => {
    const validExts = (activeTab === 'convert' && convertDirection === 'toPDF')
      ? ['.jpg', '.jpeg', '.png']
      : ['.pdf'];
    const newFiles = Array.from(fileList).filter(f =>
      validExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (newFiles.length === 0) return;
    setFiles(prev => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return;
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();

      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);

      if (data.steps && data.steps.length > 0) {
        if (data.steps.length === 1) {
          const step = data.steps[0];
          setActiveTab(step.action);
          setActiveCategory(findCategoryForTab(step.action));
          if (step.options?.level) setCompressionLevel(step.options.level);
          if (step.options?.degrees) setRotateDegrees(step.options.degrees);
          if (step.options?.text) setWatermarkText(step.options.text);
          if (step.options?.mode && step.action === 'password') setPasswordMode(step.options.mode);
          if (step.options?.direction) setConvertDirection(step.options.direction === 'toImages' ? 'toImages' : 'toPDF');
          if (step.options?.language) setOcrLanguage(step.options.language);
          setPendingSteps(null);
        } else {
          setPendingSteps(data.steps);
          setMessages(prev => [...prev, { role: 'assistant', text: `📋 Geplante Schritte: ${data.steps.map((s, i) => `${i + 1}. ${s.action}`).join(' → ')}. Lad jetzt deine Datei(en) hoch und klick "Workflow starten".` }]);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Verbindung zum Server fehlgeschlagen.' }]);
    }

    setChatLoading(false);
  };

  const pollJobStatus = (jobId) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/job/${jobId}`);
        const data = await res.json();

        if (data.status === 'completed') {
          clearInterval(pollRef.current);
          if (data.data?.multiOutput) {
            setResult({ success: true, files: data.data.files, steps: data.data.steps });
          } else {
            setResult({ success: true, ...data.data });
          }
          setProcessing(false);
          setPendingSteps(null);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          setError('Verarbeitung fehlgeschlagen. Bitte versuche es erneut.');
          setProcessing(false);
        }
      } catch (err) {
        clearInterval(pollRef.current);
        setError('Verbindung zum Server verloren.');
        setProcessing(false);
      }
    }, 1500);
  };

  const submitAndAwaitJob = (endpoint, formData) => {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(`${API_URL}${endpoint}`, { method: 'POST', body: formData });
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Verarbeitung fehlgeschlagen');
        }
        const jobData = await response.json();

        const interval = setInterval(async () => {
          try {
            const res = await fetch(`${API_URL}/job/${jobData.jobId}`);
            const data = await res.json();
            if (data.status === 'completed') {
              clearInterval(interval);
              resolve(data.data);
            } else if (data.status === 'failed') {
              clearInterval(interval);
              reject(new Error('Verarbeitung fehlgeschlagen'));
            }
          } catch (err) {
            clearInterval(interval);
            reject(err);
          }
        }, 1500);
      } catch (err) {
        reject(err);
      }
    });
  };

  const buildSingleFileFormData = (file) => {
    const formData = new FormData();
    let endpoint = '';

    if (activeTab === 'compress') {
      formData.append('file', file);
      formData.append('compressionLevel', compressionLevel);
      endpoint = '/compress';
    } else if (activeTab === 'rotate') {
      formData.append('file', file);
      formData.append('degrees', rotateDegrees);
      endpoint = '/rotate';
    } else if (activeTab === 'watermark') {
      formData.append('file', file);
      formData.append('text', watermarkText);
      endpoint = '/watermark';
    } else if (activeTab === 'password') {
      formData.append('file', file);
      formData.append('password', password);
      endpoint = passwordMode === 'set' ? '/set-password' : '/remove-password';
    } else if (activeTab === 'metadata') {
      formData.append('file', file);
      formData.append('title', metaTitle);
      formData.append('author', metaAuthor);
      formData.append('subject', metaSubject);
      endpoint = '/metadata';
    } else if (activeTab === 'ocr') {
      formData.append('file', file);
      formData.append('language', ocrLanguage);
      endpoint = '/ocr';
    } else if (activeTab === 'redact') {
      formData.append('file', file);
      formData.append('useAI', redactUseAI ? 'true' : 'false');
      const terms = redactCustomTerms.split(',').map(t => t.trim()).filter(Boolean);
      formData.append('customTerms', JSON.stringify(terms));
      endpoint = '/redact';
    }

    return { formData, endpoint };
  };

  const processBatch = async () => {
    if (files.length < 2) return;
    if (activeTab === 'password' && !password.trim()) {
      setError('Bitte ein Passwort eingeben.');
      return;
    }

    setBatchProcessing(true);
    setBatchResults(null);
    setError(null);
    setBatchProgress({ current: 0, total: files.length });

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBatchProgress({ current: i + 1, total: files.length });
      try {
        const { formData, endpoint } = buildSingleFileFormData(file);
        const data = await submitAndAwaitJob(endpoint, formData);
        results.push({ filename: file.name, success: true, data });
      } catch (err) {
        results.push({ filename: file.name, success: false, error: err.message });
      }
    }

    setBatchResults(results);
    setBatchProcessing(false);

    const initialSelection = {};
    results.forEach((r, i) => {
      if (r.success) initialSelection[i] = true;
    });
    setSelectedBatchFiles(initialSelection);
  };

  const toggleBatchFileSelection = (index) => {
    setSelectedBatchFiles(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const downloadSelectedBatchFiles = () => {
    if (!batchResults) return;
    const selected = batchResults
      .map((r, i) => ({ ...r, index: i }))
      .filter(r => r.success && selectedBatchFiles[r.index]);
    selected.forEach((r, idx) => {
      setTimeout(() => downloadFile(r.data.outputPath, buildDownloadName(r.filename, TAB_SUFFIX[activeTab])), idx * 350);
    });
  };

  const processWorkflow = async () => {
    if (files.length === 0 || !pendingSteps) return;
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      formData.append('steps', JSON.stringify(pendingSteps));

      const needsPassword = pendingSteps.some(s => s.action === 'password');
      if (needsPassword) {
        if (!password.trim()) {
          setError('Für den Passwort-Schritt wird ein Passwort benötigt (im Workflow-Schritt eingeben).');
          setProcessing(false);
          return;
        }
        formData.append('password', password);
      }

      const response = await fetch(`${API_URL}/workflow`, { method: 'POST', body: formData });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Workflow fehlgeschlagen');
      }

      const data = await response.json();
      pollJobStatus(data.jobId);
    } catch (err) {
      setError(err.message || 'Ein Fehler ist aufgetreten');
      setProcessing(false);
    }
  };

  const cancelWorkflow = () => {
    setPendingSteps(null);
    setFiles([]);
    setResult(null);
    setError(null);
  };

  const processExtraction = async () => {
    if (activeTab === 'compare') {
      if (files.length === 0 || !compareFileB) return;
    } else if (files.length === 0) {
      return;
    }

    setExtractionLoading(true);
    setExtractionError(null);
    setExtractionResult(null);

    try {
      let endpoint = '';
      const formData = new FormData();

      if (activeTab === 'extract-tables') {
        files.forEach(f => formData.append('files', f));
        endpoint = '/extract-tables';
      } else if (activeTab === 'extract-keyvalues') {
        files.forEach(f => formData.append('files', f));
        formData.append('generateReport', generateReport ? 'true' : 'false');
        endpoint = '/extract-keyvalues';
      } else if (activeTab === 'extract-standards') {
        files.forEach(f => formData.append('files', f));
        formData.append('generateReport', generateReport ? 'true' : 'false');
        endpoint = '/extract-standards';
      } else if (activeTab === 'compare') {
        formData.append('fileA', files[0]);
        formData.append('fileB', compareFileB);
        formData.append('generateReport', generateReport ? 'true' : 'false');
        endpoint = '/compare';
      } else if (activeTab === 'summarize') {
        formData.append('file', files[0]);
        endpoint = '/summarize';
      }

      const response = await fetch(`${API_URL}${endpoint}`, { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Extraktion fehlgeschlagen');
      }

      setExtractionResult(data);
    } catch (err) {
      setExtractionError(err.message || 'Ein Fehler ist aufgetreten');
    }

    setExtractionLoading(false);
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      let endpoint = '';

      if (activeTab === 'compress') {
        formData.append('file', files[0]);
        formData.append('compressionLevel', compressionLevel);
        endpoint = '/compress';
      } else if (activeTab === 'merge') {
        files.forEach(f => formData.append('files', f));
        endpoint = '/merge';
      } else if (activeTab === 'split') {
        formData.append('file', files[0]);
        formData.append('mode', splitMode);
        formData.append('pagesPerSplit', pagesPerSplit);
        formData.append('ranges', splitRanges);
        endpoint = '/split';
      } else if (activeTab === 'convert') {
        if (convertDirection === 'toPDF') {
          files.forEach(f => formData.append('files', f));
          formData.append('conversionType', 'imagesToPDF');
          endpoint = '/convert';
        } else {
          formData.append('file', files[0]);
          formData.append('format', 'jpeg');
          endpoint = '/pdf-to-images';
        }
      } else if (activeTab === 'rotate') {
        formData.append('file', files[0]);
        formData.append('degrees', rotateDegrees);
        endpoint = '/rotate';
      } else if (activeTab === 'watermark') {
        formData.append('file', files[0]);
        formData.append('text', watermarkText);
        endpoint = '/watermark';
      } else if (activeTab === 'password') {
        formData.append('file', files[0]);
        formData.append('password', password);
        endpoint = passwordMode === 'set' ? '/set-password' : '/remove-password';
      } else if (activeTab === 'metadata') {
        formData.append('file', files[0]);
        formData.append('title', metaTitle);
        formData.append('author', metaAuthor);
        formData.append('subject', metaSubject);
        endpoint = '/metadata';
      } else if (activeTab === 'ocr') {
        formData.append('file', files[0]);
        formData.append('language', ocrLanguage);
        endpoint = '/ocr';
      } else if (activeTab === 'redact') {
        formData.append('file', files[0]);
        formData.append('useAI', redactUseAI ? 'true' : 'false');
        const terms = redactCustomTerms.split(',').map(t => t.trim()).filter(Boolean);
        formData.append('customTerms', JSON.stringify(terms));
        endpoint = '/redact';
      }

      const response = await fetch(`${API_URL}${endpoint}`, { method: 'POST', body: formData });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Upload fehlgeschlagen');
      }

      const data = await response.json();
      pollJobStatus(data.jobId);
    } catch (err) {
      setError(err.message || 'Ein Fehler ist aufgetreten');
      setProcessing(false);
    }
  };

  const TAB_SUFFIX = {
    compress: 'komprimiert',
    rotate: 'gedreht',
    watermark: 'wasserzeichen',
    password: 'geschuetzt',
    metadata: 'metadaten',
    ocr: 'ocr',
    redact: 'redigiert',
    'extract-keyvalues': 'kennwerte_bericht',
    'extract-standards': 'normen_bericht',
    'extract-tables': 'tabellen'
  };

  const buildDownloadName = (originalName, suffix, ext) => {
    const base = (originalName || 'datei').replace(/\.pdf$/i, '');
    return `${base}${suffix ? '_' + suffix : ''}.${ext || 'pdf'}`;
  };

  const downloadFile = async (path, suggestedName) => {
    const targetPath = path || result?.outputPath;
    if (!targetPath) return;
    const serverFilename = targetPath.split('/').pop();
    const url = `${API_URL}/download/${serverFilename}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download fehlgeschlagen');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = suggestedName || serverFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError('Download fehlgeschlagen. Bitte erneut versuchen.');
    }
  };

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setActiveCategory(findCategoryForTab(tabId));
    setFiles([]);
    setResult(null);
    setError(null);
    setCompareFileB(null);
    setExtractionResult(null);
    setExtractionError(null);
    setBatchResults(null);
    setSelectedBatchFiles({});
  };

  const switchCategory = (catId) => {
    setActiveCategory(catId);
    const firstTab = categories.find(c => c.id === catId).tabs[0].id;
    switchTab(firstTab);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex h-screen">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-8">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center shadow-sm">
                  <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" fill="none">
                    <path d="M6 2h8l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="white" fillOpacity="0.95" />
                    <path d="M14 2v5h5" fill="none" stroke="#1e3a8a" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M8.5 13l2.3 2.3L15.5 10.5" stroke="#1e3a8a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-base font-semibold text-slate-900 leading-tight">PDF Studio</h1>
                </div>
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(prev => !prev)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                >
                  <MoreHorizontal className="w-4.5 h-4.5" />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-10 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-20">
                    <button
                      onClick={() => { toggleTemplates(); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Bookmark className="w-4 h-4" />
                      Vorlagen
                    </button>
                    <button
                      onClick={() => { toggleHistory(); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <History className="w-4 h-4" />
                      Verlauf
                    </button>
                  </div>
                )}
              </div>
            </div>

            {showTemplates && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Gespeicherte Vorlagen</p>
                {templates.length === 0 ? (
                  <p className="text-sm text-slate-400">Noch keine Vorlagen gespeichert. Plane einen mehrstufigen Chat-Workflow und speichere ihn.</p>
                ) : (
                  <div className="space-y-2">
                    {templates.map(t => (
                      <div key={t.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{t.name}</p>
                          <p className="text-xs text-slate-400">{t.steps.map(s => s.action).join(' → ')}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => useTemplate(t)} className="px-2.5 py-1 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950">
                            Nutzen
                          </button>
                          <button onClick={() => deleteTemplate(t.id)} className="p-1.5 hover:bg-slate-200 rounded-md">
                            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showHistory && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Letzte Verarbeitungen</p>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Lädt...</div>
                ) : historyEntries.length === 0 ? (
                  <p className="text-sm text-slate-400">Noch keine Verarbeitungen im Verlauf.</p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {historyEntries.map(entry => (
                      <div key={entry.id + entry.timestamp} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-xs">
                        <div className="min-w-0">
                          <p className="text-slate-700 truncate">{entry.summary}</p>
                          <p className="text-slate-400">{new Date(entry.timestamp).toLocaleString('de-DE')}</p>
                        </div>
                        {entry.outputPath && (
                          <button
                            onClick={() => downloadFile(entry.outputPath)}
                            className="p-1.5 hover:bg-slate-200 rounded-md flex-shrink-0"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-500" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1 mb-3">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => switchCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeCategory === cat.id ? 'bg-blue-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-5 mb-6 border-b border-slate-200 flex-wrap">
              {categories.find(c => c.id === activeCategory).tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`flex items-center gap-1.5 pb-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      isActive ? 'text-slate-900 border-blue-900' : 'text-slate-400 border-transparent hover:text-slate-600'
                    }`}
                  >
                    <Icon />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'compare' ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Version A (alt)</label>
                  <label className="block cursor-pointer">
                    <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                      <Upload className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
                      <p className="text-xs text-slate-500 truncate">{files[0] ? files[0].name : 'PDF wählen'}</p>
                    </div>
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFiles(e.target.files[0] ? [e.target.files[0]] : [])} />
                  </label>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Version B (neu)</label>
                  <label className="block cursor-pointer">
                    <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-slate-400 hover:bg-slate-50 transition-all">
                      <Upload className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
                      <p className="text-xs text-slate-500 truncate">{compareFileB ? compareFileB.name : 'PDF wählen'}</p>
                    </div>
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setCompareFileB(e.target.files[0] || null)} />
                  </label>
                </div>
              </div>
            ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
              <label
                className="block cursor-pointer group"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className={`border-2 border-dashed rounded-lg p-9 text-center transition-all duration-200 ${
                  isDragging ? 'border-slate-500 bg-slate-100' : 'border-slate-200 group-hover:border-slate-400 group-hover:bg-slate-50'
                }`}>
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-blue-900 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-white" />
                  </div>
                  <p className="font-medium text-slate-700 text-sm mb-1">
                    {isDragging ? 'Datei hier loslassen' : 'Datei hierher ziehen oder klicken'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {activeTab === 'convert'
                      ? (convertDirection === 'toPDF' ? 'JPEG/PNG Dateien' : 'PDF-Datei')
                      : 'PDF-Dateien'} • Max 50MB
                  </p>
                </div>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  multiple={activeTab === 'merge' || (activeTab === 'convert' && convertDirection === 'toPDF') || ['extract-tables', 'extract-keyvalues', 'extract-standards', ...SINGLE_FILE_TABS].includes(activeTab)}
                  accept={activeTab === 'convert' ? (convertDirection === 'toPDF' ? '.jpg,.jpeg,.png' : '.pdf') : '.pdf'}
                  className="hidden"
                />
              </label>
            </div>
            )}

            {['extract-keyvalues', 'extract-standards', 'compare'].includes(activeTab) && (
              <label className="flex items-center gap-2.5 mb-4 bg-white border border-slate-200 rounded-xl p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generateReport}
                  onChange={(e) => setGenerateReport(e.target.checked)}
                  className="w-4 h-4 accent-blue-900"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700">Zusätzlich PDF-Bericht erstellen</p>
                  <p className="text-xs text-slate-400">Formatiertes PDF, das anschließend weiterverarbeitet werden kann (z.B. mit Passwort schützen)</p>
                </div>
              </label>
            )}

            {(['extract-tables', 'extract-keyvalues', 'extract-standards', 'compare', 'summarize'].includes(activeTab)) && (
              <>
                <button
                  onClick={processExtraction}
                  disabled={extractionLoading || (activeTab === 'compare' ? (files.length === 0 || !compareFileB) : files.length === 0)}
                  className="w-full py-3 rounded-lg font-medium text-sm text-white bg-blue-900 hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mb-4"
                >
                  {extractionLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Wird analysiert...</>
                  ) : (
                    <><Check className="w-4 h-4" />Analysieren</>
                  )}
                </button>

                {extractionError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 mb-4">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-700">{extractionError}</p>
                  </div>
                )}

                {extractionResult && activeTab === 'summarize' && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <p className="text-xs text-slate-400 mb-3">{extractionResult.documentType}</p>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">{extractionResult.summary}</p>
                    {extractionResult.keyPoints && extractionResult.keyPoints.length > 0 && (
                      <div className="space-y-1.5">
                        {extractionResult.keyPoints.map((point, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-900 mt-1.5 flex-shrink-0" />
                            <p className="text-xs text-slate-600">{point}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {extractionResult && activeTab === 'extract-keyvalues' && (
                  <div className="space-y-3">
                    {extractionResult.results.map((r, ri) => (
                      <div key={ri} className="bg-white border border-slate-200 rounded-xl p-5">
                        <p className="text-sm font-medium text-slate-700 mb-1 truncate">{r.filename}</p>
                        {r.error ? (
                          <p className="text-xs text-red-600">{r.error}</p>
                        ) : (
                          <>
                            <p className="text-xs text-slate-400 mb-3">{r.documentType}</p>
                            {r.fields.length === 0 ? (
                              <p className="text-sm text-slate-400">Keine Kennwerte gefunden.</p>
                            ) : (
                              <div className="space-y-1.5 mb-4">
                                {r.fields.map((f, i) => (
                                  <div key={i} className="flex justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
                                    <span className="text-xs text-slate-500 flex-shrink-0">{f.key}</span>
                                    <span className="text-xs font-medium text-slate-700 text-right">{f.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {r.outputPath && (
                              <button
                                onClick={() => downloadFile(r.outputPath, buildDownloadName(r.filename, 'kennwerte_bericht'))}
                                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2"
                              >
                                <Download className="w-4 h-4" />
                                PDF-Bericht herunterladen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {extractionResult && activeTab === 'extract-standards' && (
                  <div className="space-y-3">
                    {extractionResult.results.map((r, ri) => (
                      <div key={ri} className="bg-white border border-slate-200 rounded-xl p-5">
                        <p className="text-sm font-medium text-slate-700 mb-3 truncate">{r.filename}</p>
                        {r.error ? (
                          <p className="text-xs text-red-600">{r.error}</p>
                        ) : (
                          <>
                            {r.standards.length === 0 ? (
                              <p className="text-sm text-slate-400 mb-4">Keine Normen-Referenzen gefunden.</p>
                            ) : (
                              <div className="space-y-2 mb-4">
                                {r.standards.map((s, i) => (
                                  <div key={i} className="bg-slate-50 rounded-lg p-3">
                                    <p className="text-xs font-semibold text-slate-700 mb-1">{s.reference}</p>
                                    <p className="text-xs text-slate-500">{s.context}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {r.outputPath && (
                              <button
                                onClick={() => downloadFile(r.outputPath, buildDownloadName(r.filename, 'normen_bericht'))}
                                className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2"
                              >
                                <Download className="w-4 h-4" />
                                PDF-Bericht herunterladen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {extractionResult && activeTab === 'extract-tables' && (
                  <div className="space-y-3">
                    {extractionResult.results.map((r, ri) => (
                      <div key={ri} className="bg-white border border-slate-200 rounded-xl p-5">
                        <p className="text-sm font-medium text-slate-700 mb-1 truncate">{r.filename}</p>
                        {r.error ? (
                          <p className="text-xs text-red-600">{r.error}</p>
                        ) : (
                          <>
                            <p className="text-sm text-slate-500 mb-3">{r.tableCount} Tabelle(n) gefunden</p>
                            <button
                              onClick={() => downloadFile(r.outputPath, buildDownloadName(r.filename, 'tabellen', 'xlsx'))}
                              className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2"
                            >
                              <Download className="w-4 h-4" />
                              Als Excel herunterladen
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {extractionResult && activeTab === 'compare' && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="flex gap-3 mb-4 text-xs">
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-medium">+{extractionResult.addedCount} hinzugefügt</span>
                      <span className="px-2.5 py-1 bg-red-50 text-red-700 rounded-md font-medium">−{extractionResult.removedCount} entfernt</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-4 leading-relaxed">{extractionResult.summary}</p>
                    <div className="max-h-64 overflow-y-auto bg-slate-50 rounded-lg p-3 text-xs leading-relaxed mb-4">
                      {extractionResult.segments.map((seg, i) => (
                        <span
                          key={i}
                          className={
                            seg.type === 'added' ? 'bg-emerald-100 text-emerald-800' :
                            seg.type === 'removed' ? 'bg-red-100 text-red-800 line-through' :
                            'text-slate-500'
                          }
                        >
                          {seg.value}
                        </span>
                      ))}
                    </div>
                    {extractionResult.outputPath && (
                      <button
                        onClick={() => downloadFile(extractionResult.outputPath, 'vergleichsbericht.pdf')}
                        className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        PDF-Bericht herunterladen
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {files.length > 0 && activeTab !== 'compare' && (
              <div className="space-y-2 mb-4">
                {files.length > 1 && (
                  <p className="text-xs text-slate-400 mb-1">Reihenfolge per Pfeil anpassen — so werden sie zusammengeführt</p>
                )}
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                        <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {files.length > 1 && (
                        <>
                          <button
                            onClick={() => moveFile(i, -1)}
                            disabled={i === 0}
                            className="p-1.5 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowUp className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                          <button
                            onClick={() => moveFile(i, 1)}
                            disabled={i === files.length - 1}
                            className="p-1.5 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </>
                      )}
                      <button onClick={() => removeFile(i)} className="p-1.5 hover:bg-slate-100 rounded-md transition-colors">
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'compress' && files.length > 0 && (
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Kompressionsstufe</label>
                <div className="grid grid-cols-4 gap-2">
                  {['low', 'medium', 'high', 'maximum'].map(level => (
                    <button
                      key={level}
                      onClick={() => setCompressionLevel(level)}
                      className={`py-2.5 rounded-lg text-xs font-medium capitalize transition-colors border ${
                        compressionLevel === level ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'split' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Was möchtest du erhalten?</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setSplitMode('every')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      splitMode === 'every' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Alle X Seiten
                  </button>
                  <button
                    onClick={() => setSplitMode('ranges')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      splitMode === 'ranges' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Bestimmte Seiten
                  </button>
                </div>

                {splitMode === 'every' ? (
                  <div>
                    <label className="text-xs text-slate-500 mb-1.5 block">Seiten pro Datei</label>
                    <input
                      type="number"
                      min="1"
                      value={pagesPerSplit}
                      onChange={(e) => setPagesPerSplit(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">z.B. "1" = jede Seite einzeln, "2" = je 2 Seiten zusammen</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-slate-500 mb-1.5 block">Seitenbereiche</label>
                    <input
                      type="text"
                      value={splitRanges}
                      onChange={(e) => setSplitRanges(e.target.value)}
                      placeholder="z.B. 1-3,5,8-10"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Kommagetrennt, Bereiche mit Bindestrich</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'convert' && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Richtung</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setConvertDirection('toPDF'); setFiles([]); }}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      convertDirection === 'toPDF' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Bilder → PDF
                  </button>
                  <button
                    onClick={() => { setConvertDirection('toImages'); setFiles([]); }}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      convertDirection === 'toImages' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    PDF → Bilder
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'rotate' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Drehwinkel</label>
                <div className="grid grid-cols-3 gap-2">
                  {[90, 180, 270].map(deg => (
                    <button
                      key={deg}
                      onClick={() => setRotateDegrees(deg)}
                      className={`py-2.5 rounded-lg text-xs font-medium transition-colors border flex items-center justify-center gap-1.5 ${
                        rotateDegrees === deg ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'watermark' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Wasserzeichen-Text</label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="z.B. ENTWURF, VERTRAULICH"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />
                <p className="text-xs text-slate-400 mt-1.5">Wird diagonal über alle Seiten gelegt</p>
              </div>
            )}

            {activeTab === 'password' && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Aktion</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setPasswordMode('set')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      passwordMode === 'set' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Passwort setzen
                  </button>
                  <button
                    onClick={() => setPasswordMode('remove')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      passwordMode === 'remove' ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Passwort entfernen
                  </button>
                </div>
                <label className="text-xs text-slate-500 mb-1.5 block">
                  {passwordMode === 'set' ? 'Neues Passwort' : 'Aktuelles Passwort'}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Passwort eingeben"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            )}

            {activeTab === 'metadata' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Titel</label>
                  <input
                    type="text"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder="z.B. Jahresbericht 2026"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Autor</label>
                  <input
                    type="text"
                    value={metaAuthor}
                    onChange={(e) => setMetaAuthor(e.target.value)}
                    placeholder="z.B. Max Mustermann"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1.5 block">Betreff</label>
                  <input
                    type="text"
                    value={metaSubject}
                    onChange={(e) => setMetaSubject(e.target.value)}
                    placeholder="z.B. Quartalszahlen"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
              </div>
            )}

            {activeTab === 'ocr' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Sprache im Dokument</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'deu+eng', label: 'DE + EN' },
                    { value: 'deu', label: 'Deutsch' },
                    { value: 'eng', label: 'English' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setOcrLanguage(opt.value)}
                      className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                        ocrLanguage === opt.value ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">Macht gescannte PDFs durchsuchbar und kopierbar. Kann bei vielen Seiten etwas dauern.</p>
              </div>
            )}

            {activeTab === 'redact' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="flex items-center gap-2.5 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={redactUseAI}
                    onChange={(e) => setRedactUseAI(e.target.checked)}
                    className="w-4 h-4 accent-blue-900"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-700">KI-Erkennung nutzen</p>
                    <p className="text-xs text-slate-400">Findet automatisch Namen und Adressen im Dokument</p>
                  </div>
                </label>
                <label className="text-xs text-slate-500 mb-1.5 block">Eigene Suchbegriffe (kommagetrennt)</label>
                <input
                  type="text"
                  value={redactCustomTerms}
                  onChange={(e) => setRedactCustomTerms(e.target.value)}
                  placeholder="z.B. Projektname X, Firma Y"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
                <p className="text-xs text-slate-400 mt-2">IBANs, E-Mails und Telefonnummern werden immer automatisch erkannt. Das Ergebnis-PDF ist bildbasiert — Text ist danach wirklich entfernt, nicht nur überdeckt.</p>
              </div>
            )}

            {pendingSteps && (
              <div className="mb-4 bg-blue-900 text-white rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Geplanter Workflow</p>
                  <button
                    onClick={() => setShowSaveTemplate(prev => !prev)}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    <Bookmark className="w-3 h-3" />
                    Als Vorlage speichern
                  </button>
                </div>
                <div className="space-y-2 mb-1">
                  {pendingSteps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 bg-white/10 rounded-md text-xs font-medium capitalize flex-shrink-0">{i + 1}. {s.action}</span>

                      {s.action === 'compress' && (
                        <select
                          value={s.options?.level || 'medium'}
                          onChange={(e) => updateStepOption(i, 'level', e.target.value)}
                          className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                        >
                          <option className="text-slate-900" value="low">Low</option>
                          <option className="text-slate-900" value="medium">Medium</option>
                          <option className="text-slate-900" value="high">High</option>
                          <option className="text-slate-900" value="maximum">Maximum</option>
                        </select>
                      )}

                      {s.action === 'rotate' && (
                        <select
                          value={s.options?.degrees || 90}
                          onChange={(e) => updateStepOption(i, 'degrees', parseInt(e.target.value))}
                          className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                        >
                          <option className="text-slate-900" value={90}>90°</option>
                          <option className="text-slate-900" value={180}>180°</option>
                          <option className="text-slate-900" value={270}>270°</option>
                        </select>
                      )}

                      {s.action === 'watermark' && (
                        <input
                          type="text"
                          value={s.options?.text || ''}
                          onChange={(e) => updateStepOption(i, 'text', e.target.value)}
                          placeholder="Wasserzeichen-Text"
                          className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none placeholder-slate-500 w-36"
                        />
                      )}

                      {s.action === 'password' && (
                        <>
                          <select
                            value={s.options?.mode || 'set'}
                            onChange={(e) => updateStepOption(i, 'mode', e.target.value)}
                            className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                          >
                            <option className="text-slate-900" value="set">Setzen</option>
                            <option className="text-slate-900" value="remove">Entfernen</option>
                          </select>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Passwort"
                            className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none placeholder-slate-500 w-28"
                          />
                        </>
                      )}

                      {s.action === 'convert' && (
                        <select
                          value={s.options?.direction || 'toPDF'}
                          onChange={(e) => updateStepOption(i, 'direction', e.target.value)}
                          className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                        >
                          <option className="text-slate-900" value="toPDF">Bilder → PDF</option>
                          <option className="text-slate-900" value="toImages">PDF → Bilder</option>
                        </select>
                      )}

                      {s.action === 'split' && (
                        <>
                          <select
                            value={s.options?.mode || 'every'}
                            onChange={(e) => updateStepOption(i, 'mode', e.target.value)}
                            className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                          >
                            <option className="text-slate-900" value="every">Alle X Seiten</option>
                            <option className="text-slate-900" value="ranges">Bestimmte Seiten</option>
                          </select>
                          {(s.options?.mode || 'every') === 'every' ? (
                            <input
                              type="number"
                              min="1"
                              value={s.options?.pagesPerSplit || 1}
                              onChange={(e) => updateStepOption(i, 'pagesPerSplit', parseInt(e.target.value))}
                              className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none w-16"
                            />
                          ) : (
                            <input
                              type="text"
                              value={s.options?.ranges || ''}
                              onChange={(e) => updateStepOption(i, 'ranges', e.target.value)}
                              placeholder="1-3,5"
                              className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none placeholder-slate-500 w-24"
                            />
                          )}
                        </>
                      )}

                      {s.action === 'metadata' && (
                        <>
                          <input
                            type="text"
                            value={s.options?.title || ''}
                            onChange={(e) => updateStepOption(i, 'title', e.target.value)}
                            placeholder="Titel"
                            className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none placeholder-slate-500 w-28"
                          />
                          <input
                            type="text"
                            value={s.options?.author || ''}
                            onChange={(e) => updateStepOption(i, 'author', e.target.value)}
                            placeholder="Autor"
                            className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none placeholder-slate-500 w-28"
                          />
                        </>
                      )}

                      {s.action === 'ocr' && (
                        <select
                          value={s.options?.language || 'deu+eng'}
                          onChange={(e) => updateStepOption(i, 'language', e.target.value)}
                          className="bg-white/10 text-white text-xs rounded-md px-2 py-1 outline-none border-none"
                        >
                          <option className="text-slate-900" value="deu+eng">DE + EN</option>
                          <option className="text-slate-900" value="deu">Deutsch</option>
                          <option className="text-slate-900" value="eng">English</option>
                        </select>
                      )}

                      {i < pendingSteps.length - 1 && <span className="text-slate-500 text-xs">→</span>}
                    </div>
                  ))}
                </div>
                {showSaveTemplate && (
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={saveTemplateName}
                      onChange={(e) => setSaveTemplateName(e.target.value)}
                      placeholder="Name der Vorlage"
                      className="flex-1 px-2.5 py-1.5 bg-white/10 rounded-md text-xs outline-none placeholder-slate-500 focus:ring-1 focus:ring-white/30"
                    />
                    <button
                      onClick={saveCurrentAsTemplate}
                      disabled={!saveTemplateName.trim()}
                      className="px-3 py-1.5 bg-white text-slate-900 rounded-md text-xs font-medium disabled:opacity-40"
                    >
                      Speichern
                    </button>
                  </div>
                )}
              </div>
            )}

            {files.length > 1 && SINGLE_FILE_TABS.includes(activeTab) && !pendingSteps && (
              <>
                <button
                  onClick={processBatch}
                  disabled={batchProcessing || (activeTab === 'password' && !password.trim())}
                  className="w-full py-3 rounded-lg font-medium text-sm text-white bg-blue-900 hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mb-4"
                >
                  {batchProcessing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Datei {batchProgress.current} von {batchProgress.total}...</>
                  ) : (
                    <><Check className="w-4 h-4" />Alle {files.length} Dateien verarbeiten</>
                  )}
                </button>

                {batchResults && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-slate-500">
                        {Object.values(selectedBatchFiles).filter(Boolean).length} von {batchResults.filter(r => r.success).length} ausgewählt
                      </p>
                      <button
                        onClick={downloadSelectedBatchFiles}
                        disabled={Object.values(selectedBatchFiles).filter(Boolean).length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-md text-xs font-medium hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Ausgewählte herunterladen
                      </button>
                    </div>
                    <div className="space-y-2">
                      {batchResults.map((r, i) => (
                        <label
                          key={i}
                          className={`flex items-center gap-3 bg-white border rounded-lg p-3.5 transition-colors ${
                            r.success ? 'cursor-pointer border-slate-200 hover:border-slate-300' : 'border-red-100'
                          }`}
                        >
                          {r.success ? (
                            <input
                              type="checkbox"
                              checked={!!selectedBatchFiles[i]}
                              onChange={() => toggleBatchFileSelection(i)}
                              className="w-4 h-4 accent-blue-900 flex-shrink-0"
                            />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-700 truncate">{r.filename}</p>
                            {!r.success && <p className="text-xs text-red-600">{r.error}</p>}
                            {r.success && (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {activeTab === 'compress' && r.data.savings !== undefined && (
                                  r.data.savings > 0 ? (
                                    <>
                                      <span className="text-xs text-slate-400">{formatFileSize(r.data.originalSize)} → {formatFileSize(r.data.compressedSize)}</span>
                                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">−{r.data.savings}%</span>
                                    </>
                                  ) : (
                                    <span className="text-xs text-amber-600">keine Einsparung möglich</span>
                                  )
                                )}
                                {activeTab === 'rotate' && (
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{r.data.degrees}° gedreht</span>
                                )}
                                {activeTab === 'watermark' && (
                                  <span className="text-xs font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">"{r.data.text}"</span>
                                )}
                                {activeTab === 'password' && (
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${r.data.protected ? 'text-emerald-600 bg-emerald-50' : 'text-slate-600 bg-slate-100'}`}>
                                    {r.data.protected ? 'Passwort gesetzt' : 'Passwort entfernt'}
                                  </span>
                                )}
                                {activeTab === 'metadata' && (
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Metadaten aktualisiert</span>
                                )}
                                {activeTab === 'ocr' && (
                                  <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Texterkennung angewendet</span>
                                )}
                                {activeTab === 'redact' && (
                                  <span className="text-xs font-medium text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded">{r.data.redactionCount} Stelle{r.data.redactionCount !== 1 ? 'n' : ''} geschwärzt</span>
                                )}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {files.length > 0 && !['extract-tables', 'extract-keyvalues', 'extract-standards', 'compare', 'summarize'].includes(activeTab) && !(files.length > 1 && SINGLE_FILE_TABS.includes(activeTab) && !pendingSteps) && (
              <button
                onClick={pendingSteps ? processWorkflow : processFiles}
                disabled={processing || (activeTab === 'merge' && !pendingSteps && files.length < 2) || (activeTab === 'password' && !pendingSteps && !password.trim())}
                className="w-full py-3 rounded-lg font-medium text-sm text-white bg-blue-900 hover:bg-blue-950 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mb-2"
              >
                {processing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Wird verarbeitet...</>
                ) : pendingSteps ? (
                  <><Check className="w-4 h-4" />Workflow starten ({pendingSteps.length} Schritte)</>
                ) : (
                  <><Check className="w-4 h-4" />Datei verarbeiten</>
                )}
              </button>
            )}

            {pendingSteps && !processing && (
              <button
                onClick={cancelWorkflow}
                className="w-full py-2 rounded-lg font-medium text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors mb-4"
              >
                Workflow abbrechen
              </button>
            )}

            {activeTab === 'merge' && !pendingSteps && files.length === 1 && (
              <p className="text-xs text-amber-600 mb-4 text-center">Mindestens 2 Dateien nötig zum Zusammenführen</p>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 mb-4">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {result?.success && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                  <p className="font-medium text-slate-700 text-sm">Fertig verarbeitet</p>
                </div>

                {result.steps && result.steps.length > 1 && (
                  <div className="space-y-2 mb-4">
                    {result.steps.map((step, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs">
                        <span className="font-medium text-slate-700 capitalize">{i + 1}. {step.action}</span>
                        <span className="text-slate-500">
                          {step.action === 'compress' && step.savings !== undefined && (
                            step.savings > 0
                              ? `${formatFileSize(step.originalSize)} → ${formatFileSize(step.compressedSize)} (−${step.savings}%)`
                              : 'keine Einsparung möglich'
                          )}
                          {step.action === 'merge' && `${step.fileCount} Dateien → ${step.pageCount} Seiten`}
                          {step.action === 'rotate' && `${step.degrees}° gedreht`}
                          {step.action === 'watermark' && `Text: "${step.text}"`}
                          {step.action === 'password' && (step.protected ? 'geschützt' : 'entschützt')}
                          {step.action === 'convert' && `${step.pageCount || step.imageCount} Seiten`}
                          {step.action === 'ocr' && 'Texterkennung angewendet'}
                          {step.action === 'metadata' && 'Metadaten aktualisiert'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {result.originalSize && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Original</p>
                      <p className="text-sm font-medium text-slate-700">{formatFileSize(result.originalSize)}</p>
                    </div>
                  )}
                  {result.compressedSize && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Neu</p>
                      <p className="text-sm font-medium text-slate-700">{formatFileSize(result.compressedSize)}</p>
                    </div>
                  )}
                  {result.savings !== undefined && result.savings > 0 && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Gespart</p>
                      <p className="text-sm font-medium text-emerald-600">{result.savings}%</p>
                    </div>
                  )}
                  {(result.pageCount || result.totalPages) && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Seiten</p>
                      <p className="text-sm font-medium text-slate-700">{result.pageCount || result.totalPages}</p>
                    </div>
                  )}
                  {result.redactionCount !== undefined && (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Geschwärzt</p>
                      <p className="text-sm font-medium text-blue-900">{result.redactionCount} Stelle{result.redactionCount !== 1 ? 'n' : ''}</p>
                    </div>
                  )}
                </div>

                {result.foundTerms && result.foundTerms.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {result.foundTerms.map((term, i) => (
                      <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">{term}</span>
                    ))}
                  </div>
                )}

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
                ) : (
                  <button onClick={() => downloadFile(null, buildDownloadName(files[0]?.name, TAB_SUFFIX[activeTab]))} className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-950 transition-colors flex items-center justify-center gap-2">
                    <Download className="w-4 h-4" />
                    Herunterladen
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {chatCollapsed ? (
          <div className="w-14 border-l border-slate-200 bg-white flex flex-col items-center pt-4">
            <button
              onClick={() => setChatCollapsed(false)}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <PanelRightOpen className="w-4.5 h-4.5" />
            </button>
          </div>
        ) : (
        <div className="w-96 border-l border-slate-200 bg-white flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <h2 className="font-medium text-sm text-slate-700">Assistent</h2>
            </div>
            <button
              onClick={() => setChatCollapsed(true)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user' ? 'bg-blue-900 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 border-t border-slate-200 bg-white">
            <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-slate-300 transition-all">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Was möchtest du tun?"
                className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400 text-slate-700"
              />
              <button onClick={sendMessage} className="w-7 h-7 rounded-md bg-blue-900 flex items-center justify-center flex-shrink-0 hover:bg-blue-950 transition-colors">
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

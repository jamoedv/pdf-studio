import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Scissors, Image as ImageIcon, Download, X, Check, Loader2, Send, Sparkles, AlertCircle, RotateCw, Stamp, Lock } from 'lucide-react';

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

const tabs = [
  { id: 'compress', icon: CompressIcon, label: 'Compress' },
  { id: 'merge', icon: MergeIconSVG, label: 'Merge' },
  { id: 'split', icon: Scissors, label: 'Split' },
  { id: 'convert', icon: ImageIcon, label: 'Convert' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate' },
  { id: 'watermark', icon: Stamp, label: 'Watermark' },
  { id: 'password', icon: Lock, label: 'Password' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('compress');
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
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! Sag mir einfach, was ich mit deinen PDFs machen soll — z.B. "komprimiere das stark" oder "füge alles zusammen". Lad dann noch deine Datei(en) hoch.' }
  ]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const pollRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleFileUpload = (e) => {
    const newFiles = Array.from(e.target.files);
    setFiles(prev => activeTab === 'merge' || activeTab === 'convert' ? [...prev, ...newFiles] : newFiles);
    setResult(null);
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addFiles = (fileList) => {
    const validExts = activeTab === 'convert' ? ['.jpg', '.jpeg', '.png'] : ['.pdf'];
    const newFiles = Array.from(fileList).filter(f =>
      validExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (newFiles.length === 0) return;
    setFiles(prev => activeTab === 'merge' || activeTab === 'convert' ? [...prev, ...newFiles] : newFiles);
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

      if (data.action && data.action !== 'unclear') {
        setActiveTab(data.action);
        if (data.options?.level) setCompressionLevel(data.options.level);
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
          setResult({ success: true, ...data.data });
          setProcessing(false);
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

  const downloadFile = (path) => {
    const targetPath = path || result?.outputPath;
    if (!targetPath) return;
    const filename = targetPath.split('/').pop();
    window.open(`${API_URL}/download/${filename}`, '_blank');
  };

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setFiles([]);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex h-screen">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-8">
            <div className="mb-8 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900 leading-tight">PDF Studio</h1>
                <p className="text-xs text-slate-500">Dokumente bearbeiten, lokal verarbeitet</p>
              </div>
            </div>

            <div className="flex gap-1 mb-5 p-1 bg-slate-100 rounded-lg border border-slate-200">
              {tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all ${
                      isActive ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon />
                    {tab.label}
                  </button>
                );
              })}
            </div>

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
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-slate-900 flex items-center justify-center">
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
                  multiple={activeTab === 'merge' || (activeTab === 'convert' && convertDirection === 'toPDF')}
                  accept={activeTab === 'convert' ? (convertDirection === 'toPDF' ? '.jpg,.jpeg,.png' : '.pdf') : '.pdf'}
                  className="hidden"
                />
              </label>
            </div>

            {files.length > 0 && (
              <div className="space-y-2 mb-4">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{file.name}</p>
                        <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <button onClick={() => removeFile(i)} className="p-1.5 hover:bg-slate-100 rounded-md transition-colors">
                      <X className="w-4 h-4 text-slate-400" />
                    </button>
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
                        compressionLevel === level ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
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
                      splitMode === 'every' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Alle X Seiten
                  </button>
                  <button
                    onClick={() => setSplitMode('ranges')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      splitMode === 'ranges' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
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

            {activeTab === 'rotate' && files.length > 0 && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Drehwinkel</label>
                <div className="grid grid-cols-3 gap-2">
                  {[90, 180, 270].map(deg => (
                    <button
                      key={deg}
                      onClick={() => setRotateDegrees(deg)}
                      className={`py-2.5 rounded-lg text-xs font-medium transition-colors border flex items-center justify-center gap-1.5 ${
                        rotateDegrees === deg ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
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

            {activeTab === 'convert' && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Richtung</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setConvertDirection('toPDF'); setFiles([]); }}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      convertDirection === 'toPDF' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Bilder → PDF
                  </button>
                  <button
                    onClick={() => { setConvertDirection('toImages'); setFiles([]); }}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      convertDirection === 'toImages' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    PDF → Bilder
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'password' && (
              <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Aktion</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setPasswordMode('set')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      passwordMode === 'set' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    Passwort setzen
                  </button>
                  <button
                    onClick={() => setPasswordMode('remove')}
                    className={`py-2.5 rounded-lg text-xs font-medium transition-colors border ${
                      passwordMode === 'remove' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
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

            {files.length > 0 && (
              <button
                onClick={processFiles}
                disabled={processing || (activeTab === 'merge' && files.length < 2) || (activeTab === 'password' && !password.trim())}
                className="w-full py-3 rounded-lg font-medium text-sm text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mb-4"
              >
                {processing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Wird verarbeitet...</>
                ) : (
                  <><Check className="w-4 h-4" />Datei verarbeiten</>
                )}
              </button>
            )}

            {activeTab === 'merge' && files.length === 1 && (
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
                </div>

                {result.files && result.files.length > 0 ? (
                  <div className="space-y-2">
                    {result.files.map((filePath, i) => {
                      const filename = filePath.split('/').pop();
                      return (
                        <button
                          key={i}
                          onClick={() => downloadFile(filePath)}
                          className="w-full py-2.5 px-3 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{filename}</span>
                          <Download className="w-4 h-4 flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button onClick={() => downloadFile()} className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2">
                    <Download className="w-4 h-4" />
                    Herunterladen
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="w-96 border-l border-slate-200 bg-white flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <h2 className="font-medium text-sm text-slate-700">Assistent</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user' ? 'bg-slate-900 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
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
              <button onClick={sendMessage} className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center flex-shrink-0 hover:bg-slate-800 transition-colors">
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

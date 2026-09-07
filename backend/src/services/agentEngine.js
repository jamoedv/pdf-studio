const anthropicClient = require('./anthropicClient');
const assistantTools = require('./assistantToolsService');
const workflowStorage = require('./workflowStorageService');
const templateStorage = require('./templateStorageService');

const OUTPUT_DIR = process.env.PROCESSED_DIR || 'processed';

const ALLOWED_MODELS = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
};
const DEFAULT_MODEL = 'claude-sonnet-4-5';

const TOOLS = [
  {
    name: 'compress_pdf',
    description: 'Komprimiert ein PDF, um die Dateigröße zu reduzieren.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        level: { type: 'string', enum: ['low', 'medium', 'high', 'maximum'], description: 'Standard: medium' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'merge_pdfs',
    description: 'Fügt mehrere hochgeladene PDFs zu einem einzigen Dokument zusammen, in der angegebenen Reihenfolge.',
    input_schema: {
      type: 'object',
      properties: { fileIds: { type: 'array', items: { type: 'string' } } },
      required: ['fileIds'],
    },
  },
  {
    name: 'split_pdf',
    description: 'Teilt ein PDF in mehrere Dateien auf — entweder jede Seite einzeln, alle N Seiten, oder nach angegebenen Seitenbereichen.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        mode: { type: 'string', enum: ['every', 'ranges'] },
        pagesPerSplit: { type: 'integer', description: 'Bei mode=every: Anzahl Seiten pro Teil (Standard 1)' },
        ranges: { type: 'string', description: 'Bei mode=ranges: z.B. "1-3,5,7-9"' },
      },
      required: ['fileId', 'mode'],
    },
  },
  {
    name: 'rotate_pdf',
    description: 'Dreht alle Seiten eines PDFs um den angegebenen Winkel.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        degrees: { type: 'integer', enum: [90, 180, 270] },
      },
      required: ['fileId', 'degrees'],
    },
  },
  {
    name: 'add_watermark',
    description: 'Fügt einem PDF ein Text-Wasserzeichen auf jeder Seite hinzu.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['fileId', 'text'],
    },
  },
  {
    name: 'set_password',
    description: 'Schützt ein PDF mit einem Passwort.',
    input_schema: {
      type: 'object',
      properties: { fileId: { type: 'string' }, password: { type: 'string' } },
      required: ['fileId', 'password'],
    },
  },
  {
    name: 'remove_password',
    description: 'Entfernt den Passwortschutz eines PDFs (Passwort muss bekannt sein).',
    input_schema: {
      type: 'object',
      properties: { fileId: { type: 'string' }, password: { type: 'string' } },
      required: ['fileId', 'password'],
    },
  },
  {
    name: 'set_metadata',
    description: 'Setzt Titel, Autor und/oder Betreff in den PDF-Metadaten.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        title: { type: 'string' },
        author: { type: 'string' },
        subject: { type: 'string' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'ocr_pdf',
    description: 'Wendet Texterkennung (OCR) auf ein gescanntes PDF an, damit es durchsuchbaren Text bekommt.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        language: { type: 'string', enum: ['deu', 'eng', 'deu+eng'], description: 'Standard: deu+eng' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'convert_pdf_to_images',
    description: 'Konvertiert jede Seite eines PDFs in ein einzelnes Bild.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        format: { type: 'string', enum: ['jpeg', 'png'] },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'convert_images_to_pdf',
    description: 'Fügt mehrere hochgeladene Bilder zu einem PDF zusammen (eine Seite pro Bild).',
    input_schema: {
      type: 'object',
      properties: { fileIds: { type: 'array', items: { type: 'string' } } },
      required: ['fileIds'],
    },
  },
  {
    name: 'analyze_document',
    description: 'Liest ein hochgeladenes Dokument (auch gescannt/handschriftlich, per Bilderkennung) und beantwortet eine frei formulierte Anweisung dazu. Formuliere die Anweisung präzise, inkl. gewünschtem Antwortformat (z.B. "antworte als JSON mit den Feldern ...").',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Die fileId des zu analysierenden Dokuments' },
        instruction: { type: 'string', description: 'Was aus dem Dokument extrahiert/beantwortet werden soll' },
      },
      required: ['fileId', 'instruction'],
    },
  },
  {
    name: 'compare_documents',
    description: 'Vergleicht zwei hochgeladene Dokumente anhand einer Anweisung.',
    input_schema: {
      type: 'object',
      properties: {
        fileIdA: { type: 'string' },
        fileIdB: { type: 'string' },
        instruction: { type: 'string' },
      },
      required: ['fileIdA', 'fileIdB', 'instruction'],
    },
  },
  {
    name: 'fill_template',
    description: 'Füllt eine HTML-Vorlage mit Werten und erzeugt PDF(s). Entweder templateId (aus der Vorlagen-Bibliothek) ODER html angeben. values ist immer ein Array von Objekten — ein Eintrag = ein PDF.',
    input_schema: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        html: { type: 'string' },
        values: { type: 'array', items: { type: 'object' } },
      },
      required: ['values'],
    },
  },
  {
    name: 'generate_pdf',
    description: 'Rendert beliebiges HTML zu genau einem PDF (ohne Platzhalter-Logik, z.B. für einen zusammenfassenden Bericht).',
    input_schema: {
      type: 'object',
      properties: { html: { type: 'string' } },
      required: ['html'],
    },
  },
  {
    name: 'export_excel',
    description: 'Erstellt eine Excel-Datei aus einer Liste von Datensätzen (jede Zeile = ein Objekt mit Spaltennamen als Keys).',
    input_schema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
        sheetName: { type: 'string' },
      },
      required: ['rows'],
    },
  },
  {
    name: 'save_template',
    description: 'Speichert eine HTML-Vorlage (mit {{Platzhaltern}}) in der Vorlagen-Bibliothek, damit sie im Vorlagen-Editor und für fill_template wiederverwendbar ist. Nutze dies, wenn der Nutzer eine erzeugte/angepasste Vorlage speichern möchte.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name der Vorlage' },
        html: { type: 'string', description: 'Der HTML-Inhalt der Vorlage inkl. {{Platzhalter}}' },
      },
      required: ['name', 'html'],
    },
  },
  {
    name: 'list_templates',
    description: 'Listet alle gespeicherten Vorlagen aus der Bibliothek auf (Name, id). Nutze dies, um eine bestehende Vorlage als Ausgangspunkt zu finden oder mit fill_template zu verwenden.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_template',
    description: 'Lädt den HTML-Inhalt einer gespeicherten Vorlage anhand ihrer id.',
    input_schema: {
      type: 'object',
      properties: { templateId: { type: 'string' } },
      required: ['templateId'],
    },
  },
  {
    name: 'save_workflow',
    description: 'Speichert die gerade erfolgreich durchgeführte Vorgehensweise als wiederverwendbaren Workflow, damit der Nutzer sie später mit neuen Dateien erneut ausführen kann, ohne alles neu zu erklären. Rufe dies auf, wenn der Nutzer sagt, dass er das speichern/wiederverwenden möchte, oder von selbst vorschlagen, wenn eine mehrstufige Aufgabe erfolgreich war. Gib IMMER eine "steps"-Liste an, damit der Ablauf später in der Bibliothek grafisch dargestellt werden kann.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Kurzer, wiedererkennbarer Name' },
        description: { type: 'string', description: 'Was der Workflow tut, in 1-2 Sätzen' },
        steps: {
          type: 'array',
          description: 'Die einzelnen Schritte des Ablaufs in Ausführungsreihenfolge, für eine grafische Anzeige in der Bibliothek.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Kurzer Titel des Schritts, z.B. "Musterlösung lesen"' },
              description: { type: 'string', description: 'Ein kurzer Satz, was in diesem Schritt passiert' },
            },
            required: ['title'],
          },
        },
        config: { type: 'object', description: 'Alle Parameter, die nötig sind, um den Workflow später exakt zu wiederholen (z.B. Bewertungsschema, templateId, Excel-Spalten, verwendete Anweisungen)' },
      },
      required: ['name', 'description', 'config', 'steps'],
    },
  },
  {
    name: 'list_workflows',
    description: 'Listet alle gespeicherten Workflows auf (Name + Beschreibung). Prüfe das zu Beginn eines Gesprächs, falls die Nutzeranfrage einem bekannten, wiederkehrenden Ablauf ähneln könnte.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_workflow',
    description: 'Lädt die gespeicherte Konfiguration eines Workflows anhand seiner ID, um ihn mit neuen Dateien erneut auszuführen.',
    input_schema: {
      type: 'object',
      properties: { workflowId: { type: 'string' } },
      required: ['workflowId'],
    },
  },
];

const SYSTEM_PROMPT = `Du bist der KI-Assistent eines PDF-Verarbeitungsportals. Nutzer beschreiben in freier Sprache mehrstufige Aufgaben mit hochgeladenen Dokumenten (z.B. "vergleiche diese Verträge", "bewerte diese Klausuren anhand der Musterlösung und mach mir eine Excel-Übersicht", "fülle diese Vorlage mit Werten aus diesen 10 Dokumenten").

Du hast Werkzeuge für klassische PDF-Operationen (komprimieren, zusammenfügen, aufteilen, drehen, Wasserzeichen, Passwort setzen/entfernen, Metadaten, OCR, PDF↔Bild-Konvertierung) UND für KI-gestützte Aufgaben: Dokumente lesen (auch handschriftlich/gescannt), vergleichen, Vorlagen befüllen, PDFs/Excel-Dateien erzeugen, und erfolgreiche Abläufe als wiederverwendbare Workflows/Vorlagen speichern/laden.

Vorgehen:
1. Prüfe bei mehrstufigen/wiederkehrenden Aufgaben zuerst mit list_workflows, ob es dafür schon einen gespeicherten Workflow gibt. Falls ja und die Anfrage dazu passt, lade ihn mit get_workflow. Führe DANACH die "steps" des Workflows GENAU in der gespeicherten Reihenfolge aus — überspringe keinen Schritt, ersetze keinen Schritt durch ein anderes Werkzeug, und füge keine zusätzlichen Schritte hinzu, die nicht im Workflow stehen. Wenn ein Schritt z.B. "PDF drehen" heißt, rufe rotate_pdf auf — nicht split_pdf oder ein anderes Werkzeug. Nutze "config" für die konkreten Parameter jedes Schritts (z.B. Gradzahl, Wasserzeichen-Text). Bei Unklarheit, was ein Schritt konkret bedeutet, frage lieber kurz nach, statt zu raten.
2. Führe die nötigen Schritte mit den Werkzeugen aus. Bei vielen Dateien (z.B. 10-20 Prüfungsbögen): rufe analyze_document für jede Datei einzeln auf. WICHTIG: Jedes Datei-erzeugende Werkzeug gibt im Ergebnis eine "fileId" (oder "fileIds") zurück — das ist die neu erzeugte Datei. Wenn eine Aufgabe mehrere Schritte auf demselben Dokument erfordert (z.B. "erzeuge ein PDF und drehe es dann"), übergib diese zurückgegebene fileId direkt an den nächsten Werkzeug-Aufruf, statt den Nutzer zu bitten, die Datei erneut hochzuladen.
3. Wenn eine Aufgabe aus mehreren Schritten bestand und generalisierbar ist (z.B. "Klausuren nach Schema X bewerten"), schlage dem Nutzer vor, sie als Workflow zu speichern, oder speichere sie wenn er das explizit möchte — lege dabei alle nötigen Parameter (Bewertungsschema, Anweisungstexte, ggf. templateId) in "config" ab. Wenn der Nutzer eine erzeugte oder angepasste HTML-Vorlage (mit Platzhaltern) dauerhaft speichern möchte, nutze save_template statt sie nur im Chat zu zeigen.
4. Fasse das Ergebnis am Ende klar und knapp zusammen (auf Deutsch). Erwähne erzeugte Dateien nicht mit vollem Pfad — das Frontend zeigt Download-Buttons automatisch an.

Sei bei Unsicherheiten (z.B. schwer lesbare Handschrift) transparent und weise den Nutzer darauf hin, statt zu raten.`;

async function executeTool(name, input, outputFiles) {
  switch (name) {
    case 'compress_pdf': {
      const out = await assistantTools.compressPdf(input.fileId, input.level, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'PDF komprimiert - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'merge_pdfs': {
      const out = await assistantTools.mergePdfs(input.fileIds, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'PDFs zusammengefügt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'split_pdf': {
      const options = { mode: input.mode, pagesPerSplit: input.pagesPerSplit, ranges: input.ranges };
      const files = await assistantTools.splitPdf(input.fileId, options, OUTPUT_DIR);
      outputFiles.push(...files);
      return { fileIds: files, count: files.length, message: `In ${files.length} Teile aufgeteilt - fileIds können für weitere Schritte verwendet werden` };
    }

    case 'rotate_pdf': {
      const out = await assistantTools.rotatePdf(input.fileId, input.degrees, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: `Um ${input.degrees}° gedreht - fileId kann für weitere Schritte verwendet werden` };
    }

    case 'add_watermark': {
      const out = await assistantTools.addWatermark(input.fileId, input.text, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'Wasserzeichen hinzugefügt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'set_password': {
      const out = await assistantTools.setPassword(input.fileId, input.password, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'Mit Passwort geschützt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'remove_password': {
      const out = await assistantTools.removePassword(input.fileId, input.password, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'Passwortschutz entfernt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'set_metadata': {
      const out = await assistantTools.setMetadata(input.fileId, { title: input.title, author: input.author, subject: input.subject }, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'Metadaten gesetzt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'ocr_pdf': {
      const out = await assistantTools.ocrPdf(input.fileId, input.language, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'OCR angewendet - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'convert_pdf_to_images': {
      const files = await assistantTools.convertPdfToImages(input.fileId, input.format, OUTPUT_DIR);
      outputFiles.push(...files);
      return { fileIds: files, count: files.length, message: `${files.length} Bild(er) erzeugt - fileIds können für weitere Schritte verwendet werden` };
    }

    case 'convert_images_to_pdf': {
      const out = await assistantTools.convertImagesToPdf(input.fileIds, OUTPUT_DIR);
      outputFiles.push(out);
      return { fileId: out, message: 'Bilder zu PDF zusammengefügt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'analyze_document':
      return await assistantTools.analyzeDocument(input.fileId, input.instruction);

    case 'compare_documents':
      return await assistantTools.compareDocuments(input.fileIdA, input.fileIdB, input.instruction);

    case 'fill_template': {
      const result = await assistantTools.fillTemplate(input, OUTPUT_DIR);
      outputFiles.push(...result.outputFiles);
      return { fileIds: result.outputFiles, count: result.count, message: `${result.count} PDF(s) erzeugt - fileIds können für weitere Schritte verwendet werden` };
    }

    case 'generate_pdf': {
      const result = await assistantTools.generatePdf(input.html, OUTPUT_DIR);
      outputFiles.push(result.outputPath);
      return { fileId: result.outputPath, message: 'PDF erzeugt - fileId kann für weitere Schritte verwendet werden' };
    }

    case 'export_excel': {
      const result = await assistantTools.exportExcel(input.rows, input.sheetName, OUTPUT_DIR);
      outputFiles.push(result.outputPath);
      return { fileId: result.outputPath, message: 'Excel-Datei erzeugt' };
    }

    case 'save_template': {
      const record = templateStorage.saveTemplate(input.name, input.html);
      return { id: record.id, message: `Vorlage "${input.name}" in der Bibliothek gespeichert` };
    }

    case 'list_templates':
      return { templates: templateStorage.listTemplates() };

    case 'get_template': {
      const record = templateStorage.getTemplate(input.templateId);
      if (!record) return { error: 'Vorlage nicht gefunden' };
      return record;
    }

    case 'save_workflow': {
      const record = workflowStorage.saveWorkflow(input.name, input.description, input.config, input.steps || []);
      return { id: record.id, message: `Workflow "${input.name}" gespeichert` };
    }

    case 'list_workflows':
      return { workflows: workflowStorage.listWorkflows() };

    case 'get_workflow': {
      const record = workflowStorage.getWorkflow(input.workflowId);
      if (!record) return { error: 'Workflow nicht gefunden' };
      return record;
    }

    default:
      return { error: `Unbekanntes Werkzeug: ${name}` };
  }
}

function sanitizeHistory(history) {
  if (!history || history.length === 0) return [];
  const messages = [...history];
  const last = messages[messages.length - 1];

  if (last && last.role === 'assistant' && Array.isArray(last.content)) {
    const toolUseBlocks = last.content.filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      messages.push({
        role: 'user',
        content: toolUseBlocks.map((b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: JSON.stringify({ note: 'Nicht ausgeführt - vorherige Anfrage wurde abgebrochen.' }),
        })),
      });
    }
  }

  return messages;
}

// Zentrale Agenten-Schleife, gemeinsam genutzt vom Web-Assistenten (routes/assistant.js)
// und dem Teams-Bot (routes/teams-bot.js) - identische Werkzeuge, identisches Verhalten,
// egal über welchen Kanal der Nutzer damit spricht.
// extraTools/extraExecutor erlauben kanalspezifische Zusatz-Werkzeuge (z.B. OneDrive-Zugriff
// nur im Teams-Bot, über dessen eigenes OAuth), ohne die Werkzeugliste des Web-Portals zu ändern.
async function runAgentLoop({ history, message, fileIds, model, extraTools = [], extraExecutor = null }) {
  const resolvedModel = ALLOWED_MODELS[model] || ALLOWED_MODELS[DEFAULT_MODEL];
  const allTools = extraTools.length > 0 ? [...TOOLS, ...extraTools] : TOOLS;

  let userContent = message;
  if (fileIds && fileIds.length > 0) {
    const fileList = fileIds.map((f) => `- ${f.filename} (fileId: "${f.fileId}")`).join('\n');
    userContent = `Neu hochgeladene Dateien:\n${fileList}\n\n${message}`;
  }

  let messages = [...sanitizeHistory(history), { role: 'user', content: userContent }];
  const outputFiles = [];
  let finalText = '';
  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropicClient.createMessage({
      model: resolvedModel,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: allTools,
      cache_control: { type: 'ephemeral' },
      messages,
    }, 'assistant-chat');

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      break;
    }

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let resultContent;
      try {
        // Kanalspezifische Zusatz-Werkzeuge zuerst prüfen, sonst normale Engine-Werkzeuge.
        const isExtraTool = extraExecutor && extraTools.some((t) => t.name === block.name);
        resultContent = isExtraTool
          ? await extraExecutor(block.name, block.input)
          : await executeTool(block.name, block.input, outputFiles);
      } catch (err) {
        console.error(`Werkzeug-Fehler (${block.name}):`, err.message);
        resultContent = { error: err.message };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(resultContent),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!finalText) {
    finalText = 'Ich benötige noch weitere Schritte, um das abzuschließen — bitte formuliere die Anfrage ggf. genauer.';
  }

  return { reply: finalText, history: messages, outputFiles, model: resolvedModel };
}

module.exports = { runAgentLoop, TOOLS, SYSTEM_PROMPT, ALLOWED_MODELS, DEFAULT_MODEL };

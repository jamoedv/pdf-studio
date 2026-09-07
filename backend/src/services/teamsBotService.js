const {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  ActivityHandler,
  MessageFactory,
} = require('botbuilder');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const agentEngine = require('./agentEngine');
const conversationStore = require('./teamsConversationStore');
const { runWithUser } = require('./anthropicClient');
const { createDownloadToken } = require('./teamsDownloadService');
const botGraphAuth = require('./botGraphAuth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// WICHTIG: Adapter/Credentials werden bewusst NICHT beim Laden dieses Moduls
// erzeugt, sondern erst beim ersten tatsächlichen Bot-Aufruf (siehe getAdapter()).
// Andernfalls würde der GESAMTE Server beim Start abstürzen, sobald die
// TEAMS_BOT_*-Umgebungsvariablen fehlen - auch wenn der Bot noch gar nicht
// genutzt werden soll.
let _adapter = null;
let _initError = null;

function getAdapter() {
  if (_adapter) return _adapter;
  if (_initError) throw _initError;

  if (!process.env.TEAMS_BOT_APP_ID || !process.env.TEAMS_BOT_APP_PASSWORD) {
    _initError = new Error('Teams-Bot ist nicht konfiguriert (TEAMS_BOT_APP_ID/TEAMS_BOT_APP_PASSWORD fehlen).');
    throw _initError;
  }

  try {
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: process.env.TEAMS_BOT_APP_ID,
      MicrosoftAppPassword: process.env.TEAMS_BOT_APP_PASSWORD,
      // "MultiTenant" wurde von Microsoft für NEUE Bot-Registrierungen zum 31.07.2025
      // abgeschafft - "SingleTenant" ist jetzt der Standardfall und braucht zwingend
      // die Tenant-ID der Azure-Bot-Ressource (siehe TEAMS_BOT_APP_TENANT_ID in .env).
      MicrosoftAppType: process.env.TEAMS_BOT_APP_TYPE || 'SingleTenant',
      MicrosoftAppTenantId: process.env.TEAMS_BOT_APP_TENANT_ID,
    });

    const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
    _adapter = new CloudAdapter(botFrameworkAuthentication);
    _adapter.onTurnError = async (context, error) => {
      console.error('Teams-Bot Fehler:', error);
      await context.sendActivity('Entschuldigung, da ist etwas schiefgelaufen. Bitte versuch es nochmal.');
    };
    return _adapter;
  } catch (err) {
    _initError = err;
    throw err;
  }
}

// Lädt eine von einem Nutzer direkt im Teams-Chat angehängte Datei lokal herunter,
// damit sie wie ein normaler Upload in die Agenten-Werkzeuge eingespeist werden kann.
async function downloadTeamsAttachment(attachment) {
  const downloadUrl = attachment.content?.downloadUrl || attachment.contentUrl;
  if (!downloadUrl) return null;

  const res = await fetch(downloadUrl);
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  const safeName = (attachment.name || attachment.content?.fileName || 'datei.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
  fs.writeFileSync(destPath, buffer);
  return { fileId: destPath, filename: attachment.name || safeName };
}

// Zusätzliche Werkzeuge, NUR im Teams-Bot verfügbar (nicht im Web-Portal, das seine
// eigene OneDrive-Anbindung über eine UI-Komponente hat, nicht über den Agenten).
const ONEDRIVE_TOOLS = [
  {
    name: 'onedrive_list_files',
    description: 'Listet Dateien/Ordner im OneDrive des Teams-Nutzers auf. Ohne folderId wird das Wurzelverzeichnis gezeigt.',
    input_schema: {
      type: 'object',
      properties: { folderId: { type: 'string', description: 'Optional: id eines Unterordners aus einem vorherigen Aufruf' } },
    },
  },
  {
    name: 'onedrive_import_file',
    description: 'Lädt eine Datei aus dem OneDrive des Nutzers herunter und macht sie als fileId für weitere Werkzeuge verfügbar.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'id der Datei aus onedrive_list_files' },
        filename: { type: 'string' },
      },
      required: ['itemId', 'filename'],
    },
  },
  {
    name: 'sharepoint_list_sites',
    description: 'Listet die SharePoint-Seiten auf, auf die der Nutzer Zugriff hat.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'sharepoint_browse',
    description: 'Durchsucht eine SharePoint-Seite. Ohne driveId werden erst die Dokumentbibliotheken der Seite gezeigt (eine Seite kann mehrere haben); mit driveId (und optional folderId) werden Dateien/Ordner darin gezeigt.',
    input_schema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'id aus sharepoint_list_sites' },
        driveId: { type: 'string', description: 'Optional: id einer Dokumentbibliothek aus einem vorherigen Aufruf' },
        folderId: { type: 'string', description: 'Optional: id eines Unterordners' },
      },
      required: ['siteId'],
    },
  },
  {
    name: 'sharepoint_import_file',
    description: 'Lädt eine Datei aus SharePoint herunter und macht sie als fileId für weitere Werkzeuge verfügbar.',
    input_schema: {
      type: 'object',
      properties: {
        driveId: { type: 'string' },
        itemId: { type: 'string' },
        filename: { type: 'string' },
      },
      required: ['driveId', 'itemId', 'filename'],
    },
  },
  {
    name: 'onedrive_export_file',
    description: 'Lädt eine zuvor erzeugte/bearbeitete Datei (fileId aus einem anderen Werkzeug-Ergebnis) ins OneDrive des Nutzers hoch. Ohne folderId landet sie im Wurzelverzeichnis. Funktioniert nur für Dateien bis 4 MB.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Serverpfad aus einem vorherigen Werkzeug-Ergebnis' },
        filename: { type: 'string', description: 'Gewünschter Dateiname in OneDrive' },
        folderId: { type: 'string', description: 'Optional: Ziel-Ordner-id aus onedrive_list_files' },
      },
      required: ['fileId', 'filename'],
    },
  },
  {
    name: 'sharepoint_export_file',
    description: 'Lädt eine zuvor erzeugte/bearbeitete Datei (fileId aus einem anderen Werkzeug-Ergebnis) in eine SharePoint-Dokumentbibliothek hoch. Funktioniert nur für Dateien bis 4 MB.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Serverpfad aus einem vorherigen Werkzeug-Ergebnis' },
        filename: { type: 'string', description: 'Gewünschter Dateiname in SharePoint' },
        driveId: { type: 'string', description: 'id der Dokumentbibliothek aus sharepoint_browse' },
        folderId: { type: 'string', description: 'Optional: Ziel-Unterordner-id' },
      },
      required: ['fileId', 'filename', 'driveId'],
    },
  },
];

// Führt die OneDrive-Werkzeuge aus - prüft zuerst, ob der Nutzer bereits verbunden
// ist. Falls nicht, bekommt er einen normalen Anmelde-Link (denselben OAuth-Flow
// wie im Web-Portal) statt einer Bot-Framework-eigenen Anmelde-Karte.
const ONEDRIVE_SYSTEM_PROMPT_ADDENDUM = `Du hast zusätzlich Zugriff auf das OneDrive und SharePoint des Nutzers (onedrive_list_files, onedrive_import_file, onedrive_export_file, sharepoint_list_sites, sharepoint_browse, sharepoint_import_file, sharepoint_export_file). Wichtig für den Umgang damit:
- Wenn der Nutzer unspezifisch nach Dateien fragt (z.B. "zeig mir meine Dateien", "ich will was von OneDrive/SharePoint bearbeiten", ohne exakten Dateinamen) oder mehrere Dateien bearbeiten möchte: rufe zuerst das passende Lese-Werkzeug auf und zeige die Ergebnisse als nummerierte, gut lesbare Liste (Name + ob Ordner/Bibliothek). Der Nutzer kann dann per Namen oder Nummer antworten.
- Bei SharePoint: erst sharepoint_list_sites, dann sharepoint_browse mit der gewählten siteId (ohne driveId zeigt das die Dokumentbibliotheken der Seite, meist gibt es nur "Documents" - danach mit der driveId erneut aufrufen für den Inhalt).
- Merke dir aus einer gezeigten Liste, welche Nummer zu welcher itemId/driveId/siteId gehört, damit du bei "importier Nummer 3" die richtigen IDs verwendest, ohne erneut zu fragen.
- Für mehrere Dateien auf einmal: rufe das jeweilige Import-Werkzeug für jede gewünschte Datei einzeln auf, dann verarbeite sie wie gewünscht.
- Wenn ein Lese-Werkzeug einen Ordner zurückgibt (isFolder), kannst du mit folderId erneut aufrufen, um hineinzuschauen.
- Wenn der Nutzer möchte, dass ein Ergebnis (z.B. nach compress_pdf, rotate_pdf etc.) zurück nach OneDrive/SharePoint gespeichert wird, statt es nur als Download-Link zu bekommen: nutze die fileId aus dem vorherigen Werkzeug-Ergebnis direkt für onedrive_export_file/sharepoint_export_file. Weise darauf hin, dass das aktuell nur für Dateien bis 4 MB funktioniert.`;

function makeOneDriveExecutor(username) {
  return async (name, input) => {
    if (!botGraphAuth.isConnected(username)) {
      const link = botGraphAuth.getConnectLink(username);
      return {
        error: 'not_connected',
        message: `Der Nutzer ist noch nicht mit Microsoft verbunden. Schick ihm GENAU diesen Satz als Antwort (den Link unverändert übernehmen): "Verbinde zuerst dein Microsoft-Konto, dann wiederhole deine Anfrage: ${link}"`,
      };
    }

    const token = await botGraphAuth.getValidToken(username);

    if (name === 'onedrive_list_files') {
      const items = await botGraphAuth.listOneDriveRoot(username, input.folderId);
      return { items };
    }

    if (name === 'onedrive_import_file') {
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
      await botGraphAuth.downloadOneDriveFile(username, input.itemId, destPath);
      return { fileId: destPath, filename: input.filename };
    }

    if (name === 'sharepoint_list_sites') {
      const sites = await botGraphAuth.listSharePointSites(username);
      return { sites };
    }

    if (name === 'sharepoint_browse') {
      const items = await botGraphAuth.listSharePointFolder(username, input.siteId, input.folderId, input.driveId);
      return { items };
    }

    if (name === 'sharepoint_import_file') {
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
      await botGraphAuth.downloadSharePointFile(username, input.driveId, input.itemId, destPath);
      return { fileId: destPath, filename: input.filename };
    }

    if (name === 'onedrive_export_file') {
      const result = await botGraphAuth.uploadToOneDrive(username, input.filename, input.folderId, input.fileId);
      return { success: true, webUrl: result.webUrl, message: `"${input.filename}" wurde in OneDrive gespeichert.` };
    }

    if (name === 'sharepoint_export_file') {
      const result = await botGraphAuth.uploadToSharePoint(username, input.driveId, input.filename, input.folderId, input.fileId);
      return { success: true, webUrl: result.webUrl, message: `"${input.filename}" wurde in SharePoint gespeichert.` };
    }

    return { error: `Unbekanntes Werkzeug: ${name}` };
  };
}

class PdfStudioTeamsBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const conversationId = context.activity.conversation.id;
      // Teams-Identität als Pseudo-Nutzername fürs Tracking (kein Konten-Abgleich
      // mit dem Portal-Login in dieser ersten Phase - siehe Hinweis in der Doku).
      const teamsUser = botGraphAuth.teamsUsername(context);

      const rawText = (context.activity.text || '').trim();
      const resetMatch = rawText.match(/^\/(neu|reset|new)\b\s*(.*)$/i);
      let effectiveText = rawText;

      if (resetMatch) {
        conversationStore.clearHistory(conversationId);
        effectiveText = resetMatch[2].trim();
        if (!effectiveText) {
          await context.sendActivity('✅ Verlauf zurückgesetzt — ich starte frisch, ohne den bisherigen Gesprächskontext.');
          return next();
        }
        await context.sendActivity('✅ Verlauf zurückgesetzt, bearbeite jetzt deine Anfrage...');
      }

      await context.sendActivity({ type: 'typing' });

      const fileAttachments = (context.activity.attachments || [])
        .filter((a) => a.contentType !== 'text/html' && (a.content?.downloadUrl || a.contentUrl));

      const fileIds = [];
      for (const att of fileAttachments) {
        const downloaded = await downloadTeamsAttachment(att);
        if (downloaded) fileIds.push(downloaded);
      }

      const messageText = effectiveText || (fileIds.length > 0 ? 'Analysiere die angehängte(n) Datei(en).' : '');
      if (!messageText) {
        await context.sendActivity('Beschreib kurz, was ich für dich tun soll — optional mit einer angehängten PDF-Datei oder "hol Bericht.pdf aus meinem OneDrive". Tipp: "/neu" setzt den Gesprächsverlauf zurück.');
        return next();
      }

      const history = conversationStore.getHistory(conversationId);
      const oneDriveExecutor = makeOneDriveExecutor(teamsUser);

      try {
        const result = await runWithUser(teamsUser, () =>
          agentEngine.runAgentLoop({
            history,
            message: messageText,
            fileIds,
            extraTools: ONEDRIVE_TOOLS,
            extraExecutor: oneDriveExecutor,
            extraSystemPrompt: ONEDRIVE_SYSTEM_PROMPT_ADDENDUM,
          })
        );

        conversationStore.saveHistory(conversationId, result.history);

        await context.sendActivity(result.reply);

        // Erzeugte Dateien als klickbare, zeitlich befristete Download-Links senden
        // (30 Min. gültig) - Teams macht URLs in Nachrichten automatisch anklickbar.
        if (result.outputFiles && result.outputFiles.length > 0) {
          const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
          const links = result.outputFiles.map((f) => {
            const name = f.split(/[/\\]/).pop();
            const token = createDownloadToken(f);
            return `📄 [${name}](${backendUrl}/api/v1/teams-download/${token})`;
          }).join('\n');
          await context.sendActivity(`${links}\n\n_Links sind 30 Minuten gültig._`);
        }
      } catch (error) {
        console.error('Teams-Bot Agentenfehler:', error);
        await context.sendActivity(`Entschuldigung, da ist ein Fehler aufgetreten: ${error.message}`);
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(MessageFactory.text(
            'Hallo! Ich bin der PDF-Studio-Assistent. Beschreib mir eine Aufgabe (z.B. "dreh dieses PDF um 90 Grad" oder "hol Bericht.pdf aus meinem OneDrive") und häng optional eine Datei an.'
          ));
        }
      }
      await next();
    });
  }
}

const bot = new PdfStudioTeamsBot();

module.exports = { getAdapter, bot };

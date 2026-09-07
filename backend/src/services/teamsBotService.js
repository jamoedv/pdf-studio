const {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  TeamsActivityHandler,
  MessageFactory,
} = require('botbuilder');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const agentEngine = require('./agentEngine');
const conversationStore = require('./teamsConversationStore');
const { runWithUser } = require('./anthropicClient');
const { createDownloadToken } = require('./teamsDownloadService');
const graphTokenService = require('./graphTokenService');
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
];

// Führt die OneDrive-Werkzeuge aus - prüft zuerst, ob der Nutzer bereits ein
// gültiges Graph-Token hat (über die Bot-Framework-OAuth-Verbindung "graph").
// Falls nicht, wird eine Anmelde-Karte geschickt und Claude erfährt, dass es
// noch keinen Zugriff gibt, statt einen kryptischen Fehler zu bekommen.
function makeOneDriveExecutor(context, adapter, username) {
  return async (name, input) => {
    let token = await botGraphAuth.getCachedGraphToken(context, adapter);
    if (!token) {
      const stored = graphTokenService.getTokens(username);
      // Fallback: evtl. schon vorhandenes, selbst verwaltetes Token nutzen
      // (z.B. falls die Bot-Framework-eigene Zwischenspeicherung abgelaufen ist).
      token = stored?.accessToken || null;
    }

    if (!token) {
      await botGraphAuth.sendSignInCard(context, adapter);
      return { error: 'not_connected', message: 'Der Nutzer wurde gerade aufgefordert, sich über die Anmelde-Karte mit Microsoft zu verbinden. Bitte antworte kurz, dass er sich zuerst verbinden und die Anfrage danach wiederholen soll.' };
    }

    if (name === 'onedrive_list_files') {
      const items = await botGraphAuth.listOneDriveRoot(token, input.folderId);
      return { items };
    }

    if (name === 'onedrive_import_file') {
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
      await botGraphAuth.downloadOneDriveFile(token, input.itemId, destPath);
      return { fileId: destPath, filename: input.filename };
    }

    return { error: `Unbekanntes Werkzeug: ${name}` };
  };
}

class PdfStudioTeamsBot extends TeamsActivityHandler {
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
      const adapter = getAdapter();
      const oneDriveExecutor = makeOneDriveExecutor(context, adapter, teamsUser);

      try {
        const result = await runWithUser(teamsUser, () =>
          agentEngine.runAgentLoop({
            history,
            message: messageText,
            fileIds,
            extraTools: ONEDRIVE_TOOLS,
            extraExecutor: oneDriveExecutor,
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

  // Wird von Teams aufgerufen, nachdem der Nutzer die Anmelde-Karte bestätigt hat -
  // schließt den Token-Austausch ab (TeamsActivityHandler kümmert sich um das
  // Erkennen dieser speziellen "invoke"-Aktivität, wir müssen nur noch reagieren).
  async handleTeamsSigninVerifyState(context, query) {
    const adapter = getAdapter();
    try {
      const tokenResponse = await adapter.getUserToken(context, botGraphAuth.CONNECTION_NAME, query.state);
      if (tokenResponse?.token) {
        // Zusätzlich in unserem eigenen Speicher ablegen, als Fallback falls die
        // Bot-Framework-eigene Zwischenspeicherung abläuft (kein Refresh-Mechanismus
        // dafür in dieser ersten Version - bei Ablauf einfach erneut verbinden).
        graphTokenService.saveTokens(botGraphAuth.teamsUsername(context), {
          access_token: tokenResponse.token,
          refresh_token: null,
          expires_in: 3600,
        });
        await context.sendActivity('✅ Erfolgreich mit Microsoft verbunden! Du kannst deine Anfrage jetzt wiederholen.');
      } else {
        await context.sendActivity('Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuch es nochmal.');
      }
    } catch (error) {
      console.error('Teams Sign-in Fehler:', error);
      await context.sendActivity('Die Anmeldung ist fehlgeschlagen. Bitte versuch es nochmal.');
    }
  }
}

const bot = new PdfStudioTeamsBot();

module.exports = { getAdapter, bot };

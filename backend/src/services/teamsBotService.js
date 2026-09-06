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

class PdfStudioTeamsBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const conversationId = context.activity.conversation.id;
      // Teams-Identität als Pseudo-Nutzername fürs Tracking (kein Konten-Abgleich
      // mit dem Portal-Login in dieser ersten Phase - siehe Hinweis in der Doku).
      const teamsUser = `teams:${context.activity.from.aadObjectId || context.activity.from.id}`;

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
        await context.sendActivity('Beschreib kurz, was ich für dich tun soll — optional mit einer angehängten PDF-Datei. Tipp: "/neu" setzt den Gesprächsverlauf zurück.');
        return next();
      }

      const history = conversationStore.getHistory(conversationId);

      try {
        const result = await runWithUser(teamsUser, () =>
          agentEngine.runAgentLoop({ history, message: messageText, fileIds })
        );

        conversationStore.saveHistory(conversationId, result.history);

        await context.sendActivity(result.reply);

        // Erzeugte Dateien als Datei-Info-Karten anhängen, wenn Teams das im
        // jeweiligen Kontext unterstützt (Kanal-Uploads sind aktuell nicht
        // implementiert - Nutzer bekommt stattdessen einen Hinweis mit Dateinamen).
        if (result.outputFiles && result.outputFiles.length > 0) {
          const names = result.outputFiles.map((f) => f.split(/[/\\]/).pop()).join(', ');
          await context.sendActivity(`📄 Erzeugte Datei(en): ${names} — Download aktuell nur über das Web-Portal möglich.`);
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
            'Hallo! Ich bin der PDF-Studio-Assistent. Beschreib mir eine Aufgabe (z.B. "dreh dieses PDF um 90 Grad") und häng optional eine Datei an.'
          ));
        }
      }
      await next();
    });
  }
}

const bot = new PdfStudioTeamsBot();

module.exports = { getAdapter, bot };

const { CardFactory } = require('botbuilder');
const tokenStore = require('./graphTokenService');

const CONNECTION_NAME = 'graph';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Teams-Pseudo-Nutzer bekommen ihre OneDrive/SharePoint-Tokens im selben
// dateibasierten Speicher wie Portal-Nutzer - einfach unter einem anderen
// "Nutzernamen" (teams:<aadObjectId>), damit beide Systeme unabhängig bleiben.
function teamsUsername(context) {
  return `teams:${context.activity.from.aadObjectId || context.activity.from.id}`;
}

// Versucht, über die Bot-Framework-OAuth-Verbindung ein bereits vorhandenes,
// von Teams zwischengespeichertes Token zu holen - ganz ohne dass der Nutzer
// nochmal aktiv etwas klicken muss, sofern er der Verbindung schon einmal zugestimmt hat.
async function getCachedGraphToken(context, adapter) {
  try {
    const tokenResponse = await adapter.getUserToken(context, CONNECTION_NAME);
    return tokenResponse?.token || null;
  } catch {
    return null;
  }
}

// Schickt eine Teams-typische "Anmelden"-Karte, wenn noch kein Token vorhanden ist.
async function sendSignInCard(context, adapter) {
  const resource = await adapter.getSignInResource(context, CONNECTION_NAME);
  const card = CardFactory.oauthCard(
    CONNECTION_NAME,
    'Mit Microsoft verbinden',
    'Um auf OneDrive/SharePoint zuzugreifen, verbinde bitte einmalig dein Microsoft-Konto.',
    resource.signInLink
  );
  await context.sendActivity({ attachments: [card] });
}

async function graphFetch(token, endpoint, options = {}) {
  const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API Fehler (${res.status}): ${body.slice(0, 300)}`);
  }
  return res;
}

async function listOneDriveRoot(token, folderId) {
  const endpoint = folderId ? `/me/drive/items/${folderId}/children` : '/me/drive/root/children';
  const res = await graphFetch(token, endpoint);
  const data = await res.json();
  return (data.value || []).map((it) => ({
    id: it.id,
    name: it.name,
    isFolder: !!it.folder,
    size: it.size,
  }));
}

async function downloadOneDriveFile(token, itemId, destPath) {
  const fs = require('fs');
  const res = await graphFetch(token, `/me/drive/items/${itemId}/content`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

module.exports = {
  CONNECTION_NAME,
  teamsUsername,
  getCachedGraphToken,
  sendSignInCard,
  listOneDriveRoot,
  downloadOneDriveFile,
};

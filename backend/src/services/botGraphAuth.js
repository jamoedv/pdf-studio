// Nutzt bewusst denselben, bereits ausgiebig getesteten OneDrive/SharePoint-OAuth-
// Flow wie das Web-Portal (graphService.js), statt der fragilen, versionsabhängigen
// Bot-Framework-eigenen OAuth-Connection-API. Der Bot schickt einen normalen Link
// (keine spezielle Anmelde-Karte) - der Nutzer klickt, meldet sich an, fertig.
// Tokens landen im selben Speicher wie beim Portal, nur unter einem Teams-Pseudo-
// Nutzernamen statt dem Portal-Login.
const graphService = require('./graphService');
const tokenStore = require('./graphTokenService');

function teamsUsername(context) {
  return `teams:${context.activity.from.aadObjectId || context.activity.from.id}`;
}

function isConnected(username) {
  return tokenStore.isConnected(username);
}

function getConnectLink(username) {
  return graphService.getAuthUrl(username);
}

// Holt ein gültiges Access-Token (erneuert bei Bedarf automatisch über den
// Refresh-Token) - nutzt dieselbe, bereits bewährte Logik wie das Web-Portal.
async function getValidToken(username) {
  return graphService.getValidAccessToken(username);
}

async function listOneDriveRoot(username, folderId) {
  return graphService.listOneDrive(username, folderId);
}

async function downloadOneDriveFile(username, itemId, destPath) {
  return graphService.downloadItem(username, { itemId }, destPath);
}

async function listSharePointSites(username) {
  return graphService.listSharePointSites(username);
}

async function listSharePointFolder(username, siteId, folderId, driveId) {
  return graphService.listSharePointFolder(username, siteId, folderId, driveId);
}

async function downloadSharePointFile(username, driveId, itemId, destPath) {
  return graphService.downloadItem(username, { driveId, itemId }, destPath);
}

// fileId ist hier der lokale Serverpfad einer bereits erzeugten Datei (z.B. aus
// einem vorherigen Werkzeug-Ergebnis wie {fileId: "/app/processed/..."}).
async function uploadToOneDrive(username, filename, folderId, filePath) {
  return graphService.uploadItem(username, { folderId, filename }, filePath);
}

async function uploadToSharePoint(username, driveId, filename, folderId, filePath) {
  return graphService.uploadItem(username, { driveId, folderId, filename }, filePath);
}

module.exports = {
  teamsUsername,
  isConnected,
  getConnectLink,
  getValidToken,
  listOneDriveRoot,
  downloadOneDriveFile,
  listSharePointSites,
  listSharePointFolder,
  downloadSharePointFile,
  uploadToOneDrive,
  uploadToSharePoint,
};

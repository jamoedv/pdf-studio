const jwt = require('jsonwebtoken');
const tokenStore = require('./graphTokenService');

const TENANT = process.env.AZURE_TENANT_ID || 'common';
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const SCOPES = 'offline_access User.Read Files.ReadWrite Sites.ReadWrite.All';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function getRedirectUri() {
  // Muss exakt mit der in der Azure-App-Registrierung hinterlegten Redirect-URI übereinstimmen.
  return process.env.AZURE_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/v1/onedrive/callback`;
}

// Baut die Microsoft-Login-URL. "state" trägt den Nutzernamen signiert mit dem
// bestehenden JWT_SECRET, damit der Callback (der ohne Authorization-Header vom
// Browser aus Microsoft kommt) weiß, für wen die Tokens gespeichert werden müssen.
function getAuthUrl(username) {
  const state = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    // "login" statt "select_account" erzwingt eine echte Neuanmeldung mit
    // Zugangsdaten - select_account kann bei Windows/Edge-Betriebssystem-SSO
    // trotzdem automatisch nur eine Identität liefern, ohne wirklich zu fragen.
    prompt: 'login',
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
}

function verifyState(state) {
  const decoded = jwt.verify(state, process.env.JWT_SECRET);
  return decoded.username;
}

async function exchangeCodeForTokens(code) {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      scope: SCOPES,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Token-Austausch fehlgeschlagen');
  return data;
}

async function refreshTokens(refreshToken) {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Token-Erneuerung fehlgeschlagen');
  return data;
}

// Liefert ein gültiges Access-Token für den Nutzer, erneuert es bei Bedarf automatisch
// und schreibt den neuen Stand zurück in den Token-Speicher.
async function getValidAccessToken(username) {
  let tokens = tokenStore.getTokens(username);
  if (!tokens) throw new Error('Nicht mit Microsoft verbunden');

  if (Date.now() >= tokens.expiresAt) {
    const fresh = await refreshTokens(tokens.refreshToken);
    // Microsoft liefert bei einem Refresh nicht immer ein neues refresh_token mit -
    // in dem Fall das alte behalten.
    if (!fresh.refresh_token) fresh.refresh_token = tokens.refreshToken;
    tokens = tokenStore.saveTokens(username, fresh);
  }
  return tokens.accessToken;
}

async function graphFetch(username, endpoint, options = {}) {
  const accessToken = await getValidAccessToken(username);
  const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Graph API Fehler (${res.status}): ${errBody.slice(0, 300)}`);
  }
  return res;
}

function mapItems(items) {
  return (items || []).map((it) => ({
    id: it.id,
    name: it.name,
    isFolder: !!it.folder,
    size: it.size,
    modified: it.lastModifiedDateTime,
    driveId: it.parentReference?.driveId,
  }));
}

// OneDrive des eingeloggten Nutzers durchsuchen. Ohne folderId wird das Wurzelverzeichnis gezeigt.
async function listOneDrive(username, folderId) {
  const endpoint = folderId ? `/me/drive/items/${folderId}/children` : '/me/drive/root/children';
  const res = await graphFetch(username, endpoint);
  const data = await res.json();
  return mapItems(data.value);
}

// Verfügbare SharePoint-Seiten auflisten (an die der Nutzer Zugriff hat).
// Löst eine SharePoint-Seite direkt über ihre URL auf (umgeht die verzögerte
// Such-Indexierung von /sites?search=* - eine frisch angelegte Seite kann dort
// je nach Microsoft-Infrastruktur erst nach Minuten bis Stunden auftauchen).
async function getSiteByUrl(username, siteUrl) {
  // SharePoints "Link kopieren"-Freigabe-URLs (z.B. mit :f:, :w:, :x:, :b:) sind
  // Kurzform-Freigabelinks für einzelne Ordner/Dateien, keine Seiten-URLs - Graph
  // kann diese nicht auflösen. Klare Fehlermeldung statt kryptischem 400er.
  if (/:[a-z]:\//.test(siteUrl)) {
    throw new Error('Das ist ein Freigabe-Link für einen einzelnen Ordner/eine Datei ("Link kopieren"), keine Seiten-URL. Bitte stattdessen die Adresse aus der Browser-Adressleiste kopieren, während du auf der Seite selbst bist (z.B. https://firma.sharepoint.com/sites/Teamname).');
  }

  const url = new URL(siteUrl);
  const hostname = url.hostname;
  const sitePath = url.pathname.replace(/\/$/, ''); // trailing slash entfernen
  const endpoint = sitePath ? `/sites/${hostname}:${sitePath}` : `/sites/${hostname}`;
  const res = await graphFetch(username, endpoint);
  const s = await res.json();
  return { id: s.id, name: s.displayName || s.name, webUrl: s.webUrl };
}

async function listSharePointSites(username) {
  const sites = [];

  // /sites/root ist deutlich zuverlässiger als /sites?search=* (dieser Such-Endpunkt
  // ist laut zahlreichen Microsoft-Foren-Berichten seit Jahren gelegentlich mit
  // "generalException" instabil, besonders bei frisch lizenzierten Tenants).
  try {
    const rootRes = await graphFetch(username, '/sites/root');
    const root = await rootRes.json();
    sites.push({ id: root.id, name: root.displayName || root.name || 'Standardseite', webUrl: root.webUrl });
  } catch (err) {
    // Root-Seite konnte nicht geladen werden - kein Abbruch, evtl. hilft trotzdem die Suche.
  }

  try {
    const res = await graphFetch(username, '/sites?search=*');
    const data = await res.json();
    for (const s of data.value || []) {
      if (!sites.some((existing) => existing.id === s.id)) {
        sites.push({ id: s.id, name: s.displayName, webUrl: s.webUrl });
      }
    }
  } catch (err) {
    if (sites.length > 0) return sites; // Root-Seite hatten wir schon - kein harter Fehler nötig
    if (err.message.includes('SPO license') || err.message.includes('does not have a SPO')) {
      throw new Error('SharePoint ist für dieses Microsoft-Konto nicht lizenziert (keine SharePoint-Online-Lizenz im Tenant hinterlegt).');
    }
    if (err.message.includes('generalException')) {
      throw new Error('SharePoint ist auf diesem Tenant evtl. noch nicht vollständig bereitgestellt (kann nach Lizenzzuweisung etwas dauern) oder Microsoft hat gerade ein vorübergehendes Problem. Bitte in ein paar Minuten erneut versuchen.');
    }
    throw err;
  }

  return sites;
}

// Zeigt bei Seiten-Wurzel ALLE Dokumentbibliotheken der Seite als Ordner an (eine Seite
// kann mehrere Bibliotheken haben - nur die Standardbibliothek abzufragen führte dazu,
// dass Dateien in anderen Bibliotheken fälschlich als "Ordner ist leer" erschienen).
// Beim Navigieren in eine Bibliothek/einen Unterordner wird gezielt in deren Drive gesucht.
async function listSharePointFolder(username, siteId, folderId, driveId) {
  if (!folderId && !driveId) {
    // Seiten-Wurzel: alle Dokumentbibliotheken auflisten
    const res = await graphFetch(username, `/sites/${siteId}/drives`);
    const data = await res.json();
    return (data.value || []).map((d) => ({
      id: d.id,
      name: d.name,
      isFolder: true,
      isDrive: true,
      driveId: d.id,
    }));
  }

  const endpoint = folderId
    ? `/drives/${driveId}/items/${folderId}/children`
    : `/drives/${driveId}/root/children`;
  const res = await graphFetch(username, endpoint);
  const data = await res.json();
  return mapItems(data.value).map((item) => ({ ...item, driveId }));
}

// Lädt eine Datei (OneDrive oder SharePoint-Drive) herunter und schreibt sie lokal,
// damit sie wie eine normal hochgeladene Datei in die bestehende Verarbeitung geht.
async function downloadItem(username, { driveId, itemId }, destPath) {
  const fs = require('fs');
  const endpoint = driveId ? `/drives/${driveId}/items/${itemId}/content` : `/me/drive/items/${itemId}/content`;
  const res = await graphFetch(username, endpoint);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

// Lädt eine lokale Datei zu OneDrive oder in eine SharePoint-Bibliothek hoch.
// Nutzt den "einfachen" Upload-Endpunkt - reicht für Dateien bis 4 MB (für größere
// Dateien wäre eine Upload-Session nötig, aktuell nicht implementiert).
async function uploadItem(username, { driveId, folderId, filename }, filePath) {
  const fs = require('fs');
  const fileBuffer = fs.readFileSync(filePath);
  if (fileBuffer.length > 4 * 1024 * 1024) {
    throw new Error('Datei größer als 4 MB - einfacher Upload nicht möglich (Upload-Session noch nicht implementiert)');
  }
  const base = driveId ? `/drives/${driveId}` : '/me/drive';
  const parent = folderId ? `items/${folderId}:` : 'root:';
  const endpoint = `${base}/${parent}/${encodeURIComponent(filename)}:/content`;
  const res = await graphFetch(username, endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  });
  return await res.json();
}

module.exports = {
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  getValidAccessToken,
  listOneDrive,
  listSharePointSites,
  getSiteByUrl,
  listSharePointFolder,
  downloadItem,
  uploadItem,
};

const fs = require('fs');
const path = require('path');

const TOKENS_DIR = process.env.GRAPH_TOKENS_DIR || path.join(__dirname, '..', '..', 'data', 'graph-tokens');

function ensureDir() {
  if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });
}

function tokenPath(username) {
  // Nutzername als Dateiname - für Sonderzeichen leicht bereinigt.
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TOKENS_DIR, `${safe}.json`);
}

function saveTokens(username, tokens) {
  ensureDir();
  const record = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // expires_in ist in Sekunden ab jetzt; wir merken uns den absoluten Zeitpunkt,
    // mit 60s Sicherheitsabstand, damit ein Request nicht knapp mit abgelaufenem Token startet.
    expiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
  };
  fs.writeFileSync(tokenPath(username), JSON.stringify(record, null, 2));
  return record;
}

function getTokens(username) {
  const p = tokenPath(username);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function isConnected(username) {
  return getTokens(username) !== null;
}

function disconnect(username) {
  const p = tokenPath(username);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { saveTokens, getTokens, isConnected, disconnect };

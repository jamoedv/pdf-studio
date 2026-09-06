const fs = require('fs');
const path = require('path');

const CONV_DIR = process.env.TEAMS_CONVERSATIONS_DIR || path.join(__dirname, '..', '..', 'data', 'teams-conversations');

function ensureDir() {
  if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
}

function convPath(conversationId) {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CONV_DIR, `${safe}.json`);
}

// Teams schickt jede Nachricht als eigenen, zustandslosen HTTP-Webhook-Aufruf -
// die Konversations-Historie (für die Agenten-Schleife) muss deshalb serverseitig
// pro Teams-Konversation zwischengespeichert werden, ähnlich wie im Web-Portal
// die Historie clientseitig zwischen den Anfragen mitgeschickt wird.
function getHistory(conversationId) {
  const p = convPath(conversationId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')).history || [];
  } catch {
    return [];
  }
}

function saveHistory(conversationId, history) {
  ensureDir();
  fs.writeFileSync(convPath(conversationId), JSON.stringify({ history, updatedAt: new Date().toISOString() }));
}

function clearHistory(conversationId) {
  const p = convPath(conversationId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { getHistory, saveHistory, clearHistory };

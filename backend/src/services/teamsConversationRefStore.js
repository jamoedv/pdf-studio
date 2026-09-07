const fs = require('fs');
const path = require('path');

const REF_DIR = process.env.TEAMS_CONV_REFS_DIR || path.join(__dirname, '..', '..', 'data', 'teams-conversation-refs');

function ensureDir() {
  if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });
}

function refPath(teamsUsername) {
  const safe = teamsUsername.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(REF_DIR, `${safe}.json`);
}

// Wird bei JEDER Nachricht an den Bot aktualisiert - Bot Framework braucht diese
// Referenz, um später von sich aus (ohne vorherige Nutzer-Nachricht) eine
// Nachricht schicken zu können ("proaktives Messaging").
function saveReference(teamsUsername, conversationReference, displayName) {
  ensureDir();
  fs.writeFileSync(refPath(teamsUsername), JSON.stringify({ teamsUsername, conversationReference, displayName, updatedAt: new Date().toISOString() }));
}

function getReference(teamsUsername) {
  const p = refPath(teamsUsername);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function listKnownContacts() {
  ensureDir();
  return fs.readdirSync(REF_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REF_DIR, f), 'utf-8')))
    .map((data) => ({ teamsUsername: data.teamsUsername, displayName: data.displayName }));
}

module.exports = { saveReference, getReference, listKnownContacts };

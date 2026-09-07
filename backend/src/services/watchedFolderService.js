const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WATCH_DIR = process.env.WATCHED_FOLDERS_DIR || path.join(__dirname, '..', '..', 'data', 'watched-folders');

function ensureDir() {
  if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR, { recursive: true });
}

function filePath(id) {
  return path.join(WATCH_DIR, `${id}.json`);
}

function createWatch(config) {
  ensureDir();
  const id = uuidv4();
  const record = {
    id,
    username: config.username, // Portal-Nutzer, dessen OneDrive/SharePoint-Verbindung genutzt wird
    source: config.source, // 'onedrive' | 'sharepoint'
    siteId: config.siteId || null,
    driveId: config.driveId || null,
    folderId: config.folderId || null,
    folderLabel: config.folderLabel || '',
    instruction: config.instruction,
    destination: config.destination || null, // { source, siteId, driveId, folderId, folderLabel } oder null
    notifyEmail: config.notifyEmail || null,
    notifyTeamsUserId: config.notifyTeamsUserId || null,
    active: true,
    seenItemIds: [],
    lastChecked: null,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath(id), JSON.stringify(record, null, 2));
  return record;
}

function listWatches(username) {
  ensureDir();
  return fs.readdirSync(WATCH_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(WATCH_DIR, f), 'utf-8')))
    .filter((w) => !username || w.username === username);
}

function listAllActiveWatches() {
  return listWatches(null).filter((w) => w.active);
}

function getWatch(id) {
  const p = filePath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function updateWatch(id, updates) {
  const current = getWatch(id);
  if (!current) return null;
  const updated = { ...current, ...updates };
  fs.writeFileSync(filePath(id), JSON.stringify(updated, null, 2));
  return updated;
}

function deleteWatch(id) {
  const p = filePath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Merkt sich verarbeitete Datei-ids, damit dieselbe Datei nicht mehrfach
// verarbeitet wird (begrenzt auf die letzten 500, um die Datei nicht unbegrenzt
// wachsen zu lassen - reicht für alle realistischen Ordnergrößen).
function markItemsSeen(id, itemIds) {
  const current = getWatch(id);
  if (!current) return;
  const seen = [...new Set([...current.seenItemIds, ...itemIds])].slice(-500);
  updateWatch(id, { seenItemIds: seen, lastChecked: new Date().toISOString() });
}

module.exports = {
  createWatch,
  listWatches,
  listAllActiveWatches,
  getWatch,
  updateWatch,
  deleteWatch,
  markItemsSeen,
};

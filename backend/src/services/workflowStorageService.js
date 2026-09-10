const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR || path.join(__dirname, '..', '..', 'data', 'workflows');

function ensureDir() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  }
}

// ownerUsername ist optional (z.B. wenn der Assistent selbst speichert, ohne dass
// wir explizit von aussen einen Nutzer mitgeben - siehe agentEngine.js). Ohne
// Besitzer taucht ein Workflow in keiner "Meine Apps"-Liste auf, bleibt aber
// ganz normal ueber list_workflows/get_workflow im Chat nutzbar.
function saveWorkflow(name, description, config, steps = [], ownerUsername = null) {
  ensureDir();
  const id = uuidv4();
  const record = {
    id,
    name,
    description,
    config,
    steps,
    ownerUsername,
    authorizedUsers: [],
    isPublic: false,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

function listWorkflows() {
  ensureDir();
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8')))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listWorkflowsSummary() {
  return listWorkflows().map((record) => ({
    id: record.id, name: record.name, description: record.description,
    steps: record.steps || [], createdAt: record.createdAt,
  }));
}

function updateWorkflow(id, { name, description, steps, config }) {
  const existing = getWorkflow(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(config !== undefined ? { config } : {}),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

function getWorkflow(id) {
  const filePath = path.join(WORKFLOWS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function deleteWorkflow(id) {
  const filePath = path.join(WORKFLOWS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// --- App-Freigabe (Poweruser/Admin) -----------------------------------------

function shareWorkflow(id, username) {
  const wf = getWorkflow(id);
  if (!wf) return null;
  if (!wf.authorizedUsers.includes(username)) wf.authorizedUsers.push(username);
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(wf, null, 2));
  return wf;
}

function unshareWorkflow(id, username) {
  const wf = getWorkflow(id);
  if (!wf) return null;
  wf.authorizedUsers = wf.authorizedUsers.filter((u) => u !== username);
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(wf, null, 2));
  return wf;
}

function setPublic(id, isPublic) {
  const wf = getWorkflow(id);
  if (!wf) return null;
  wf.isPublic = !!isPublic;
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(wf, null, 2));
  return wf;
}

function renameApp(id, name, description) {
  return updateWorkflow(id, { name, description });
}

// Apps, die der Nutzer selbst besitzt.
function listOwnedBy(username) {
  return listWorkflows().filter((wf) => wf.ownerUsername === username);
}

// Apps, die anderen gehoeren, aber fuer diesen Nutzer freigegeben sind
// (namentlich oder "fuer alle").
function listSharedWith(username) {
  return listWorkflows().filter(
    (wf) => wf.ownerUsername !== username && (wf.isPublic || (wf.authorizedUsers || []).includes(username))
  );
}

// Darf dieser Nutzer die App tatsaechlich ausfuehren?
function canRun(wf, username) {
  return wf.ownerUsername === username || wf.isPublic || (wf.authorizedUsers || []).includes(username);
}

module.exports = {
  saveWorkflow,
  listWorkflows,
  listWorkflowsSummary,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  shareWorkflow,
  unshareWorkflow,
  setPublic,
  renameApp,
  listOwnedBy,
  listSharedWith,
  canRun,
};

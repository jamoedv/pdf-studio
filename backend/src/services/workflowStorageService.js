const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR || path.join(__dirname, '..', '..', 'data', 'workflows');

function ensureDir() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  }
}

function saveWorkflow(name, description, config, steps = []) {
  ensureDir();
  const id = uuidv4();
  const record = { id, name, description, config, steps, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

function listWorkflows() {
  ensureDir();
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const record = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8'));
      return { id: record.id, name: record.name, description: record.description, steps: record.steps || [], createdAt: record.createdAt };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

module.exports = { saveWorkflow, listWorkflows, getWorkflow, updateWorkflow, deleteWorkflow };

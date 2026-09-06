const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.join(__dirname, '..', '..', 'data', 'templates');

function ensureDir() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

function saveTemplate(name, html) {
  ensureDir();
  const id = uuidv4();
  const record = { id, name, html, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

function listTemplates() {
  ensureDir();
  return fs.readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const record = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8'));
      return { id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt };
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function getTemplate(id) {
  const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function updateTemplate(id, { name, html }) {
  const existing = getTemplate(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...(name !== undefined ? { name } : {}),
    ...(html !== undefined ? { html } : {}),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

function deleteTemplate(id) {
  const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

module.exports = { saveTemplate, listTemplates, getTemplate, updateTemplate, deleteTemplate };

const fs = require('fs');
const path = require('path');

const USAGE_DIR = process.env.USAGE_DIR || path.join(__dirname, '..', '..', 'data', 'usage');
const USAGE_LOG_FILE = path.join(USAGE_DIR, 'usage.jsonl');
const COST_CENTERS_FILE = path.join(USAGE_DIR, 'cost-centers.json');

// Preise pro 1M Tokens in USD (Stand: siehe Anthropic Preisliste - bei Modelländerungen aktualisieren)
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-1-20250805': { input: 15, output: 75 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };
// Cache-Schreiben kostet ca. 1.25x der normalen Input-Rate, Cache-Lesen ca. 0.1x (Anthropic-Multiplikatoren)
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function ensureDir() {
  if (!fs.existsSync(USAGE_DIR)) fs.mkdirSync(USAGE_DIR, { recursive: true });
}

function estimateCostUSD(model, usage) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (usage.inputTokens || 0) / 1_000_000 * pricing.input;
  const outputCost = (usage.outputTokens || 0) / 1_000_000 * pricing.output;
  const cacheWriteCost = (usage.cacheCreationTokens || 0) / 1_000_000 * pricing.input * CACHE_WRITE_MULTIPLIER;
  const cacheReadCost = (usage.cacheReadTokens || 0) / 1_000_000 * pricing.input * CACHE_READ_MULTIPLIER;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

function logUsage({ username, feature, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }) {
  ensureDir();
  const record = {
    timestamp: new Date().toISOString(),
    username: username || 'unbekannt',
    costCenter: getCostCenter(username) || '',
    feature: feature || 'unbekannt',
    model,
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    cacheCreationTokens: cacheCreationTokens || 0,
    cacheReadTokens: cacheReadTokens || 0,
  };
  record.estimatedCostUSD = Math.round(estimateCostUSD(model, record) * 1_000_000) / 1_000_000;
  fs.appendFileSync(USAGE_LOG_FILE, JSON.stringify(record) + '\n');
  return record;
}

function readAllRecords() {
  ensureDir();
  if (!fs.existsSync(USAGE_LOG_FILE)) return [];
  return fs.readFileSync(USAGE_LOG_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function getUsageRecords({ from, to, username, costCenter } = {}) {
  let records = readAllRecords();
  if (from) records = records.filter((r) => r.timestamp >= from);
  if (to) records = records.filter((r) => r.timestamp <= to);
  if (username) {
    const q = username.toLowerCase();
    records = records.filter((r) => (r.username || '').toLowerCase().includes(q));
  }
  if (costCenter) {
    const q = costCenter.toLowerCase();
    // Aktuelle Kostenstellen-Zuordnung des Nutzers prüfen, nicht den historisch
    // gespeicherten Stand - eine nachträglich zugewiesene Kostenstelle soll auch
    // ältere, bereits geloggte Aufrufe rückwirkend erfassen.
    records = records.filter((r) => (getCostCenter(r.username) || '').toLowerCase().includes(q));
  }
  return records;
}

function getUsageSummary({ from, to, username, costCenter, groupBy = 'username' } = {}) {
  const records = getUsageRecords({ from, to, username, costCenter });
  const groups = {};
  for (const r of records) {
    // Bei Gruppierung nach Kostenstelle IMMER die aktuelle Zuordnung nachschlagen,
    // nicht den im Datensatz gespeicherten Stand von damals - sonst werden nachträglich
    // zugewiesene Kostenstellen nicht rückwirkend auf bereits geloggte Aufrufe angewendet.
    const key = groupBy === 'costCenter'
      ? (getCostCenter(r.username) || 'Ohne Kostenstelle')
      : (r[groupBy] || 'unbekannt');
    if (!groups[key]) {
      groups[key] = { key, calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUSD: 0 };
    }
    groups[key].calls += 1;
    groups[key].inputTokens += r.inputTokens;
    groups[key].outputTokens += r.outputTokens;
    groups[key].cacheCreationTokens += r.cacheCreationTokens;
    groups[key].cacheReadTokens += r.cacheReadTokens;
    groups[key].estimatedCostUSD += r.estimatedCostUSD;
  }
  return Object.values(groups)
    .map((g) => ({ ...g, estimatedCostUSD: Math.round(g.estimatedCostUSD * 100) / 100 }))
    .sort((a, b) => b.estimatedCostUSD - a.estimatedCostUSD);
}

function getDistinctUsernames() {
  const records = readAllRecords();
  return [...new Set(records.map((r) => r.username))].sort();
}

// Löscht Datensätze, die den Filterkriterien entsprechen (z.B. alle "unbekannt"-Einträge
// aus der Zeit vor Einführung des Nutzer-Trackings). Schreibt die Log-Datei ohne diese neu.
function deleteUsageRecords({ username } = {}) {
  const records = readAllRecords();
  const remaining = username ? records.filter((r) => r.username !== username) : [];
  const deletedCount = records.length - remaining.length;
  ensureDir();
  fs.writeFileSync(USAGE_LOG_FILE, remaining.map((r) => JSON.stringify(r)).join('\n') + (remaining.length ? '\n' : ''));
  return deletedCount;
}

function readCostCenters() {
  ensureDir();
  if (!fs.existsSync(COST_CENTERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(COST_CENTERS_FILE, 'utf-8')); } catch { return {}; }
}

function getCostCenter(username) {
  if (!username) return null;
  return readCostCenters()[username] || null;
}

function setCostCenter(username, costCenter) {
  ensureDir();
  const map = readCostCenters();
  map[username] = costCenter;
  fs.writeFileSync(COST_CENTERS_FILE, JSON.stringify(map, null, 2));
  return map;
}

function listCostCenters() {
  return readCostCenters();
}

module.exports = {
  logUsage,
  getUsageRecords,
  getUsageSummary,
  getDistinctUsernames,
  deleteUsageRecords,
  getCostCenter,
  setCostCenter,
  listCostCenters,
};

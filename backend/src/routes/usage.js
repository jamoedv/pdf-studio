const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const usageTracking = require('../services/usageTrackingService');

router.use(requireAuth);

// Zusammenfassung, gruppiert nach Nutzer oder Kostenstelle
router.get('/usage/summary', (req, res) => {
  try {
    const { from, to, groupBy, username, costCenter } = req.query;
    const summary = usageTracking.getUsageSummary({ from, to, username, costCenter, groupBy: groupBy === 'costCenter' ? 'costCenter' : 'username' });
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Liste aller Nutzernamen, die jemals getrackt wurden (für Filter-Dropdown im Frontend)
router.get('/usage/usernames', (req, res) => {
  try {
    res.json({ usernames: usageTracking.getDistinctUsernames() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Datensätze eines bestimmten Nutzers löschen (z.B. Altlasten mit username="unbekannt")
router.delete('/usage/records', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username erforderlich' });
    const deletedCount = usageTracking.deleteUsageRecords({ username });
    res.json({ deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Einzelne Datensätze (z.B. für Detailansicht/Debugging)
router.get('/usage/records', (req, res) => {
  try {
    const { from, to, username, costCenter } = req.query;
    const records = usageTracking.getUsageRecords({ from, to, username, costCenter });
    res.json({ records });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CSV-Export für Buchhaltung/Kostenstellen-Verrechnung
router.get('/usage/export.csv', (req, res) => {
  try {
    const { from, to } = req.query;
    const records = usageTracking.getUsageRecords({ from, to });
    const header = 'Datum,Nutzer,Kostenstelle,Funktion,Modell,Input-Tokens,Output-Tokens,Cache-Schreiben,Cache-Lesen,Geschätzte Kosten (USD)';
    const rows = records.map((r) => [
      r.timestamp, r.username, r.costCenter, r.feature, r.model,
      r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens, r.estimatedCostUSD.toFixed(6),
    ].join(','));
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nutzung_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kostenstellen verwalten
router.get('/usage/cost-centers', (req, res) => {
  try {
    res.json({ costCenters: usageTracking.listCostCenters() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/usage/cost-centers', (req, res) => {
  try {
    const { username, costCenter } = req.body;
    if (!username || !costCenter) return res.status(400).json({ error: 'username und costCenter erforderlich' });
    const map = usageTracking.setCostCenter(username, costCenter);
    res.json({ costCenters: map });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

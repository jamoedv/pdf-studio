const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
router.use(requireAuth);
const { v4: uuidv4 } = require('uuid');
const redisClient = require('../services/redisClient');

router.get('/templates', async (req, res, next) => {
  try {
    const raw = await redisClient.get('templates');
    const templates = raw ? JSON.parse(raw) : [];
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

router.post('/templates', async (req, res, next) => {
  try {
    const { name, steps } = req.body;
    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'name and steps required' });
    }

    const raw = await redisClient.get('templates');
    const templates = raw ? JSON.parse(raw) : [];

    const newTemplate = { id: uuidv4(), name, steps, createdAt: new Date().toISOString() };
    templates.unshift(newTemplate);

    await redisClient.set('templates', JSON.stringify(templates));
    res.json(newTemplate);
  } catch (error) {
    next(error);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    const raw = await redisClient.get('templates');
    let templates = raw ? JSON.parse(raw) : [];
    templates = templates.filter(t => t.id !== req.params.id);
    await redisClient.set('templates', JSON.stringify(templates));
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

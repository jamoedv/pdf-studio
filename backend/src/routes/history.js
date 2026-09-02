const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
router.use(requireAuth);
const redisClient = require('../services/redisClient');

router.get('/history', async (req, res, next) => {
  try {
    const rawEntries = await redisClient.lrange('history', 0, 49);
    const entries = rawEntries.map(e => JSON.parse(e));
    res.json(entries);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

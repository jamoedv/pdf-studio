const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const redisClient = require('../services/redisClient');

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const totalJobs = parseInt(await redisClient.get('stats:totalJobs').catch(() => '0')) || 0;
    const totalStorageSavedBytes = parseInt(await redisClient.get('stats:totalStorageSavedBytes').catch(() => '0')) || 0;

    const byType = await redisClient.hgetall('stats:byType').catch(() => ({}));
    const byUser = await redisClient.hgetall('stats:byUser').catch(() => ({}));
    const daily = await redisClient.hgetall('stats:daily').catch(() => ({}));

    const dailySorted = Object.entries(daily || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, count]) => ({ date, count: parseInt(count) }));

    const byTypeSorted = Object.entries(byType || {})
      .map(([type, count]) => ({ type, count: parseInt(count) }))
      .sort((a, b) => b.count - a.count);

    const byUserSorted = Object.entries(byUser || {})
      .map(([username, count]) => ({ username, count: parseInt(count) }))
      .sort((a, b) => b.count - a.count);

    res.json({
      totalJobs,
      totalStorageSavedMB: (totalStorageSavedBytes / (1024 * 1024)).toFixed(1),
      byType: byTypeSorted,
      byUser: byUserSorted,
      daily: dailySorted
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

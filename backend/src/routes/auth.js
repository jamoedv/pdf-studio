const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

router.post('/auth/register', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nutzername und Passwort erforderlich' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    }

    const userCount = await userService.countUsers();
    const role = userCount === 0 ? 'admin' : 'user';

    const user = await userService.createUser(username, password, role);

    const token = jwt.sign(
      { username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nutzername und Passwort erforderlich' });
    }

    const user = await userService.verifyPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Nutzername oder Passwort falsch' });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/auth/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await userService.listUsers();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

router.patch('/auth/users/:username/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle' });
    }
    const result = await userService.setRole(req.params.username, role);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/auth/users/:username', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.username);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

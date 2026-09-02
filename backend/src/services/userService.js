const bcrypt = require('bcryptjs');
const redisClient = require('./redisClient');

class UserService {
  async createUser(username, password, role = 'user') {
    const existing = await redisClient.get(`users:${username}`).catch(() => null);
    if (existing) {
      throw new Error('Nutzername bereits vergeben');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      username,
      passwordHash,
      role,
      createdAt: new Date().toISOString()
    };

    await redisClient.set(`users:${username}`, JSON.stringify(user));
    await redisClient.sadd('users:list', username);

    return { username, role, createdAt: user.createdAt };
  }

  async getUser(username) {
    try {
      const raw = await redisClient.get(`users:${username}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async verifyPassword(username, password) {
    const user = await this.getUser(username);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  async listUsers() {
    const usernames = await redisClient.smembers('users:list');
    const users = [];
    for (const username of usernames) {
      const user = await this.getUser(username);
      if (user) users.push({ username: user.username, role: user.role, createdAt: user.createdAt });
    }
    return users;
  }

  async setRole(username, role) {
    const user = await this.getUser(username);
    if (!user) throw new Error('Nutzer nicht gefunden');
    user.role = role;
    await redisClient.set(`users:${username}`, JSON.stringify(user));
    return { username: user.username, role: user.role };
  }

  async deleteUser(username) {
    await redisClient.del(`users:${username}`);
    await redisClient.srem('users:list', username);
  }

  async countUsers() {
    const usernames = await redisClient.smembers('users:list');
    return usernames.length;
  }
}

module.exports = new UserService();

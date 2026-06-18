const redis = require('redis');
const config = require('../config');

let client = null;

async function getRedisClient() {
  if (!client) {
    const options = {
      socket: {
        host: config.redis.host,
        port: config.redis.port
      }
    };
    if (config.redis.password) {
      options.password = config.redis.password;
    }
    client = redis.createClient(options);
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    await client.connect();
  }
  return client;
}

async function setCache(key, value, ttlSeconds) {
  const redis = await getRedisClient();
  const strValue = typeof value === 'object' ? JSON.stringify(value) : value;
  if (ttlSeconds) {
    await redis.setEx(key, ttlSeconds, strValue);
  } else {
    await redis.set(key, strValue);
  }
}

async function getCache(key) {
  const redis = await getRedisClient();
  const value = await redis.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function delCache(key) {
  const redis = await getRedisClient();
  await redis.del(key);
}

async function incrCounter(key, ttlSeconds) {
  const redis = await getRedisClient();
  const count = await redis.incr(key);
  if (ttlSeconds && count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  return count;
}

module.exports = {
  getRedisClient,
  setCache,
  getCache,
  delCache,
  incrCounter
};

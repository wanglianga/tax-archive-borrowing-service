require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { handleError, notFound } = require('./middleware/auth');
const { AppError } = require('./utils');

const authRoutes = require('./routes/auth');
const taxpayerRoutes = require('./routes/taxpayers');
const catalogRoutes = require('./routes/catalogs');
const archiveRoutes = require('./routes/archives');
const borrowRoutes = require('./routes/borrow');
const approvalRoutes = require('./routes/approvals');
const accessRoutes = require('./routes/access');
const auditRoutes = require('./routes/audit');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

const requiredDirs = [config.dirs.upload, config.dirs.preview, config.dirs.desensitized];
for (const dir of requiredDirs) {
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }
}

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    const { query } = require('./db');
    await query('SELECT 1');
    health.services.mysql = 'ok';
  } catch (err) {
    health.services.mysql = `error: ${err.message}`;
    health.status = 'degraded';
  }

  try {
    const { getRedisClient } = require('./redis');
    const redis = await getRedisClient();
    await redis.ping();
    health.services.redis = 'ok';
  } catch (err) {
    health.services.redis = `error: ${err.message}`;
    health.status = 'degraded';
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/', (req, res) => {
  res.json({
    name: '税务电子档案借阅服务',
    version: '1.0.0',
    description: 'Tax Electronic Archive Borrowing Service',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      taxpayers: '/api/taxpayers',
      catalogs: '/api/catalogs',
      archives: '/api/archives',
      borrow: '/api/borrow',
      approvals: '/api/approvals',
      access: '/api/access',
      audit: '/api/audit'
    }
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/taxpayers', taxpayerRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use('/api/archives', archiveRoutes);
app.use('/api/borrow', borrowRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/audit', auditRoutes);

app.use(notFound);
app.use(handleError);

async function startServer() {
  try {
    const { query } = require('./db');
    await query('SELECT 1');
    console.log('MySQL 连接成功');

    try {
      const { getRedisClient } = require('./redis');
      await getRedisClient();
      console.log('Redis 连接成功');
    } catch (redisErr) {
      console.warn('Redis 连接警告:', redisErr.message);
    }
  } catch (err) {
    console.warn('数据库连接警告:', err.message);
    console.warn('服务仍将启动，但部分功能可能不可用');
  }

  app.listen(config.port, () => {
    console.log(`税务电子档案借阅服务已启动`);
    console.log(`服务地址: http://localhost:${config.port}`);
    console.log(`健康检查: http://localhost:${config.port}/health`);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('服务启动失败:', err);
    process.exit(1);
  });
}

module.exports = app;

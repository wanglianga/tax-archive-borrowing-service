require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tax_archive_db',
    connectionLimit: 20,
    waitForConnections: true,
    queueLimit: 0
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default_secret_key',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  watermark: {
    text: process.env.WATERMARK_TEXT || '税务电子档案'
  },
  limits: {
    preview: parseInt(process.env.DEFAULT_PREVIEW_LIMIT) || 10,
    download: parseInt(process.env.DEFAULT_DOWNLOAD_LIMIT) || 3,
    borrowDays: parseInt(process.env.DEFAULT_BORROW_DAYS) || 7
  },
  dirs: {
    upload: process.env.UPLOAD_DIR || './uploads',
    preview: process.env.PREVIEW_DIR || './previews',
    desensitized: process.env.DESENSITIZED_DIR || './desensitized'
  }
};

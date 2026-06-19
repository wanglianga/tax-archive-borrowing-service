const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');

async function initDatabase() {
  console.log('开始初始化数据库...');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true
  });

  try {
    const sqlPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await conn.query(sql);
    console.log('数据库表结构创建成功！');
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('数据库初始化完成！');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = initDatabase;

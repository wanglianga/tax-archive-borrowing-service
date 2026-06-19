const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.db);

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function rawQuery(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryWithPagination(sql, params, { page, pageSize }) {
  const limit = Math.max(1, parseInt(pageSize) || 20);
  const offset = (Math.max(1, parseInt(page) || 1) - 1) * limit;
  const paginatedSql = `${sql} LIMIT ${limit} OFFSET ${offset}`;
  const [rows] = await pool.query(paginatedSql, params);
  return rows;
}

async function countQuery(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows[0] ? rows[0].total : 0;
}

async function getConnection() {
  return await pool.getConnection();
}

async function transaction(callback) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  query,
  rawQuery,
  queryWithPagination,
  countQuery,
  getConnection,
  transaction
};

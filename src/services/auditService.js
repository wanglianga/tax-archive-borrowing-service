const db = require('../db');

async function createAuditLog({
  userId,
  username,
  realName,
  action,
  targetType = null,
  targetId = null,
  ipAddress = null,
  userAgent = null,
  requestMethod = null,
  requestPath = null,
  detail = null
}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, username, real_name, action, target_type, target_id,
        ip_address, user_agent, request_method, request_path, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        realName,
        action,
        targetType,
        targetId,
        ipAddress,
        userAgent,
        requestMethod,
        requestPath,
        typeof detail === 'object' ? JSON.stringify(detail) : detail
      ]
    );
  } catch (err) {
    console.error('写入审计日志失败:', err.message);
  }
}

async function queryAuditLogs({
  userId = null,
  action = null,
  targetType = null,
  targetId = null,
  startTime = null,
  endTime = null,
  page = 1,
  pageSize = 20
} = {}) {
  const where = [];
  const params = [];

  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (targetType) {
    where.push('target_type = ?');
    params.push(targetType);
  }
  if (targetId) {
    where.push('target_id = ?');
    params.push(targetId);
  }
  if (startTime) {
    where.push('created_at >= ?');
    params.push(startTime);
  }
  if (endTime) {
    where.push('created_at <= ?');
    params.push(endTime);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (page - 1) * pageSize;

  const [list, countResult] = await Promise.all([
    db.query(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    db.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    )
  ]);

  return {
    list,
    total: countResult[0].total,
    page,
    pageSize
  };
}

module.exports = {
  createAuditLog,
  queryAuditLogs
};

const { verifyToken } = require('../auth');
const { fail, AppError } = require('../utils');
const { ROLES, SENSITIVITY_LEVEL } = require('../constants');
const { getCache } = require('../redis');
const { isExpired } = require('../utils');
const db = require('../db');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail(res, '未提供有效的身份认证凭证', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return fail(res, '身份认证凭证已过期或无效', 401, 'TOKEN_INVALID');
  }

  req.user = payload;
  next();
}

function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) {
      return fail(res, '未登录', 401, 'UNAUTHORIZED');
    }
    if (req.user.role === ROLES.ADMIN) {
      return next();
    }
    if (!allowedRoles.includes(req.user.role)) {
      return fail(res, '当前用户角色无权限执行该操作', 403, 'FORBIDDEN_ROLE');
    }
    next();
  };
}

function requireAnyRole(roleGroups) {
  return function (req, res, next) {
    if (!req.user) {
      return fail(res, '未登录', 401, 'UNAUTHORIZED');
    }
    if (req.user.role === ROLES.ADMIN) {
      return next();
    }
    const hasPermission = roleGroups.some(roles => roles.includes(req.user.role));
    if (!hasPermission) {
      return fail(res, '当前用户角色无权限执行该操作', 403, 'FORBIDDEN_ROLE');
    }
    next();
  };
}

function canApproveSensitivity(sensitivityLevel) {
  return function (req, res, next) {
    if (!req.user) {
      return fail(res, '未登录', 401, 'UNAUTHORIZED');
    }
    if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.SENIOR_APPROVER) {
      return next();
    }
    if (req.user.role === ROLES.APPROVER && sensitivityLevel <= SENSITIVITY_LEVEL.CONFIDENTIAL) {
      return next();
    }
    return fail(res, '审批人级别不足以审批该敏感级别的档案', 403, 'APPROVAL_LEVEL_INSUFFICIENT');
  };
}

async function checkTempAuthorization(userId, archiveId) {
  const cacheKey = `temp_auth:${userId}:${archiveId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return !isExpired(cached.expireAt);
  }

  const records = await db.query(
    `SELECT * FROM temp_authorizations
     WHERE user_id = ? AND (archive_id = ? OR archive_id IS NULL)
       AND is_active = 1 AND expire_at > NOW()
     ORDER BY expire_at DESC LIMIT 1`,
    [userId, archiveId]
  );

  if (records.length > 0) {
    const auth = records[0];
    await require('../redis').setCache(cacheKey, {
      id: auth.id,
      expireAt: auth.expire_at
    }, Math.floor((new Date(auth.expire_at) - Date.now()) / 1000));
    return true;
  }
  return false;
}

async function verifyArchiveAccess(userId, archiveId, applicationId = null) {
  if (applicationId) {
    const items = await db.query(
      `SELECT ba.*, bai.preview_count, bai.download_count, ba.preview_limit, ba.download_limit
       FROM borrow_applications ba
       JOIN borrow_application_items bai ON ba.id = bai.application_id
       WHERE ba.id = ? AND bai.archive_id = ?
         AND ba.approval_status = 'approved' AND ba.is_expired = 0 AND ba.expire_at > NOW()`,
      [applicationId, archiveId]
    );
    if (items.length > 0) {
      return { authorized: true, application: items[0] };
    }
  }

  const anyApproved = await db.query(
    `SELECT ba.*, bai.preview_count, bai.download_count, ba.preview_limit, ba.download_limit
     FROM borrow_applications ba
     JOIN borrow_application_items bai ON ba.id = bai.application_id
     WHERE ba.applicant_id = ? AND bai.archive_id = ?
       AND ba.approval_status = 'approved' AND ba.is_expired = 0 AND ba.expire_at > NOW()
     ORDER BY ba.created_at DESC LIMIT 1`,
    [userId, archiveId]
  );
  if (anyApproved.length > 0) {
    return { authorized: true, application: anyApproved[0] };
  }

  const hasTempAuth = await checkTempAuthorization(userId, archiveId);
  if (hasTempAuth) {
    return { authorized: true, tempAuth: true };
  }

  return { authorized: false };
}

function handleError(err, req, res, next) {
  console.error('Error:', err);
  if (err instanceof AppError) {
    return fail(res, err.message, err.statusCode, err.code);
  }
  return fail(res, '服务器内部错误', 500, 'INTERNAL_ERROR');
}

function notFound(req, res) {
  return fail(res, '请求的资源不存在', 404, 'NOT_FOUND');
}

module.exports = {
  authenticate,
  requireRole,
  requireAnyRole,
  canApproveSensitivity,
  checkTempAuthorization,
  verifyArchiveAccess,
  handleError,
  notFound
};

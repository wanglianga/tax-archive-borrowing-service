const { createAuditLog } = require('../services/auditService');
const { AUDIT_ACTION } = require('../constants');

function auditMiddleware(auditAction, targetType = null, getTargetId = null) {
  return async function (req, res, next) {
    const originalSend = res.send;
    let responseBody = null;

    res.send = function (body) {
      try {
        responseBody = typeof body === 'string' ? body : JSON.stringify(body);
      } catch (e) {}
      return originalSend.apply(this, arguments);
    };

    res.on('finish', async () => {
      try {
        const targetId = getTargetId
          ? (typeof getTargetId === 'function' ? getTargetId(req, res, responseBody) : getTargetId)
          : (req.params.id ? parseInt(req.params.id) : null);

        const detail = {
          requestBody: req.body ? JSON.stringify(req.body) : null,
          queryParams: req.query ? JSON.stringify(req.query) : null,
          statusCode: res.statusCode,
          responseSnippet: responseBody ? responseBody.substring(0, 500) : null
        };

        await createAuditLog({
          userId: req.user ? req.user.id : null,
          username: req.user ? req.user.username : null,
          realName: req.user ? req.user.realName : null,
          action: auditAction,
          targetType,
          targetId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
          userAgent: req.headers['user-agent'],
          requestMethod: req.method,
          requestPath: req.originalUrl,
          detail
        });
      } catch (err) {
        console.error('审计日志记录失败:', err.message);
      }
    });

    next();
  };
}

function auditUnauthorized(req) {
  return createAuditLog({
    userId: req.user ? req.user.id : null,
    username: req.user ? req.user.username : null,
    realName: req.user ? req.user.realName : null,
    action: AUDIT_ACTION.UNAUTHORIZED_ACCESS,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    requestMethod: req.method,
    requestPath: req.originalUrl,
    detail: {
      queryParams: req.query ? JSON.stringify(req.query) : null
    }
  });
}

module.exports = {
  auditMiddleware,
  auditUnauthorized
};

const express = require('express');
const Joi = require('joi');
const { success, fail } = require('../utils');
const { authenticate, requireRole, verifyArchiveAccess, verifyBatchDownload } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const {
  previewArchive,
  downloadArchive,
  batchDownloadArchives,
  getBatchDownloadStatus,
  verifyAccessToken,
  revokeByApplication,
  detectAbnormalConnections
} = require('../services/accessService');
const { ROLES, AUDIT_ACTION } = require('../constants');

const router = express.Router();

router.use(authenticate);

const previewSchema = Joi.object({
  application_id: Joi.number().integer().allow(null),
  watermark_text: Joi.string().max(200).allow(null, '')
});

router.get(
  '/archives/:archiveId/preview',
  auditMiddleware(AUDIT_ACTION.PREVIEW, 'archive', (req) => parseInt(req.params.archiveId)),
  async (req, res, next) => {
    try {
      const archiveId = parseInt(req.params.archiveId);
      await verifyArchiveAccess(req, res, () => {});

      const { error, value } = previewSchema.validate(req.query);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const previewData = await previewArchive({
        archiveId,
        applicationId: value.application_id ? parseInt(value.application_id) : null,
        watermarkText: value.watermark_text || null,
        userId: req.user.id,
        userName: req.user.username,
        userRole: req.user.role,
        requestIp: req.clientIp,
        userAgent: req.headers['user-agent']
      });

      return success(res, previewData);
    } catch (err) {
      next(err);
    }
  }
);

const downloadSchema = Joi.object({
  application_id: Joi.number().integer().allow(null),
  watermark_text: Joi.string().max(200).allow(null, ''),
  format: Joi.string().valid('original', 'watermarked').default('watermarked')
});

router.get(
  '/archives/:archiveId/download',
  auditMiddleware(AUDIT_ACTION.DOWNLOAD, 'archive', (req) => parseInt(req.params.archiveId)),
  async (req, res, next) => {
    try {
      const archiveId = parseInt(req.params.archiveId);
      await verifyArchiveAccess(req, res, () => {});

      const { error, value } = downloadSchema.validate(req.query);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const downloadData = await downloadArchive({
        archiveId,
        applicationId: value.application_id ? parseInt(value.application_id) : null,
        watermarkText: value.watermark_text || null,
        format: value.format,
        userId: req.user.id,
        userName: req.user.username,
        userRole: req.user.role,
        requestIp: req.clientIp,
        userAgent: req.headers['user-agent']
      });

      return success(res, downloadData);
    } catch (err) {
      next(err);
    }
  }
);

const batchDownloadSchema = Joi.object({
  archive_ids: Joi.array().items(Joi.number().integer()).min(1).max(100).required().messages({
    'any.required': '请选择要下载的档案'
  }),
  application_ids: Joi.array().items(Joi.number().integer()).allow(null),
  watermark_text: Joi.string().max(200).allow(null, '')
});

router.post(
  '/archives/batch-download',
  auditMiddleware(AUDIT_ACTION.BATCH_DOWNLOAD),
  async (req, res, next) => {
    try {
      const { error, value } = batchDownloadSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const batchResult = await batchDownloadArchives({
        archiveIds: value.archive_ids,
        applicationIds: value.application_ids || [],
        watermarkText: value.watermark_text || null,
        userId: req.user.id,
        userName: req.user.username,
        userRole: req.user.role,
        requestIp: req.clientIp,
        userAgent: req.headers['user-agent']
      });

      return success(res, batchResult, '批量下载任务已创建');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/batch/:batchId/status', async (req, res, next) => {
  try {
    const batchId = parseInt(req.params.batchId);
    const status = await getBatchDownloadStatus(batchId, req.user.id);
    return success(res, status);
  } catch (err) {
    next(err);
  }
});

router.get('/archives/tokens/verify', async (req, res, next) => {
  try {
    const token = (req.headers['x-access-token'] || req.query.token || '').toString();
    const clientIp = req.clientIp;
    const userAgent = req.headers['user-agent'];
    const result = verifyAccessToken(token, clientIp, userAgent);
    return success(res, result);
  } catch (err) {
    if (err.message.includes('令牌') || err.message.includes('IP') || err.message.includes('过期') || err.message.includes('浏览器')) {
      return fail(res, err.message, 403, 'TOKEN_INVALID');
    }
    next(err);
  }
});

const revokeSchema = Joi.object({
  reason: Joi.string().min(1).max(500).allow(null, '')
});

router.post(
  '/applications/:applicationId/revoke',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.AUTHORIZATION_EXPIRE_RECYCLE, 'borrow_application', (req) => parseInt(req.params.applicationId)),
  async (req, res, next) => {
    try {
      const applicationId = parseInt(req.params.applicationId);
      const { error, value } = revokeSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }
      const result = await revokeByApplication(
        applicationId,
        req.user.id,
        value.reason || '管理员主动回收授权'
      );
      return success(res, result, '授权已全部回收');
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/applications/:applicationId/abnormal-connections',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  async (req, res, next) => {
    try {
      const applicationId = req.params.applicationId ? parseInt(req.params.applicationId) : null;
      const result = await detectAbnormalConnections(applicationId);
      return success(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/abnormal-connections',
  requireRole(ROLES.ADMIN, ROLES.SENIOR_APPROVER),
  async (req, res, next) => {
    try {
      const result = await detectAbnormalConnections(null);
      return success(res, result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

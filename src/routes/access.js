const express = require('express');
const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const { success, fail } = require('../utils');
const { authenticate, requireRole, verifyArchiveAccess } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const {
  previewArchive,
  downloadArchive,
  batchDownloadArchives,
  recycleExpiredArchives
} = require('../services/accessService');
const { ROLES, AUDIT_ACTION } = require('../constants');

const router = express.Router();

router.use(authenticate);

const previewSchema = Joi.object({
  application_id: Joi.number().integer().allow(null)
});

router.get(
  '/preview/:archiveId',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  async (req, res, next) => {
    try {
      const { error, value } = previewSchema.validate(req.query);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await previewArchive({
        userId: req.user.id,
        userName: req.user.realName,
        archiveId: parseInt(req.params.archiveId),
        applicationId: value.application_id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return success(res, result);
    } catch (err) {
      next(err);
    }
  }
);

const downloadSchema = Joi.object({
  application_id: Joi.number().integer().allow(null)
});

router.get(
  '/download/:archiveId',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  async (req, res, next) => {
    try {
      const { error, value } = downloadSchema.validate(req.query);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await downloadArchive({
        userId: req.user.id,
        userName: req.user.realName,
        archiveId: parseInt(req.params.archiveId),
        applicationId: value.application_id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return success(res, result, '下载权限已验证');
    } catch (err) {
      next(err);
    }
  }
);

const batchDownloadSchema = Joi.object({
  archive_ids: Joi.array().items(Joi.number().integer()).allow(null)
});

router.post(
  '/batch-download/:applicationId',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  async (req, res, next) => {
    try {
      const { error, value } = batchDownloadSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await batchDownloadArchives({
        userId: req.user.id,
        userName: req.user.realName,
        applicationId: parseInt(req.params.applicationId),
        archiveIds: value.archive_ids,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return success(res, result, '批量下载权限已验证');
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/recycle',
  requireRole(ROLES.ADMIN),
  auditMiddleware(AUDIT_ACTION.RECYCLE, 'system'),
  async (req, res, next) => {
    try {
      const result = await recycleExpiredArchives();
      return success(res, result, '到期回收执行完成');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

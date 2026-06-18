const express = require('express');
const Joi = require('joi');
const { success, fail } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const {
  approveApplication,
  rejectApplication,
  recallApplication,
  createTempAuthorization,
  listPendingApprovals
} = require('../services/approvalService');
const { ROLES, AUDIT_ACTION } = require('../constants');

const router = express.Router();

router.use(authenticate);

router.get('/pending', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await listPendingApprovals(
      req.user.id,
      parseInt(page),
      parseInt(pageSize)
    );
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

const approveSchema = Joi.object({
  comment: Joi.string().max(500).allow(null, '')
});

router.post(
  '/:applicationId/approve',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.APPROVE, 'borrow_application', (req) => parseInt(req.params.applicationId)),
  async (req, res, next) => {
    try {
      const { error, value } = approveSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await approveApplication({
        applicationId: parseInt(req.params.applicationId),
        approverId: req.user.id,
        approverRole: req.user.role,
        comment: value.comment
      });

      return success(res, result, '审批通过');
    } catch (err) {
      next(err);
    }
  }
);

const rejectSchema = Joi.object({
  comment: Joi.string().min(1).max(500).required().messages({
    'any.required': '请填写驳回理由'
  })
});

router.post(
  '/:applicationId/reject',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.REJECT, 'borrow_application', (req) => parseInt(req.params.applicationId)),
  async (req, res, next) => {
    try {
      const { error, value } = rejectSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await rejectApplication({
        applicationId: parseInt(req.params.applicationId),
        approverId: req.user.id,
        approverRole: req.user.role,
        comment: value.comment
      });

      return success(res, result, '已驳回申请');
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:applicationId/recall',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  async (req, res, next) => {
    try {
      const result = await recallApplication({
        applicationId: parseInt(req.params.applicationId),
        applicantId: req.user.id
      });
      return success(res, result, '已撤回申请');
    } catch (err) {
      next(err);
    }
  }
);

const tempAuthSchema = Joi.object({
  user_id: Joi.number().integer().required(),
  archive_id: Joi.number().integer().allow(null),
  application_id: Joi.number().integer().allow(null),
  reason: Joi.string().min(1).max(500).required(),
  expire_hours: Joi.number().integer().min(1).max(168).default(24)
});

router.post(
  '/temp-authorize',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.TEMP_AUTH, 'temp_authorization'),
  async (req, res, next) => {
    try {
      const { error, value } = tempAuthSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await createTempAuthorization({
        userId: value.user_id,
        archiveId: value.archive_id,
        applicationId: value.application_id,
        authorizedBy: req.user.id,
        reason: value.reason,
        expireHours: value.expire_hours
      });

      return success(res, result, '临时授权已创建');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

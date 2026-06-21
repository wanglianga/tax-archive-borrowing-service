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
  listPendingApprovals,
  listApproverNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require('../services/approvalService');
const {
  listPendingDesensitizeTasks,
  retryDesensitizeTask,
  resolveDesensitizeTaskManually
} = require('../services/desensitizeService');
const { ROLES, AUDIT_ACTION, AUTHORIZATION_LEVEL } = require('../constants');

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

router.get('/desensitize-tasks',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  async (req, res, next) => {
    try {
      const { page = 1, pageSize = 20 } = req.query;
      const result = await listPendingDesensitizeTasks(
        req.user.id,
        parseInt(page),
        parseInt(pageSize)
      );
      return success(res, result);
    } catch (err) {
      next(err);
    }
  }
);

const retryTaskSchema = Joi.object({
  new_auth_level: Joi.number().integer().min(1).max(4).allow(null),
  resolution_note: Joi.string().max(1000).allow(null, '')
});

router.post('/desensitize-tasks/:taskId/retry',
  requireRole(ROLES.ADMIN, ROLES.APPROVER, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.DESENSITIZE_TASK_RETRY, 'desensitize_task', (req) => parseInt(req.params.taskId)),
  async (req, res, next) => {
    try {
      const { error, value } = retryTaskSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const taskId = parseInt(req.params.taskId);
      const result = await retryDesensitizeTask(
        taskId,
        req.user.id,
        value.new_auth_level,
        value.resolution_note
      );
      return success(res, result, '脱敏任务重试已提交');
    } catch (err) {
      next(err);
    }
  }
);

const resolveTaskSchema = Joi.object({
  resolution_note: Joi.string().min(1).max(1000).required().messages({
    'any.required': '请填写人工介入处理说明'
  }),
  new_auth_level: Joi.number().integer().min(1).max(4).default(4)
});

router.post('/desensitize-tasks/:taskId/resolve',
  requireRole(ROLES.ADMIN, ROLES.SENIOR_APPROVER),
  auditMiddleware(AUDIT_ACTION.DESENSITIZE_TASK_RESOLVED, 'desensitize_task', (req) => parseInt(req.params.taskId)),
  async (req, res, next) => {
    try {
      const { error, value } = resolveTaskSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const taskId = parseInt(req.params.taskId);
      const result = await resolveDesensitizeTaskManually(
        taskId,
        req.user.id,
        value.resolution_note,
        value.new_auth_level
      );
      return success(res, result, '脱敏任务已人工介入处理');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/notifications', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, is_read = null } = req.query;
    const isRead = is_read === null ? null : (is_read === 'true' || is_read === '1');
    const result = await listApproverNotifications(
      req.user.id,
      isRead,
      parseInt(page),
      parseInt(pageSize)
    );
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/:notificationId/read', async (req, res, next) => {
  try {
    const notificationId = parseInt(req.params.notificationId);
    const result = await markNotificationRead(notificationId, req.user.id);
    return success(res, result, '通知已标记为已读');
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    const result = await markAllNotificationsRead(req.user.id);
    return success(res, result, `已将 ${result.affected} 条通知标记为已读`);
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

router.get('/authorization-levels', (req, res) => {
  const levels = [
    { level: AUTHORIZATION_LEVEL.LEVEL_1_BASIC, name: '基础授权', desc: '屏蔽所有身份证号、银行账号、联系人姓名电话、供应商明细' },
    { level: AUTHORIZATION_LEVEL.LEVEL_2_STANDARD, name: '标准授权', desc: '屏蔽身份证号中段、银行账号中段，保留联系人姓氏，供应商仅保留名称' },
    { level: AUTHORIZATION_LEVEL.LEVEL_3_ADVANCED, name: '高级授权', desc: '保留身份证号前6后4、银行账号前6后4，保留联系人姓名但屏蔽电话，供应商保留主要字段' },
    { level: AUTHORIZATION_LEVEL.LEVEL_4_FULL, name: '完全授权', desc: '完整可见，仅加水印追溯（仅限最高级审批人指定）' }
  ];
  return success(res, levels);
});

module.exports = router;

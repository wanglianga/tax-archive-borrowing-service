const express = require('express');
const Joi = require('joi');
const { success, fail } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { queryAuditLogs } = require('../services/auditService');
const { ROLES } = require('../constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(ROLES.ADMIN, ROLES.AUDITOR));

const querySchema = Joi.object({
  user_id: Joi.number().integer().allow(null),
  action: Joi.string().max(50).allow(null),
  target_type: Joi.string().max(50).allow(null),
  target_id: Joi.number().integer().allow(null),
  start_time: Joi.string().allow(null),
  end_time: Joi.string().allow(null),
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(200).default(20)
});

router.get('/', async (req, res, next) => {
  try {
    const { error, value } = querySchema.validate(req.query);
    if (error) {
      return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
    }

    const result = await queryAuditLogs({
      userId: value.user_id,
      action: value.action,
      targetType: value.target_type,
      targetId: value.target_id,
      startTime: value.start_time,
      endTime: value.end_time,
      page: value.page,
      pageSize: value.page_size
    });

    return success(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/actions', (req, res) => {
  return success(res, {
    actions: [
      'login', 'logout',
      'create_application',
      'approve', 'reject',
      'preview_archive', 'download_archive',
      'desensitize', 'desensitize_failed',
      'recycle', 'temp_auth',
      'unauthorized_access'
    ]
  });
});

module.exports = router;

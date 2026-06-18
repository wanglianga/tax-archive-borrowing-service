const express = require('express');
const Joi = require('joi');
const { success, fail } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const {
  createBorrowApplication,
  listBorrowApplications,
  getBorrowApplicationDetail
} = require('../services/borrowService');
const { ROLES, BORROW_PURPOSE, AUDIT_ACTION } = require('../constants');

const router = express.Router();

router.use(authenticate);

const createSchema = Joi.object({
  purpose: Joi.string().valid(...Object.values(BORROW_PURPOSE)).required(),
  case_number: Joi.string().max(100).allow(null, ''),
  reason: Joi.string().required(),
  archive_ids: Joi.array().items(Joi.number().integer()).min(1).required(),
  borrow_days: Joi.number().integer().min(1).max(30).allow(null),
  preview_limit: Joi.number().integer().min(1).max(100).allow(null),
  download_limit: Joi.number().integer().min(1).max(50).allow(null),
  remark: Joi.string().max(500).allow(null, '')
});

router.post(
  '/',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  auditMiddleware(AUDIT_ACTION.CREATE_APPLICATION, 'borrow_application'),
  async (req, res, next) => {
    try {
      const { error, value } = createSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await createBorrowApplication({
        applicantId: req.user.id,
        purpose: value.purpose,
        caseNumber: value.case_number,
        reason: value.reason,
        archiveIds: value.archive_ids,
        borrowDays: value.borrow_days,
        previewLimit: value.preview_limit,
        downloadLimit: value.download_limit,
        remark: value.remark
      });

      return success(res, result, '申请已提交');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const { status = null, keyword = '', page = 1, pageSize = 20, scope = 'self' } = req.query;
    let applicantId = null;
    let approverId = null;

    if (scope === 'self' && req.user.role === ROLES.TAX_OFFICER) {
      applicantId = req.user.id;
    } else if (scope === 'approve' && (req.user.role === ROLES.APPROVER || req.user.role === ROLES.SENIOR_APPROVER)) {
      approverId = req.user.id;
    } else if (scope === 'all' && (req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR)) {
    } else {
      applicantId = req.user.id;
    }

    const result = await listBorrowApplications({
      applicantId,
      status,
      approverId,
      keyword,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });

    return success(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const detail = await getBorrowApplicationDetail(parseInt(req.params.id));
    if (!detail) {
      return fail(res, '借阅申请不存在', 404, 'APPLICATION_NOT_FOUND');
    }

    if (req.user.role === ROLES.TAX_OFFICER && detail.applicant_id !== req.user.id) {
      return fail(res, '无权查看该申请', 403, 'FORBIDDEN');
    }

    return success(res, detail);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

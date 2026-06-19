const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { success, fail, AppError } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { AUDIT_ACTION, ROLES } = require('../constants');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { keyword = '', page = 1, pageSize = 20 } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (keyword) {
      where += ' AND (taxpayer_id LIKE ? OR taxpayer_name LIKE ? OR legal_person LIKE ?)';
      const likeKeyword = `%${keyword}%`;
      params.push(likeKeyword, likeKeyword, likeKeyword);
    }

    const listSql = `SELECT * FROM taxpayers ${where} ORDER BY created_at DESC`;
    const countSql = `SELECT COUNT(*) as total FROM taxpayers ${where}`;

    const [list, total] = await Promise.all([
      db.queryWithPagination(listSql, params, { page, pageSize }),
      db.countQuery(countSql, params)
    ]);

    return success(res, {
      list,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const taxpayers = await db.query(
      'SELECT * FROM taxpayers WHERE id = ? LIMIT 1',
      [parseInt(req.params.id)]
    );

    if (taxpayers.length === 0) {
      return fail(res, '纳税人不存在', 404, 'TAXPAYER_NOT_FOUND');
    }

    return success(res, taxpayers[0]);
  } catch (err) {
    next(err);
  }
});

const createSchema = Joi.object({
  taxpayer_id: Joi.string().required().max(50),
  taxpayer_name: Joi.string().required().max(200),
  taxpayer_type: Joi.string().max(50).allow(null, ''),
  legal_person: Joi.string().max(50).allow(null, ''),
  phone: Joi.string().max(20).allow(null, ''),
  address: Joi.string().max(500).allow(null, ''),
  industry: Joi.string().max(100).allow(null, ''),
  registration_date: Joi.date().allow(null)
});

router.post(
  '/',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  auditMiddleware(AUDIT_ACTION.CREATE_APPLICATION, 'taxpayer'),
  async (req, res, next) => {
    try {
      const { error, value } = createSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const exists = await db.query(
        'SELECT id FROM taxpayers WHERE taxpayer_id = ?',
        [value.taxpayer_id]
      );
      if (exists.length > 0) {
        return fail(res, '该纳税人识别号已存在', 400, 'TAXPAYER_EXISTS');
      }

      const result = await db.query(
        `INSERT INTO taxpayers (taxpayer_id, taxpayer_name, taxpayer_type, legal_person, phone, address, industry, registration_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          value.taxpayer_id, value.taxpayer_name, value.taxpayer_type,
          value.legal_person, value.phone, value.address, value.industry,
          value.registration_date || null
        ]
      );

      return success(res, { id: result.insertId }, '创建成功');
    } catch (err) {
      next(err);
    }
  }
);

const updateSchema = Joi.object({
  taxpayer_name: Joi.string().max(200),
  taxpayer_type: Joi.string().max(50).allow(null, ''),
  legal_person: Joi.string().max(50).allow(null, ''),
  phone: Joi.string().max(20).allow(null, ''),
  address: Joi.string().max(500).allow(null, ''),
  industry: Joi.string().max(100).allow(null, ''),
  registration_date: Joi.date().allow(null),
  status: Joi.number().valid(0, 1)
});

router.put(
  '/:id',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  async (req, res, next) => {
    try {
      const { error, value } = updateSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const taxpayers = await db.query(
        'SELECT id FROM taxpayers WHERE id = ?',
        [parseInt(req.params.id)]
      );
      if (taxpayers.length === 0) {
        return fail(res, '纳税人不存在', 404, 'TAXPAYER_NOT_FOUND');
      }

      const updates = [];
      const params = [];
      for (const [key, val] of Object.entries(value)) {
        if (val !== undefined) {
          updates.push(`${key} = ?`);
          params.push(val);
        }
      }

      if (updates.length > 0) {
        params.push(parseInt(req.params.id));
        await db.query(
          `UPDATE taxpayers SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
      }

      return success(res, null, '更新成功');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

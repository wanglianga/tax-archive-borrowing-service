const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { success, fail } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { ROLES, SENSITIVITY_LEVEL, ARCHIVE_TYPE } = require('../constants');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const {
      keyword = '',
      taxpayerId = null,
      catalogId = null,
      archiveType = null,
      sensitivityLevel = null,
      caseNumber = null,
      page = 1,
      pageSize = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const params = [];
    let where = 'WHERE a.status = 1';

    if (keyword) {
      where += ' AND (a.title LIKE ? OR a.archive_code LIKE ?)';
      const likeKeyword = `%${keyword}%`;
      params.push(likeKeyword, likeKeyword);
    }
    if (taxpayerId) {
      where += ' AND a.taxpayer_id = ?';
      params.push(parseInt(taxpayerId));
    }
    if (catalogId) {
      where += ' AND a.catalog_id = ?';
      params.push(parseInt(catalogId));
    }
    if (archiveType) {
      where += ' AND a.archive_type = ?';
      params.push(archiveType);
    }
    if (sensitivityLevel) {
      where += ' AND a.sensitivity_level = ?';
      params.push(parseInt(sensitivityLevel));
    }
    if (caseNumber) {
      where += ' AND a.case_number LIKE ?';
      params.push(`%${caseNumber}%`);
    }

    const [list, countResult] = await Promise.all([
      db.query(
        `SELECT a.*, t.taxpayer_name, t.taxpayer_id as taxpayer_id_no, c.name as catalog_name
         FROM archives a
         LEFT JOIN taxpayers t ON a.taxpayer_id = t.id
         LEFT JOIN archive_catalogs c ON a.catalog_id = c.id
         ${where}
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset]
      ),
      db.query(
        `SELECT COUNT(*) as total FROM archives a ${where}`,
        params
      )
    ]);

    return success(res, {
      list,
      total: countResult[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const archives = await db.query(
      `SELECT a.*, t.taxpayer_name, t.taxpayer_id as taxpayer_id_no, c.name as catalog_name
       FROM archives a
       LEFT JOIN taxpayers t ON a.taxpayer_id = t.id
       LEFT JOIN archive_catalogs c ON a.catalog_id = c.id
       WHERE a.id = ? LIMIT 1`,
      [parseInt(req.params.id)]
    );

    if (archives.length === 0) {
      return fail(res, '档案不存在', 404, 'ARCHIVE_NOT_FOUND');
    }

    return success(res, archives[0]);
  } catch (err) {
    next(err);
  }
});

const createSchema = Joi.object({
  archive_code: Joi.string().required().max(100),
  title: Joi.string().required().max(300),
  taxpayer_id: Joi.number().integer().required(),
  catalog_id: Joi.number().integer().allow(null),
  archive_type: Joi.string().valid(...Object.values(ARCHIVE_TYPE)).required(),
  sensitivity_level: Joi.number().valid(1, 2, 3, 4).default(1),
  case_number: Joi.string().max(100).allow(null, ''),
  file_name: Joi.string().max(300).allow(null, ''),
  file_path: Joi.string().max(500).allow(null, ''),
  file_size: Joi.number().default(0),
  period_year: Joi.number().integer().allow(null),
  period_month: Joi.number().integer().allow(null),
  description: Joi.string().allow(null, ''),
  tags: Joi.string().max(500).allow(null, ''),
  requires_desensitization: Joi.number().valid(0, 1).default(0),
  desensitization_rule: Joi.string().allow(null, '')
});

router.post(
  '/',
  requireRole(ROLES.ADMIN, ROLES.TAX_OFFICER),
  auditMiddleware('create_archive', 'archive'),
  async (req, res, next) => {
    try {
      const { error, value } = createSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const exists = await db.query(
        'SELECT id FROM archives WHERE archive_code = ?',
        [value.archive_code]
      );
      if (exists.length > 0) {
        return fail(res, '该档案编号已存在', 400, 'ARCHIVE_CODE_EXISTS');
      }

      const result = await db.query(
        `INSERT INTO archives (archive_code, title, taxpayer_id, catalog_id, archive_type,
          sensitivity_level, case_number, file_name, file_path, file_size,
          period_year, period_month, description, tags, requires_desensitization,
          desensitization_rule, uploader_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          value.archive_code, value.title, value.taxpayer_id, value.catalog_id,
          value.archive_type, value.sensitivity_level, value.case_number,
          value.file_name, value.file_path, value.file_size, value.period_year,
          value.period_month, value.description, value.tags,
          value.requires_desensitization, value.desensitization_rule,
          req.user.id
        ]
      );

      return success(res, { id: result.insertId }, '创建成功');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

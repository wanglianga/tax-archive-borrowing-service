const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { success, fail } = require('../utils');
const { authenticate, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const catalogs = await db.query(
      'SELECT * FROM archive_catalogs WHERE status = 1 ORDER BY parent_id, sort_order'
    );

    const tree = buildTree(catalogs);
    return success(res, tree);
  } catch (err) {
    next(err);
  }
});

function buildTree(items, parentId = 0) {
  const result = [];
  for (const item of items) {
    if (item.parent_id === parentId) {
      const node = {
        id: item.id,
        name: item.name,
        parentId: item.parent_id,
        sortOrder: item.sort_order,
        description: item.description,
        children: buildTree(items, item.id)
      };
      result.push(node);
    }
  }
  return result;
}

const createSchema = Joi.object({
  name: Joi.string().required().max(100),
  parent_id: Joi.number().integer().default(0),
  sort_order: Joi.number().integer().default(0),
  description: Joi.string().max(500).allow(null, '')
});

router.post(
  '/',
  requireRole(ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const { error, value } = createSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const result = await db.query(
        `INSERT INTO archive_catalogs (name, parent_id, sort_order, description) VALUES (?, ?, ?, ?)`,
        [value.name, value.parent_id, value.sort_order, value.description || value.name]
      );

      return success(res, { id: result.insertId }, '创建成功');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

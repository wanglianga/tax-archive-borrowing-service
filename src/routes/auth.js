const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { generateToken, comparePassword } = require('../auth');
const { success, fail } = require('../utils');
const { auditMiddleware } = require('../middleware/audit');
const { AUDIT_ACTION } = require('../constants');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const loginSchema = Joi.object({
  username: Joi.string().required().messages({
    'any.required': '用户名不能为空'
  }),
  password: Joi.string().required().messages({
    'any.required': '密码不能为空'
  })
});

router.post(
  '/login',
  auditMiddleware(AUDIT_ACTION.LOGIN, 'user'),
  async (req, res) => {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return fail(res, error.details[0].message, 400, 'VALIDATION_ERROR');
      }

      const users = await db.query(
        'SELECT * FROM users WHERE username = ? AND status = 1 LIMIT 1',
        [value.username]
      );

      if (users.length === 0) {
        return fail(res, '用户名或密码错误', 401, 'LOGIN_FAILED');
      }

      const user = users[0];
      if (!comparePassword(value.password, user.password)) {
        return fail(res, '用户名或密码错误', 401, 'LOGIN_FAILED');
      }

      const token = generateToken(user);

      return success(res, {
        token,
        user: {
          id: user.id,
          username: user.username,
          realName: user.real_name,
          role: user.role,
          employeeId: user.employee_id,
          department: user.department,
          position: user.position
        }
      }, '登录成功');
    } catch (err) {
      console.error(err);
      return fail(res, '登录失败，请稍后重试', 500, 'LOGIN_ERROR');
    }
  }
);

router.get(
  '/me',
  authenticate,
  async (req, res) => {
    try {
      const users = await db.query(
        'SELECT id, username, real_name, role, employee_id, department, position, email, phone FROM users WHERE id = ? LIMIT 1',
        [req.user.id]
      );

      if (users.length === 0) {
        return fail(res, '用户不存在', 404, 'USER_NOT_FOUND');
      }

      const user = users[0];
      return success(res, {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        role: user.role,
        employeeId: user.employee_id,
        department: user.department,
        position: user.position,
        email: user.email,
        phone: user.phone
      });
    } catch (err) {
      console.error(err);
      return fail(res, '获取用户信息失败', 500, 'GET_USER_ERROR');
    }
  }
);

router.post('/logout', authenticate, async (req, res) => {
  return success(res, null, '已退出登录');
});

module.exports = router;

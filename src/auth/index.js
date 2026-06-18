const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');

function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    role: user.role,
    employeeId: user.employee_id,
    department: user.department
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return null;
  }
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword
};

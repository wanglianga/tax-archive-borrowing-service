const dayjs = require('dayjs');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

function success(res, data = null, message = 'success', statusCode = 200) {
  return res.status(statusCode).json({
    code: 0,
    message,
    data
  });
}

function fail(res, message = 'error', statusCode = 500, errorCode = 'INTERNAL_ERROR') {
  return res.status(statusCode).json({
    code: -1,
    message,
    errorCode,
    data: null
  });
}

function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  return dayjs(date).format(format);
}

function isExpired(expireAt) {
  return dayjs().isAfter(dayjs(expireAt));
}

function addDays(date, days) {
  return dayjs(date).add(days, 'day').toDate();
}

function maskTaxId(taxId) {
  if (!taxId || taxId.length < 10) return taxId;
  return taxId.slice(0, 4) + '********' + taxId.slice(-4);
}

function maskPhone(phone) {
  if (!phone || phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function maskBankAccount(account) {
  if (!account || account.length < 8) return account;
  return account.slice(0, 4) + '****' + account.slice(-4);
}

function maskAmount(amount) {
  if (amount === null || amount === undefined) return amount;
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num >= 10000) {
    return Math.round(num / 1000) * 1000;
  }
  return num;
}

function generateWatermarkText(userId, userName, timestamp) {
  return `${userId}-${userName}-${formatDate(timestamp || new Date())}`;
}

module.exports = {
  AppError,
  success,
  fail,
  formatDate,
  isExpired,
  addDays,
  maskTaxId,
  maskPhone,
  maskBankAccount,
  maskAmount,
  generateWatermarkText
};

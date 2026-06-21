const dayjs = require('dayjs');
const { v4: uuidv4 } = require('uuid');

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

function addHours(date, hours) {
  return dayjs(date).add(hours, 'hour').toDate();
}

function maskTaxId(taxId) {
  if (!taxId || taxId.length < 10) return taxId;
  return taxId.slice(0, 4) + '********' + taxId.slice(-4);
}

function maskTaxIdStandard(taxId) {
  if (!taxId || taxId.length < 10) return taxId;
  const head = taxId.slice(0, 6);
  const tail = taxId.slice(-4);
  const midLen = taxId.length - 10;
  return head + '*'.repeat(Math.max(midLen, 6)) + tail;
}

function maskTaxIdAdvanced(taxId) {
  if (!taxId || taxId.length < 10) return taxId;
  return taxId.slice(0, 6) + '****' + taxId.slice(-4);
}

function maskPhone(phone) {
  if (!phone || phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function maskPhoneKeepHead(phone) {
  if (!phone || phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-2);
}

function maskBankAccount(account) {
  if (!account || account.length < 8) return account;
  return account.slice(0, 4) + '****' + account.slice(-4);
}

function maskBankAccountStandard(account) {
  if (!account || account.length < 12) return maskBankAccount(account);
  return account.slice(0, 6) + '****' + account.slice(-4);
}

function maskBankAccountAdvanced(account) {
  if (!account || account.length < 12) return maskBankAccount(account);
  return account.slice(0, 6) + '**' + account.slice(-4);
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

function maskAmountRough(amount) {
  if (amount === null || amount === undefined) return amount;
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num >= 100000000) {
    return Math.round(num / 10000000) * 10000000 + '（约）';
  }
  if (num >= 10000) {
    return Math.round(num / 10000) + '万元（约）';
  }
  return num;
}

function maskIdCard(idCard) {
  if (!idCard) return idCard;
  const str = String(idCard);
  if (str.length < 10) return str;
  return str.slice(0, 4) + '**********' + str.slice(-4);
}

function maskIdCardStandard(idCard) {
  if (!idCard) return idCard;
  const str = String(idCard);
  if (str.length < 10) return str;
  return str.slice(0, 6) + '********' + str.slice(-4);
}

function maskIdCardAdvanced(idCard) {
  if (!idCard) return idCard;
  const str = String(idCard);
  if (str.length < 10) return str;
  return str.slice(0, 6) + '****' + str.slice(-4);
}

function maskCaseContactName(name) {
  if (!name) return name;
  const str = String(name);
  if (str.length <= 1) return str;
  if (str.length === 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str.slice(-1);
}

function maskCaseContactNameStandard(name) {
  if (!name) return name;
  const str = String(name);
  if (str.length <= 1) return str;
  return str[0] + '某';
}

function maskAddress(address) {
  if (!address) return address;
  const str = String(address);
  if (str.length <= 6) return str[0] + '***';
  return str.slice(0, 6) + '***' + str.slice(-2);
}

function maskSupplierDetail(supplier, level = 1) {
  if (!supplier) return supplier;
  if (typeof supplier === 'string') {
    return level <= 2 ? '***供应商信息已屏蔽***' : supplier;
  }
  if (typeof supplier !== 'object') return supplier;

  const result = { ...supplier };
  if (level === 1) {
    result.name = result.name ? maskCaseContactName(result.name) : result.name;
    result.contact_name = undefined;
    result.contact_phone = undefined;
    result.bank_account = undefined;
    result.address = undefined;
    result.tax_id = undefined;
    result.amount = result.amount !== undefined ? maskAmountRough(result.amount) : result.amount;
    result.__masked = '供应商明细已完全屏蔽，仅保留脱敏名称';
  } else if (level === 2) {
    result.name = result.name || '';
    result.contact_name = result.contact_name ? maskCaseContactNameStandard(result.contact_name) : undefined;
    result.contact_phone = result.contact_phone ? maskPhone(result.contact_phone) : undefined;
    result.bank_account = result.bank_account ? maskBankAccount(result.bank_account) : undefined;
    result.address = result.address ? maskAddress(result.address) : undefined;
    result.tax_id = result.tax_id ? maskTaxId(result.tax_id) : undefined;
    result.amount = result.amount !== undefined ? maskAmount(result.amount) : result.amount;
    result.__masked = '供应商明细按标准级别脱敏';
  } else if (level === 3) {
    result.contact_phone = result.contact_phone ? maskPhoneKeepHead(result.contact_phone) : undefined;
    result.bank_account = result.bank_account ? maskBankAccountAdvanced(result.bank_account) : undefined;
    result.tax_id = result.tax_id ? maskTaxIdAdvanced(result.tax_id) : undefined;
    result.address = result.address;
    result.amount = result.amount;
    result.__masked = '供应商明细按高级级别脱敏';
  }
  return result;
}

function generateWatermarkText(userId, userName, timestamp) {
  return `${userId}-${userName}-${formatDate(timestamp || new Date())}`;
}

function generateAccessToken() {
  return `tk_${uuidv4().replace(/-/g, '')}`;
}

function generateDownloadToken() {
  return `dl_${uuidv4().replace(/-/g, '')}${Date.now().toString(36)}`;
}

function generateBatchId() {
  return `BATCH_${dayjs().format('YYYYMMDDHHmmss')}_${uuidv4().slice(0, 8).toUpperCase()}`;
}

function generateWatermarkFileId() {
  return `WM_${dayjs().format('YYYYMMDD')}_${uuidv4().slice(0, 10)}`;
}

function detectSensitiveContent(content) {
  const detected = [];
  if (!content) return detected;
  const text = typeof content === 'string' ? content : JSON.stringify(content);

  if (/\d{17}[\dXx]/.test(text) || /身份证号?[码]?[：:]\s*\d+/.test(text)) {
    detected.push('id_card');
  }
  if (/\d{16,22}/.test(text) || /银行卡?号?[：:]\s*\d+/.test(text) || /账号[：:]\s*\d{10,}/.test(text)) {
    detected.push('bank_account');
  }
  if (/联系人|涉案人员|当事人|举报人|被举报人/.test(text)) {
    detected.push('case_contact');
  }
  if (/供应商|供货方|采购|明细/.test(text)) {
    detected.push('supplier_detail');
  }
  if (/1[3-9]\d{9}/.test(text) || /电话[：:]/i.test(text) || /手机[：:]/i.test(text)) {
    detected.push('phone');
  }
  if (/地址[：:]|住址|住所地/.test(text)) {
    detected.push('address');
  }
  if (/金额|涉案金额|税额|罚款|元[，,\s]/.test(text)) {
    detected.push('amount');
  }
  if (/法人|法定代表人|法人代表/.test(text)) {
    detected.push('legal_person');
  }

  return [...new Set(detected)];
}

function getSensitivityRuleByLevel(archive, authLevel = 1) {
  if (!archive) return '';
  const rules = [];
  const baseRule = archive.desensitization_rule || '';

  if (authLevel >= 1) {
    rules.push('mask_id_card');
    rules.push('mask_bank_account');
    rules.push('mask_phone');
    rules.push('mask_case_contact');
    rules.push('mask_supplier');
  }
  if (authLevel >= 2) {
    rules.push('keep_idcard_head');
    rules.push('keep_bank_head');
    rules.push('keep_contact_surname');
    rules.push('keep_supplier_name');
  }
  if (authLevel >= 3) {
    rules.push('keep_idcard_more');
    rules.push('keep_bank_more');
    rules.push('keep_contact_name');
    rules.push('keep_supplier_main');
    rules.push('mask_amount_rough');
  }
  if (authLevel >= 4) {
    return 'no_mask';
  }

  return rules.join(',');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function shortHash(str, len = 8) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(len, '0').slice(0, len);
}

module.exports = {
  AppError,
  success,
  fail,
  formatDate,
  isExpired,
  addDays,
  addHours,
  maskTaxId,
  maskTaxIdStandard,
  maskTaxIdAdvanced,
  maskPhone,
  maskPhoneKeepHead,
  maskBankAccount,
  maskBankAccountStandard,
  maskBankAccountAdvanced,
  maskAmount,
  maskAmountRough,
  maskIdCard,
  maskIdCardStandard,
  maskIdCardAdvanced,
  maskCaseContactName,
  maskCaseContactNameStandard,
  maskAddress,
  maskSupplierDetail,
  generateWatermarkText,
  generateAccessToken,
  generateDownloadToken,
  generateBatchId,
  generateWatermarkFileId,
  detectSensitiveContent,
  getSensitivityRuleByLevel,
  delay,
  safeJsonParse,
  shortHash
};

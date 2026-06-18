const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { AppError, maskTaxId, maskPhone, maskBankAccount, maskAmount, generateWatermarkText } = require('../utils');
const { createAuditLog } = require('./auditService');
const { AUDIT_ACTION } = require('../constants');

function applyTextDesensitization(content, rules) {
  if (!content || !rules) return content;

  let result = content;
  const ruleList = rules.split(',');

  if (ruleList.includes('mask_tax_id')) {
    result = result.replace(/[0-9A-Z]{15,20}/g, (match) => maskTaxId(match));
  }

  if (ruleList.includes('mask_phone')) {
    result = result.replace(/1[3-9]\d{9}/g, (match) => maskPhone(match));
  }

  if (ruleList.includes('mask_bank_account')) {
    result = result.replace(/\d{16,22}/g, (match) => maskBankAccount(match));
  }

  if (ruleList.includes('mask_amount')) {
    result = result.replace(/(\d+\.?\d*)/g, (match) => {
      if (parseFloat(match) > 100) {
        return String(maskAmount(match));
      }
      return match;
    });
  }

  return result;
}

function applyJsonDesensitization(obj, rules) {
  if (!obj || !rules) return obj;
  if (typeof obj !== 'object') return obj;

  const ruleList = rules.split(',');
  const result = Array.isArray(obj) ? [...obj] : { ...obj };

  const sensitiveKeys = [
    { key: 'taxpayerId', alt: ['tax_id', 'taxpayer_id'], rule: 'mask_tax_id' },
    { key: 'phone', alt: ['mobile', 'telephone'], rule: 'mask_phone' },
    { key: 'bankAccount', alt: ['account', 'bank_account', 'card_no'], rule: 'mask_bank_account' },
    { key: 'amount', alt: ['money', 'total', 'sum', 'price'], rule: 'mask_amount' },
    { key: 'legalPerson', alt: ['legal_person', 'owner'], rule: 'mask_phone' }
  ];

  function processNode(node) {
    if (node === null || node === undefined) return node;

    if (Array.isArray(node)) {
      return node.map(item => processNode(item));
    }

    if (typeof node === 'object') {
      const processed = {};
      for (const [key, value] of Object.entries(node)) {
        const sensitiveDef = sensitiveKeys.find(
          s => s.key.toLowerCase() === key.toLowerCase() || s.alt.some(a => a.toLowerCase() === key.toLowerCase())
        );
        if (sensitiveDef && ruleList.includes(sensitiveDef.rule) && typeof value === 'string') {
          if (sensitiveDef.rule === 'mask_tax_id') {
            processed[key] = maskTaxId(value);
          } else if (sensitiveDef.rule === 'mask_phone') {
            processed[key] = maskPhone(value);
          } else if (sensitiveDef.rule === 'mask_bank_account') {
            processed[key] = maskBankAccount(value);
          } else if (sensitiveDef.rule === 'mask_amount') {
            processed[key] = maskAmount(value);
          }
        } else {
          processed[key] = processNode(value);
        }
      }
      return processed;
    }

    if (typeof node === 'string') {
      return applyTextDesensitization(node, rules);
    }

    return node;
  }

  return processNode(result);
}

async function createDesensitizedVersion(archiveId, applicationId, userId, userName) {
  const archives = await db.query(
    'SELECT * FROM archives WHERE id = ?',
    [archiveId]
  );

  if (archives.length === 0) {
    throw new AppError('档案不存在', 404, 'ARCHIVE_NOT_FOUND');
  }

  const archive = archives[0];
  const version = uuidv4().slice(0, 12);
  const watermarkText = generateWatermarkText(userId, userName);

  let desensitizeStatus = 'completed';
  let errorMessage = null;
  let desensitizedContent = null;

  if (archive.requires_desensitization && archive.desensitization_rule) {
    try {
      desensitizedContent = {
        version,
        originalArchiveId: archiveId,
        desensitizedAt: new Date().toISOString(),
        rulesApplied: archive.desensitization_rule,
        archiveData: {
          id: archive.id,
          title: archive.title,
          archiveCode: archive.archive_code,
          archiveType: archive.archive_type,
          description: archive.description ? applyTextDesensitization(archive.description, archive.desensitization_rule) : null,
          watermark: watermarkText,
          notice: '本文件已按规定进行脱敏处理，仅限税务机关内部使用，严禁外传'
        }
      };
    } catch (err) {
      desensitizeStatus = 'failed';
      errorMessage = err.message;

      await createAuditLog({
        userId,
        action: AUDIT_ACTION.DESENSITIZE_FAILED,
        targetType: 'archive',
        targetId: archiveId,
        detail: {
          archiveCode: archive.archive_code,
          rules: archive.desensitization_rule,
          error: err.message
        }
      });

      throw new AppError(`档案脱敏处理失败：${err.message}`, 500, 'DESENSITIZE_FAILED');
    }
  } else {
    desensitizedContent = {
      version,
      originalArchiveId: archiveId,
      desensitizedAt: new Date().toISOString(),
      rulesApplied: null,
      archiveData: {
        id: archive.id,
        title: archive.title,
        archiveCode: archive.archive_code,
        archiveType: archive.archive_type,
        description: archive.description,
        watermark: watermarkText,
        notice: '本文件仅限税务机关内部使用，严禁外传'
      }
    };
  }

  const desensitizedDir = config.dirs.desensitized;
  if (!fs.existsSync(desensitizedDir)) {
    fs.mkdirSync(desensitizedDir, { recursive: true });
  }

  const fileName = `desensitized_${archiveId}_${applicationId}_${version}.json`;
  const filePath = path.join(desensitizedDir, fileName);

  if (desensitizedContent) {
    desensitizedContent.archiveData.watermark = watermarkText;
    fs.writeFileSync(filePath, JSON.stringify(desensitizedContent, null, 2), 'utf8');
  }

  const result = await db.query(
    `INSERT INTO desensitized_archives (archive_id, application_id, version, file_path, file_name,
      rule_used, desensitize_status, error_message, watermark_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      archiveId, applicationId, version, filePath, fileName,
      archive.desensitization_rule, desensitizeStatus, errorMessage, watermarkText
    ]
  );

  return {
    id: result.insertId,
    version,
    status: desensitizeStatus,
    watermarkText,
    filePath
  };
}

async function getOrCreateDesensitizedVersion(archiveId, applicationId, userId, userName) {
  const existing = await db.query(
    `SELECT * FROM desensitized_archives
     WHERE archive_id = ? AND application_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [archiveId, applicationId]
  );

  if (existing.length > 0 && existing[0].desensitize_status === 'completed') {
    return existing[0];
  }

  return await createDesensitizedVersion(archiveId, applicationId, userId, userName);
}

function generateWatermarkOverlay(userId, userName, archiveId, applicationId) {
  return {
    text: generateWatermarkText(userId, userName),
    timestamp: new Date().toISOString(),
    userId,
    userName,
    archiveId,
    applicationId,
    notice: '机密文件 - 严禁外传',
    opacity: 0.15,
    angle: -30
  };
}

module.exports = {
  applyTextDesensitization,
  applyJsonDesensitization,
  createDesensitizedVersion,
  getOrCreateDesensitizedVersion,
  generateWatermarkOverlay
};

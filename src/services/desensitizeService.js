const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const {
  AppError,
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
  detectSensitiveContent,
  getSensitivityRuleByLevel,
  delay,
  safeJsonParse,
  shortHash
} = require('../utils');
const { createAuditLog } = require('./auditService');
const { createApproverNotification } = require('./approvalService');
const {
  AUDIT_ACTION,
  AUTHORIZATION_LEVEL,
  AUTHORIZATION_LEVEL_DESC,
  DESENSITIZE_TASK_STATUS,
  SENSITIVE_CONTENT_TYPE,
  SENSITIVE_CONTENT_DESC
} = require('../constants');

function applyTextDesensitizationByLevel(content, rules, authLevel = 1) {
  if (!content || !rules) return content;

  let result = content;
  const ruleList = rules.split(',');

  if (authLevel >= 4) {
    return result;
  }

  if (ruleList.includes('mask_id_card') || ruleList.includes('mask_tax_id')) {
    if (authLevel === 1) {
      result = result.replace(/\d{17}[\dXx]/g, (match) => maskIdCard(match));
      result = result.replace(/[0-9A-Z]{15,20}/g, (match) => maskTaxId(match));
    } else if (authLevel === 2) {
      result = result.replace(/\d{17}[\dXx]/g, (match) => maskIdCardStandard(match));
      result = result.replace(/[0-9A-Z]{15,20}/g, (match) => maskTaxIdStandard(match));
    } else if (authLevel === 3) {
      result = result.replace(/\d{17}[\dXx]/g, (match) => maskIdCardAdvanced(match));
      result = result.replace(/[0-9A-Z]{15,20}/g, (match) => maskTaxIdAdvanced(match));
    }
  }

  if (ruleList.includes('mask_phone')) {
    if (authLevel <= 2) {
      result = result.replace(/1[3-9]\d{9}/g, (match) => maskPhone(match));
    } else if (authLevel === 3) {
      result = result.replace(/1[3-9]\d{9}/g, (match) => maskPhoneKeepHead(match));
    }
  }

  if (ruleList.includes('mask_bank_account')) {
    if (authLevel === 1) {
      result = result.replace(/\d{16,22}/g, (match) => maskBankAccount(match));
    } else if (authLevel === 2) {
      result = result.replace(/\d{16,22}/g, (match) => maskBankAccountStandard(match));
    } else if (authLevel === 3) {
      result = result.replace(/\d{16,22}/g, (match) => maskBankAccountAdvanced(match));
    }
  }

  if (ruleList.includes('mask_amount') || ruleList.includes('mask_amount_rough')) {
    if (authLevel <= 2 && ruleList.includes('mask_amount_rough')) {
      result = result.replace(/(\d+\.?\d*)/g, (match) => {
        if (parseFloat(match) > 100) {
          return String(maskAmountRough(match));
        }
        return match;
      });
    } else {
      result = result.replace(/(\d+\.?\d*)/g, (match) => {
        if (parseFloat(match) > 100) {
          return String(maskAmount(match));
        }
        return match;
      });
    }
  }

  if (ruleList.includes('mask_case_contact')) {
    const patterns = [
      /(联系人[：:]\s*)([\u4e00-\u9fa5]{2,4})/g,
      /(涉案人员[：:]\s*)([\u4e00-\u9fa5]{2,4})/g,
      /(当事人[：:]\s*)([\u4e00-\u9fa5]{2,4})/g
    ];
    for (const pat of patterns) {
      result = result.replace(pat, (m, prefix, name) => {
        if (authLevel === 1) {
          return prefix + maskCaseContactName(name);
        } else if (authLevel <= 3) {
          return prefix + maskCaseContactNameStandard(name);
        }
        return m;
      });
    }
  }

  if (ruleList.includes('mask_supplier')) {
    if (authLevel <= 2) {
      result = result.replace(/(供应商(名称)?[：:]\s*)([^\n，,。；;]{2,50})/g,
        (m, prefix, _suffix, name) => prefix + (authLevel === 1 ? maskCaseContactName(name) : name)
      );
    }
  }

  return result;
}

function applyJsonDesensitizationByLevel(obj, rules, authLevel = 1) {
  if (!obj || !rules) return obj;
  if (typeof obj !== 'object') return obj;
  if (authLevel >= 4) return obj;

  const ruleList = rules.split(',');
  const result = Array.isArray(obj) ? [...obj] : { ...obj };

  const sensitiveKeys = [
    { key: 'idCard', alt: ['id_card', 'idcard', '身份证号', '身份证'], rule: 'mask_id_card', type: 'id_card' },
    { key: 'taxpayerId', alt: ['tax_id', 'taxpayer_id', '纳税人识别号'], rule: 'mask_tax_id', type: 'tax_id' },
    { key: 'phone', alt: ['mobile', 'telephone', '联系电话', '手机'], rule: 'mask_phone', type: 'phone' },
    { key: 'bankAccount', alt: ['account', 'bank_account', 'card_no', '银行账号', '银行卡号'], rule: 'mask_bank_account', type: 'bank_account' },
    { key: 'amount', alt: ['money', 'total', 'sum', 'price', '金额', '涉案金额'], rule: 'mask_amount', type: 'amount' },
    { key: 'legalPerson', alt: ['legal_person', 'owner', '法人', '法人代表'], rule: 'mask_legal_person', type: 'legal_person' },
    { key: 'contactName', alt: ['contact_name', '联系人', '涉案人员', '当事人'], rule: 'mask_case_contact', type: 'contact' },
    { key: 'address', alt: ['住址', '地址', '住所地'], rule: 'mask_address', type: 'address' },
    { key: 'supplier', alt: ['suppliers', '供应商', '供货方', '采购明细'], rule: 'mask_supplier', type: 'supplier' }
  ];

  function maskByType(value, type, level) {
    if (!value || typeof value !== 'string') return value;
    switch (type) {
      case 'id_card':
        return level === 1 ? maskIdCard(value)
          : level === 2 ? maskIdCardStandard(value)
          : maskIdCardAdvanced(value);
      case 'tax_id':
        return level === 1 ? maskTaxId(value)
          : level === 2 ? maskTaxIdStandard(value)
          : maskTaxIdAdvanced(value);
      case 'phone':
        return level <= 2 ? maskPhone(value) : maskPhoneKeepHead(value);
      case 'bank_account':
        return level === 1 ? maskBankAccount(value)
          : level === 2 ? maskBankAccountStandard(value)
          : maskBankAccountAdvanced(value);
      case 'amount':
        return level <= 2 ? maskAmountRough(value) : maskAmount(value);
      case 'legal_person':
        return level <= 2 ? maskCaseContactNameStandard(value) : value;
      case 'contact':
        return level === 1 ? maskCaseContactName(value)
          : level <= 3 ? maskCaseContactNameStandard(value)
          : value;
      case 'address':
        return level <= 2 ? maskAddress(value) : value;
      default:
        return value;
    }
  }

  function processNode(node) {
    if (node === null || node === undefined) return node;

    if (Array.isArray(node)) {
      return node.map(item => processNode(item));
    }

    if (typeof node === 'object') {
      const processed = {};
      for (const [key, value] of Object.entries(node)) {
        const sensitiveDef = sensitiveKeys.find(
          s => s.key.toLowerCase() === key.toLowerCase()
            || s.alt.some(a => a.toLowerCase() === key.toLowerCase())
        );
        if (sensitiveDef && ruleList.includes(sensitiveDef.rule) && value !== null && value !== undefined) {
          if (sensitiveDef.type === 'supplier') {
            processed[key] = maskSupplierDetail(value, authLevel);
          } else if (typeof value === 'string') {
            processed[key] = maskByType(value, sensitiveDef.type, authLevel);
          } else if (Array.isArray(value) || typeof value === 'object') {
            processed[key] = processNode(value);
          } else {
            processed[key] = value;
          }
        } else {
          processed[key] = processNode(value);
        }
      }
      return processed;
    }

    if (typeof node === 'string') {
      return applyTextDesensitizationByLevel(node, rules, authLevel);
    }

    return node;
  }

  return processNode(result);
}

async function determineAuthorizationLevel(application, approverRole = null) {
  if (!application) return AUTHORIZATION_LEVEL.LEVEL_1_BASIC;

  if (application.authorization_level && application.authorization_level >= 1) {
    return Math.min(application.authorization_level, 4);
  }

  let level = AUTHORIZATION_LEVEL.LEVEL_1_BASIC;

  if (application.sensitivity_level >= 2) {
    level = Math.max(level, AUTHORIZATION_LEVEL.LEVEL_2_STANDARD);
  }
  if (application.sensitivity_level >= 3) {
    level = Math.max(level, AUTHORIZATION_LEVEL.LEVEL_3_ADVANCED);
  }
  if (approverRole === 'senior_approver' || approverRole === 'admin') {
    level = Math.min(level + 1, 4);
  }

  return level;
}

async function createDesensitizeTask({
  archiveId,
  applicationId,
  applicantId,
  approverId = null,
  authorizationLevel = 1,
  errorMessage = null,
  errorStack = null,
  sensitiveContentTypes = null
}) {
  const result = await db.query(
    `INSERT INTO desensitize_tasks
     (archive_id, application_id, applicant_id, approver_id, authorization_level,
      task_status, error_message, error_stack, sensitive_content_types)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      archiveId, applicationId, applicantId, approverId, authorizationLevel,
      DESENSITIZE_TASK_STATUS.PENDING,
      errorMessage, errorStack,
      Array.isArray(sensitiveContentTypes) ? sensitiveContentTypes.join(',') : sensitiveContentTypes
    ]
  );

  await createAuditLog({
    userId: applicantId,
    action: AUDIT_ACTION.DESENSITIZE_TASK_PENDING,
    targetType: 'desensitize_task',
    targetId: result.insertId,
    detail: {
      archiveId,
      applicationId,
      authorizationLevel,
      sensitiveContentTypes,
      errorMessage
    }
  });

  try {
    await notifyApproverForDesensitizeTask(result.insertId, {
      archiveId,
      applicationId,
      applicantId,
      approverId,
      authorizationLevel,
      errorMessage,
      sensitiveContentTypes
    });
    await db.query(
      `UPDATE desensitize_tasks SET notify_sent = 1 WHERE id = ?`,
      [result.insertId]
    );
  } catch (notifyErr) {
    console.error('通知审批人失败:', notifyErr.message);
  }

  return {
    taskId: result.insertId,
    status: DESENSITIZE_TASK_STATUS.PENDING
  };
}

async function notifyApproverForDesensitizeTask(taskId, params) {
  const approvers = await db.query(
    `SELECT DISTINCT u.id, u.real_name, u.email
     FROM borrow_approvals ba
     JOIN users u ON ba.approver_id = u.id
     WHERE ba.application_id = ? AND ba.status IN ('pending', 'approved')
     ORDER BY ba.approval_step`,
    [params.applicationId]
  );

  if (approvers.length === 0) {
    const adminUsers = await db.query(
      `SELECT id, real_name, email FROM users WHERE role IN ('admin', 'senior_approver') AND status = 1 LIMIT 5`
    );
    for (const admin of adminUsers) {
      await createApproverNotification({
        approverId: admin.id,
        applicationId: params.applicationId,
        taskId,
        notificationType: 'DESENSITIZE_FAILED',
        title: '档案脱敏处理失败，需要人工介入',
        content: `档案ID ${params.archiveId} 的脱敏处理失败。\n错误信息：${params.errorMessage || '未知错误'}\n敏感内容类型：${params.sensitiveContentTypes || '未检测'}\n请尽快登录系统处理该任务。`,
        priority: 2,
        relatedData: JSON.stringify(params)
      });
    }
  } else {
    for (const approver of approvers) {
      await createApproverNotification({
        approverId: approver.id,
        applicationId: params.applicationId,
        taskId,
        notificationType: 'DESENSITIZE_FAILED',
        title: '档案脱敏处理失败，需要审批人介入',
        content: `您审批的借阅申请（申请ID ${params.applicationId}）涉及的档案（ID ${params.archiveId}）脱敏失败。\n错误：${params.errorMessage || '未知错误'}\n包含敏感内容：${params.sensitiveContentTypes || '未检测'}\n授权级别：${AUTHORIZATION_LEVEL_DESC[params.authorizationLevel] || '级别' + params.authorizationLevel}\n请前往「待处理脱敏任务」查看并处理。`,
        priority: 2,
        relatedData: JSON.stringify(params)
      });

      await createAuditLog({
        userId: null,
        username: 'system',
        realName: '系统',
        action: AUDIT_ACTION.NOTIFY_APPROVER,
        targetType: 'approver',
        targetId: approver.id,
        detail: {
          taskId,
          archiveId: params.archiveId,
          applicationId: params.applicationId,
          notificationType: 'DESENSITIZE_FAILED',
          approverName: approver.real_name
        }
      });
    }
  }

  return true;
}

async function createDesensitizedVersion(archiveId, applicationId, userId, userName, authLevel = null) {
  const archives = await db.query(
    'SELECT * FROM archives WHERE id = ?',
    [archiveId]
  );

  if (archives.length === 0) {
    throw new AppError('档案不存在', 404, 'ARCHIVE_NOT_FOUND');
  }

  const archive = archives[0];

  let applicationInfo = null;
  let effectiveAuthLevel = authLevel;

  if (applicationId) {
    const apps = await db.query(
      `SELECT ba.*, MAX(a.sensitivity_level) as max_sensitivity
       FROM borrow_applications ba
       JOIN borrow_application_items bai ON ba.id = bai.application_id
       JOIN archives a ON bai.archive_id = a.id
       WHERE ba.id = ?
       GROUP BY ba.id`,
      [applicationId]
    );
    if (apps.length > 0) {
      applicationInfo = apps[0];
      applicationInfo.sensitivity_level = applicationInfo.max_sensitivity;
      if (!effectiveAuthLevel) {
        effectiveAuthLevel = await determineAuthorizationLevel(applicationInfo);
      }
    }
  }

  if (!effectiveAuthLevel) {
    effectiveAuthLevel = AUTHORIZATION_LEVEL.LEVEL_1_BASIC;
  }

  effectiveAuthLevel = Math.min(Math.max(parseInt(effectiveAuthLevel) || 1, 1), 4);

  const version = uuidv4().slice(0, 12);
  const watermarkText = generateWatermarkText(userId, userName);

  const detectedContent = detectSensitiveContent(
    (archive.description || '') + (archive.title || '') + (archive.tags || '')
  );
  if (archive.sensitive_content_types) {
    const fromDb = archive.sensitive_content_types.split(',');
    for (const t of fromDb) if (!detectedContent.includes(t)) detectedContent.push(t);
  }

  const hasSensitiveForLevel = detectedContent.length > 0
    || archive.requires_desensitization
    || archive.sensitivity_level >= 2;

  const baseRules = archive.desensitization_rule || getSensitivityRuleByLevel(archive, effectiveAuthLevel);
  const ruleList = baseRules === 'no_mask' ? '' : baseRules;

  let desensitizeStatus = 'completed';
  let errorMessage = null;
  let desensitizedContent = null;
  let actualRules = ruleList;

  if (hasSensitiveForLevel && effectiveAuthLevel < 4 && ruleList) {
    try {
      const rulesToUse = ruleList || getSensitivityRuleByLevel(archive, effectiveAuthLevel);

      desensitizedContent = {
        version,
        originalArchiveId: archiveId,
        applicationId,
        authorizationLevel: effectiveAuthLevel,
        authorizationLevelDesc: AUTHORIZATION_LEVEL_DESC[effectiveAuthLevel],
        desensitizedAt: new Date().toISOString(),
        rulesApplied: rulesToUse,
        sensitiveContentDetected: detectedContent,
        sensitiveContentDesc: detectedContent.map(t => SENSITIVE_CONTENT_DESC[t] || t),
        archiveData: {
          id: archive.id,
          title: archive.title,
          archiveCode: archive.archive_code,
          archiveType: archive.archive_type,
          sensitivityLevel: archive.sensitivity_level,
          description: archive.description
            ? applyTextDesensitizationByLevel(archive.description, rulesToUse, effectiveAuthLevel)
            : null,
          watermark: watermarkText,
          notice: `本文件按授权级别${effectiveAuthLevel}（${AUTHORIZATION_LEVEL_DESC[effectiveAuthLevel]}）进行脱敏处理，仅限税务机关内部使用，严禁外传。${detectedContent.length > 0 ? '包含敏感信息：' + detectedContent.map(t => SENSITIVE_CONTENT_DESC[t] || t).join('、') : ''}`
        },
        securityNotice: '注意：本脱敏版本禁止逆向还原、禁止截图外传、禁止与他人共享，所有操作均已记录审计日志。'
      };

      actualRules = rulesToUse;

      await createAuditLog({
        userId,
        action: AUDIT_ACTION.DESENSITIZE,
        targetType: 'archive',
        targetId: archiveId,
        detail: {
          archiveCode: archive.archive_code,
          rules: rulesToUse,
          authorizationLevel: effectiveAuthLevel,
          version,
          sensitiveContentDetected: detectedContent
        }
      });

    } catch (err) {
      desensitizeStatus = 'failed';
      errorMessage = err.message;
      console.error(`档案 ${archiveId} 脱敏失败:`, err.message);

      await createAuditLog({
        userId,
        action: AUDIT_ACTION.DESENSITIZE_FAILED,
        targetType: 'archive',
        targetId: archiveId,
        detail: {
          archiveCode: archive.archive_code,
          rules: ruleList,
          authorizationLevel: effectiveAuthLevel,
          error: err.message,
          errorStack: err.stack ? err.stack.slice(0, 500) : null
        }
      });

      const pendingTask = await createDesensitizeTask({
        archiveId,
        applicationId,
        applicantId: userId,
        approverId: applicationInfo ? applicationInfo.current_approver_id : null,
        authorizationLevel: effectiveAuthLevel,
        errorMessage: err.message,
        errorStack: err.stack ? err.stack.slice(0, 2000) : null,
        sensitiveContentTypes: detectedContent
      });

      throw new AppError(
        `档案脱敏处理失败（授权级别${effectiveAuthLevel}）：${err.message}。` +
        `该档案包含敏感内容${detectedContent.length > 0 ? '（' + detectedContent.map(t => SENSITIVE_CONTENT_DESC[t] || t).join('、') + '）' : ''}，` +
        `已通知审批人处理（任务ID: ${pendingTask.taskId}），原件暂不交付。`,
        500,
        'DESENSITIZE_FAILED_BLOCKED'
      );
    }
  } else if (effectiveAuthLevel >= 4) {
    desensitizedContent = {
      version,
      originalArchiveId: archiveId,
      applicationId,
      authorizationLevel: 4,
      authorizationLevelDesc: AUTHORIZATION_LEVEL_DESC[4],
      desensitizedAt: new Date().toISOString(),
      rulesApplied: 'no_mask_full_access',
      sensitiveContentDetected: detectedContent,
      archiveData: {
        id: archive.id,
        title: archive.title,
        archiveCode: archive.archive_code,
        archiveType: archive.archive_type,
        sensitivityLevel: archive.sensitivity_level,
        description: archive.description,
        watermark: watermarkText,
        notice: '本文件为完全授权版本，仅限高级授权人员使用，严禁外传。所有访问已记录审计。'
      },
      securityNotice: '注意：本版本为完整可见版本，水印标识您的身份，严禁转发或泄漏。'
    };
    actualRules = 'no_mask';

    await createAuditLog({
      userId,
      action: AUDIT_ACTION.DESENSITIZE,
      targetType: 'archive',
      targetId: archiveId,
      detail: {
        archiveCode: archive.archive_code,
        authorizationLevel: 4,
        fullAccess: true,
        version
      }
    });
  } else {
    desensitizedContent = {
      version,
      originalArchiveId: archiveId,
      applicationId,
      authorizationLevel: effectiveAuthLevel,
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

  const fileName = `desensitized_${archiveId}_${applicationId || 'NA'}_L${effectiveAuthLevel}_${version}.json`;
  const filePath = path.join(desensitizedDir, fileName);

  if (desensitizedContent) {
    desensitizedContent.archiveData.watermark = watermarkText;
    fs.writeFileSync(filePath, JSON.stringify(desensitizedContent, null, 2), 'utf8');
  }

  const result = await db.query(
    `INSERT INTO desensitized_archives
     (archive_id, application_id, version, authorization_level, file_path, file_name,
      rule_used, desensitize_status, error_message, watermark_text, sensitive_content_detected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      archiveId, applicationId, version, effectiveAuthLevel, filePath, fileName,
      actualRules, desensitizeStatus, errorMessage, watermarkText,
      detectedContent.length > 0 ? detectedContent.join(',') : null
    ]
  );

  return {
    id: result.insertId,
    version,
    status: desensitizeStatus,
    authorizationLevel: effectiveAuthLevel,
    watermarkText,
    filePath,
    sensitiveContentDetected: detectedContent,
    rulesApplied: actualRules
  };
}

async function getOrCreateDesensitizedVersion(archiveId, applicationId, userId, userName, authLevel = null) {
  let searchLevel = authLevel;
  if (!searchLevel && applicationId) {
    const apps = await db.query(
      `SELECT authorization_level FROM borrow_applications WHERE id = ?`,
      [applicationId]
    );
    if (apps.length > 0 && apps[0].authorization_level) {
      searchLevel = apps[0].authorization_level;
    }
  }
  const effectiveLevel = searchLevel || AUTHORIZATION_LEVEL.LEVEL_1_BASIC;

  const existing = await db.query(
    `SELECT * FROM desensitized_archives
     WHERE archive_id = ? AND application_id = ? AND authorization_level = ?
     ORDER BY created_at DESC LIMIT 1`,
    [archiveId, applicationId, effectiveLevel]
  );

  if (existing.length > 0 && existing[0].desensitize_status === 'completed') {
    return existing[0];
  }

  if (existing.length > 0 && existing[0].desensitize_status === 'failed') {
    const pendingTasks = await db.query(
      `SELECT * FROM desensitize_tasks
       WHERE archive_id = ? AND application_id = ? AND task_status IN ('pending','processing','failed')
       ORDER BY created_at DESC LIMIT 1`,
      [archiveId, applicationId]
    );
    if (pendingTasks.length > 0) {
      throw new AppError(
        `档案脱敏处理尚在待处理状态（任务ID: ${pendingTasks[0].id}），` +
        `审批人介入完成前原件不能交付。错误：${pendingTasks[0].error_message || '未知原因'}`,
        423,
        'DESENSITIZE_TASK_PENDING_BLOCKED'
      );
    }
  }

  return await createDesensitizedVersion(archiveId, applicationId, userId, userName, authLevel);
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
    angle: -30,
    traceId: shortHash(`${userId}-${archiveId}-${applicationId || 0}-${Date.now()}`)
  };
}

async function listPendingDesensitizeTasks(approverId = null, page = 1, pageSize = 20) {
  const where = [];
  const params = [];

  where.push(`task_status IN ('pending','processing','failed')`);

  if (approverId) {
    where.push(`(approver_id = ? OR approver_id IS NULL OR EXISTS (
      SELECT 1 FROM borrow_approvals ba
      WHERE ba.application_id = desensitize_tasks.application_id
        AND ba.approver_id = ? AND ba.status IN ('pending','approved')
    ))`);
    params.push(approverId, approverId);
  }

  const whereClause = 'WHERE ' + where.join(' AND ');

  const listSql = `
    SELECT dt.*,
           a.title as archive_title, a.archive_code, a.sensitivity_level,
           ba.application_no, ba.purpose,
           u.real_name as applicant_name
    FROM desensitize_tasks dt
    JOIN archives a ON dt.archive_id = a.id
    JOIN borrow_applications ba ON dt.application_id = ba.id
    JOIN users u ON dt.applicant_id = u.id
    ${whereClause}
    ORDER BY dt.created_at DESC
  `;
  const countSql = `SELECT COUNT(*) as total FROM desensitize_tasks dt ${whereClause}`;

  const [list, total] = await Promise.all([
    db.queryWithPagination(listSql, params, { page, pageSize }),
    db.countQuery(countSql, params)
  ]);

  return { list, total, page, pageSize };
}

async function retryDesensitizeTask(taskId, operatorId, newAuthLevel = null, resolutionNote = null) {
  const tasks = await db.query(
    `SELECT * FROM desensitize_tasks WHERE id = ? FOR UPDATE`,
    [taskId]
  );

  if (tasks.length === 0) {
    throw new AppError('脱敏任务不存在', 404, 'TASK_NOT_FOUND');
  }

  const task = tasks[0];

  if (task.task_status === DESENSITIZE_TASK_STATUS.RESOLVED
    || task.task_status === DESENSITIZE_TASK_STATUS.CANCELLED) {
    throw new AppError('该任务已结束，无法重试', 400, 'TASK_ALREADY_CLOSED');
  }

  const targetAuthLevel = newAuthLevel || task.authorization_level;

  await db.query(
    `UPDATE desensitize_tasks SET task_status = ?, retry_count = retry_count + 1, updated_at = NOW() WHERE id = ?`,
    [DESENSITIZE_TASK_STATUS.PROCESSING, taskId]
  );

  const app = await db.query(
    `SELECT applicant_id FROM borrow_applications WHERE id = ?`,
    [task.application_id]
  );
  const applicantId = app.length > 0 ? app[0].applicant_id : task.applicant_id;
  const applicantUser = await db.query(
    `SELECT real_name FROM users WHERE id = ?`,
    [applicantId]
  );
  const userName = applicantUser.length > 0 ? applicantUser[0].real_name : 'unknown';

  try {
    const result = await createDesensitizedVersion(
      task.archive_id,
      task.application_id,
      applicantId,
      userName,
      targetAuthLevel
    );

    await db.query(
      `UPDATE desensitize_tasks
       SET task_status = ?, resolved_by = ?, resolved_at = NOW(), resolution_note = ?,
           authorization_level = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        DESENSITIZE_TASK_STATUS.RESOLVED,
        operatorId,
        resolutionNote || `审批人重试成功，已生成脱敏版本（级别${targetAuthLevel}）`,
        targetAuthLevel,
        taskId
      ]
    );

    await createAuditLog({
      userId: operatorId,
      action: AUDIT_ACTION.DESENSITIZE_TASK_RESOLVED,
      targetType: 'desensitize_task',
      targetId: taskId,
      detail: {
        archiveId: task.archive_id,
        applicationId: task.application_id,
        newAuthLevel: targetAuthLevel,
        desensitizedId: result.id,
        resolutionNote
      }
    });

    return {
      taskId,
      status: DESENSITIZE_TASK_STATUS.RESOLVED,
      desensitized: result
    };

  } catch (err) {
    let newStatus = DESENSITIZE_TASK_STATUS.FAILED;
    if (task.retry_count + 1 < task.max_retry) {
      newStatus = DESENSITIZE_TASK_STATUS.PENDING;
    }

    await db.query(
      `UPDATE desensitize_tasks
       SET task_status = ?, error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [newStatus, err.message.slice(0, 1000), taskId]
    );

    await createAuditLog({
      userId: operatorId,
      action: AUDIT_ACTION.DESENSITIZE_TASK_RETRY,
      targetType: 'desensitize_task',
      targetId: taskId,
      detail: {
        archiveId: task.archive_id,
        applicationId: task.application_id,
        retryCount: task.retry_count + 1,
        maxRetry: task.max_retry,
        error: err.message,
        status: newStatus
      }
    });

    throw new AppError(
      `重试失败（第${task.retry_count + 1}/${task.max_retry}次）：${err.message}`,
      500,
      'DESENSITIZE_RETRY_FAILED'
    );
  }
}

async function resolveDesensitizeTaskManually(taskId, operatorId, resolutionNote, newAuthLevel = 4) {
  const tasks = await db.query(
    `SELECT * FROM desensitize_tasks WHERE id = ?`,
    [taskId]
  );

  if (tasks.length === 0) {
    throw new AppError('脱敏任务不存在', 404, 'TASK_NOT_FOUND');
  }

  const task = tasks[0];

  const app = await db.query(
    `SELECT applicant_id FROM borrow_applications WHERE id = ?`,
    [task.application_id]
  );
  const applicantId = app.length > 0 ? app[0].applicant_id : task.applicant_id;
  const applicantUser = await db.query(
    `SELECT real_name FROM users WHERE id = ?`,
    [applicantId]
  );
  const userName = applicantUser.length > 0 ? applicantUser[0].real_name : 'unknown';

  const effectiveLevel = Math.min(Math.max(newAuthLevel, 1), 4);

  const result = await createDesensitizedVersion(
    task.archive_id,
    task.application_id,
    applicantId,
    userName,
    effectiveLevel
  );

  await db.query(
    `UPDATE desensitize_tasks
     SET task_status = ?, resolved_by = ?, resolved_at = NOW(),
         resolution_note = ?, authorization_level = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      DESENSITIZE_TASK_STATUS.RESOLVED,
      operatorId,
      resolutionNote || `审批人人工介入，直接生成级别${effectiveLevel}脱敏版本`,
      effectiveLevel,
      taskId
    ]
  );

  await createAuditLog({
    userId: operatorId,
    action: AUDIT_ACTION.DESENSITIZE_TASK_RESOLVED,
    targetType: 'desensitize_task',
    targetId: taskId,
    detail: {
      archiveId: task.archive_id,
      applicationId: task.application_id,
      resolutionType: 'manual_intervention',
      newAuthLevel: effectiveLevel,
      desensitizedId: result.id,
      note: resolutionNote
    }
  });

  return {
    taskId,
    status: DESENSITIZE_TASK_STATUS.RESOLVED,
    desensitized: result,
    manual: true
  };
}

module.exports = {
  applyTextDesensitization: applyTextDesensitizationByLevel,
  applyTextDesensitizationByLevel,
  applyJsonDesensitization: applyJsonDesensitizationByLevel,
  applyJsonDesensitizationByLevel,
  createDesensitizedVersion,
  getOrCreateDesensitizedVersion,
  generateWatermarkOverlay,
  determineAuthorizationLevel,
  createDesensitizeTask,
  listPendingDesensitizeTasks,
  retryDesensitizeTask,
  resolveDesensitizeTaskManually
};

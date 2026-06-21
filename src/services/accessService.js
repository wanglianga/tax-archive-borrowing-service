const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { getCache, setCache, incrCounter, delCache } = require('../redis');
const { AppError, isExpired, fail, success, generateAccessToken as genPreviewTokenId, generateDownloadToken as genDownloadTokenId, generateBatchId, generateWatermarkFileId, shortHash, safeJsonParse, addHours } = require('../utils');
const { verifyArchiveAccess } = require('../middleware/auth');
const { getOrCreateDesensitizedVersion, generateWatermarkOverlay, determineAuthorizationLevel } = require('./desensitizeService');
const { createAuditLog } = require('./auditService');
const {
  AUDIT_ACTION,
  APPROVAL_STATUS,
  ACCESS_TOKEN_TYPE,
  TOKEN_STATUS,
  PACKAGE_STATUS,
  WATERMARK_FILE_STATUS,
  AUTHORIZATION_LEVEL
} = require('../constants');
const { expireOverdueApplications } = require('./borrowService');

async function checkPreviewLimit(userId, archiveId, applicationId, previewLimit) {
  const cacheKey = `preview_count:${applicationId}:${archiveId}`;

  const dbItem = await db.query(
    'SELECT preview_count FROM borrow_application_items WHERE application_id = ? AND archive_id = ?',
    [applicationId, archiveId]
  );

  const currentCount = dbItem.length > 0 ? dbItem[0].preview_count : 0;

  if (currentCount >= previewLimit) {
    throw new AppError('预览次数已用完', 403, 'PREVIEW_LIMIT_EXCEEDED');
  }

  return currentCount;
}

async function checkDownloadLimit(userId, archiveId, applicationId, downloadLimit) {
  const dbItem = await db.query(
    'SELECT download_count FROM borrow_application_items WHERE application_id = ? AND archive_id = ?',
    [applicationId, archiveId]
  );

  const currentCount = dbItem.length > 0 ? dbItem[0].download_count : 0;

  if (currentCount >= downloadLimit) {
    throw new AppError('下载次数已用完', 403, 'DOWNLOAD_LIMIT_EXCEEDED');
  }

  return currentCount;
}

async function incrementPreviewCount(applicationId, archiveId) {
  await db.query(
    'UPDATE borrow_application_items SET preview_count = preview_count + 1 WHERE application_id = ? AND archive_id = ?',
    [applicationId, archiveId]
  );
  await db.query(
    `UPDATE borrow_applications SET last_access_at = NOW() WHERE id = ?`,
    [applicationId]
  );
}

async function incrementDownloadCount(applicationId, archiveId) {
  await db.query(
    'UPDATE borrow_application_items SET download_count = download_count + 1 WHERE application_id = ? AND archive_id = ?',
    [applicationId, archiveId]
  );
  await db.query(
    `UPDATE borrow_applications SET last_access_at = NOW() WHERE id = ?`,
    [applicationId]
  );
}

async function generatePreviewToken({ userId, archiveId, applicationId, desensitizedId = null, ipAddress = null, userAgent = null, expireHours = 2 }) {
  const token = genPreviewTokenId();
  const expireAt = addHours(new Date(), expireHours);

  const uaHash = userAgent ? shortHash(userAgent, 12) : null;

  const result = await db.query(
    `INSERT INTO access_tokens
     (token, token_type, user_id, archive_id, application_id, desensitized_id,
      ip_restriction, user_agent_hash, expire_at, token_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token,
      ACCESS_TOKEN_TYPE.PREVIEW,
      userId,
      archiveId,
      applicationId,
      desensitizedId,
      ipAddress,
      uaHash,
      expireAt,
      TOKEN_STATUS.ACTIVE
    ]
  );

  await setCache(`access_token:${token}`, {
    id: result.insertId,
    userId,
    archiveId,
    applicationId,
    type: ACCESS_TOKEN_TYPE.PREVIEW,
    expireAt
  }, expireHours * 3600);

  return {
    token,
    tokenId: result.insertId,
    expireAt,
    expireHours
  };
}

async function generateDownloadToken({ userId, archiveId, applicationId, desensitizedId = null, ipAddress = null, userAgent = null, expireHours = 1 }) {
  const token = genDownloadTokenId();
  const expireAt = addHours(new Date(), expireHours);

  const uaHash = userAgent ? shortHash(userAgent, 12) : null;

  const result = await db.query(
    `INSERT INTO access_tokens
     (token, token_type, user_id, archive_id, application_id, desensitized_id,
      ip_restriction, user_agent_hash, expire_at, token_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token,
      ACCESS_TOKEN_TYPE.DOWNLOAD,
      userId,
      archiveId,
      applicationId,
      desensitizedId,
      ipAddress,
      uaHash,
      expireAt,
      TOKEN_STATUS.ACTIVE
    ]
  );

  await setCache(`access_token:${token}`, {
    id: result.insertId,
    userId,
    archiveId,
    applicationId,
    type: ACCESS_TOKEN_TYPE.DOWNLOAD,
    expireAt
  }, expireHours * 3600);

  return {
    token,
    tokenId: result.insertId,
    expireAt,
    expireHours
  };
}

async function verifyAccessToken(token, ipAddress = null, userAgent = null) {
  const cacheData = await getCache(`access_token:${token}`);
  let record = null;

  if (cacheData) {
    record = cacheData;
  } else {
    const records = await db.query(
      `SELECT * FROM access_tokens WHERE token = ? LIMIT 1`,
      [token]
    );
    if (records.length === 0) {
      throw new AppError('访问令牌不存在或已失效', 401, 'TOKEN_NOT_FOUND');
    }
    record = records[0];
  }

  if (record.token_status && record.token_status !== TOKEN_STATUS.ACTIVE) {
    throw new AppError(`访问令牌已${record.token_status}`, 401, 'TOKEN_INVALID');
  }

  if (record.expire_at) {
    const exp = typeof record.expire_at === 'string' ? new Date(record.expire_at) : record.expire_at;
    if (isExpired(exp)) {
      await revokeAccessToken(token, null, '令牌过期自动失效');
      throw new AppError('访问令牌已过期', 401, 'TOKEN_EXPIRED');
    }
  }

  if (record.ip_restriction && ipAddress && record.ip_restriction !== ipAddress) {
    await createAuditLog({
      userId: record.user_id,
      action: AUDIT_ACTION.ABNORMAL_CONNECTION_DETECTED,
      targetType: 'access_token',
      targetId: record.id || record.tokenId || null,
      ipAddress,
      userAgent,
      detail: {
        expectedIp: record.ip_restriction,
        actualIp: ipAddress,
        token,
        reason: 'IP地址与申请时不一致'
      }
    });
    throw new AppError('访问令牌IP受限', 403, 'TOKEN_IP_MISMATCH');
  }

  if (record.user_agent_hash && userAgent) {
    const actualHash = shortHash(userAgent, 12);
    if (actualHash !== record.user_agent_hash) {
      await createAuditLog({
        userId: record.user_id,
        action: AUDIT_ACTION.ABNORMAL_CONNECTION_DETECTED,
        targetType: 'access_token',
        targetId: record.id || record.tokenId || null,
        ipAddress,
        userAgent,
        detail: {
          expectedHash: record.user_agent_hash,
          actualHash,
          token,
          reason: '客户端标识与申请时不一致'
        }
      });
      throw new AppError('访问令牌客户端受限', 403, 'TOKEN_UA_MISMATCH');
    }
  }

  const tokenId = record.id || record.tokenId;
  if (tokenId) {
    await db.query(
      `UPDATE access_tokens SET last_used_at = NOW(), use_count = use_count + 1 WHERE id = ?`,
      [tokenId]
    );
  }

  return record;
}

async function revokeAccessToken(token, operatorId = null, reason = '管理员手动回收') {
  const records = await db.query(
    `SELECT * FROM access_tokens WHERE token = ?`,
    [token]
  );
  if (records.length === 0) {
    return { revoked: false, reason: '令牌不存在' };
  }
  const record = records[0];

  if (record.token_status === TOKEN_STATUS.REVOKED) {
    return { revoked: false, reason: '令牌已被回收' };
  }

  await db.query(
    `UPDATE access_tokens
     SET token_status = ?, revoked_at = NOW(), revoked_by = ?, revoke_reason = ?
     WHERE token = ?`,
    [TOKEN_STATUS.REVOKED, operatorId, reason, token]
  );

  await delCache(`access_token:${token}`);

  await createAuditLog({
    userId: operatorId || null,
    action: AUDIT_ACTION.TOKEN_REVOKED,
    targetType: 'access_token',
    targetId: record.id,
    detail: {
      token: record.token,
      tokenType: record.token_type,
      userId: record.user_id,
      applicationId: record.application_id,
      archiveId: record.archive_id,
      reason
    }
  });

  return { revoked: true, token, reason };
}

async function createWatermarkFileRecord({
  userId, archiveId, applicationId = null, desensitizedId = null,
  filePath, fileName, watermarkText, expireDays = 7
}) {
  const fileRid = generateWatermarkFileId();
  const expireAt = addHours(new Date(), expireDays * 24);

  const result = await db.query(
    `INSERT INTO offline_watermark_files
     (file_rid, user_id, archive_id, application_id, desensitized_id,
      file_path, file_name, watermark_text, file_status, expire_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileRid, userId, archiveId, applicationId, desensitizedId,
      filePath, fileName, watermarkText, WATERMARK_FILE_STATUS.ACTIVE, expireAt
    ]
  );

  return {
    fileRid,
    id: result.insertId,
    expireAt,
    expireDays
  };
}

async function revokeWatermarkFile(fileRid, operatorId = null, reason = '授权到期自动回收') {
  const records = await db.query(
    `SELECT * FROM offline_watermark_files WHERE file_rid = ?`,
    [fileRid]
  );
  if (records.length === 0) return { revoked: false };
  const record = records[0];

  if (record.file_status === WATERMARK_FILE_STATUS.REVOKED
    || record.file_status === WATERMARK_FILE_STATUS.DELETED) {
    return { revoked: false };
  }

  await db.query(
    `UPDATE offline_watermark_files
     SET file_status = ?, revoked_at = NOW(), revoked_by = ?, revoke_reason = ?
     WHERE file_rid = ?`,
    [WATERMARK_FILE_STATUS.REVOKED, operatorId, reason, fileRid]
  );

  try {
    if (record.file_path && fs.existsSync(record.file_path)) {
      fs.unlinkSync(record.file_path);
    }
  } catch (e) {
    console.warn(`删除水印文件失败: ${record.file_path}`, e.message);
  }

  await createAuditLog({
    userId: operatorId || null,
    action: AUDIT_ACTION.WATERMARK_FILE_REVOKED,
    targetType: 'watermark_file',
    targetId: record.id,
    detail: {
      fileRid,
      userId: record.user_id,
      archiveId: record.archive_id,
      applicationId: record.application_id,
      reason,
      path: record.file_path
    }
  });

  return { revoked: true, fileRid };
}

async function createBatchPackageRecord({
  applicationId, userId, archiveIds,
  filePath = null, fileName = null, fileSize = 0, expireDays = 7
}) {
  const batchId = generateBatchId();
  const expireAt = addHours(new Date(), expireDays * 24);

  const result = await db.query(
    `INSERT INTO batch_packages
     (batch_id, application_id, user_id, archive_ids, file_path, file_name,
      file_size, package_status, expire_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batchId, applicationId, userId,
      Array.isArray(archiveIds) ? archiveIds.join(',') : (archiveIds || null),
      filePath, fileName, fileSize, PACKAGE_STATUS.GENERATING, expireAt
    ]
  );

  return {
    batchId,
    id: result.insertId,
    expireAt,
    expireDays
  };
}

async function markBatchPackageReady(batchId, filePath, fileName, fileSize) {
  await db.query(
    `UPDATE batch_packages
     SET file_path = ?, file_name = ?, file_size = ?, package_status = ?, updated_at = NOW()
     WHERE batch_id = ?`,
    [filePath, fileName, fileSize, PACKAGE_STATUS.READY, batchId]
  );
  return true;
}

async function revokeBatchPackage(batchId, operatorId = null, reason = '授权到期自动回收') {
  const records = await db.query(
    `SELECT * FROM batch_packages WHERE batch_id = ?`,
    [batchId]
  );
  if (records.length === 0) return { revoked: false };
  const record = records[0];

  if (record.package_status === PACKAGE_STATUS.REVOKED
    || record.package_status === PACKAGE_STATUS.DELETED) {
    return { revoked: false };
  }

  await db.query(
    `UPDATE batch_packages
     SET package_status = ?, revoked_at = NOW(), revoked_by = ?, revoke_reason = ?
     WHERE batch_id = ?`,
    [PACKAGE_STATUS.REVOKED, operatorId, reason, batchId]
  );

  try {
    if (record.file_path && fs.existsSync(record.file_path)) {
      fs.unlinkSync(record.file_path);
    }
  } catch (e) {
    console.warn(`删除压缩包文件失败: ${record.file_path}`, e.message);
  }

  await createAuditLog({
    userId: operatorId || null,
    action: AUDIT_ACTION.BATCH_PACKAGE_REVOKED,
    targetType: 'batch_package',
    targetId: record.id,
    detail: {
      batchId,
      userId: record.user_id,
      applicationId: record.application_id,
      reason,
      path: record.file_path
    }
  });

  return { revoked: true, batchId };
}

async function updateLastAccessTime(applicationId) {
  if (!applicationId) return false;
  await db.query(
    `UPDATE borrow_applications SET last_access_at = NOW() WHERE id = ?`,
    [applicationId]
  );

  const app = await db.query(
    `SELECT last_access_at FROM borrow_applications WHERE id = ?`,
    [applicationId]
  );
  if (app.length > 0) {
    await createAuditLog({
      userId: null,
      username: 'system',
      realName: '系统',
      action: AUDIT_ACTION.LAST_ACCESS_RECORDED,
      targetType: 'borrow_application',
      targetId: applicationId,
      last_access_at: app[0].last_access_at,
      detail: {
        lastAccessTime: app[0].last_access_at
      }
    });
  }
  return true;
}

async function detectAbnormalConnections(applicationId = null) {
  const abnormal = [];

  const tokenAbnormal = await db.query(
    `SELECT at.*, u.real_name
     FROM access_tokens at
     LEFT JOIN users u ON at.user_id = u.id
     WHERE at.token_status = ?
       AND (at.last_used_at IS NULL OR at.last_used_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))
       AND at.expire_at > NOW()
       AND (at.ip_restriction IS NOT NULL OR at.user_agent_hash IS NOT NULL)
       ${applicationId ? 'AND at.application_id = ?' : ''}
     LIMIT 100`,
    [TOKEN_STATUS.ACTIVE, applicationId].filter(x => x !== undefined)
  );

  for (const t of tokenAbnormal) {
    abnormal.push({
      type: 'suspicious_token',
      id: t.id,
      token: t.token,
      tokenType: t.token_type,
      userId: t.user_id,
      userName: t.real_name,
      archiveId: t.archive_id,
      applicationId: t.application_id,
      ipRestriction: t.ip_restriction,
      uaHash: t.user_agent_hash,
      lastUsedAt: t.last_used_at,
      expireAt: t.expire_at,
      description: '令牌长期未使用且带IP/UA限制，可能异常'
    });
  }

  return abnormal;
}

async function previewArchive({ userId, userName, archiveId, applicationId = null, ipAddress, userAgent }) {
  await expireOverdueApplications();

  const accessResult = await verifyArchiveAccess(userId, archiveId, applicationId);

  if (!accessResult.authorized) {
    await createAuditLog({
      userId,
      action: AUDIT_ACTION.UNAUTHORIZED_ACCESS,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
      detail: {
        reason: '无借阅权限或权限已过期',
        applicationId
      }
    });
    throw new AppError('无权访问该档案或借阅已过期', 403, 'ARCHIVE_ACCESS_DENIED');
  }

  const archives = await db.query(
    'SELECT * FROM archives WHERE id = ?',
    [archiveId]
  );

  if (archives.length === 0) {
    throw new AppError('档案不存在', 404, 'ARCHIVE_NOT_FOUND');
  }

  const archive = archives[0];

  if (accessResult.application) {
    await checkPreviewLimit(
      userId, archiveId,
      accessResult.application.id,
      accessResult.application.preview_limit
    );

    await incrementPreviewCount(accessResult.application.id, archiveId);

    let desensitizedVersion = null;
    let authLevel = accessResult.application.authorization_level || null;

    if (archive.requires_desensitization || (archive.sensitive_content_types && archive.sensitive_content_types.length > 0)) {
      try {
        desensitizedVersion = await getOrCreateDesensitizedVersion(
          archiveId, accessResult.application.id, userId, userName, authLevel
        );
      } catch (err) {
        if (err.code === 'DESENSITIZE_FAILED_BLOCKED'
          || err.code === 'DESENSITIZE_TASK_PENDING_BLOCKED'
          || err.code === 'DESENSITIZE_RETRY_FAILED') {
          throw err;
        }
        throw new AppError(
          `档案脱敏处理失败，无法预览。敏感档案不能因脱敏失败绕过权限控制。详情：${err.message}`,
          403,
          'DESENSITIZE_FAILED_BLOCKED'
        );
      }

      if (!desensitizedVersion || desensitizedVersion.desensitize_status !== 'completed') {
        throw new AppError(
          '档案脱敏处理失败或尚在处理中，无法预览。敏感档案不能因脱敏失败绕过权限控制。',
          403,
          'DESENSITIZE_FAILED_BLOCKED'
        );
      }
    }

    let previewToken = null;
    try {
      previewToken = await generatePreviewToken({
        userId,
        archiveId,
        applicationId: accessResult.application.id,
        desensitizedId: desensitizedVersion ? desensitizedVersion.id : null,
        ipAddress,
        userAgent,
        expireHours: 4
      });
    } catch (e) {
      console.warn('生成预览令牌失败:', e.message);
    }

    await updateLastAccessTime(accessResult.application.id);

    await createAuditLog({
      userId,
      userName: userName || (accessResult.application ? null : null),
      action: AUDIT_ACTION.PREVIEW_ARCHIVE,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
      last_access_at: new Date(),
      detail: {
        applicationId: accessResult.application.id,
        archiveCode: archive.archive_code,
        archiveTitle: archive.title,
        desensitized: archive.requires_desensitization || !!archive.sensitive_content_types,
        watermark: desensitizedVersion ? desensitizedVersion.watermark_text : null,
        authorizationLevel: authLevel,
        previewTokenId: previewToken ? previewToken.tokenId : null
      }
    });

    const watermark = generateWatermarkOverlay(
      userId, userName, archiveId, accessResult.application.id
    );

    if (watermark && archive.file_name) {
      try {
        await createWatermarkFileRecord({
          userId,
          archiveId,
          applicationId: accessResult.application.id,
          desensitizedId: desensitizedVersion ? desensitizedVersion.id : null,
          filePath: null,
          fileName: `WM_${archive.archive_code}_${Date.now()}.json`,
          watermarkText: watermark.text,
          expireDays: Math.min(accessResult.application.borrow_days || 7, 30)
        });
      } catch (e) {
        console.warn('创建水印文件记录失败:', e.message);
      }
    }

    return {
      archive: {
        id: archive.id,
        archiveCode: archive.archive_code,
        title: archive.title,
        archiveType: archive.archive_type,
        sensitivityLevel: archive.sensitivity_level,
        description: archive.description,
        fileName: archive.file_name,
        fileMime: archive.file_mime,
        fileSize: archive.file_size,
        periodYear: archive.period_year,
        periodMonth: archive.period_month,
        caseNumber: archive.case_number,
        tags: archive.tags ? archive.tags.split(',') : [],
        sensitiveContentTypes: archive.sensitive_content_types ? archive.sensitive_content_types.split(',') : []
      },
      desensitized: !!(archive.requires_desensitization || archive.sensitive_content_types),
      desensitizedVersionId: desensitizedVersion ? desensitizedVersion.id : null,
      authorizationLevel: authLevel,
      watermark,
      previewToken: previewToken ? previewToken.token : null,
      previewTokenExpireAt: previewToken ? previewToken.expireAt : null,
      previewCount: accessResult.application.preview_count + 1,
      previewLimit: accessResult.application.preview_limit,
      expireAt: accessResult.application.expire_at
    };
  } else if (accessResult.tempAuth) {
    await updateLastAccessTime(null);

    await createAuditLog({
      userId,
      action: AUDIT_ACTION.PREVIEW_ARCHIVE,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
      last_access_at: new Date(),
      detail: {
        authType: 'temporary',
        archiveCode: archive.archive_code
      }
    });

    const watermark = generateWatermarkOverlay(userId, userName, archiveId, null);

    return {
      archive: {
        id: archive.id,
        archiveCode: archive.archive_code,
        title: archive.title,
        archiveType: archive.archive_type,
        sensitivityLevel: archive.sensitivity_level,
        description: archive.description
      },
      desensitized: false,
      tempAuth: true,
      watermark
    };
  }

  throw new AppError('无权访问该档案', 403, 'ARCHIVE_ACCESS_DENIED');
}

async function downloadArchive({ userId, userName, archiveId, applicationId = null, ipAddress, userAgent }) {
  await expireOverdueApplications();

  const accessResult = await verifyArchiveAccess(userId, archiveId, applicationId);

  if (!accessResult.authorized) {
    await createAuditLog({
      userId,
      action: AUDIT_ACTION.UNAUTHORIZED_ACCESS,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
      detail: {
        type: 'download',
        reason: '无借阅权限或权限已过期',
        applicationId
      }
    });
    throw new AppError('无权下载该档案或借阅已过期', 403, 'ARCHIVE_ACCESS_DENIED');
  }

  if (accessResult.tempAuth) {
    throw new AppError('临时授权仅允许预览，不允许下载', 403, 'TEMP_AUTH_NO_DOWNLOAD');
  }

  const archives = await db.query(
    'SELECT * FROM archives WHERE id = ?',
    [archiveId]
  );

  if (archives.length === 0) {
    throw new AppError('档案不存在', 404, 'ARCHIVE_NOT_FOUND');
  }

  const archive = archives[0];
  const application = accessResult.application;

  await checkDownloadLimit(userId, archiveId, application.id, application.download_limit);

  let desensitizedVersion = null;
  let authLevel = application.authorization_level || null;

  if (archive.requires_desensitization || (archive.sensitive_content_types && archive.sensitive_content_types.length > 0)) {
    try {
      desensitizedVersion = await getOrCreateDesensitizedVersion(
        archiveId, application.id, userId, userName, authLevel
      );
    } catch (err) {
      if (err.code === 'DESENSITIZE_FAILED_BLOCKED'
        || err.code === 'DESENSITIZE_TASK_PENDING_BLOCKED'
        || err.code === 'DESENSITIZE_RETRY_FAILED') {
        throw err;
      }
      throw new AppError(
        `档案脱敏处理失败，无法下载。敏感档案不能因脱敏失败绕过权限控制。详情：${err.message}`,
        403,
        'DESENSITIZE_FAILED_BLOCKED'
      );
    }

    if (!desensitizedVersion || desensitizedVersion.desensitize_status !== 'completed') {
      throw new AppError(
        '档案脱敏处理失败或尚在处理中，无法下载。敏感档案不能因脱敏失败绕过权限控制。',
        403,
        'DESENSITIZE_FAILED_BLOCKED'
      );
    }
  }

  await incrementDownloadCount(application.id, archiveId);

  let downloadToken = null;
  try {
    downloadToken = await generateDownloadToken({
      userId,
      archiveId,
      applicationId: application.id,
      desensitizedId: desensitizedVersion ? desensitizedVersion.id : null,
      ipAddress,
      userAgent,
      expireHours: 2
    });
  } catch (e) {
    console.warn('生成下载令牌失败:', e.message);
  }

  await updateLastAccessTime(application.id);

  await createAuditLog({
    userId,
    action: AUDIT_ACTION.DOWNLOAD_ARCHIVE,
    targetType: 'archive',
    targetId: archiveId,
    ipAddress,
    userAgent,
    last_access_at: new Date(),
    detail: {
      applicationId: application.id,
      archiveCode: archive.archive_code,
      desensitized: !!(archive.requires_desensitization || archive.sensitive_content_types),
      watermark: desensitizedVersion ? desensitizedVersion.watermark_text : null,
      authorizationLevel: authLevel,
      downloadTokenId: downloadToken ? downloadToken.tokenId : null
    }
  });

  const watermark = generateWatermarkOverlay(userId, userName, archiveId, application.id);

  if (watermark && archive.file_name) {
    try {
      await createWatermarkFileRecord({
        userId,
        archiveId,
        applicationId: application.id,
        desensitizedId: desensitizedVersion ? desensitizedVersion.id : null,
        filePath: null,
        fileName: `WM_DL_${archive.archive_code}_${Date.now()}.json`,
        watermarkText: watermark.text,
        expireDays: Math.min(application.borrow_days || 7, 30)
      });
    } catch (e) {
      console.warn('创建下载水印文件记录失败:', e.message);
    }
  }

  return {
    archive: {
      id: archive.id,
      archiveCode: archive.archive_code,
      title: archive.title,
      fileName: desensitizedVersion ? desensitizedVersion.file_name : archive.file_name,
      fileSize: archive.file_size,
      desensitized: !!(archive.requires_desensitization || archive.sensitive_content_types),
      desensitizedFilePath: desensitizedVersion ? desensitizedVersion.file_path : archive.file_path,
      authorizationLevel: authLevel
    },
    watermark,
    downloadToken: downloadToken ? downloadToken.token : null,
    downloadTokenExpireAt: downloadToken ? downloadToken.expireAt : null,
    downloadCount: application.download_count + 1,
    downloadLimit: application.download_limit,
    expireAt: application.expire_at
  };
}

async function batchDownloadArchives({ userId, userName, applicationId, archiveIds = null, ipAddress, userAgent }) {
  await expireOverdueApplications();

  const applications = await db.query(
    `SELECT * FROM borrow_applications
     WHERE id = ? AND applicant_id = ? AND approval_status = ? AND is_expired = 0 AND expire_at > NOW()`,
    [applicationId, userId, APPROVAL_STATUS.APPROVED]
  );

  if (applications.length === 0) {
    await createAuditLog({
      userId,
      action: AUDIT_ACTION.UNAUTHORIZED_ACCESS,
      targetType: 'borrow_application',
      targetId: applicationId,
      ipAddress,
      userAgent,
      detail: { type: 'batch_download', reason: '申请不存在或无权限' }
    });
    throw new AppError('借阅申请不存在或权限已过期', 403, 'BATCH_DOWNLOAD_DENIED');
  }

  const application = applications[0];

  let itemQuery = `
    SELECT bai.*, a.* FROM borrow_application_items bai
    JOIN archives a ON bai.archive_id = a.id
    WHERE bai.application_id = ?
  `;
  const params = [applicationId];
  if (archiveIds && archiveIds.length > 0) {
    itemQuery += ' AND bai.archive_id IN (?)';
    params.push(archiveIds);
  }

  const items = await db.query(itemQuery, params);

  if (items.length === 0) {
    throw new AppError('没有可下载的档案', 400, 'NO_ARCHIVES_TO_DOWNLOAD');
  }

  let authLevel = application.authorization_level || null;

  for (const item of items) {
    await checkDownloadLimit(userId, item.archive_id, applicationId, application.download_limit);

    if (item.requires_desensitization
      || (item.sensitive_content_types && item.sensitive_content_types.length > 0)) {
      try {
        const desensitized = await getOrCreateDesensitizedVersion(
          item.archive_id, applicationId, userId, userName, authLevel
        );
        if (!desensitized || desensitized.desensitize_status !== 'completed') {
          throw new AppError(
            `档案 ${item.archive_code} 脱敏处理失败，批量下载已取消。敏感档案不能因脱敏失败绕过权限控制。`,
            403, 'DESENSITIZE_FAILED_BLOCKED'
          );
        }
      } catch (err) {
        if (err.code === 'DESENSITIZE_FAILED_BLOCKED'
          || err.code === 'DESENSITIZE_TASK_PENDING_BLOCKED') {
          throw err;
        }
        throw new AppError(
          `档案 ${item.archive_code} 处理失败，批量下载已取消。详情：${err.message}`,
          500, 'BATCH_PROCESS_ERROR'
        );
      }
    }
  }

  for (const item of items) {
    await incrementDownloadCount(applicationId, item.archive_id);
  }

  const archiveIdList = items.map(i => i.archive_id);
  const batchPkg = await createBatchPackageRecord({
    applicationId,
    userId,
    archiveIds: archiveIdList,
    expireDays: Math.min(application.borrow_days || 7, 30)
  });

  await markBatchPackageReady(
    batchPkg.batchId,
    null,
    `batch_${applicationId}_${Date.now()}.zip`,
    archiveIdList.length * 1024 * 50
  );

  await updateLastAccessTime(applicationId);

  await createAuditLog({
    userId,
    action: AUDIT_ACTION.DOWNLOAD_ARCHIVE,
    targetType: 'borrow_application',
    targetId: applicationId,
    ipAddress,
    userAgent,
    last_access_at: new Date(),
    detail: {
      type: 'batch',
      batchId: batchPkg.batchId,
      count: items.length,
      archiveIds: archiveIdList,
      authorizationLevel: authLevel
    }
  });

  return {
    applicationId,
    batchId: batchPkg.batchId,
    batchExpireAt: batchPkg.expireAt,
    totalFiles: items.length,
    authorizationLevel: authLevel,
    files: items.map(item => ({
      archiveId: item.archive_id,
      archiveCode: item.archive_code,
      title: item.title,
      desensitized: !!(item.requires_desensitization || item.sensitive_content_types)
    })),
    expireAt: application.expire_at
  };
}

async function recycleExpiredArchives() {
  const expiredCount = await expireOverdueApplications();

  const now = new Date();
  let revokedTokens = 0;
  let revokedPackages = 0;
  let revokedWatermarks = 0;
  let recycledAuths = 0;
  const abnormalConn = [];

  const authKeysToClear = await db.query(
    `SELECT ba.applicant_id, bai.archive_id, ba.id as application_id
     FROM borrow_applications ba
     JOIN borrow_application_items bai ON ba.id = bai.application_id
     WHERE ba.is_expired = 1 AND ba.approval_status = 'expired'`
  );

  for (const item of authKeysToClear) {
    await delCache(`borrow_auth:${item.applicant_id}:${item.archive_id}`);
    await delCache(`temp_auth:${item.applicant_id}:${item.archive_id}`);
    recycledAuths++;
  }

  const expiredApps = await db.query(
    `SELECT DISTINCT id, applicant_id, last_access_at, expire_at
     FROM borrow_applications
     WHERE is_expired = 1 AND approval_status = 'expired'`
  );

  for (const app of expiredApps) {
    const tokens = await db.query(
      `SELECT token FROM access_tokens
       WHERE application_id = ? AND token_status = ? AND expire_at <= ?`,
      [app.id, TOKEN_STATUS.ACTIVE, now]
    );
    for (const t of tokens) {
      const r = await revokeAccessToken(t.token, null, `借阅申请${app.id}到期自动回收`);
      if (r.revoked) revokedTokens++;
    }

    const activeTokensLeft = await db.query(
      `SELECT token FROM access_tokens
       WHERE application_id = ? AND token_status = ?`,
      [app.id, TOKEN_STATUS.ACTIVE]
    );
    for (const t of activeTokensLeft) {
      const r = await revokeAccessToken(t.token, null, `借阅申请${app.id}到期强制回收所有关联令牌`);
      if (r.revoked) revokedTokens++;
    }

    const pkgs = await db.query(
      `SELECT batch_id FROM batch_packages
       WHERE application_id = ? AND package_status IN (?, ?)`,
      [app.id, PACKAGE_STATUS.GENERATING, PACKAGE_STATUS.READY]
    );
    for (const p of pkgs) {
      const r = await revokeBatchPackage(p.batch_id, null, `借阅申请${app.id}到期自动回收批量压缩包`);
      if (r.revoked) revokedPackages++;
    }

    const wms = await db.query(
      `SELECT file_rid FROM offline_watermark_files
       WHERE application_id = ? AND file_status = ?`,
      [app.id, WATERMARK_FILE_STATUS.ACTIVE]
    );
    for (const w of wms) {
      const r = await revokeWatermarkFile(w.file_rid, null, `借阅申请${app.id}到期自动回收离线水印文件`);
      if (r.revoked) revokedWatermarks++;
    }

    const appAbnormal = await detectAbnormalConnections(app.id);
    for (const ab of appAbnormal) abnormalConn.push(ab);

    await createAuditLog({
      userId: null,
      username: 'system',
      realName: '系统',
      action: AUDIT_ACTION.AUTHORIZATION_EXPIRE_RECYCLE,
      targetType: 'borrow_application',
      targetId: app.id,
      last_access_at: app.last_access_at,
      recovery_action: `回收令牌:${tokens.length + activeTokensLeft.length};压缩包:${pkgs.length};水印:${wms.length}`,
      abnormal_connections: appAbnormal.length > 0 ? JSON.stringify(appAbnormal) : null,
      detail: {
        applicationId: app.id,
        applicantId: app.applicant_id,
        expireAt: app.expire_at,
        lastAccessAt: app.last_access_at,
        tokensRevoked: tokens.length + activeTokensLeft.length,
        packagesRevoked: pkgs.length,
        watermarksRevoked: wms.length,
        abnormalConnectionCount: appAbnormal.length
      }
    });
  }

  const expiredTokensByTime = await db.query(
    `SELECT token FROM access_tokens
     WHERE token_status = ? AND expire_at <= ?`,
    [TOKEN_STATUS.ACTIVE, now]
  );
  for (const t of expiredTokensByTime) {
    const r = await revokeAccessToken(t.token, null, '令牌过期时间已到自动回收');
    if (r.revoked) revokedTokens++;
  }

  const expiredPackagesByTime = await db.query(
    `SELECT batch_id FROM batch_packages
     WHERE package_status IN (?, ?) AND expire_at <= ?`,
    [PACKAGE_STATUS.GENERATING, PACKAGE_STATUS.READY, now]
  );
  for (const p of expiredPackagesByTime) {
    const r = await revokeBatchPackage(p.batchId, null, '压缩包过期时间已到自动回收');
    if (r.revoked) revokedPackages++;
  }

  const expiredWatermarksByTime = await db.query(
    `SELECT file_rid FROM offline_watermark_files
     WHERE file_status = ? AND expire_at <= ?`,
    [WATERMARK_FILE_STATUS.ACTIVE, now]
  );
  for (const w of expiredWatermarksByTime) {
    const r = await revokeWatermarkFile(w.file_rid, null, '离线水印文件过期自动回收');
    if (r.revoked) revokedWatermarks++;
  }

  const allAbnormal = await detectAbnormalConnections();
  for (const ab of allAbnormal) abnormalConn.push(ab);

  if (abnormalConn.length > 0) {
    for (const ab of abnormalConn.slice(0, 50)) {
      await createAuditLog({
        userId: null,
        username: 'system',
        realName: '系统',
        action: AUDIT_ACTION.ABNORMAL_CONNECTION_DETECTED,
        targetType: ab.type,
        targetId: ab.id,
        detail: ab
      });
    }
  }

  await createAuditLog({
    userId: null,
    username: 'system',
    realName: '系统',
    action: AUDIT_ACTION.RECYCLE,
    targetType: 'system',
    last_access_at: now,
    recovery_action: `applications:${expiredCount};tokens:${revokedTokens};packages:${revokedPackages};watermarks:${revokedWatermarks};auths:${recycledAuths};abnormal:${abnormalConn.length}`,
    abnormal_connections: abnormalConn.length > 0 ? JSON.stringify(abnormalConn.slice(0, 100)) : null,
    detail: {
      expiredApplications: expiredCount,
      recycledAuthorizations: recycledAuths,
      revokedTokens,
      revokedPackages,
      revokedWatermarkFiles: revokedWatermarks,
      abnormalConnectionCount: abnormalConn.length,
      abnormalConnectionsSample: abnormalConn.slice(0, 10)
    }
  });

  return {
    expiredApplications: expiredCount,
    recycledAuthorizations: recycledAuths,
    revokedTokens,
    revokedPackages,
    revokedWatermarkFiles: revokedWatermarks,
    abnormalConnectionCount: abnormalConn.length,
    abnormalConnections: abnormalConn.slice(0, 20)
  };
}

async function revokeByApplication(applicationId, operatorId, reason = '管理员手动回收') {
  let revokedTokens = 0;
  let revokedPackages = 0;
  let revokedWatermarks = 0;

  const tokens = await db.query(
    `SELECT token FROM access_tokens
     WHERE application_id = ? AND token_status = ?`,
    [applicationId, TOKEN_STATUS.ACTIVE]
  );
  for (const t of tokens) {
    const r = await revokeAccessToken(t.token, operatorId, reason);
    if (r.revoked) revokedTokens++;
  }

  const pkgs = await db.query(
    `SELECT batch_id FROM batch_packages
     WHERE application_id = ? AND package_status IN (?, ?)`,
    [applicationId, PACKAGE_STATUS.GENERATING, PACKAGE_STATUS.READY]
  );
  for (const p of pkgs) {
    const r = await revokeBatchPackage(p.batch_id, operatorId, reason);
    if (r.revoked) revokedPackages++;
  }

  const wms = await db.query(
    `SELECT file_rid FROM offline_watermark_files
     WHERE application_id = ? AND file_status = ?`,
    [applicationId, WATERMARK_FILE_STATUS.ACTIVE]
  );
  for (const w of wms) {
    const r = await revokeWatermarkFile(w.file_rid, operatorId, reason);
    if (r.revoked) revokedWatermarks++;
  }

  await createAuditLog({
    userId: operatorId,
    action: AUDIT_ACTION.AUTHORIZATION_EXPIRE_RECYCLE,
    targetType: 'borrow_application',
    targetId: applicationId,
    recovery_action: `手动回收 tokens:${revokedTokens};packages:${revokedPackages};watermarks:${revokedWatermarks}`,
    detail: {
      applicationId,
      operatorId,
      reason,
      revokedTokens,
      revokedPackages,
      revokedWatermarks
    }
  });

  return {
    applicationId,
    revokedTokens,
    revokedPackages,
    revokedWatermarks,
    reason
  };
}

module.exports = {
  previewArchive,
  downloadArchive,
  batchDownloadArchives,
  recycleExpiredArchives,
  checkPreviewLimit,
  checkDownloadLimit,
  generatePreviewToken,
  generateDownloadToken,
  verifyAccessToken,
  revokeAccessToken,
  createBatchPackageRecord,
  markBatchPackageReady,
  revokeBatchPackage,
  createWatermarkFileRecord,
  revokeWatermarkFile,
  updateLastAccessTime,
  detectAbnormalConnections,
  revokeByApplication
};

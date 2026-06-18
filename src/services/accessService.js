const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { getCache, setCache, incrCounter, delCache } = require('../redis');
const { AppError, isExpired, fail, success } = require('../utils');
const { verifyArchiveAccess } = require('../middleware/auth');
const { getOrCreateDesensitizedVersion, generateWatermarkOverlay } = require('./desensitizeService');
const { createAuditLog } = require('./auditService');
const { AUDIT_ACTION, APPROVAL_STATUS } = require('../constants');
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
}

async function incrementDownloadCount(applicationId, archiveId) {
  await db.query(
    'UPDATE borrow_application_items SET download_count = download_count + 1 WHERE application_id = ? AND archive_id = ?',
    [applicationId, archiveId]
  );
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
    if (archive.requires_desensitization) {
      try {
        desensitizedVersion = await getOrCreateDesensitizedVersion(
          archiveId, accessResult.application.id, userId, userName
        );
      } catch (err) {
        if (err.code === 'DESENSITIZE_FAILED') {
          throw new AppError('档案脱敏处理失败，无法预览。敏感档案不能因脱敏失败绕过权限控制。', 403, 'DESENSITIZE_FAILED_BLOCKED');
        }
        throw err;
      }

      if (!desensitizedVersion || desensitizedVersion.desensitize_status !== 'completed') {
        throw new AppError('档案脱敏处理失败，无法预览。敏感档案不能因脱敏失败绕过权限控制。', 403, 'DESENSITIZE_FAILED_BLOCKED');
      }
    }

    await createAuditLog({
      userId,
      userName: userName || (accessResult.application ? null : null),
      action: AUDIT_ACTION.PREVIEW_ARCHIVE,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
      detail: {
        applicationId: accessResult.application.id,
        archiveCode: archive.archive_code,
        archiveTitle: archive.title,
        desensitized: archive.requires_desensitization,
        watermark: desensitizedVersion ? desensitizedVersion.watermark_text : null
      }
    });

    const watermark = generateWatermarkOverlay(
      userId, userName, archiveId, accessResult.application.id
    );

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
        tags: archive.tags ? archive.tags.split(',') : []
      },
      desensitized: archive.requires_desensitization,
      desensitizedVersionId: desensitizedVersion ? desensitizedVersion.id : null,
      watermark,
      previewCount: accessResult.application.preview_count + 1,
      previewLimit: accessResult.application.preview_limit,
      expireAt: accessResult.application.expire_at
    };
  } else if (accessResult.tempAuth) {
    await createAuditLog({
      userId,
      action: AUDIT_ACTION.PREVIEW_ARCHIVE,
      targetType: 'archive',
      targetId: archiveId,
      ipAddress,
      userAgent,
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
  if (archive.requires_desensitization) {
    try {
      desensitizedVersion = await getOrCreateDesensitizedVersion(
        archiveId, application.id, userId, userName
      );
    } catch (err) {
      if (err.code === 'DESENSITIZE_FAILED') {
        throw new AppError('档案脱敏处理失败，无法下载。敏感档案不能因脱敏失败绕过权限控制。', 403, 'DESENSITIZE_FAILED_BLOCKED');
      }
      throw err;
    }

    if (!desensitizedVersion || desensitizedVersion.desensitize_status !== 'completed') {
      throw new AppError('档案脱敏处理失败，无法下载。敏感档案不能因脱敏失败绕过权限控制。', 403, 'DESENSITIZE_FAILED_BLOCKED');
    }
  }

  await incrementDownloadCount(application.id, archiveId);

  await createAuditLog({
    userId,
    action: AUDIT_ACTION.DOWNLOAD_ARCHIVE,
    targetType: 'archive',
    targetId: archiveId,
    ipAddress,
    userAgent,
    detail: {
      applicationId: application.id,
      archiveCode: archive.archive_code,
      desensitized: archive.requires_desensitization,
      watermark: desensitizedVersion ? desensitizedVersion.watermark_text : null
    }
  });

  return {
    archive: {
      id: archive.id,
      archiveCode: archive.archive_code,
      title: archive.title,
      fileName: desensitizedVersion ? desensitizedVersion.file_name : archive.file_name,
      fileSize: archive.file_size,
      desensitized: archive.requires_desensitization,
      desensitizedFilePath: desensitizedVersion ? desensitizedVersion.file_path : archive.file_path
    },
    watermark: generateWatermarkOverlay(userId, userName, archiveId, application.id),
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

  for (const item of items) {
    await checkDownloadLimit(userId, item.archive_id, applicationId, application.download_limit);

    if (item.requires_desensitization) {
      try {
        const desensitized = await getOrCreateDesensitizedVersion(
          item.archive_id, applicationId, userId, userName
        );
        if (!desensitized || desensitized.desensitize_status !== 'completed') {
          throw new AppError(
            `档案 ${item.archive_code} 脱敏处理失败，批量下载已取消。敏感档案不能因脱敏失败绕过权限控制。`,
            403, 'DESENSITIZE_FAILED_BLOCKED'
          );
        }
      } catch (err) {
        if (err.code === 'DESENSITIZE_FAILED' || err.code === 'DESENSITIZE_FAILED_BLOCKED') {
          throw err;
        }
        throw new AppError(
          `档案 ${item.archive_code} 处理失败，批量下载已取消。`,
          500, 'BATCH_PROCESS_ERROR'
        );
      }
    }
  }

  for (const item of items) {
    await incrementDownloadCount(applicationId, item.archive_id);
  }

  await createAuditLog({
    userId,
    action: AUDIT_ACTION.DOWNLOAD_ARCHIVE,
    targetType: 'borrow_application',
    targetId: applicationId,
    ipAddress,
    userAgent,
    detail: {
      type: 'batch',
      count: items.length,
      archiveIds: items.map(i => i.archive_id)
    }
  });

  return {
    applicationId,
    batchId: `BATCH_${Date.now()}`,
    totalFiles: items.length,
    files: items.map(item => ({
      archiveId: item.archive_id,
      archiveCode: item.archive_code,
      title: item.title,
      desensitized: item.requires_desensitization
    })),
    expireAt: application.expire_at
  };
}

async function recycleExpiredArchives() {
  const expiredCount = await expireOverdueApplications();

  const authKeysToClear = await db.query(
    `SELECT ba.applicant_id, bai.archive_id FROM borrow_applications ba
     JOIN borrow_application_items bai ON ba.id = bai.application_id
     WHERE ba.is_expired = 1 AND ba.approval_status = 'expired'`
  );

  for (const item of authKeysToClear) {
    await delCache(`borrow_auth:${item.applicant_id}:${item.archive_id}`);
    await delCache(`temp_auth:${item.applicant_id}:${item.archive_id}`);
  }

  await createAuditLog({
    userId: null,
    username: 'system',
    realName: '系统',
    action: AUDIT_ACTION.RECYCLE,
    targetType: 'system',
    detail: {
      expiredApplications: expiredCount,
      recycledAuthorizations: authKeysToClear.length
    }
  });

  return {
    expiredApplications: expiredCount,
    recycledAuthorizations: authKeysToClear.length
  };
}

module.exports = {
  previewArchive,
  downloadArchive,
  batchDownloadArchives,
  recycleExpiredArchives,
  checkPreviewLimit,
  checkDownloadLimit
};

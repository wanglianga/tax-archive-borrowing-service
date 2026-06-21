const db = require('../db');
const dayjs = require('dayjs');
const {
  APPROVAL_STATUS,
  APPROVAL_STEP,
  ROLES,
  SENSITIVITY_LEVEL,
  AUTHORIZATION_LEVEL,
  AUDIT_ACTION
} = require('../constants');
const { AppError, addDays } = require('../utils');
const { delCache, setCache } = require('../redis');
const { createAuditLog } = require('./auditService');

async function createApproverNotification({
  approverId,
  applicationId = null,
  taskId = null,
  notificationType,
  title,
  content = null,
  priority = 1,
  relatedData = null
}) {
  if (!approverId || !notificationType || !title) {
    throw new AppError('缺少通知必要参数', 400, 'NOTIFICATION_PARAMS_MISSING');
  }

  const result = await db.query(
    `INSERT INTO approver_notifications
     (approver_id, application_id, task_id, notification_type, title, content, priority, related_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      approverId,
      applicationId,
      taskId,
      notificationType,
      title,
      content,
      priority,
      typeof relatedData === 'object' ? JSON.stringify(relatedData) : (relatedData || null)
    ]
  );

  return {
    id: result.insertId,
    approverId,
    notificationType,
    title,
    createdAt: new Date()
  };
}

async function listApproverNotifications(approverId, isRead = null, page = 1, pageSize = 20) {
  const where = ['approver_id = ?'];
  const params = [approverId];

  if (isRead !== null && isRead !== undefined) {
    where.push('is_read = ?');
    params.push(isRead ? 1 : 0);
  }

  const whereClause = 'WHERE ' + where.join(' AND ');

  const listSql = `
    SELECT an.*, ba.application_no, u.real_name as related_name
    FROM approver_notifications an
    LEFT JOIN borrow_applications ba ON an.application_id = ba.id
    LEFT JOIN users u ON u.id = (
      SELECT applicant_id FROM borrow_applications WHERE id = an.application_id LIMIT 1
    )
    ${whereClause}
    ORDER BY an.priority DESC, an.created_at DESC
  `;
  const countSql = `SELECT COUNT(*) as total FROM approver_notifications an ${whereClause}`;

  const [list, total] = await Promise.all([
    db.queryWithPagination(listSql, params, { page, pageSize }),
    db.countQuery(countSql, params)
  ]);

  return { list, total, page, pageSize };
}

async function markNotificationRead(notificationId, approverId) {
  const records = await db.query(
    `SELECT * FROM approver_notifications WHERE id = ? AND approver_id = ?`,
    [notificationId, approverId]
  );

  if (records.length === 0) {
    throw new AppError('通知不存在或无权限', 404, 'NOTIFICATION_NOT_FOUND');
  }

  await db.query(
    `UPDATE approver_notifications SET is_read = 1, read_at = NOW() WHERE id = ?`,
    [notificationId]
  );

  return { id: notificationId, isRead: true };
}

async function markAllNotificationsRead(approverId) {
  const result = await db.query(
    `UPDATE approver_notifications SET is_read = 1, read_at = NOW()
     WHERE approver_id = ? AND is_read = 0`,
    [approverId]
  );
  return { affected: result.affectedRows };
}

function determineAuthorizationLevelByApprovalChain(approvalChain) {
  if (!approvalChain || approvalChain.length === 0) {
    return AUTHORIZATION_LEVEL.LEVEL_1_BASIC;
  }

  if (approvalChain.length >= 3) {
    return AUTHORIZATION_LEVEL.LEVEL_4_FULL;
  }
  if (approvalChain.length >= 2) {
    return AUTHORIZATION_LEVEL.LEVEL_3_ADVANCED;
  }
  if (approvalChain.length >= 1) {
    return AUTHORIZATION_LEVEL.LEVEL_2_STANDARD;
  }
  return AUTHORIZATION_LEVEL.LEVEL_1_BASIC;
}

async function approveApplication({
  applicationId,
  approverId,
  approverRole,
  comment = null
}) {
  return await db.transaction(async (conn) => {
    const [applications] = await conn.execute(
      'SELECT * FROM borrow_applications WHERE id = ? FOR UPDATE',
      [applicationId]
    );

    if (applications.length === 0) {
      throw new AppError('借阅申请不存在', 404, 'APPLICATION_NOT_FOUND');
    }

    const application = applications[0];

    if (application.approval_status !== APPROVAL_STATUS.PENDING) {
      throw new AppError(`当前申请状态为 ${application.approval_status}，无法审批`, 400, 'INVALID_STATUS');
    }

    const [approvals] = await conn.execute(
      'SELECT * FROM borrow_approvals WHERE application_id = ? ORDER BY approval_step',
      [applicationId]
    );

    if (approvals.length === 0) {
      throw new AppError('该申请无需审批', 400, 'NO_APPROVAL_REQUIRED');
    }

    const currentApproval = approvals.find(
      a => a.status === 'pending' && a.approval_step === application.approval_step
    );

    if (!currentApproval) {
      throw new AppError('当前没有待审批环节', 400, 'NO_PENDING_STEP');
    }

    if (currentApproval.approver_id !== approverId) {
      if (approverRole === ROLES.ADMIN) {
      } else if (currentApproval.approval_role !== approverRole) {
        throw new AppError('您没有权限审批该申请', 403, 'NOT_APPROVER');
      }
    }

    await conn.execute(
      `UPDATE borrow_approvals SET status = 'approved' WHERE id = ?`,
      [currentApproval.id]
    );

    await conn.execute(
      `INSERT INTO approval_records (approval_id, application_id, approver_id, action, comment)
       VALUES (?, ?, ?, 'approve', ?)`,
      [currentApproval.id, applicationId, approverId, comment]
    );

    const nextApproval = approvals.find(
      a => a.approval_step > currentApproval.approval_step
    );

    if (nextApproval) {
      await conn.execute(
        `UPDATE borrow_applications
         SET approval_step = ?, current_approver_id = ?
         WHERE id = ?`,
        [nextApproval.approval_step, nextApproval.approver_id, applicationId]
      );

      try {
        const nextApproverInfo = await conn.execute(
          `SELECT real_name FROM users WHERE id = ?`,
          [nextApproval.approver_id]
        );
        await createApproverNotification({
          approverId: nextApproval.approver_id,
          applicationId,
          notificationType: 'APPROVAL_NEEDED',
          title: `借阅申请待审批 - ${application.application_no}`,
          content: `借阅申请 ${application.application_no} 已通过上一级审批，请您尽快处理。\n借阅目的：${application.purpose}\n事由：${application.reason ? application.reason.slice(0, 200) : '无'}`,
          priority: 1
        });
      } catch (e) {
        console.warn('发送下一审批人通知失败:', e.message);
      }

      return {
        applicationId,
        approvalStatus: APPROVAL_STATUS.PENDING,
        nextStep: nextApproval.approval_step
      };
    } else {
      const expireAt = addDays(new Date(), application.borrow_days);
      const totalApprovalSteps = approvals.length;
      const authorizationLevel = determineAuthorizationLevelByApprovalChain(approvals);

      await conn.execute(
        `UPDATE borrow_applications
         SET approval_status = ?, approval_step = ?, current_approver_id = NULL,
             expire_at = ?, authorization_level = ?
         WHERE id = ?`,
        [APPROVAL_STATUS.APPROVED, APPROVAL_STEP.COMPLETED, expireAt, authorizationLevel, applicationId]
      );

      const items = await conn.execute(
        'SELECT archive_id FROM borrow_application_items WHERE application_id = ?',
        [applicationId]
      );

      for (const item of items[0]) {
        const cacheKey = `borrow_auth:${application.applicant_id}:${item.archive_id}`;
        await setCache(cacheKey, {
          applicationId,
          expireAt,
          authorizationLevel
        }, application.borrow_days * 86400);
      }

      try {
        await createApproverNotification({
          approverId: application.applicant_id,
          applicationId,
          notificationType: 'APPLICATION_APPROVED',
          title: `借阅申请已通过 - ${application.application_no}`,
          content: `您的借阅申请 ${application.application_no} 已通过审批。\n授权级别：${authorizationLevel} 级\n有效期至：${dayjs(expireAt).format('YYYY-MM-DD HH:mm')}\n借阅期限：${application.borrow_days} 天\n请在有效期内使用，过期后所有访问令牌将自动失效。`,
          priority: 1
        });
      } catch (e) {
        console.warn('发送申请人通知失败:', e.message);
      }

      await createAuditLog({
        userId: approverId,
        action: AUDIT_ACTION.APPROVE,
        targetType: 'borrow_application',
        targetId: applicationId,
        detail: {
          applicationNo: application.application_no,
          authorizationLevel,
          totalApprovalSteps,
          expireAt
        }
      });

      return {
        applicationId,
        approvalStatus: APPROVAL_STATUS.APPROVED,
        nextStep: APPROVAL_STEP.COMPLETED,
        expireAt,
        authorizationLevel
      };
    }
  });
}

async function rejectApplication({
  applicationId,
  approverId,
  approverRole,
  comment = null
}) {
  return await db.transaction(async (conn) => {
    const [applications] = await conn.execute(
      'SELECT * FROM borrow_applications WHERE id = ? FOR UPDATE',
      [applicationId]
    );

    if (applications.length === 0) {
      throw new AppError('借阅申请不存在', 404, 'APPLICATION_NOT_FOUND');
    }

    const application = applications[0];

    if (application.approval_status !== APPROVAL_STATUS.PENDING) {
      throw new AppError('当前申请状态不允许驳回', 400, 'INVALID_STATUS');
    }

    const [approvals] = await conn.execute(
      'SELECT * FROM borrow_approvals WHERE application_id = ? AND status = ?',
      [applicationId, 'pending']
    );

    const currentApproval = approvals.find(
      a => a.approval_step === application.approval_step
    );

    if (!currentApproval) {
      throw new AppError('当前没有待审批环节', 400, 'NO_PENDING_STEP');
    }

    if (currentApproval.approver_id !== approverId && currentApproval.approval_role !== approverRole && approverRole !== ROLES.ADMIN) {
      throw new AppError('您没有权限审批该申请', 403, 'NOT_APPROVER');
    }

    await conn.execute(
      `UPDATE borrow_approvals SET status = 'rejected' WHERE id = ?`,
      [currentApproval.id]
    );

    await conn.execute(
      `INSERT INTO approval_records (approval_id, application_id, approver_id, action, comment)
       VALUES (?, ?, ?, 'reject', ?)`,
      [currentApproval.id, applicationId, approverId, comment || '申请被驳回']
    );

    await conn.execute(
      `UPDATE borrow_applications SET approval_status = ? WHERE id = ?`,
      [APPROVAL_STATUS.REJECTED, applicationId]
    );

    try {
      await createApproverNotification({
        approverId: application.applicant_id,
        applicationId,
        notificationType: 'APPLICATION_REJECTED',
        title: `借阅申请被驳回 - ${application.application_no}`,
        content: `您的借阅申请 ${application.application_no} 被驳回。\n驳回理由：${comment || '未说明'}\n如有疑问请联系审批人。`,
        priority: 2
      });
    } catch (e) {
      console.warn('发送驳回通知失败:', e.message);
    }

    return {
      applicationId,
      approvalStatus: APPROVAL_STATUS.REJECTED
    };
  });
}

async function recallApplication({ applicationId, applicantId }) {
  return await db.transaction(async (conn) => {
    const [applications] = await conn.execute(
      'SELECT * FROM borrow_applications WHERE id = ?',
      [applicationId]
    );

    if (applications.length === 0) {
      throw new AppError('借阅申请不存在', 404, 'APPLICATION_NOT_FOUND');
    }

    const application = applications[0];

    if (application.applicant_id !== applicantId) {
      throw new AppError('只能撤回自己的申请', 403, 'NOT_APPLICANT');
    }

    if (application.approval_status !== APPROVAL_STATUS.PENDING) {
      throw new AppError('当前状态不允许撤回', 400, 'INVALID_STATUS');
    }

    await conn.execute(
      `UPDATE borrow_approvals SET status = 'recalled' WHERE application_id = ? AND status = 'pending'`,
      [applicationId]
    );

    await conn.execute(
      `UPDATE borrow_applications SET approval_status = ? WHERE id = ?`,
      [APPROVAL_STATUS.RECALLED, applicationId]
    );

    return {
      applicationId,
      approvalStatus: APPROVAL_STATUS.RECALLED
    };
  });
}

async function createTempAuthorization({
  userId,
  archiveId = null,
  applicationId = null,
  authorizedBy,
  reason,
  expireHours = 24
}) {
  if (!userId || !authorizedBy || !reason) {
    throw new AppError('缺少必要参数', 400, 'MISSING_PARAMS');
  }

  const expireAt = dayjs().add(expireHours, 'hour').format('YYYY-MM-DD HH:mm:ss');

  const result = await db.query(
    `INSERT INTO temp_authorizations (user_id, archive_id, application_id, authorized_by, reason, expire_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, archiveId, applicationId, authorizedBy, reason, expireAt]
  );

  if (archiveId) {
    const cacheKey = `temp_auth:${userId}:${archiveId}`;
    await setCache(cacheKey, {
      id: result.insertId,
      expireAt
    }, expireHours * 3600);
  }

  try {
    const authUser = await db.query(`SELECT real_name FROM users WHERE id = ?`, [userId]);
    const authName = authUser.length > 0 ? authUser[0].real_name : '未知用户';
    await createApproverNotification({
      approverId: userId,
      applicationId,
      notificationType: 'TEMP_AUTHORIZATION',
      title: '您被授予临时访问权限',
      content: `授予人ID：${authorizedBy}\n授权原因：${reason}\n有效期：${expireHours} 小时，截止时间 ${expireAt}\n${archiveId ? `涉及档案ID：${archiveId}` : '涉及全部可访问档案'}\n过期后所有令牌将自动失效。`,
      priority: 1
    });
  } catch (e) {
    console.warn('发送临时授权通知失败:', e.message);
  }

  return {
    id: result.insertId,
    expireAt
  };
}

async function listPendingApprovals(approverId, page = 1, pageSize = 20) {
  const where = `WHERE bap.approver_id = ? AND bap.status = 'pending' AND ba.approval_status = 'pending'`;
  const listSql = `SELECT DISTINCT ba.*, u.real_name as applicant_name, u.department, u.position
       FROM borrow_applications ba
       JOIN borrow_approvals bap ON ba.id = bap.application_id
       LEFT JOIN users u ON ba.applicant_id = u.id
       ${where}
       ORDER BY ba.created_at DESC`;
  const countSql = `SELECT COUNT(DISTINCT ba.id) as total
       FROM borrow_applications ba
       JOIN borrow_approvals bap ON ba.id = bap.application_id
       ${where}`;

  const [list, total] = await Promise.all([
    db.queryWithPagination(listSql, [approverId], { page, pageSize }),
    db.countQuery(countSql, [approverId])
  ]);

  return {
    list,
    total,
    page,
    pageSize
  };
}

module.exports = {
  approveApplication,
  rejectApplication,
  recallApplication,
  createTempAuthorization,
  listPendingApprovals,
  createApproverNotification,
  listApproverNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  determineAuthorizationLevelByApprovalChain
};

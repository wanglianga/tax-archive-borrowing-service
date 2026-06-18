const db = require('../db');
const dayjs = require('dayjs');
const {
  APPROVAL_STATUS,
  APPROVAL_STEP,
  ROLES,
  SENSITIVITY_LEVEL
} = require('../constants');
const { AppError, addDays } = require('../utils');
const { delCache, setCache } = require('../redis');

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
        // 管理员可以代为审批
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

      return {
        applicationId,
        approvalStatus: APPROVAL_STATUS.PENDING,
        nextStep: nextApproval.approval_step
      };
    } else {
      const expireAt = addDays(new Date(), application.borrow_days);

      await conn.execute(
        `UPDATE borrow_applications
         SET approval_status = ?, approval_step = ?, current_approver_id = NULL, expire_at = ?
         WHERE id = ?`,
        [APPROVAL_STATUS.APPROVED, APPROVAL_STEP.COMPLETED, expireAt, applicationId]
      );

      const items = await conn.execute(
        'SELECT archive_id FROM borrow_application_items WHERE application_id = ?',
        [applicationId]
      );

      for (const item of items[0]) {
        const cacheKey = `borrow_auth:${application.applicant_id}:${item.archive_id}`;
        await setCache(cacheKey, {
          applicationId,
          expireAt
        }, application.borrow_days * 86400);
      }

      return {
        applicationId,
        approvalStatus: APPROVAL_STATUS.APPROVED,
        nextStep: APPROVAL_STEP.COMPLETED,
        expireAt
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

  return {
    id: result.insertId,
    expireAt
  };
}

async function listPendingApprovals(approverId, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;

  const [list, countResult] = await Promise.all([
    db.query(
      `SELECT DISTINCT ba.*, u.real_name as applicant_name, u.department, u.position
       FROM borrow_applications ba
       JOIN borrow_approvals bap ON ba.id = bap.application_id
       LEFT JOIN users u ON ba.applicant_id = u.id
       WHERE bap.approver_id = ? AND bap.status = 'pending'
         AND ba.approval_status = 'pending'
       ORDER BY ba.created_at DESC LIMIT ? OFFSET ?`,
      [approverId, pageSize, offset]
    ),
    db.query(
      `SELECT COUNT(DISTINCT ba.id) as total
       FROM borrow_applications ba
       JOIN borrow_approvals bap ON ba.id = bap.application_id
       WHERE bap.approver_id = ? AND bap.status = 'pending'
         AND ba.approval_status = 'pending'`,
      [approverId]
    )
  ]);

  return {
    list,
    total: countResult[0].total,
    page,
    pageSize
  };
}

module.exports = {
  approveApplication,
  rejectApplication,
  recallApplication,
  createTempAuthorization,
  listPendingApprovals
};

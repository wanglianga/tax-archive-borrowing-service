const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const config = require('../config');
const {
  BORROW_PURPOSE,
  SENSITIVITY_LEVEL,
  APPROVAL_STATUS,
  APPROVAL_STEP,
  ROLES
} = require('../constants');
const { AppError, addDays } = require('../utils');

function generateApplicationNo() {
  const prefix = 'BR';
  const date = dayjs().format('YYYYMMDD');
  const random = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}${date}${random}`;
}

function determineApprovalChain(archives, purpose) {
  let maxSensitivity = SENSITIVITY_LEVEL.NORMAL;
  for (const arch of archives) {
    if (arch.sensitivity_level > maxSensitivity) {
      maxSensitivity = arch.sensitivity_level;
    }
  }

  const chain = [];

  if (maxSensitivity >= SENSITIVITY_LEVEL.CONFIDENTIAL) {
    chain.push({
      step: APPROVAL_STEP.FIRST_LEVEL,
      role: ROLES.APPROVER,
      required: true
    });
  }

  if (maxSensitivity >= SENSITIVITY_LEVEL.SECRET) {
    chain.push({
      step: APPROVAL_STEP.SECOND_LEVEL,
      role: ROLES.SENIOR_APPROVER,
      required: true
    });
  }

  if (maxSensitivity >= SENSITIVITY_LEVEL.TOP_SECRET) {
    chain.push({
      step: APPROVAL_STEP.THIRD_LEVEL,
      role: ROLES.SENIOR_APPROVER,
      required: true
    });
  }

  if (purpose === BORROW_PURPOSE.CASE_INVESTIGATION && chain.length === 0) {
    chain.push({
      step: APPROVAL_STEP.FIRST_LEVEL,
      role: ROLES.APPROVER,
      required: true
    });
  }

  if (chain.length === 0) {
    return null;
  }

  return chain;
}

async function createBorrowApplication({
  applicantId,
  purpose,
  caseNumber = null,
  reason,
  archiveIds,
  borrowDays = null,
  previewLimit = null,
  downloadLimit = null,
  remark = null
}) {
  if (!Object.values(BORROW_PURPOSE).includes(purpose)) {
    throw new AppError('无效的借阅目的', 400, 'INVALID_PURPOSE');
  }

  if (!archiveIds || archiveIds.length === 0) {
    throw new AppError('至少需要选择一个档案', 400, 'NO_ARCHIVES_SELECTED');
  }

  const archivePlaceholders = archiveIds.map(() => '?').join(', ');
  const archives = await db.query(
    `SELECT * FROM archives WHERE id IN (${archivePlaceholders}) AND status = 1`,
    archiveIds
  );

  if (archives.length !== archiveIds.length) {
    throw new AppError('部分档案不存在或已删除', 400, 'ARCHIVES_NOT_FOUND');
  }

  for (const arch of archives) {
    if (purpose === BORROW_PURPOSE.CASE_INVESTIGATION && !caseNumber && !arch.case_number) {
      throw new AppError(`案件稽查借阅必须关联案件编号，档案 ${arch.archive_code} 未关联案件`, 400, 'CASE_NUMBER_REQUIRED');
    }
  }

  const approvalChain = determineApprovalChain(archives, purpose);
  const effectiveBorrowDays = borrowDays || config.limits.borrowDays;
  const effectivePreviewLimit = previewLimit || config.limits.preview;
  const effectiveDownloadLimit = downloadLimit || config.limits.download;

  return await db.transaction(async (conn) => {
    const applicationNo = generateApplicationNo();
    const expireAt = addDays(new Date(), effectiveBorrowDays);

    let approvalStatus = APPROVAL_STATUS.PENDING;
    let approvalStep = APPROVAL_STEP.FIRST_LEVEL;

    if (!approvalChain) {
      approvalStatus = APPROVAL_STATUS.APPROVED;
      approvalStep = APPROVAL_STEP.COMPLETED;
    }

    const [appResult] = await conn.execute(
      `INSERT INTO borrow_applications (application_no, applicant_id, purpose, case_number, reason,
        borrow_days, preview_limit, download_limit, approval_status, approval_step,
        expire_at, is_batch, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationNo, applicantId, purpose, caseNumber, reason,
        effectiveBorrowDays, effectivePreviewLimit, effectiveDownloadLimit,
        approvalStatus, approvalStep, expireAt,
        archiveIds.length > 1 ? 1 : 0, remark
      ]
    );

    const applicationId = appResult.insertId;

    for (const arch of archives) {
      await conn.execute(
        `INSERT INTO borrow_application_items (application_id, archive_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id=id`,
        [applicationId, arch.id]
      );
    }

    if (approvalChain) {
      const firstStep = approvalChain[0];
      const [approver] = await conn.execute(
        `SELECT id FROM users WHERE role = ? AND status = 1 LIMIT 1`,
        [firstStep.role]
      );

      for (const step of approvalChain) {
        await conn.execute(
          `INSERT INTO borrow_approvals (application_id, approver_id, approval_step, approval_role, is_required, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [
            applicationId,
            approver.length > 0 ? approver[0].id : null,
            step.step,
            step.role,
            step.required ? 1 : 0
          ]
        );
      }

      await conn.execute(
        `UPDATE borrow_applications SET current_approver_id = ? WHERE id = ?`,
        [approver.length > 0 ? approver[0].id : null, applicationId]
      );
    }

    return {
      id: applicationId,
      applicationNo,
      approvalStatus,
      approvalStep
    };
  });
}

async function listBorrowApplications({
  applicantId = null,
  status = null,
  approverId = null,
  keyword = null,
  page = 1,
  pageSize = 20
}) {
  const params = [];
  let where = 'WHERE 1=1';

  if (applicantId) {
    where += ' AND ba.applicant_id = ?';
    params.push(applicantId);
  }
  if (status) {
    where += ' AND ba.approval_status = ?';
    params.push(status);
  }
  if (approverId) {
    where += ` AND EXISTS (
      SELECT 1 FROM borrow_approvals bap
      WHERE bap.application_id = ba.id AND bap.approver_id = ?
    )`;
    params.push(approverId);
  }
  if (keyword) {
    where += ' AND (ba.application_no LIKE ? OR ba.reason LIKE ?)';
    const like = `%${keyword}%`;
    params.push(like, like);
  }

  const listSql = `SELECT ba.*, u.real_name as applicant_name, u.department, u.position
       FROM borrow_applications ba
       LEFT JOIN users u ON ba.applicant_id = u.id
       ${where}
       ORDER BY ba.created_at DESC`;
  const countSql = `SELECT COUNT(*) as total FROM borrow_applications ba ${where}`;

  const [list, total] = await Promise.all([
    db.queryWithPagination(listSql, params, { page, pageSize }),
    db.countQuery(countSql, params)
  ]);

  return {
    list,
    total,
    page,
    pageSize
  };
}

async function getBorrowApplicationDetail(id) {
  const applications = await db.query(
    `SELECT ba.*, u.real_name as applicant_name, u.department, u.position,
            u.employee_id as applicant_employee_id
     FROM borrow_applications ba
     LEFT JOIN users u ON ba.applicant_id = u.id
     WHERE ba.id = ? LIMIT 1`,
    [id]
  );

  if (applications.length === 0) {
    return null;
  }

  const [items, approvals, records] = await Promise.all([
    db.query(
      `SELECT bai.*, a.title, a.archive_code, a.archive_type, a.sensitivity_level,
              a.file_name, a.requires_desensitization, t.taxpayer_name
       FROM borrow_application_items bai
       JOIN archives a ON bai.archive_id = a.id
       LEFT JOIN taxpayers t ON a.taxpayer_id = t.id
       WHERE bai.application_id = ?`,
      [id]
    ),
    db.query(
      `SELECT bap.*, u.real_name as approver_name, u.position as approver_position
       FROM borrow_approvals bap
       LEFT JOIN users u ON bap.approver_id = u.id
       WHERE bap.application_id = ? ORDER BY bap.approval_step`,
      [id]
    ),
    db.query(
      `SELECT ar.*, u.real_name as approver_name
       FROM approval_records ar
       LEFT JOIN users u ON ar.approver_id = u.id
       WHERE ar.application_id = ? ORDER BY ar.created_at`,
      [id]
    )
  ]);

  return {
    ...applications[0],
    items,
    approvals,
    approvalRecords: records
  };
}

async function expireOverdueApplications() {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const result = await db.query(
    `UPDATE borrow_applications
     SET is_expired = 1, approval_status = 'expired'
     WHERE is_expired = 0 AND approval_status = 'approved' AND expire_at < ?`,
    [now]
  );
  return result.affectedRows;
}

module.exports = {
  createBorrowApplication,
  listBorrowApplications,
  getBorrowApplicationDetail,
  expireOverdueApplications,
  determineApprovalChain,
  generateApplicationNo
};

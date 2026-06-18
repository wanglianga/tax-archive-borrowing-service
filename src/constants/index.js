const ROLES = {
  ADMIN: 'admin',
  TAX_OFFICER: 'tax_officer',
  APPROVER: 'approver',
  SENIOR_APPROVER: 'senior_approver',
  AUDITOR: 'auditor'
};

const SENSITIVITY_LEVEL = {
  NORMAL: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
  TOP_SECRET: 4
};

const BORROW_PURPOSE = {
  CASE_INVESTIGATION: 'case_investigation',
  CONSULTATION_REPLY: 'consultation_reply',
  PENALTY_REVIEW: 'penalty_review',
  INTERNAL_REVIEW: 'internal_review'
};

const ARCHIVE_TYPE = {
  TAX_RETURN: 'tax_return',
  INVOICE: 'invoice',
  PENALTY_DECISION: 'penalty_decision',
  CORRESPONDENCE: 'correspondence',
  HISTORICAL_ATTACHMENT: 'historical_attachment'
};

const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RECALLED: 'recalled',
  EXPIRED: 'expired'
};

const APPROVAL_STEP = {
  FIRST_LEVEL: 1,
  SECOND_LEVEL: 2,
  THIRD_LEVEL: 3,
  COMPLETED: 99
};

const AUDIT_ACTION = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  CREATE_APPLICATION: 'create_application',
  APPROVE: 'approve',
  REJECT: 'reject',
  PREVIEW_ARCHIVE: 'preview_archive',
  DOWNLOAD_ARCHIVE: 'download_archive',
  DESENSITIZE: 'desensitize',
  RECYCLE: 'recycle',
  TEMP_AUTH: 'temp_auth',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  DESENSITIZE_FAILED: 'desensitize_failed'
};

module.exports = {
  ROLES,
  SENSITIVITY_LEVEL,
  BORROW_PURPOSE,
  ARCHIVE_TYPE,
  APPROVAL_STATUS,
  APPROVAL_STEP,
  AUDIT_ACTION
};

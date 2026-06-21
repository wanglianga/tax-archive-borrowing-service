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
  DESENSITIZE_FAILED: 'desensitize_failed',
  DESENSITIZE_TASK_PENDING: 'desensitize_task_pending',
  DESENSITIZE_TASK_RETRY: 'desensitize_task_retry',
  DESENSITIZE_TASK_RESOLVED: 'desensitize_task_resolved',
  NOTIFY_APPROVER: 'notify_approver',
  TOKEN_REVOKED: 'token_revoked',
  DOWNLOAD_LINK_REVOKED: 'download_link_revoked',
  BATCH_PACKAGE_REVOKED: 'batch_package_revoked',
  WATERMARK_FILE_REVOKED: 'watermark_file_revoked',
  AUTHORIZATION_EXPIRE_RECYCLE: 'authorization_expire_recycle',
  ABNORMAL_CONNECTION_DETECTED: 'abnormal_connection_detected',
  LAST_ACCESS_RECORDED: 'last_access_recorded'
};

const AUTHORIZATION_LEVEL = {
  LEVEL_1_BASIC: 1,
  LEVEL_2_STANDARD: 2,
  LEVEL_3_ADVANCED: 3,
  LEVEL_4_FULL: 4
};

const AUTHORIZATION_LEVEL_DESC = {
  1: '基础授权 - 屏蔽所有身份证号、银行账号、联系人姓名电话、供应商明细',
  2: '标准授权 - 屏蔽身份证号中段、银行账号中段，保留联系人姓氏，供应商仅保留名称',
  3: '高级授权 - 保留身份证号前6后4、银行账号前6后4，保留联系人姓名但屏蔽电话，供应商保留主要字段',
  4: '完全授权 - 完整可见，仅加水印追溯'
};

const DESENSITIZE_TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  FAILED: 'failed',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled'
};

const SENSITIVE_CONTENT_TYPE = {
  ID_CARD: 'id_card',
  BANK_ACCOUNT: 'bank_account',
  CASE_CONTACT: 'case_contact',
  SUPPLIER_DETAIL: 'supplier_detail',
  PHONE: 'phone',
  AMOUNT: 'amount',
  ADDRESS: 'address',
  LEGAL_PERSON: 'legal_person'
};

const SENSITIVE_CONTENT_DESC = {
  id_card: '身份证号',
  bank_account: '银行账号',
  case_contact: '涉案联系人',
  supplier_detail: '供应商明细',
  phone: '联系电话',
  amount: '涉案金额',
  address: '详细地址',
  legal_person: '法人代表'
};

const ACCESS_TOKEN_TYPE = {
  PREVIEW: 'preview',
  DOWNLOAD: 'download'
};

const TOKEN_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
};

const PACKAGE_STATUS = {
  GENERATING: 'generating',
  READY: 'ready',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  DELETED: 'deleted'
};

const WATERMARK_FILE_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  DELETED: 'deleted'
};

module.exports = {
  ROLES,
  SENSITIVITY_LEVEL,
  BORROW_PURPOSE,
  ARCHIVE_TYPE,
  APPROVAL_STATUS,
  APPROVAL_STEP,
  AUDIT_ACTION,
  AUTHORIZATION_LEVEL,
  AUTHORIZATION_LEVEL_DESC,
  DESENSITIZE_TASK_STATUS,
  SENSITIVE_CONTENT_TYPE,
  SENSITIVE_CONTENT_DESC,
  ACCESS_TOKEN_TYPE,
  TOKEN_STATUS,
  PACKAGE_STATUS,
  WATERMARK_FILE_STATUS
};

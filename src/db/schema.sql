CREATE DATABASE IF NOT EXISTS tax_archive_db
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE tax_archive_db;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS desensitized_archives;
DROP TABLE IF EXISTS approval_records;
DROP TABLE IF EXISTS borrow_approvals;
DROP TABLE IF EXISTS borrow_application_items;
DROP TABLE IF EXISTS borrow_applications;
DROP TABLE IF EXISTS archives;
DROP TABLE IF EXISTS archive_catalogs;
DROP TABLE IF EXISTS taxpayers;
DROP TABLE IF EXISTS temp_authorizations;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL,
  department VARCHAR(100),
  position VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(100),
  status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_role (role)
);

CREATE TABLE taxpayers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  taxpayer_id VARCHAR(50) NOT NULL UNIQUE,
  taxpayer_name VARCHAR(200) NOT NULL,
  taxpayer_type VARCHAR(50),
  legal_person VARCHAR(50),
  phone VARCHAR(20),
  address VARCHAR(500),
  industry VARCHAR(100),
  registration_date DATE,
  status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_taxpayer_id (taxpayer_id),
  INDEX idx_taxpayer_name (taxpayer_name)
);

CREATE TABLE archive_catalogs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id BIGINT DEFAULT 0,
  sort_order INT DEFAULT 0,
  description VARCHAR(500),
  status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent_id (parent_id)
);

CREATE TABLE archives (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  archive_code VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(300) NOT NULL,
  taxpayer_id BIGINT NOT NULL,
  catalog_id BIGINT,
  archive_type VARCHAR(50) NOT NULL,
  sensitivity_level TINYINT NOT NULL DEFAULT 1,
  case_number VARCHAR(100),
  file_name VARCHAR(300),
  file_path VARCHAR(500),
  file_size BIGINT DEFAULT 0,
  file_mime VARCHAR(100),
  period_year INT,
  period_month INT,
  description TEXT,
  tags VARCHAR(500),
  uploader_id BIGINT,
  requires_desensitization TINYINT DEFAULT 0,
  desensitization_rule TEXT,
  sensitive_content_types VARCHAR(500) DEFAULT NULL,
  status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_taxpayer_id (taxpayer_id),
  INDEX idx_catalog_id (catalog_id),
  INDEX idx_archive_type (archive_type),
  INDEX idx_sensitivity (sensitivity_level),
  INDEX idx_case_number (case_number)
);

CREATE TABLE borrow_applications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_no VARCHAR(100) NOT NULL UNIQUE,
  applicant_id BIGINT NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  case_number VARCHAR(100),
  reason TEXT NOT NULL,
  borrow_days INT NOT NULL,
  preview_limit INT NOT NULL,
  download_limit INT NOT NULL,
  approval_status VARCHAR(30) DEFAULT 'pending',
  approval_step INT DEFAULT 1,
  current_approver_id BIGINT,
  authorization_level TINYINT DEFAULT 1,
  expire_at TIMESTAMP NULL,
  last_access_at TIMESTAMP NULL,
  is_expired TINYINT DEFAULT 0,
  is_batch TINYINT DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_applicant (applicant_id),
  INDEX idx_status (approval_status),
  INDEX idx_case_number (case_number),
  INDEX idx_expire_at (expire_at)
);

CREATE TABLE borrow_application_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT NOT NULL,
  archive_id BIGINT NOT NULL,
  preview_count INT DEFAULT 0,
  download_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_app_archive (application_id, archive_id),
  INDEX idx_application_id (application_id),
  INDEX idx_archive_id (archive_id)
);

CREATE TABLE borrow_approvals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT NOT NULL,
  approver_id BIGINT NOT NULL,
  approval_step INT NOT NULL,
  approval_role VARCHAR(50),
  is_required TINYINT DEFAULT 1,
  status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_application_id (application_id),
  INDEX idx_approver_id (approver_id)
);

CREATE TABLE approval_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  approval_id BIGINT NOT NULL,
  application_id BIGINT NOT NULL,
  approver_id BIGINT NOT NULL,
  action VARCHAR(30) NOT NULL,
  comment VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_application_id (application_id),
  INDEX idx_approver_id (approver_id)
);

CREATE TABLE desensitized_archives (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  archive_id BIGINT NOT NULL,
  application_id BIGINT NOT NULL,
  version VARCHAR(50) NOT NULL,
  authorization_level TINYINT DEFAULT 1,
  file_path VARCHAR(500),
  file_name VARCHAR(300),
  rule_used TEXT,
  desensitize_status VARCHAR(30) DEFAULT 'pending',
  error_message VARCHAR(1000),
  watermark_text VARCHAR(500),
  sensitive_content_detected VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_archive_id (archive_id),
  INDEX idx_application_id (application_id),
  INDEX idx_status (desensitize_status)
);

CREATE TABLE temp_authorizations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  archive_id BIGINT,
  application_id BIGINT,
  authorized_by BIGINT NOT NULL,
  reason VARCHAR(500),
  expire_at TIMESTAMP NOT NULL,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_expire_at (expire_at)
);

CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  username VARCHAR(50),
  real_name VARCHAR(50),
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(50),
  target_id BIGINT,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  request_method VARCHAR(10),
  request_path VARCHAR(500),
  last_access_at TIMESTAMP NULL,
  recovery_action VARCHAR(100),
  abnormal_connections TEXT,
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
);

CREATE TABLE desensitize_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  archive_id BIGINT NOT NULL,
  application_id BIGINT NOT NULL,
  applicant_id BIGINT NOT NULL,
  approver_id BIGINT,
  authorization_level TINYINT DEFAULT 1,
  task_status VARCHAR(30) DEFAULT 'pending',
  retry_count INT DEFAULT 0,
  max_retry INT DEFAULT 3,
  error_message VARCHAR(1000),
  error_stack TEXT,
  sensitive_content_types VARCHAR(500),
  resolved_by BIGINT,
  resolved_at TIMESTAMP NULL,
  resolution_note VARCHAR(1000),
  notify_sent TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_archive_id (archive_id),
  INDEX idx_application_id (application_id),
  INDEX idx_status (task_status),
  INDEX idx_approver_id (approver_id)
);

CREATE TABLE access_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(100) NOT NULL UNIQUE,
  token_type VARCHAR(20) NOT NULL,
  user_id BIGINT NOT NULL,
  archive_id BIGINT,
  application_id BIGINT,
  desensitized_id BIGINT,
  ip_restriction VARCHAR(200),
  user_agent_hash VARCHAR(100),
  expire_at TIMESTAMP NOT NULL,
  token_status VARCHAR(20) DEFAULT 'active',
  revoked_at TIMESTAMP NULL,
  revoked_by BIGINT,
  revoke_reason VARCHAR(500),
  last_used_at TIMESTAMP NULL,
  use_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_user_id (user_id),
  INDEX idx_expire_at (expire_at),
  INDEX idx_status (token_status)
);

CREATE TABLE batch_packages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id VARCHAR(100) NOT NULL UNIQUE,
  application_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  archive_ids TEXT,
  file_path VARCHAR(500),
  file_name VARCHAR(300),
  file_size BIGINT DEFAULT 0,
  package_status VARCHAR(20) DEFAULT 'generating',
  expire_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  revoked_by BIGINT,
  revoke_reason VARCHAR(500),
  download_count INT DEFAULT 0,
  last_download_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch_id (batch_id),
  INDEX idx_application_id (application_id),
  INDEX idx_status (package_status),
  INDEX idx_expire_at (expire_at)
);

CREATE TABLE offline_watermark_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  file_rid VARCHAR(100) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  archive_id BIGINT NOT NULL,
  application_id BIGINT,
  desensitized_id BIGINT,
  file_path VARCHAR(500),
  file_name VARCHAR(300),
  watermark_text VARCHAR(500),
  file_status VARCHAR(20) DEFAULT 'active',
  expire_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  revoked_by BIGINT,
  revoke_reason VARCHAR(500),
  last_access_at TIMESTAMP NULL,
  access_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_file_rid (file_rid),
  INDEX idx_user_id (user_id),
  INDEX idx_expire_at (expire_at),
  INDEX idx_status (file_status)
);

CREATE TABLE approver_notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  approver_id BIGINT NOT NULL,
  application_id BIGINT,
  task_id BIGINT,
  notification_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  is_read TINYINT DEFAULT 0,
  read_at TIMESTAMP NULL,
  priority TINYINT DEFAULT 1,
  related_data TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_approver_id (approver_id),
  INDEX idx_is_read (is_read),
  INDEX idx_type (notification_type)
);

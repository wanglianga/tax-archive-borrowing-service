const bcrypt = require('bcryptjs');
const db = require('../db');
const { ROLES, ARCHIVE_TYPE, SENSITIVITY_LEVEL } = require('../constants');

async function seedData() {
  console.log('开始初始化种子数据...');

  const hashPassword = (pwd) => bcrypt.hashSync(pwd, 10);

  const users = [
    {
      username: 'admin',
      password: hashPassword('admin123'),
      real_name: '系统管理员',
      employee_id: 'EMP001',
      role: ROLES.ADMIN,
      department: '信息中心',
      position: '系统管理员'
    },
    {
      username: 'officer01',
      password: hashPassword('officer123'),
      real_name: '张稽查',
      employee_id: 'EMP002',
      role: ROLES.TAX_OFFICER,
      department: '稽查局',
      position: '稽查员'
    },
    {
      username: 'officer02',
      password: hashPassword('officer123'),
      real_name: '李咨询',
      employee_id: 'EMP003',
      role: ROLES.TAX_OFFICER,
      department: '纳税服务科',
      position: '咨询员'
    },
    {
      username: 'approver01',
      password: hashPassword('approver123'),
      real_name: '王科长',
      employee_id: 'EMP004',
      role: ROLES.APPROVER,
      department: '稽查局',
      position: '科长'
    },
    {
      username: 'senior01',
      password: hashPassword('senior123'),
      real_name: '赵局长',
      employee_id: 'EMP005',
      role: ROLES.SENIOR_APPROVER,
      department: '稽查局',
      position: '副局长'
    },
    {
      username: 'auditor01',
      password: hashPassword('auditor123'),
      real_name: '孙审计',
      employee_id: 'EMP006',
      role: ROLES.AUDITOR,
      department: '督察内审科',
      position: '审计员'
    }
  ];

  for (const user of users) {
    await db.query(
      `INSERT INTO users (username, password, real_name, employee_id, role, department, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password)`,
      [user.username, user.password, user.real_name, user.employee_id, user.role, user.department, user.position]
    );
  }
  console.log('用户数据初始化完成');

  const taxpayers = [
    {
      taxpayer_id: '91110000MA01234567',
      taxpayer_name: '北京宏达商贸有限公司',
      taxpayer_type: '有限责任公司',
      legal_person: '陈宏达',
      phone: '010-12345678',
      address: '北京市朝阳区建国路88号',
      industry: '批发零售业',
      registration_date: '2020-01-15'
    },
    {
      taxpayer_id: '91110000MA07654321',
      taxpayer_name: '北京鼎盛科技有限公司',
      taxpayer_type: '有限责任公司',
      legal_person: '刘鼎盛',
      phone: '010-87654321',
      address: '北京市海淀区中关村大街1号',
      industry: '信息技术服务业',
      registration_date: '2019-06-20'
    },
    {
      taxpayer_id: '91110000MA0ABCDEFG',
      taxpayer_name: '北京恒信建筑工程有限公司',
      taxpayer_type: '有限责任公司',
      legal_person: '周恒信',
      phone: '010-55667788',
      address: '北京市丰台区丰台路66号',
      industry: '建筑业',
      registration_date: '2018-03-10'
    }
  ];

  for (const tp of taxpayers) {
    await db.query(
      `INSERT INTO taxpayers (taxpayer_id, taxpayer_name, taxpayer_type, legal_person, phone, address, industry, registration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE taxpayer_name=VALUES(taxpayer_name)`,
      [tp.taxpayer_id, tp.taxpayer_name, tp.taxpayer_type, tp.legal_person, tp.phone, tp.address, tp.industry, tp.registration_date]
    );
  }
  console.log('纳税人数据初始化完成');

  const catalogs = [
    { name: '申报表', parent_id: 0, sort_order: 1 },
    { name: '发票档案', parent_id: 0, sort_order: 2 },
    { name: '处罚决定', parent_id: 0, sort_order: 3 },
    { name: '往来材料', parent_id: 0, sort_order: 4 },
    { name: '历史附件', parent_id: 0, sort_order: 5 },
    { name: '增值税申报表', parent_id: 1, sort_order: 1 },
    { name: '企业所得税申报表', parent_id: 1, sort_order: 2 },
    { name: '个人所得税申报表', parent_id: 1, sort_order: 3 },
    { name: '进项发票', parent_id: 2, sort_order: 1 },
    { name: '销项发票', parent_id: 2, sort_order: 2 }
  ];

  for (const cat of catalogs) {
    await db.query(
      `INSERT INTO archive_catalogs (name, parent_id, sort_order, description) VALUES (?, ?, ?, ?)`,
      [cat.name, cat.parent_id, cat.sort_order, cat.name]
    );
  }
  console.log('档案目录数据初始化完成');

  const taxpayersResult = await db.query('SELECT id FROM taxpayers');
  const taxpayerIds = taxpayersResult.map(t => t.id);

  const archives = [
    {
      archive_code: 'TAX-VAT-2024-0001',
      title: '北京宏达商贸有限公司2024年1月增值税纳税申报表',
      taxpayer_id: taxpayerIds[0],
      catalog_id: 6,
      archive_type: ARCHIVE_TYPE.TAX_RETURN,
      sensitivity_level: SENSITIVITY_LEVEL.CONFIDENTIAL,
      case_number: 'CASE2024001',
      file_name: 'vat_return_202401.pdf',
      file_path: '/uploads/vat_return_202401.pdf',
      file_size: 1024000,
      file_mime: 'application/pdf',
      period_year: 2024,
      period_month: 1,
      requires_desensitization: 1,
      desensitization_rule: 'mask_tax_id,mask_amount,mask_phone',
      description: '2024年1月增值税纳税申报表主表及附表',
      tags: '增值税,2024年,1月'
    },
    {
      archive_code: 'TAX-CIT-2023-0001',
      title: '北京鼎盛科技有限公司2023年度企业所得税汇算清缴申报表',
      taxpayer_id: taxpayerIds[1],
      catalog_id: 7,
      archive_type: ARCHIVE_TYPE.TAX_RETURN,
      sensitivity_level: SENSITIVITY_LEVEL.SECRET,
      case_number: 'CASE2024002',
      file_name: 'cit_return_2023.pdf',
      file_path: '/uploads/cit_return_2023.pdf',
      file_size: 2048000,
      file_mime: 'application/pdf',
      period_year: 2023,
      period_month: 12,
      requires_desensitization: 1,
      desensitization_rule: 'mask_tax_id,mask_amount,mask_phone,mask_bank_account',
      description: '2023年度企业所得税年度纳税申报表',
      tags: '企业所得税,2023年,汇算清缴'
    },
    {
      archive_code: 'INV-IN-2024-0001',
      title: '北京恒信建筑工程有限公司2024年1月进项发票清单',
      taxpayer_id: taxpayerIds[2],
      catalog_id: 9,
      archive_type: ARCHIVE_TYPE.INVOICE,
      sensitivity_level: SENSITIVITY_LEVEL.NORMAL,
      case_number: 'CASE2024003',
      file_name: 'invoice_in_202401.xlsx',
      file_path: '/uploads/invoice_in_202401.xlsx',
      file_size: 512000,
      file_mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      period_year: 2024,
      period_month: 1,
      requires_desensitization: 0,
      desensitization_rule: null,
      description: '2024年1月增值税进项发票认证清单',
      tags: '进项发票,2024年,1月'
    },
    {
      archive_code: 'PEN-2024-0001',
      title: '税务行政处罚决定书 - 北京宏达商贸有限公司',
      taxpayer_id: taxpayerIds[0],
      catalog_id: 3,
      archive_type: ARCHIVE_TYPE.PENALTY_DECISION,
      sensitivity_level: SENSITIVITY_LEVEL.TOP_SECRET,
      case_number: 'CASE2024001',
      file_name: 'penalty_2024001.pdf',
      file_path: '/uploads/penalty_2024001.pdf',
      file_size: 768000,
      file_mime: 'application/pdf',
      period_year: 2024,
      period_month: 3,
      requires_desensitization: 1,
      desensitization_rule: 'mask_tax_id,mask_amount,mask_phone,mask_bank_account',
      description: '关于北京宏达商贸有限公司发票违法行为的行政处罚决定',
      tags: '行政处罚,稽查案件,发票'
    },
    {
      archive_code: 'COR-2024-0001',
      title: '税务事项通知书 - 北京鼎盛科技有限公司',
      taxpayer_id: taxpayerIds[1],
      catalog_id: 4,
      archive_type: ARCHIVE_TYPE.CORRESPONDENCE,
      sensitivity_level: SENSITIVITY_LEVEL.CONFIDENTIAL,
      case_number: 'CASE2024002',
      file_name: 'notice_2024001.pdf',
      file_path: '/uploads/notice_2024001.pdf',
      file_size: 256000,
      file_mime: 'application/pdf',
      period_year: 2024,
      period_month: 2,
      requires_desensitization: 0,
      desensitization_rule: null,
      description: '税务约谈通知书',
      tags: '税务事项通知,约谈'
    }
  ];

  for (const arch of archives) {
    await db.query(
      `INSERT INTO archives (archive_code, title, taxpayer_id, catalog_id, archive_type, sensitivity_level,
        case_number, file_name, file_path, file_size, file_mime, period_year, period_month, description, tags,
        requires_desensitization, desensitization_rule, uploader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         taxpayer_id = VALUES(taxpayer_id),
         catalog_id = VALUES(catalog_id),
         archive_type = VALUES(archive_type),
         sensitivity_level = VALUES(sensitivity_level),
         case_number = VALUES(case_number),
         file_name = VALUES(file_name),
         file_path = VALUES(file_path),
         file_size = VALUES(file_size),
         file_mime = VALUES(file_mime),
         period_year = VALUES(period_year),
         period_month = VALUES(period_month),
         description = VALUES(description),
         tags = VALUES(tags),
         requires_desensitization = VALUES(requires_desensitization),
         desensitization_rule = VALUES(desensitization_rule)`,
      [
        arch.archive_code, arch.title, arch.taxpayer_id, arch.catalog_id, arch.archive_type, arch.sensitivity_level,
        arch.case_number, arch.file_name, arch.file_path, arch.file_size, arch.file_mime, arch.period_year, arch.period_month,
        arch.description, arch.tags, arch.requires_desensitization, arch.desensitization_rule == null ? null : arch.desensitization_rule
      ]
    );
  }
  console.log('档案数据初始化完成');
  console.log('种子数据初始化全部完成！');
}

if (require.main === module) {
  seedData()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = seedData;

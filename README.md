# 税务电子档案借阅服务系统

## 项目简介

税务电子档案借阅服务，基于 Express + MySQL + Redis 构建，用于管理纳税人电子档案的借阅审批流程。支持纳税人档案管理、借阅申请、多级审批链、脱敏版本生成、动态水印、预览下载、次数限制、到期回收和完整审计记录。

## 技术栈

- **后端框架**: Express.js 4.x
- **数据库**: MySQL 8.0
- **缓存**: Redis 7.x
- **认证**: JWT (JSON Web Token)
- **密码加密**: bcryptjs
- **参数校验**: Joi
- **ID生成**: uuid
- **日期处理**: dayjs

## 核心功能

| 模块 | 功能说明 |
|------|----------|
| 认证授权 | JWT 身份认证，基于角色的访问控制（RBAC），越权访问检测 |
| 纳税人管理 | 纳税人基本信息的增删改查 |
| 档案目录 | 档案分类目录树结构管理 |
| 档案管理 | 申报表、发票、处罚决定、往来材料、历史附件等档案管理 |
| 借阅申请 | 单条/批量申请，支持案件稽查、咨询答复、处罚复核、内部复盘四种借阅目的 |
| 审批链 | 根据敏感级别自动生成多级审批链，支持科长、副局长分级审批 |
| 临时授权 | 审批人可对特定用户或档案授予临时访问权限 |
| 脱敏处理 | 敏感档案按规则脱敏，脱敏失败时自动阻断访问 |
| 动态水印 | 每次预览/下载生成包含用户ID、姓名、时间的动态水印 |
| 预览/下载 | 次数限制、权限校验、批量下载、到期自动失效 |
| 到期回收 | 自动回收过期借阅权限，清理缓存 |
| 审计日志 | 完整记录所有操作行为，支持追溯查询 |

## 用户角色

| 角色 | 标识 | 权限 |
|------|------|------|
| 系统管理员 | `admin` | 全部权限 |
| 税务人员 | `tax_officer` | 提交借阅申请、查看/下载已授权档案 |
| 审批人（科长） | `approver` | 审批机密级及以下档案 |
| 高级审批人（副局长） | `senior_approver` | 审批秘密级、绝密级档案 |
| 审计员 | `auditor` | 查看审计日志和所有申请 |

## 敏感级别

| 级别 | 值 | 审批层级 |
|------|-----|----------|
| 普通 | 1 | 无需审批（案件稽查除外） |
| 机密 | 2 | 一级审批（科长） |
| 秘密 | 3 | 二级审批（科长 + 副局长） |
| 绝密 | 4 | 三级审批（科长 + 副局长 + 局长） |

## 原始需求

> 请开发税务电子档案借阅服务，使用 Express、MySQL 和 Redis 管理纳税人、档案目录、借阅申请、审批链、脱敏版本、水印、预览、下载、到期回收和审计记录。税务人员按案件稽查、咨询答复、处罚复核或内部复盘申请查看申报表、发票、处罚决定、往来材料和历史附件；审批人根据岗位、案件编号、敏感级别和借阅目的授权；系统对文件加水印、限制次数并记录阅读行为。服务要处理越权访问、临时授权、批量借阅、脱敏失败、到期失效和审计追溯，敏感档案不能因为下载包生成失败就绕过权限。

## 启动方式

### 前置要求

- Node.js >= 18.x
- MySQL >= 8.0
- Redis >= 6.x
- Docker / Docker Compose（推荐使用 Docker 方式启动）

### Docker 一键启动（推荐）

#### 1. 启动服务

```bash
docker compose up --build
```

如需后台运行：

```bash
docker compose up --build -d
```

#### 2. 初始化种子数据

等待 MySQL 和应用服务启动完成后，执行：

```bash
docker exec -it tax-archive-app node src/scripts/seed-data.js
```

#### 3. 停止服务

```bash
docker compose down
```

如需清理数据卷：

```bash
docker compose down -v
```

#### 访问地址

- 服务地址: http://localhost:3000
- 健康检查: http://localhost:3000/health
- API 文档根: http://localhost:3000/

### 本地启动方式

#### 1. 安装依赖

```bash
npm install
```

#### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，修改 MySQL 和 Redis 连接信息：

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=tax_admin
DB_PASSWORD=tax_password_2024
DB_NAME=tax_archive_db

REDIS_HOST=localhost
REDIS_PORT=6379
```

#### 3. 初始化数据库

确保 MySQL 已启动并创建了数据库，然后执行：

```bash
npm run init-db
npm run seed
```

#### 4. 启动服务

```bash
npm run dev
```

或者生产模式：

```bash
npm start
```

#### 访问地址

- 服务地址: http://localhost:3000
- 健康检查: http://localhost:3000/health

## 默认测试账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `admin` | `admin123` | 系统管理员 | 全部权限 |
| `officer01` | `officer123` | 税务人员（稽查） | 提交借阅申请 |
| `officer02` | `officer123` | 税务人员（咨询） | 提交借阅申请 |
| `approver01` | `approver123` | 科长 | 一级审批 |
| `senior01` | `senior123` | 副局长 | 二级/三级审批 |
| `auditor01` | `auditor123` | 审计员 | 审计追溯 |

## API 接口说明

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录获取 Token |
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/auth/logout` | 退出登录 |

### 纳税人管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/taxpayers` | 纳税人列表（支持关键词搜索） |
| GET | `/api/taxpayers/:id` | 纳税人详情 |
| POST | `/api/taxpayers` | 新增纳税人 |
| PUT | `/api/taxpayers/:id` | 更新纳税人信息 |

### 档案目录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/catalogs` | 获取档案目录树 |
| POST | `/api/catalogs` | 新增档案目录 |

### 档案管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/archives` | 档案列表（支持多条件筛选） |
| GET | `/api/archives/:id` | 档案详情 |
| POST | `/api/archives` | 新增档案 |

### 借阅申请

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/borrow` | 提交借阅申请（支持批量） |
| GET | `/api/borrow` | 借阅申请列表 |
| GET | `/api/borrow/:id` | 借阅申请详情 |

### 审批管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/approvals/pending` | 待我审批的申请列表 |
| POST | `/api/approvals/:applicationId/approve` | 审批通过 |
| POST | `/api/approvals/:applicationId/reject` | 审批驳回 |
| POST | `/api/approvals/:applicationId/recall` | 撤回申请 |
| POST | `/api/approvals/temp-authorize` | 创建临时授权 |

### 访问档案（预览/下载）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/access/preview/:archiveId` | 预览档案（含脱敏、水印） |
| GET | `/api/access/download/:archiveId` | 下载档案（次数校验） |
| POST | `/api/access/batch-download/:applicationId` | 批量下载 |
| POST | `/api/access/recycle` | 手动执行到期回收（管理员） |

### 审计日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/audit` | 查询审计日志 |
| GET | `/api/audit/actions` | 获取审计动作类型列表 |

## 目录结构

```
wl-365/
├── src/
│   ├── app.js                 # 应用入口
│   ├── config/                # 配置文件
│   │   └── index.js
│   ├── db/                    # 数据库
│   │   ├── index.js           # 连接池
│   │   └── schema.sql         # 数据库表结构
│   ├── redis/                 # Redis 缓存
│   │   └── index.js
│   ├── auth/                  # JWT 认证
│   │   └── index.js
│   ├── middleware/            # 中间件
│   │   ├── auth.js            # 认证与权限
│   │   └── audit.js           # 审计日志
│   ├── constants/             # 常量定义
│   │   └── index.js
│   ├── utils/                 # 工具函数
│   │   └── index.js
│   ├── services/              # 业务服务
│   │   ├── auditService.js    # 审计服务
│   │   ├── borrowService.js   # 借阅申请服务
│   │   ├── approvalService.js # 审批服务
│   │   ├── desensitizeService.js # 脱敏与水印服务
│   │   └── accessService.js   # 访问（预览/下载）服务
│   ├── routes/                # 路由
│   │   ├── auth.js
│   │   ├── taxpayers.js
│   │   ├── catalogs.js
│   │   ├── archives.js
│   │   ├── borrow.js
│   │   ├── approvals.js
│   │   ├── access.js
│   │   └── audit.js
│   └── scripts/               # 脚本
│       ├── init-db.js         # 数据库初始化
│       └── seed-data.js       # 种子数据
├── uploads/                   # 文件上传目录
├── previews/                  # 预览文件目录
├── desensitized/              # 脱敏版本目录
├── Dockerfile                 # Docker 镜像构建
├── docker-compose.yml         # Docker Compose 编排
├── .dockerignore
├── .env.example
├── .env
├── package.json
└── README.md
```

## 安全设计

1. **越权访问防护**: 每次访问档案都校验借阅权限和有效期，未授权访问记录审计日志
2. **脱敏失败阻断**: 敏感档案脱敏失败时直接拒绝访问，绝不因技术故障绕过权限
3. **次数限制**: 独立的预览和下载次数限制，Redis + DB 双重计数
4. **动态水印**: 每次访问生成包含用户身份信息的唯一水印，便于泄漏溯源
5. **多级审批**: 根据档案敏感级别自动匹配审批链，低级审批人无法审批高级别档案
6. **临时授权**: 临时授权有严格的时间限制，到期自动失效
7. **完整审计**: 所有关键操作都写入审计日志，包括未授权访问尝试

## 注意事项

1. 生产环境部署前请务必修改 `.env` 中的 `JWT_SECRET`、数据库密码和 Redis 密码
2. MySQL 容器首次启动会自动执行 `schema.sql` 初始化表结构
3. 种子数据脚本 `seed-data.js` 会创建默认测试用户和示例档案数据
4. 脱敏功能当前提供文本和 JSON 数据脱敏示例，实际 PDF/图片脱敏需根据文件类型扩展
5. 建议配置定时任务定期调用 `/api/access/recycle` 接口回收过期权限
6. 所有档案访问操作均已记录审计日志，建议定期备份审计日志表

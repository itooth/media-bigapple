# BigApple Events Archive

Vite + React 活动案例集，配套一个 Node.js 后端。活动内容统一维护，管理员可以为不同代理商配置 Logo、网站名称和展示活动。

## 代理商配置

原站页脚右下角的齿轮进入管理员登录。登录后在一张表里新增或修改代理商：上传 Logo、填写名称、按活动名称取消不需要展示的活动，点击该行“保存”，复制公开链接。

- 新建代理商时，当前全部活动默认勾选。每场活动包含所有照片、作品与原有报道。
- 保存选择快照，后续新增活动不会擅自更改已有代理商的选择。
- `/` 是原站，`/6024` 等是代理商入口，`/admin` 是管理页。
- 代理商只替换顶部 Logo 和网站名称；详情与作品相册统一使用“用户案例”。其他原始文案保留。
- 代理商链接公开。编号是展示配置标识，不是保密口令，原站仍公开全部内容。
- 无停用、删除、独立编辑页或预览流程。
- 原站与所有代理商的导航统一只保留 Events 和 Search。
- 已开通独立地址的品牌，后台“复制链接”使用品牌域名；旧编号链接自动跳转，活动路径保持。品牌入口根目录始终显示对应品牌，不提供原站或管理员入口。

首次启动自动导入：`/6024` Polo（保留已选 29 场）、`/6025` 有推传媒（旧版 33 场）、`/6026` WinFlow（当前全部 34 场）。之后后台修改以数据库为准，重启或更新代码不会重新覆盖。新增代理商仍默认全选。

```text
React 页面（原站 / 6024 / 6025 / 6026 / admin）
                      ↓ 同源 API
Node.js 服务 ─────── SQLite /data/resellers.sqlite
                      ├─ 活动目录及照片、作品的引用
                      ├─ 代理商名称、Logo 地址、活动选择
                      └─ 首次导入记录
照片和作品 → 沿用图床；上传的 Logo → 平台对象存储
```

采用单容器 Node.js + SQLite，配置与数据放在持久化卷，适合当前活动库及管理员规模。无需额外数据库服务。只有未来需要多实例共同写入时，再考虑迁移 PostgreSQL。当前没有浏览量统计功能。

完整运行、部署与数据维护说明见 [docs/reseller-admin.md](docs/reseller-admin.md)。

## 活动数据在哪

```text
GitHub（本仓库）              图床 media.bigapple.app        服务器 /data（SQLite）
皮肤 + 生成规则               照片、视频、主图（按哈希）      每场活动一条「原始记录」← 唯一真源
src/lib/renderEvent.js        团队上传，只存链接              团队直接写入，不用部署
        └──────── 打开页面时：原始记录 → renderEvent → 页面 ────────┘
```

- 服务器存原始记录（manifest、媒体索引条目及云端链接、案例、外链），每次读取用当前代码的 `renderEvent` 渲染（46 场约 5ms，按变更缓存）。换皮肤或改渲染规则只需部署代码，所有活动自动按新规则显示。
- 部署只换代码，不覆盖活动；`dist-server/sources.json` 只在空数据库（新环境）时导入。存量的旧格式行，只有当打包的原始记录渲染结果与它逐字节一致时才自动替换成原始记录。
- 新增或整场更新：`PUT /api/activities/<uid>`，body `{ "source": {...} }`。追加照片/案例：`PATCH /api/activities/<uid>`，body `{ "assets": [...], "cases": [...] }`，同路径替换、新路径追加，追加批次不能带封面标记。旧版本都记入 `activity_revisions`。
- 认人：请求带 BigApple 部署身份头（`x-bigapple-publisher-id`、`Authorization: Bearer <部署令牌>`、`x-bigapple-skill-id/version`），服务器向 BigApple 查 `media` 应用，查得到 = 在团队部署白名单里才放行。团队成员用「活动素材整理专家」Skill 完成，不手写请求。
- 撤下活动：管理员登录 `/admin` 后 `DELETE /api/activities/<uid>`（保留旧版本）。
- 原始记录由 `src/data/events.js` 的 `activitySources` 从素材目录收集（Skill 在本地跑构建取出这一场）。
- `works/<名字>/index.html`：从旧站收编的单文件作品网页，访问地址 `/works/<名字>/`，以 CSP sandbox 运行（不同源，碰不到管理后台）。只放无外部依赖的单文件；新作品优先用 BigApple 部署成独立网址，不往这里加。

## 开发与构建

需要 Node.js 24 或更新版本。

```bash
npm ci --include=dev
npm run build
# 先在本机环境中设置 ADMIN_PASSWORD（4–512位）；不要把密码提交进仓库。
npm start
```

打开 `http://localhost:3000`。前后端由同一个进程提供服务。`npm run build` 生成 `dist/index.html` 和服务端活动目录 `dist-server/events.json`；页面通过 API 获取内容，不再支持双击 HTML 离线运行。管理员密码不进入前端文件。
启动时将活动目录事务同步到 SQLite，所有公开 API 从数据库读取。活动内容仍通过原有源码／素材库维护；此版本不增加活动内容编辑器。目录更新只修改活动资料，不改代理商的展示选择。

前端热更新：先运行 `npm run build:catalog`，在已设置密码的终端运行 `npm run dev:api`，另一个终端运行 `npm run dev`。Vite 将 API 和本地 Logo 请求代理至 3001 端口。

```bash
npm test
npm run db:backup
```

仓库包含 `src/data/siteContent.snapshot.json`，因此没有原作者的素材库也能完整构建。素材库存在时，构建会刷新该快照，请将内容更新一并提交。

## 组件结构

- `src/App.jsx`：页面状态与数据筛选
- `src/components/Header.jsx`：桌面与移动导航
- `src/components/SearchPanel.jsx`：活动搜索
- `src/components/MonthSection.jsx`：月份分组
- `src/components/EventCard.jsx`：活动卡片
- `src/components/EventDetail.jsx`：活动详情页
- `src/components/EventGallery.jsx`：活动完整相册页
- `src/components/Carousel.jsx`：活动剪影与制作内容轮播
- `src/data/events.js`：活动内容
- `src/data/mediaIndex.generated.js`：唯一媒体索引（路径 / 文件名 / 哈希 / 云端 url）
- `src/lib/brandLogo.js`：品牌 logo（内联 data URI，项目里不留图片文件）
- `src/data/productionCatalog.js`：待接入活动的 BigApple 制作素材
- `src/components/AdminPage.jsx`：一行一家代理商、默认全选的活动多选框
- `src/components/AdminLogin.jsx`：管理员密码登录弹窗
- `server/app.mjs`：登录、配置读写、Logo 上传和公开站点 API
- `server/store.mjs`：持久化 SQLite 配置
- `server/bootstrap.mjs`：首次品牌导入，重复启动不覆盖已有配置
- `bootstrap/resellers.json`：公开的首次上线配置快照，不含数据库或密码
- `scripts/backup-data.mjs`：在线一致性备份及本地 Logo 备份
- `Dockerfile`：用于 BigApple Docker 部署的单容器服务

合并 PR 会运行测试和构建，不会自动部署。首次上线须在原应用配置管理员 Secret，确认持久化卷与对象存储，再按 Docker 模式部署；详见维护说明。后续后台改配置无需再次部署。

## 独立品牌地址

平台一个子域名对应一个应用入口，因此品牌域名使用同一份轻量转发程序；没有复制 React 页面、活动目录、数据库、照片或 Logo。三个入口仅有代理商编号配置不同，每次访问实时读取 `media` 的共享页面和所选活动 API。主站更新页面或后台配置后，入口同步生效，无需重新部署品牌前端。

```text
polo-events.bigapple.work    ─┐
youtui-events.bigapple.work  ─┼→ media 服务 → 一份 SQLite + 原图床
winflow-events.bigapple.work ─┘
```

`gateway/server.mjs` 是公共入口实现，`gateway/sites.json` 是部署映射。`npm run release:gateways` 生成三个微型 Docker 发布目录，不含业务页面或素材。完成入口部署及范围验证后，管理员域名绑定接口将地址写入数据库；后台可复制新地址，旧路径开始跳转。详细发布顺序见 [docs/brand-domains.md](docs/brand-domains.md)。

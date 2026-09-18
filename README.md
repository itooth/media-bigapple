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

完整运行、部署与数据维护说明见 [docs/reseller-admin.md](docs/reseller-admin.md)。

## 编辑活动

活动数据集中在 `src/data/events.js`。归档页文字、详情页文字和图片都是独立字段，可以直接编辑：

```js
{
  id: 'unique-id',
  partner: '网页上可编辑的合作方 Title',
  description: '网页上可编辑的一句话描述。',
  image: importedCover,
  alt: '图片无障碍描述',
  detail: {
    title: '活动主标题',
    date: '2026年8月8日',
    city: '深圳',
    summary: '详情页的一句话描述。',
    highlights: [],
    gallery: [],
    productions: [],
    media: [],
  },
}
```

月份由外层 `label` 控制。

**前端项目里不放任何图片文件**，页面上的图全部通过 `src/data/mediaIndex.generated.js` 里的
`url` 指向云端（`media.bigapple.app`）。每张图靠一个哈希和云端那张 1:1 对应。

新增或更新活动图片时：

1. 把图片放进项目之外的素材目录（`素材库` 原图真源 / 归档的 `网站压缩素材`），不要放进这个前端项目。
2. 重新生成索引：`node scripts/build-media-index.mjs`（只读图片，不修改、不删除）。
3. 在 `src/data/events.js` 里挂活动 id；只有存在更多真实照片时才扩充 `gallery`，没有真实制作物或媒体报道时保持 `productions`、`media` 为空数组，页面会自动隐藏对应模块。
4. 重新构建：`npm run build`。

对应不上云端的图会在索引里记 `url` 为空，页面不渲染，不会拿别的图顶上。

已经确认由 BigApple 制作、但所属活动尚未上线的素材，登记在 `src/data/productionCatalog.js`，不要挂到无关活动中。

## 开发与构建

需要 Node.js 24 或更新版本。

```bash
npm ci --include=dev
npm run build
# 先在本机环境中设置 ADMIN_PASSWORD（至少12位）；不要把密码提交进仓库。
npm start
```

打开 `http://localhost:3000`。前后端由同一个进程提供服务。`npm run build` 生成 `dist/index.html` 和服务端活动目录 `dist-server/events.json`；页面通过 API 获取内容，不再支持双击 HTML 离线运行。管理员密码不进入前端文件。

前端热更新：先运行 `npm run build:catalog`，在已设置密码的终端运行 `npm run dev:api`，另一个终端运行 `npm run dev`。Vite 将 API 和本地 Logo 请求代理至 3001 端口。

```bash
npm test
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
- `Dockerfile`：用于 BigApple Docker 部署的单容器服务

# BigApple Events Archive

Vite + React 活动案例集。页面内容由数据文件驱动，图片与文字相互独立。

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

```bash
npm install --include=dev
npm run dev
npm run build
```

`npm run build` 会生成可直接打开的离线文件 `dist/index.html`（约 3.5 MB，gzip 约 630 KB，
里面只有 1 张内联图片：品牌 logo）。

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

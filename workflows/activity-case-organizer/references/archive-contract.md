# 整理与数据契约

## 正式目录

```text
YYYY-MM-DD_活动名称/
+-- 01_活动照片/                 现场照片、视频、海报、活动级 logo
+-- 02_案例/
|   +-- 首页01_案例名称/         已有人工作品名与顺序优先
|       +-- 说明.md             案例名称 / 案例简介 / 案例网址
|       +-- 截图/               图片作品、真实页面截图、作品视频
|       +-- 其他/               链接原文、PPT、PDF、源码及附件
+-- 03_社交媒体/                报道链接、截图
+-- 其他/                      待确认项、活动资料、整理记录.json
+-- manifest.json              version 6，活动事实及全量文件哈希
+-- 媒体映射.json               version 2，原件到展示副本的映射
```

旧素材有独立源码目录或视频位于 `其他/` 时保留原件，逐项明确展示用途再迁入规范目录；不能让脚本猜测并抽走项目依赖。裸输入、压缩包解压目录放活动外；未经核验不删除。近似画面不按字节重复删除。同名不同文件使用独立中文名。

## 计划与 AI 沉淀

`scan` 输出计划位于输入目录外。每个 entry 包含 `assetId, sourcePath, originalName, sha256, bytes, targetPath, selected, review`；AI 填写 `targetPath`、`review.reviewed/evidence/confidence`，可补 `scoreDimensions`、`sampledSeconds`、`role`。`role` 可为 poster/logo/resource，避免海报/logo 混入现场相册。描述与评分必须有实看依据。未确定项移至 `其他/`，说明原因；不让新手逐项编辑这些字段。

`apply` 保留输入，以复制方式建立正式目录，并把计划存在 `其他/整理记录.json`。只处理当前素材，不扫描整个电脑。修改后的源文件哈希不匹配时停止，已有目标内容不同拒绝覆盖。再次整理保留已有 `assetId`；补入新文件不撤销人工选择。

`mirror` 每次扫描当前正式文件名，保留当前 `selected`/`role` 和未知元数据；重命名后按唯一哈希复用身份和判断。相同哈希在多个案例出现时须显式核对归属，不能自动跨案例认同一作品。`首页NN_` 是人工顺序；旧五位评分、`首页_`、`封面_` 继续兼容。图片透明通道保留 PNG，普通图片 JPEG；展示视频 H.264/AAC，不截断。展示副本带短哈希避免同名扩展格式冲突。需要其他压缩质量时改版本号，原件不受影响。

原件变化会使 review 失效，未审素材标为 needs-review；失败不产生可发布 URL。失败或待审项可在明确排除后设 `selected:false`，保留原件和理由。旧镜像文件可以留作恢复，但网站仅读当前映射，不能扫旧镜像混入页面。

## manifest v6

保留已有字段和 ID。`id` 稳定；对接已有线上活动须填 `uid` 为线上 UID，不用标题匹配。基础字段：`title,date(YYYY-MM-DD或null),venue,organizer,coOrganizers,summary,tags,sourceFolder,assets[]`。每项 asset 为 `path,name,type,bytes,sha256`；路径为相对活动目录的 POSIX 路径。JSON 自身不进入 assets，避免自引用。未知事实为空；日期未知不填当天。

`caseIds` 为案例相对目录到稳定 ID；重命名通过资产身份延续，歧义人工确认。`presentation` 允许：

```json
{
  "headline": "用户确认的活动标题",
  "intro": "有来源的活动介绍",
  "poster": {"path": "01_活动照片/活动海报.png", "caption": "活动海报"},
  "partners": [{"name":"合作方名称","role":"联合主办","path":"01_活动照片/合作方标识.png"}],
  "resources": [{"title":"现场课件","path":"其他/课件.pdf"}]
}
```

仅引用已明确可公开的资料；`resources.path` 允许 PDF/PPT/Word，不自动暴露源码包。外链资料用 `href`，可下载文件加 `downloadable:true`。无海报时使用现有封面，无 logo/资料省略。

## 媒体映射 v2

`activity,media[],linkReview[]`。媒体记录：`assetId,originalName,normalizedName,originalPath,originalSha256,originalBytes,mediaType,websitePath,websiteSha256,websiteBytes,compression,processedAt,status,review,selected,role,cover,homepage,score`。`websitePath` 相对 `--website-root`。复用条件为原件哈希、压缩版本和真实输出哈希均一致；不能只看修改时间。宽高/时长未知保持未知。

链接记录：`url,casePath,sourcePath,title,status,captureKind,screenshotPath,capturedAt`，可附 `error/evidence`。`casePath` 指案例目录；报道可用 `kind:social` 且 casePath 为空。captured 只在真网页或视频帧已实看后设置。来源文件必须保留。没有图片但有链接的案例通过 linkReview 保留为文字网站卡。

网页实际显示：title、date、venue（作城市/地点）、summary（简介；`presentation.intro` 优先）、tags、海报、带图片的 partners。organizer/coOrganizers 写入 `detail` 留档，当前 UI 不单独显示；要在页面露出主办方，填 `presentation.partners`（有 logo 才显示）或写进 summary。

scan 输出 `duplicateGroups`，计划条目带 `duplicates`：字节相同的输入只留一份展示，其余 `selected:false` 并放 `其他/重复副本_*`，记录理由。只改名的文件，展示副本沿用原文件名（带同一短哈希），属预期，不重新压缩。`mirror` 有待审素材时照常写出两份 JSON，返回 `pendingOrFailed` 列表，这是正常中间态，补完 review 再跑。

网页 API 仍使用 `gallery/highlights/productionGallery/productions/videos/productionVideos/media`；新增 `detail.presentation` 可选。编译器按 UID 合并单场，不清空整站。UI 不回写原件，也不决定事实或选片。

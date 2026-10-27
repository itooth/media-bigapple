# 执行命令

需要 Python 3.12+、Pillow；视频还需要 ffmpeg。网站沿用已有 Node 24+ / npm 工程。不要新建账号、购买 API 或把私密素材发送到外部服务。

以下由助手执行，把示例绝对路径替换为本次真实目录；`SKILL` 指本 Skill 文件夹。脚本会给出结构化结果，失败保留原件。`scan` 只盘点，AI 判断与命名在计划中写完后再 apply。

```sh
python3 "$SKILL/scripts/archive.py" scan /输入目录 /工作区/整理计划.json
python3 "$SKILL/scripts/archive.py" apply /工作区/整理计划.json /素材库/活动
python3 "$SKILL/scripts/archive.py" mirror /素材库/活动 /网站压缩素材
python3 "$SKILL/scripts/catalog.py" /素材库/活动 \
  --website-root /网站压缩素材 \
  --catalog /网站工程/content/catalog.json \
  --out /工作区/catalog.preview.json --public-dir /工作区/preview-public
```

标题/时间等填 manifest；作品说明填当前 `说明.md`；人工排除选片在媒体映射 `selected:false`，且记录理由。新增案例链接填 linkReview，保留原文文件。原件和元数据更新后再次 mirror 和 catalog；只重新编码改变内容的项。

在网站工程构建预览：

```sh
CASE_CATALOG=/工作区/catalog.preview.json VITE_PUBLIC_DIR=/工作区/preview-public npm run build
BIGAPPLE_DATA_DIR=/工作区/preview-db PORT=4192 npm start
```

本地管理服务需要配置 `ADMIN_PASSWORD`；随机生成到本地进程环境，不打印密码、不复用生产数据库。构建会更新 dist-server/events.json，避免与另一个运行中的预览共用同一工程输出。手机宽 390 与桌面都检查。

发布素材上传后，用回执表替代本地 public 目录：

```sh
python3 "$SKILL/scripts/catalog.py" /素材库/活动 \
  --website-root /网站压缩素材 --catalog /网站工程/content/catalog.json \
  --out /工作区/catalog.release.json --uploads /工作区/媒体上传回执.json
```

回执表按真实 SHA256 索引：`{"<sha256>":{"sha256":"<sha256>","bytes":123,"url":"https://真实存储地址"}}`。回执来自上传工具和验证，不凭空生成。上传失败不编译半成品。发布前审阅新旧 catalog 差异，确认仅目标 UID 变动，再替换工程 content/catalog.json 并构建。

验证脚本：`python3 "$SKILL/scripts/test_workflow.py"`。只用隔离测试目录，不拿真实活动做破坏性测试。

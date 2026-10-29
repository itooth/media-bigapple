# 执行命令

需要 Python 3.12+、Pillow；视频还需要 ffmpeg。网站沿用已有 Node 24+ / npm 工程。不要新建账号、购买 API 或把私密素材发送到外部服务。

以下由助手执行，把示例绝对路径替换为本次真实目录；`SKILL` 指本 Skill 文件夹。脚本会给出结构化结果，失败保留原件。`scan` 只盘点，AI 判断与命名在计划中写完后再 apply。

```sh
python3 "$SKILL/scripts/archive.py" scan /输入目录 /工作区/整理计划.json
# 同一活动补素材：复用已审核判断
python3 "$SKILL/scripts/archive.py" scan /新一批素材 /工作区/整理计划-2.json --archive /素材库/活动
python3 "$SKILL/scripts/archive.py" apply /工作区/整理计划.json /素材库/活动
python3 "$SKILL/scripts/archive.py" mirror /素材库/活动 /网站压缩素材
# 先在网站工程导出当前全站数据（以 src/data 为准）：npm run build:catalog
python3 "$SKILL/scripts/catalog.py" /素材库/活动 \
  --website-root /网站压缩素材 \
  --catalog /网站工程/dist-server/events.json \
  --out /工作区/catalog.preview.json --public-dir /工作区/preview-public
```

manifest.json 在 apply 时生成空壳，事实字段（title/date/venue/organizer/summary）在 apply 之后、catalog 之前填写；mirror 不会清掉它们。标题/时间等填 manifest；作品说明填当前 `说明.md`；人工排除选片在媒体映射 `selected:false`，且记录理由。新增案例链接填 linkReview，保留原文文件。原件和元数据更新后再次 mirror 和 catalog；只重新编码改变内容的项。

在网站工程构建预览：

```sh
CASE_CATALOG=/工作区/catalog.preview.json VITE_PUBLIC_DIR=/工作区/preview-public npm run build
BIGAPPLE_DATA_DIR=/工作区/preview-db PORT=4192 npm start
```

本地管理服务需要配置 `ADMIN_PASSWORD`；随机生成到本地进程环境（如 `ADMIN_PASSWORD=$(openssl rand -hex 16)`），不打印密码、不复用生产数据库。构建会在 dist/case-assets 生成预览素材，不要提交。构建会更新 dist-server/events.json，避免与另一个运行中的预览共用同一工程输出。手机宽 390 与桌面都检查。

上线不走 catalog.py：按 [备份、发布与上线](release.md) 用 `publish.py` 和 APP 部署专员。

验证脚本：`python3 "$SKILL/scripts/test_workflow.py"`。只用隔离测试目录，不拿真实活动做破坏性测试。

# 案例链接与输入包吸收

`SKILL` 指本 Skill 文件夹。三个脚本都只读写活动目录，不改 manifest.json 与媒体映射.json。依赖 Pillow；capture 另需 Playwright 和本机 Chrome/Chromium。

## 一、链接取帧选主图（capture_case_links.py）

案例可能只有 TXT/MD/URL 链接而没有截图。首屏常是标题卡、加载页或白屏，所以脚本对每条链接多时刻取帧，由模型实看后选一张作主图。

- 取帧时刻：页面载入、动态内容渲染完成、点击开始/继续或按键后、滚动 35%/70%、视频多个时间点（有 poster 则取封面帧）。
- 候选帧只写到活动目录外的暂存目录（默认 `.<活动名>-link-captures/`），检查点 `capture-review.json`。不改活动、不评分、不选主图。
- 每帧带 `contentScore`（0-1，只做排序参考）和 flags：`capture-too-small`、`near-uniform-image`、`possible-loading-screen`、`possible-error-or-verification`、`http-error-NNN`。
- 候选 status 一律 `needs-review`。必须逐张实看，真深色游戏不能只因颜色深判错。失败记原因，不伪造图片。
- 选主图：优先能看出作品身份与玩法/功能全貌的帧；避开只有标题、LOGO、加载进度、纯文字、空白的帧。每个案例只一张主图。
- 选定后才把图放进案例 `截图/`，命名写实际画面内容，再在媒体映射 v2 登记 media 与 linkReview，并刷新 manifest v6（先 `archive.py mirror`，再 `catalog.py`）。
- linkReview 字段：`url,casePath,sourcePath,title,status,captureKind,screenshotPath,capturedAt`。
- `captured` 只在真网页或视频帧已实看后设置。`captureKind` 取 `page-first`、`page-interactive`、`page-scrolled`、`video-poster`、`video-frame`（视频帧写秒数）。
- 依赖库、帮助页等非作品 URL 可记 `verified-no-capture` 并写 `reason`。
- 已有 captured 且截图已审、哈希一致的链接会跳过；`--refresh` 强制重取。

```sh
python3 "$SKILL/scripts/capture_case_links.py" /活动目录 --dry-run
python3 "$SKILL/scripts/capture_case_links.py" /活动目录 --workers 3 --candidates 6 --video-frames 4
```

其他参数：`--case 案例目录名`（可重复）、`--chrome` 浏览器路径、`--output` 暂存目录（须在活动外）、`--timeout` 秒。

## 二、链接清单一一对应（match_case_links.py）

链接常集中在 `02_案例/案例链接.md` 之类的清单里。每条必须落到一个案例或进待确认，案例侧反向核对。

- 读取范围：案例 `说明.md` 的「案例网址」、案例 `其他/` 下文本、`02_案例/` 根层清单及 `案例集合材料/`、`案例素材/`、`原案例素材/`。集合清单是原始证据，保留原样。
- 匹配：规范化名称后 `exact`（高）；`--alias`/`--alias-file` 为 `alias`（中）；唯一互相包含为 `contains`（中，需页面复核）；其余进待确认，不凭相近硬绑。证据优先级：已有截图里的作品名，其次页面标题与部署路径，再次说明简介。
- 同一 URL 出现在两个案例会报错并拒绝 `--apply`。同作品备用入口归同一案例，主入口写「案例网址」。
- `--apply` 只写：案例 `其他/游戏链接.md` 或 `视频链接.md`、`其他/链接匹配记录.md`、`说明.md` 的占位网址、根 `其他/待确认素材.md`。人工填的真实网址保留并报冲突，重复运行不重复追加。
- 别名映射只用命令行或活动外文件，活动里不得出现 `链接对应表.md`。
- `--verify` 实际请求页面取标题；无网络时置信度不得标 high。
- 完成标准：清单条数 = 已分配 + 待确认；有链接的案例 `说明.md` 有真实 URL；同一 URL 不跨案例。

```sh
python3 "$SKILL/scripts/match_case_links.py" /活动目录 --verify
python3 "$SKILL/scripts/match_case_links.py" /活动目录 --alias "清单名=案例目录名" --verify --apply
```

先看只读报告再 `--apply`。

## 三、输入包吸收（absorb_input_packages.py）

活动根目录只允许四个文件夹和两份 JSON。其余目录（交接包、原素材、解压目录）都是输入包，收尾必须检查一次。

- 比对：先 SHA-256，再图片 8×8 dHash（长宽比接近、画面方差足够，纯色与缩略图不参与）；视频只比字节。
- 已覆盖的重复媒体不再保留；独有媒体和文档移到 `其他/输入包吸收/<包名>/独有媒体|文档/`，之后由模型按内容重新安置。压缩包不会自动展开，先解压到活动外再重跑。
- `--apply` 写 `其他/输入包吸收记录.md` 并删除输入包目录（`--keep-package` 保留）。删除不可逆，先看只读报告再执行。
- 吸收会改变业务文件集合。安置完后重新 `archive.py apply`/`mirror`，让 manifest assets 与哈希同步，输入包内媒体不进媒体映射。

```sh
python3 "$SKILL/scripts/absorb_input_packages.py" /活动目录
python3 "$SKILL/scripts/absorb_input_packages.py" /活动目录 --apply [--keep-package]
```

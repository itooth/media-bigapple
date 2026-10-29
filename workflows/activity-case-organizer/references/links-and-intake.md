# 案例链接与输入包吸收

`SKILL` 指本 Skill 文件夹。四个脚本（capture、match、register_link、absorb）都只读写活动目录，不改 manifest.json 与媒体映射.json。依赖 Pillow；capture 另需 Playwright 和本机 Chrome/Chromium。

## 一、链接取帧选主图（capture_case_links.py）

案例可能只有 TXT/MD/URL 链接而没有截图。首屏常是标题卡、加载页或白屏，所以脚本对每条链接多时刻取帧，由模型实看后选一张作主图。

- 取帧时刻：页面载入、动态内容渲染完成、点击开始/继续或按键后、滚动 35%/70%、视频多个时间点（有 poster 则取封面帧）。
- 候选帧只写到活动目录外的暂存目录（默认在活动同级的 `.<活动名>-link-captures/`；建议显式 `--output`），每条链接的候选清单为 `<key>-candidates.json`，检查点 `capture-review.json`。不改活动、不评分、不选主图。
- 每帧带 `contentScore`（0-1，只做排序参考）和 flags：`capture-too-small`、`near-uniform-image`、`possible-loading-screen`、`possible-error-or-verification`、`http-error-NNN`。
- 候选 status 一律 `needs-review`。必须逐张实看，真深色游戏不能只因颜色深判错。失败记原因，不伪造图片。
- 选主图：优先能看出作品身份与玩法/功能全貌的帧；避开只有标题、LOGO、加载进度、纯文字、空白的帧。每个案例只一张主图。
- 每条链接有整体时限（默认 max(60, 4×`--timeout`) 秒，可用 `--link-timeout` 调整）。取帧在独立子进程里跑，超时整组杀掉，该条在 `capture-review.json` 记 `status: failed` 和 `error: TimeoutError: ...`，继续下一条，进程正常退出（有失败时退出码 1）。失败的链接用 `register_link.py --status failed` 登记。
- 选定后用 `register_link.py` 登记（见下），不要手改 JSON：它把选中帧复制进案例 `截图/`（文件名写实际画面内容），在媒体映射.json 写/更新 linkReview，并在 `其他/整理记录.json` 把该截图标为已审（`--evidence` 必填，写实看到的内容）。之后 `archive.py mirror`（会保留 linkReview，已审截图不再算待审），再 `catalog.py`。
- linkReview 字段：`url,casePath,sourcePath,title,status,captureKind,screenshotPath,capturedAt`，可附 `error/evidence/reason`。
- `captured` 只在真网页或视频帧已实看后设置。`captureKind` 取 `page-first`、`page-settled`、`page-interactive`、`page-scrolled`、`video-poster`、`video-frame`（视频帧秒数写进 evidence）。
- 依赖库、帮助页等非作品 URL 可记 `verified-no-capture` 并写 `reason`。
- 已有 captured 且截图已审、哈希一致的链接会跳过；`--refresh` 强制重取。

```sh
python3 "$SKILL/scripts/capture_case_links.py" /活动目录 --dry-run
python3 "$SKILL/scripts/capture_case_links.py" /活动目录 --workers 3 --candidates 6 --video-frames 4
```

其他参数：`--case 案例目录名`（可重复）、`--chrome` 浏览器路径、`--output` 暂存目录（须在活动外）、`--timeout` 单步等待秒数、`--link-timeout` 单条链接硬时限秒数。

登记选定的帧或失败（`--candidate` 用候选帧完整路径，`--name` 不含扩展名）：

```sh
python3 "$SKILL/scripts/register_link.py" /活动目录 --case 首页02_新安校园 --url https://example.com/ \
  --candidate /暂存目录/xxx-c02-xxxx.png --name 页面_发布一条新动态表单 --kind page-interactive \
  --title "页面标题" --evidence "实看:发布动态表单,能看出是学生内容社区"
python3 "$SKILL/scripts/register_link.py" /活动目录 --case 首页02_新安校园 --url https://example.com/ \
  --status failed --error "TimeoutError: 页面一直加载"
```

重复登记同一案例+URL 是更新 linkReview 记录，不会重复记录；`--name` 相同则覆盖同一个截图文件。换了 `--name` 重登记时，旧截图文件会留在 `截图/` 里，需要手动删除，否则同案例会有多张图。案例 `截图/` 里还没有主图时，`--name` 自动加 `10000_主图_` 前缀（已含「主图」不重复加；已有五位分数前缀的在分数后插入 `主图_`）。源文件默认从案例文本里自动找，找不到用 `--source`。

## 二、链接清单一一对应（match_case_links.py）

前置条件：
- 只有链接没有图的作品，先建 `02_案例/首页NN_作品名/` 再跑 match；作品归属拿不准时问实习生，不能猜。
- 案例目录要先建好：`02_案例/<序号或首页前缀>_<案例名>/`，例如 `首页02_新安校园`、`08200_交易复盘`。脚本不建案例目录，目录不存在时该条链接一律进「未分配」。
- 清单里的名称与案例名（去掉序号、`首页` 前缀、括号后）规范化后一致才自动对上。对不上（如清单写「卫煜信 短剧分镜大师」，目录叫 `首页01_短剧分镜大师`）用 `--alias "清单名=案例目录名"`，可重复；很多条时放活动外文件用 `--alias-file`。
- 链接文件名：普通作品写 `其他/作品链接.md`，视频（名称含「视频」或 URL 是视频后缀）写 `其他/视频链接.md`。旧版的 `游戏链接.md` 仍可读；案例里只有旧文件时继续往旧文件追加，不会再生成新文件。

链接常集中在 `02_案例/案例链接.md` 之类的清单里。每条必须落到一个案例或进待确认，案例侧反向核对。

- 读取范围：案例 `说明.md` 的「案例网址」、案例 `其他/` 下文本、`02_案例/` 根层清单及 `案例集合材料/`、`案例素材/`、`原案例素材/`。集合清单是原始证据，保留原样。
- 匹配：规范化名称后 `exact`（高）；`--alias`/`--alias-file` 为 `alias`（中）；唯一互相包含为 `contains`（中，需页面复核）；其余进待确认，不凭相近硬绑。证据优先级：已有截图里的作品名，其次页面标题与部署路径，再次说明简介。
- 同一 URL 出现在两个案例会报错并拒绝 `--apply`。同作品备用入口归同一案例，主入口写「案例网址」。
- `--apply` 只写：案例 `其他/作品链接.md` 或 `视频链接.md`、`其他/链接匹配记录.md`、`说明.md` 的网址、根 `其他/待确认素材.md`。案例没有 `说明.md` 时创建模板（`## 案例名称`、`## 案例简介`、`## 案例网址` 三节，简介写「待补充」，案例名称用去掉 `首页NN_`/五位分数前缀的名字），catalog.py 从其中的 `## 案例简介` 和 `## 案例网址` 读取，简介需要人补：请向实习生要一句作品介绍，`publish.py` 发现简介为空或「待补充」会拦住。人工填的真实网址保留并报冲突，重复运行不重复追加。
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

# 备份、发布与上线

上新、补素材都不部署：图传图床，这一场的原始记录直接写进服务器，几秒生效。服务器按团队部署白名单认人，和 `check_team_access.sh` 是同一个判断。

```text
整理好的归档 ─► ① 提醒备份到团队共享硬盘 ─► ② 拉最新皮肤 + publish.py 写测试站
     ─► ③ 助手自查 + 使用者确认 ─► ④ publish.py 写正式站 ─► ⑤ 线上验收
```

## ① 原件备份到团队共享硬盘

提醒使用者：「请把整理好的整个活动文件夹复制到团队共享硬盘的活动素材目录，复制完告诉我。」不需要对方提供路径。对方确认后记录：

```sh
python3 "$SKILL/scripts/release_gate.py" backup /素材库/活动 --confirmed-by <姓名>
```

助手没法核对硬盘，就如实说「我记录的是你的确认，没有核对硬盘」。图床里只是压缩展示图，不能代替原件。

## ② 写测试站

```sh
git -C /网站工程 pull --ff-only
cd /网站工程 && npm ci --include=dev
python3 "$SKILL/scripts/publish.py" /素材库/活动 --repo /网站工程 --web-root /网站压缩素材 --app media-staging
```

`pull` 失败（本地有改动或分叉）：`publish.py` 每次运行都会改写网站工程里 `src/data` 的生成文件，这些改动不用提交。先 `git -C /网站工程 status --short` 看清楚：只有 `src/data/*.generated.js`、`siteContent.snapshot.json`、`docs/media-index-report.md` 这类生成文件变了，就 `git -C /网站工程 restore src/data docs` 再 pull；有别的改动就停下找查理，不要 reset/stash。

脚本先做全部检查（manifest、备份记录、id、主图、案例简介），再传图、本地构建核对数量、跑 `npm test`，最后写入。打印「新增」「更新」或「追加素材」，以及网站现在的活动总数。

失败按中文提示补齐后重跑，重跑是安全的：已传的图按哈希跳过，同一场活动重复写入只是覆盖成同样内容。只想看会改什么时加 `--dry-run`（不上传、不写服务器）。

## ③ 测试站确认

打开 `https://media-staging.bigapple.work/events/<活动目录名>`，助手先自己检查：标题日期、封面、照片数量与顺序、视频能播、每个案例的图片和网址、手机宽度、「下载全部素材」。有问题回到整理步骤修改，再从 ② 重跑。

然后把地址发给使用者逐项看：封面、照片、案例对应、文字。对方明确说「确认」后记录：

```sh
python3 "$SKILL/scripts/release_gate.py" approve /素材库/活动 --preview https://media-staging.bigapple.work/events/<活动目录名> --confirmed-by <姓名>
```

确认绑定当前素材指纹；之后再改任何素材或文字，`check` 会要求重新走 ②–③。

## ④⑤ 写正式站并验收

```sh
python3 "$SKILL/scripts/release_gate.py" check /素材库/活动
python3 "$SKILL/scripts/publish.py" /素材库/活动 --repo /网站工程 --web-root /网站压缩素材
```

不加 `--app`：图传正式图床，写入正式站 `media`。正式站不能引用测试图床的图，所以这一步必须重跑，不能把测试站数据搬过去。

验收：`https://media.bigapple.work/events/<活动目录名>` 封面、照片、视频播放、案例网址、手机布局、批量下载；首页活动数 = 脚本打印的总数，随手开两场旧活动确认正常。全部通过才告诉使用者「已上线」并给出正式地址。

## 更新已有活动

先问清是哪种，两种都要求整理目录的目录名、manifest 的 `id` 和原活动一致（查正式站：`curl -s https://media.bigapple.work/api/site`，找这场的 `uid` 和 `id`）：

```text
A. 只补照片/案例（最常见）            B. 整场改（换封面、删照片、改排序、改标题简介）
   新建一个只放这批新素材的整理目录       必须用这场活动完整的整理目录
   publish.py ... --append              publish.py ...（不加 --append）
   服务器把这批并进去，原有的都保留       整场替换，本地目录里没有的照片网站上也会消失
```

A 的做法：新目录名用原活动的目录名（放在另一个素材库路径下，避免和旧目录冲突），scan → 命名 → apply，manifest 填和原活动一样的 `id`、`uid`、`title`、`date`，再从 ① 走到 ⑤，两次 `publish.py` 都加 `--append`。追加的照片不能带「封面」标记，要换封面走 B。新照片按文件名前的五位分数插进原有顺序。

B 的做法：本机没有完整目录就请使用者从团队共享硬盘复制回来，新素材用 `archive.py scan <新一批> ... --archive <完整目录>` 合并，然后从 ① 走到 ⑤。旧版本都留在服务器的 `activity_revisions` 里。

## 边缘情况

| 情况 | 处理 |
|---|---|
| 写入返回 403「不在团队部署白名单」 | 回到开工自检，把 ID 发给查理 |
| 写入返回 409「活动 id 已被使用」 | 另一场活动占了这个 id；换一个 id（`MM-DD-短名`），别动别人的活动 |
| 写入返回 426 | APP 部署专员版本过旧，去技能页更新后重跑 |
| 连不上服务器、超时 | 网络恢复后重跑同一条命令 |
| 上传大视频时进程几分钟没动静、CPU 为 0 | 连接挂住了：结束 `publish.py` 和它的 `upload-media.mjs` 子进程，重跑同一条命令，已传的跳过 |
| 图床返回 413 | 额度满了，停下告诉查理，不要删别的活动的图腾空间 |
| 要撤下一场活动 | 只有查理能做（`/admin` 登录后删除，旧版本保留可恢复）；告诉对方去找查理 |
| 写错了想回到上一个版本 | 用上一版整理目录重跑 ②④；或找查理从 `activity_revisions` 恢复 |
| 要换皮肤（改页面样式或 `src/lib/renderEvent.js` 渲染规则） | 不属于上活动：改 GitHub 上的 media-bigapple，`npm test` 通过后，这一步使用 bigapple-deploy Skill 部署 `media-staging` 验证，再部署 `media`。部署只换代码，服务器上所有活动打开时自动按新规则渲染，不用重新发布。部署前后各存一份 `/api/site`，确认没改的活动逐字节一致 |
| 追加返回 409「旧格式」 | 这场活动还是早期格式，先用完整目录整场更新一次（B），之后就能追加 |
| 追加返回 404 | 服务器上没有这个 uid：目录名和原活动不一致，或这其实是新活动 |
| 追加被拦「只有视频、没有截图的案例」 | 服务器追加按主图路径合并，没截图的视频案例会把线上同类案例顶掉。给它补一张取帧主图，或走整场更新 / 修旧活动 |
| 正式站图片地址里出现 `media-staging` | 上传脚本把测试图床的地址当成已上传。网站工程的 `upload-media.mjs` 只在目标图床已有时才跳过；旧版本先升级再重跑正式发布 |

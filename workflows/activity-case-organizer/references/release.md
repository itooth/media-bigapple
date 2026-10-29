# 备份、发布与上线

新活动走网站已有的媒体链路：展示图上传到图床 → 增量写入 `src/data` 的三份数据文件 → 构建 → 部署。部署一律用「APP 部署专员」（bigapple-deploy）Skill，先读它的当前文档。下面的命令由助手执行，实习生只需要回答问题、看页面、说「确认」。

```text
整理好的归档 ─► ① 原件备份到团队共享硬盘 ─► ② publish.py（上传展示图 + 写数据 + 构建 + 测试）
     ─► ③ 推到 activity/<id> 分支 ─► ④ 部署测试站 media-staging ─► ⑤ 实习生确认
     ─► ⑥ 合并到 main ─► ⑦ 部署正式站 media ─► ⑧ 线上验收
```

## ① 原件备份到团队共享硬盘

先问：「这次活动的原件（整理好的整个活动文件夹）已经复制到团队共享硬盘了吗？放在哪个目录？」没复制就先引导复制：插上共享硬盘，把 `/素材库/YYYY-MM-DD_活动名` 整个文件夹拖进硬盘的活动素材目录。对方说完路径后，助手确认该目录存在且文件数一致（比较时排除 `其他/发布确认.json`：`release_gate.py backup/approve` 只写进归档，共享硬盘上的副本里没有这一份），再记录：

```sh
python3 "$SKILL/scripts/release_gate.py" backup /素材库/活动 --location "/Volumes/团队共享盘/活动素材/YYYY-MM-DD_活动名"
```

硬盘没插在当前电脑上、无法核对时，如实告诉对方「只记录了你说的位置，我没法核对」，不要说已验证。云端图床里的是压缩展示图，不能代替原件。

## ② 生成网站数据

```sh
git -C /网站工程 fetch origin main
git -C /网站工程 switch -c activity/<活动id> origin/main   # 从最新 main 开活动分支，不要在 main 上直接改
python3 "$SKILL/scripts/publish.py" /素材库/活动 --repo /网站工程 --web-root /网站压缩素材 --app media-staging
```

测试站阶段加 `--app media-staging`，图只进测试图床，不碰正式站用的图床。

脚本先检查 manifest、选中素材都已就绪、共享硬盘备份已记录，再上传展示图、生成数据、构建、跑测试；还会检查活动 id 格式与冲突（对照 HEAD 的 snapshot）、每个案例有且仅有一张主图、案例简介不为空，并核对构建结果里的封面、照片数、视频数、案例都齐。上传用的 Skill 版本取自环境变量 `BIGAPPLE_SKILL_VERSION`，没有就读 APP 部署专员的 `bigapple/metadata.json`；有文件上传失败时脚本以非 0 退出。失败时按中文提示补齐后重跑；已上传的图按哈希跳过，不会重复传。图床返回 413 说明额度满了，停下告诉负责人，不要删别的活动的图腾空间。

只想看会改什么时加 `--dry-run`（不上传，图片地址为空）。

## ③④ 测试站预览

```sh
git -C /网站工程 add src/data docs/media-index-report.md && git -C /网站工程 commit -m "新增活动：<活动名>"   # 在 activity/<活动id> 分支
git -C /网站工程 push -u origin activity/<活动id>
cd /网站工程 && npm run release:prepare     # 输出一个干净目录
```

用 APP 部署专员把这个干净目录以 docker 方式部署到应用 `media-staging`（已存在就更新，不新建同名应用）。打开 `https://media-staging.bigapple.work/events/<活动目录名>`，助手先自己检查：标题日期、封面、照片数量与顺序、视频能播、每个案例的图片和网址、手机宽度、「下载全部素材」。有问题回到整理步骤修改，再从 ② 重跑。

## ⑤ 实习生确认

把测试站地址发给实习生，请对方逐项看：封面、照片、案例对应、文字。对方明确说「确认」后记录：

```sh
python3 "$SKILL/scripts/release_gate.py" approve /素材库/活动 --preview https://media-staging.bigapple.work/events/<活动目录名> --confirmed-by <姓名>
```

确认绑定当前素材指纹；确认之后再改任何素材或文字，`check` 会要求重新走 ②–⑤。

## ⑥⑦⑧ 上线

```sh
python3 "$SKILL/scripts/release_gate.py" check /素材库/活动
```

**上线前先把图传到正式图床。** 测试阶段用了 `--app media-staging`，数据里的图片地址指向测试图床，正式站不应依赖它。所以在同一个 `activity/<活动id>` 分支上，**不加 `--app` 重跑一遍 publish.py**（默认传到正式图床 `bigapple-onboarding-course`，已传过的按哈希跳过），再提交，然后开 PR：

```sh
python3 "$SKILL/scripts/publish.py" /素材库/活动 --repo /网站工程 --web-root /网站压缩素材
git -C /网站工程 add src/data docs/media-index-report.md && git -C /网站工程 commit -m "活动图片切换到正式图床：<活动名>"
```

通过后在 GitHub 开 PR 并等检查通过再合并（`gh pr create`，`gh pr checks --watch`，`gh pr merge --merge`）。合并后切到 main 拉最新（`git switch main && git pull`），`npm run release:prepare`，用 APP 部署专员更新已有应用 `media`（保留原 appId、地址、数据卷和 Secrets，不新建应用）。部署前记下当前线上 `/api/site` 的活动数。

上线后实测：活动数 = 部署前 + 1，旧活动地址都能打开；新活动详情页封面、照片、视频播放、案例网址、手机布局、批量下载。全部通过才告诉实习生「已上线」，并给出正式地址。

## 失败与回退

- main 在你开分支后有别人的新提交：合并前先 `git pull origin main` 到活动分支，`src/data` 冲突时重跑 ② 生成，不手改生成文件。
- APP 部署专员返回 `DEPLOYMENT_IMAGE_REGISTRY_UNAVAILABLE`：是平台临时拉不到镜像。告诉实习生「平台临时故障，不是你的操作问题」，等 5 分钟后重试同一条命令，最多 5 次，仍失败就停下找负责人。
- 部署失败会保留上一个可用版本；结果不明先查部署状态，不重复提交。
- 要撤下这场活动：`BIGAPPLE_REMOVE_ACTIVITIES=<活动id>` 环境变量下重跑数据生成和构建，再部署。不要用删除应用的方式回退。

## 网站数据保护

同事电脑上的素材库没有这场活动时，构建会保留数据文件里已有的活动，不会静默删除；只有显式设置 `BIGAPPLE_REMOVE_ACTIVITIES` 才删。

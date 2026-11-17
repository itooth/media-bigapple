#!/usr/bin/env python3
"""把一场活动发布到案例网站服务器（测试站或正式站）。

服务器数据库是活动数据的唯一真源（存每场活动的原始记录，打开页面时按当前皮肤渲染）；
网站代码（GitHub）只是皮肤和生成规则。本脚本：上传展示图到图床 → 用本地网站工程生成这一场的
原始记录（dist-server/sources.json）→ 只把这一场写入服务器，用本机 BigApple 部署身份，
服务器按团队部署白名单放行：
  整场（默认）PUT /api/activities/<uid>：整场替换，归档必须是这场活动完整的整理目录
  追加（--append）PATCH /api/activities/<uid>：只把这批照片/案例并进服务器上已有的活动
不部署、不 commit、不 push；网站工程里 src/data 的改动是生成过程的副产物，不用提交。

前提：归档已 mirror 过（存在媒体映射.json），且已用 release_gate.py backup 记录原件已复制到团队共享硬盘。

用法：
  publish.py <活动归档目录> --repo <网站工程> --web-root <mirror 输出根> --app media-staging   # 测试站
  publish.py <活动归档目录> --repo <网站工程> --web-root <mirror 输出根>                        # 正式站
  加 --append：给已有活动补照片/案例，归档只需包含新的这批（manifest 的 id、目录名与原活动一致）
  加 --dry-run：不上传图、不写服务器
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_gate import require_backup  # noqa: E402
import checks  # noqa: E402  唯一一套记录检查，audit.py / repair.py 也用它

REQUIRED_MANIFEST_FIELDS = ("title", "date", "id")
DEFAULT_APP = "bigapple-onboarding-course"
# 图床 app → 写入哪个网站。测试图床的图只给测试站用，正式站必须用正式图床。
SITE_FOR_APP = {"media-staging": "https://media-staging.bigapple.work"}
PRODUCTION_SITE = "https://media.bigapple.work"
DEPLOY_SKILL_ID = "sk_405931e4-67f2-494f-aaca-8081885f54e5"
ACTIVITY_ID_PATTERN = re.compile(r"^\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
CASE_DIR_PATTERN = re.compile(r"^(?:首页\d{2}_.+|\d{5}_.+)")
COLLECTION_DIRS = ("案例集合材料", "案例素材", "原案例素材")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
PLACEHOLDER_INTRO = {"", "待补充", "待确认"}
SUMMARY_MAX = checks.SUMMARY_MAX
TEMPLATE_SUMMARY = checks.TEMPLATE_SUMMARY


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


class PublishError(RuntimeError):
    """携带中文提示的发布前置检查失败。"""


def check_manifest(manifest):
    missing = [field for field in REQUIRED_MANIFEST_FIELDS if not manifest.get(field)]
    if missing:
        raise PublishError(f"manifest.json 缺少必填字段：{'、'.join(missing)}")


def check_media_ready(media_map):
    not_ready = [
        m.get("originalPath", "(未知路径)")
        for m in media_map.get("media", [])
        if m.get("selected", True) and m.get("status") != "website-ready"
    ]
    if not_ready:
        sample = "、".join(not_ready[:5])
        more = f" 等共 {len(not_ready)} 条" if len(not_ready) > 5 else ""
        raise PublishError(f"以下已选中素材尚未就绪（status 不是 website-ready）：{sample}{more}")


def check_publish_confirmation(activity_root):
    """Building site data needs the originals on the team shared disk; preview approval comes later, on staging."""
    try:
        return require_backup(activity_root)
    except ValueError as exc:
        raise PublishError(str(exc)) from exc


def selected_website_ready_media(media_map):
    return [
        m
        for m in media_map.get("media", [])
        if m.get("selected", True) and m.get("status") == "website-ready" and m.get("websitePath")
    ]


def website_media_path(relative_path):
    """与 vite.config.js websiteMediaPath / src/data/events.js websiteAssetPath 相同：图片 -> .jpg，视频 -> .mp4。"""
    path = str(relative_path)
    path = re.sub(r"\.(jpe?g|png|webp|gif|bmp)$", ".jpg", path, flags=re.IGNORECASE)
    return re.sub(r"\.(mp4|mov|m4v|avi|mkv|webm)$", ".mp4", path, flags=re.IGNORECASE)


def case_title(folder_name):
    return re.sub(r"^\d{5}_", "", re.sub(r"^首页\d{2}_", "", folder_name)).strip()


def site_for_app(app):
    return SITE_FOR_APP.get(app, PRODUCTION_SITE)


def load_site_activities(site):
    """服务器上现有活动，转成 check_activity_id_conflict 用的 {id, folder}（folder 即 uid）。"""
    try:
        with urllib.request.urlopen(f"{site}/api/site", timeout=60) as response:
            events = json.load(response)["events"]
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
        raise PublishError(f"读不到 {site} 的现有活动，无法检查活动 id 冲突：{exc}") from exc
    return [{"id": e.get("id"), "folder": e.get("uid")} for e in events]


def deploy_skill_dir():
    """APP 部署专员通常和本 Skill 装在同一个 skills 目录；网站工程在别处，所以由这里找好再传给 upload-media.mjs。"""
    here = Path(__file__).resolve().parents[1]
    for candidate in (os.environ.get("BIGAPPLE_DEPLOY_SKILL_DIR"), here.parent / "bigapple-deploy", Path.home() / ".claude" / "skills" / "bigapple-deploy"):
        if candidate and (Path(candidate) / "bigapple" / "metadata.json").is_file():
            return Path(candidate).resolve()
    raise PublishError("找不到「APP 部署专员」Skill，请先在技能页安装它")


def deploy_skill_version():
    if os.environ.get("BIGAPPLE_SKILL_VERSION"):
        return os.environ["BIGAPPLE_SKILL_VERSION"].strip()
    return read_json(deploy_skill_dir() / "bigapple" / "metadata.json")["version"]


def deployment_headers():
    """本机 BigApple 部署身份（check_team_access.sh 会先生成并登记它）。"""
    data_dir = Path(os.environ.get("CLAUDE_GUI_DATA_DIR") or Path.home() / ".bigapple")
    credential_file = Path(os.environ.get("BIGAPPLE_DEPLOY_CREDENTIAL_FILE") or data_dir / "deployment-credential.json")
    if not credential_file.is_file():
        raise PublishError("找不到本机部署身份，请先运行 check_team_access.sh 完成团队白名单检查")
    credential = read_json(credential_file)
    return {
        "x-bigapple-publisher-id": credential["publisherId"],
        "Authorization": f"Bearer {credential['token']}",
        "x-bigapple-skill-id": DEPLOY_SKILL_ID,
        "x-bigapple-skill-version": deploy_skill_version(),
    }


def built_source(repo, activity_id):
    sources = json.loads((Path(repo) / "dist-server" / "sources.json").read_text(encoding="utf-8"))
    matched = [e for e in sources if e.get("uid") == activity_id]
    if len(matched) != 1:
        raise PublishError(f"构建产物里应恰好有一场 uid={activity_id} 的活动原始记录，实际 {len(matched)} 场")
    return matched[0]


def write_activity(site, source, append=False):
    """只写这一场；服务器保留旧版本，其他活动不受影响。append 只发这批照片和案例。"""
    payload = {"assets": source.get("assets", []), "cases": source.get("cases", []), "videos": source.get("record", {}).get("videos", [])} if append else {"source": source}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{site}/api/activities/{urllib.parse.quote(source['uid'], safe='')}",
        data=body, method="PATCH" if append else "PUT", headers={**deployment_headers(), "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get("error") or ""
        except (json.JSONDecodeError, ValueError):
            message = ""
        raise PublishError(f"写入 {site} 失败（HTTP {exc.code}）：{message or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise PublishError(f"连不上 {site}：{exc.reason}。网络恢复后重跑即可，已传的图会跳过") from exc


def check_activity_id_format(manifest, site_activities=(), folder_name=""):
    """新活动的 id 必须合规；网站上同目录已有的旧 id（如 activity-27）照用，不让补素材卡住。"""
    activity_id = str(manifest.get("id", ""))
    existing = any(e.get("id") == activity_id and e.get("folder") == folder_name for e in site_activities)
    if not existing and not ACTIVITY_ID_PATTERN.match(activity_id):
        raise PublishError(
            f"活动 id「{activity_id}」格式不对。要 MM-DD-英文或拼音短名，如 10-28-yiwu-ai-class，不能是随机 UUID；"
            "请在 manifest.json 里改 id，并把 uid 设为活动目录名。"
        )


def check_activity_id_conflict(manifest, snapshot_manifests, folder_name):
    """返回 True 表示线上已有同 id 同目录的活动（本次是更新）；同 id 不同目录抛错。"""
    activity_id = str(manifest.get("id", ""))
    for existing in snapshot_manifests or []:
        if existing.get("id") == activity_id and existing.get("folder") != folder_name:
            raise PublishError(
                f"活动 id 冲突：线上已有活动 {activity_id}（目录 {existing.get('folder')}），和本活动目录 {folder_name} 不是同一场。请换一个 id。"
            )
    return any(e.get("id") == activity_id and e.get("folder") == folder_name for e in snapshot_manifests or [])


def case_directories(activity_root):
    case_root = Path(activity_root) / "02_案例"
    if not case_root.is_dir():
        return []
    return [
        entry for entry in sorted(case_root.iterdir())
        if entry.is_dir() and not entry.is_symlink() and entry.name not in COLLECTION_DIRS
    ]


def case_images(case_dir):
    shots = case_dir / "截图"
    if not shots.is_dir():
        return []
    return sorted(
        p for p in shots.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and not p.name.startswith("._")
    )


def case_intro(case_dir):
    readme = case_dir / "说明.md"
    if not readme.is_file():
        return ""
    text = readme.read_text(encoding="utf-8-sig")
    match = re.search(r"^#{1,6}\s*案例简介\s*\n(.*?)(?=^#{1,6}\s|\Z)", text, re.MULTILINE | re.DOTALL)
    return match.group(1).strip() if match else ""


def check_cases(activity_root, media_map):
    """网站 readCaseMedia 只展示有主图的案例：无图、多图缺主图的案例整个丢弃且不报错，所以在这里拦。"""
    ready = {m["originalPath"] for m in selected_website_ready_media(media_map)}
    problems = []
    for case_dir in case_directories(activity_root):
        name = case_dir.name
        if not CASE_DIR_PATTERN.match(name):
            problems.append(f"案例目录「{name}」命名不对，要 首页NN_案例名 或 五位分数_案例名，否则网站不识别")
            continue
        title = case_title(name)
        if case_intro(case_dir) in PLACEHOLDER_INTRO:
            problems.append(f"案例「{title}」的说明.md 里「案例简介」为空或「待补充」，请向实习生要一句作品介绍")
        images = case_images(case_dir)
        if not images and any(p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES and p.relative_to(activity_root).as_posix() in ready for p in (case_dir / "视频").rglob("*")):
            continue
        if not images:
            problems.append(f"案例「{title}」没有主图，网站不会显示（只有链接没有图的案例要先取帧并登记截图）")
            continue
        mains = [p for p in images if "主图" in p.name]
        if len(images) > 1 and len(mains) != 1:
            problems.append(
                f"案例「{title}」有 {len(images)} 张截图，文件名含「主图」的有 {len(mains)} 张；"
                "必须恰好一张，命名如 10000_主图_描述.png，否则网站不显示这个案例"
            )
            continue
        main = mains[0] if mains else images[0]
        if main.relative_to(activity_root).as_posix() not in ready:
            problems.append(f"案例「{title}」的主图 {main.name} 没有进入已就绪的展示副本，先跑 archive.py mirror 并确认它被选中")
    if problems:
        raise PublishError("案例检查没通过：\n- " + "\n- ".join(problems))


def check_summary(manifest):
    """活动简介是网站上给人看的一句话：不超过 SUMMARY_MAX 字，不能是自动生成的模板句。"""
    summary = str(manifest.get("summary") or "").strip()
    if not summary or TEMPLATE_SUMMARY.search(summary):
        raise PublishError("manifest.json 的 summary 为空或是模板句。请向实习生要一句话简介（这场活动做了什么），"
                           f"不超过 {SUMMARY_MAX} 字")
    if len(summary) > SUMMARY_MAX:
        raise PublishError(f"manifest.json 的 summary 有 {len(summary)} 字，网站上限 {SUMMARY_MAX} 字：「{summary}」。"
                           "只留一句做了什么，细节写进案例的「详细说明」")


def poster_path_for(video_rel):
    """和 video_posters.py 同一约定：活动视频封面在 01_活动照片/视频封面/，案例视频封面在同目录。"""
    v = Path(video_rel)
    if v.parts[0] == "01_活动照片":
        return (Path("01_活动照片") / "视频封面" / (v.stem + ".poster.jpg")).as_posix()
    return v.with_name(v.stem + ".poster.jpg").as_posix()


def check_videos(activity_root, manifest, media_map):
    """每个上网页的视频都要有封面；作品视频要放进它的案例 02_案例/<案例>/视频/，不能混在活动视频里。"""
    ready = {m["originalPath"] for m in selected_website_ready_media(media_map)}
    declared = manifest.get("videoPosters") or {}
    problems = []
    for m in selected_website_ready_media(media_map):
        rel = m["originalPath"]
        if Path(rel).suffix.lower() not in VIDEO_SUFFIXES:
            continue
        if rel.startswith("01_活动照片/") and "作品视频" in Path(rel).name:
            problems.append(f"{rel} 是作品视频，要放到对应案例的 02_案例/<案例>/视频/ 下（拿不准归属就问实习生）")
            continue
        poster = poster_path_for(rel)
        if poster not in ready:
            problems.append(f"{rel} 没有封面：跑 video_posters.py frames 生成 {poster}，再 archive.py mirror")
        elif rel.startswith("01_活动照片/") and declared.get(rel) != poster:
            problems.append(f"{rel} 的封面没写进 manifest.json 的 videoPosters（video_posters.py 会自动写）")
    if problems:
        raise PublishError("视频检查没通过：\n- " + "\n- ".join(problems))


def check_similar_photos(activity_root, media_map):
    """archive.py scan 标出的相似连拍组：每组只能有一张进相册，除非写了 keepAll 理由。"""
    record = Path(activity_root) / "其他" / "整理记录.json"
    if not record.is_file():
        return
    shown = {}
    for m in selected_website_ready_media(media_map):
        if m["originalPath"].startswith("01_活动照片/"):
            shown.setdefault(m["originalSha256"], []).append(m["originalPath"])
    problems = []
    for group in read_json(record).get("similarGroups", []):
        hits = sorted(p for sha in group.get("sha256", []) for p in shown.get(sha, []))
        if len(hits) > 1 and not str(group.get("keepAll") or "").strip():
            problems.append(" / ".join(hits))
    if problems:
        raise PublishError("这些照片几乎一样，相册里每组只留最清楚的一张，其余移到 其他/相似连拍/；"
                           "确实要都留，在 其他/整理记录.json 的 similarGroups 给这组写 keepAll 理由：\n- " + "\n- ".join(problems))


def check_web_targets(media_map):
    """展示副本进暂存时改名为 <活动目录>/<originalPath 按网站规则换扩展名>：检查重名；返回扩展名与网站不一致（透明 PNG）的素材。"""
    seen = {}
    mismatched = []
    for item in selected_website_ready_media(media_map):
        target = website_media_path(item["originalPath"])
        if target in seen:
            raise PublishError(f"两个素材换成网站扩展名后重名：{seen[target]} 和 {item['originalPath']}（都变成 {target}），请改其中一个的文件名")
        seen[target] = item["originalPath"]
        if Path(item["websitePath"]).suffix.lower() != Path(target).suffix.lower():
            mismatched.append(item["originalPath"])
    return mismatched


def warn_or_raise(check, append, *args):
    """追加模式：服务器上的旧问题只提示，由助手问使用者这次要不要顺手修；整场发布照拦。"""
    try:
        check(*args)
    except PublishError as exc:
        if not append:
            raise
        print("提示（追加不拦，请问使用者是否顺手修）：" + str(exc))


def check_built_source(source, append=False):
    """生成的原始记录过一遍 checks.py：和全站体检同一套规则。"""
    issues = checks.check_source(source)
    if not issues:
        return []
    message = "记录检查没通过（规则见 checks.py）：\n" + checks.format_issues(issues)
    if append:
        print("提示（追加不拦，请问使用者是否顺手修）：" + message)
        return issues
    raise PublishError(message)


def run_preflight_checks(activity_root, manifest, media_map, snapshot_loader=None, append=False):
    """snapshot_loader：无参函数，返回服务器现有活动的 {id, folder}；放到最后调用，前面的检查失败时不联网。"""
    check_manifest(manifest)
    folder_name = manifest.get("sourceFolder") or Path(activity_root).name
    check_media_ready(media_map)
    check_publish_confirmation(activity_root)
    check_cases(activity_root, media_map)
    check_similar_photos(activity_root, media_map)
    warn_or_raise(check_summary, append, manifest)
    warn_or_raise(check_videos, append, activity_root, manifest, media_map)
    transparent = check_web_targets(media_map)
    if transparent:
        print("提示：以下素材的展示副本是透明 PNG，网站按 .jpg 路径查找。发布时会改名为 .jpg 放进图床，浏览器一般仍能显示，请在测试站看一眼：")
        for path in transparent[:10]:
            print("  - " + path)
    snapshot_manifests = snapshot_loader() if snapshot_loader else []
    check_activity_id_format(manifest, snapshot_manifests, folder_name)
    is_update = check_activity_id_conflict(manifest, snapshot_manifests, folder_name)
    return is_update, snapshot_manifests


def copy_tree(src, dst):
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def build_library_staging(activity_root, staging_root, activity_folder_name):
    """library/<活动目录名>/ = 归档本身的副本，供 build-media-index.mjs 读 manifest / 原图体积。"""
    dest = staging_root / activity_folder_name
    copy_tree(Path(activity_root), dest)
    return dest


def build_web_staging(media_map, web_root, staging_root, activity_folder_name):
    """web/<活动目录名>/ = 只含 selected 且 website-ready 的展示副本，从 --web-root 按 websitePath 取。

    同时把 manifest.json 复制进去：upload-media.mjs 在索引里还没有这个活动时，
    会退回读 <media-root>/<folder>/manifest.json 解析活动 id，没有这份副本会按
    folder 名字当 id 上传，和真实 id 对不上。
    """
    dest = staging_root / activity_folder_name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    manifest_src = Path(media_map["_activity_root"]) / "manifest.json"
    if manifest_src.exists():
        shutil.copy2(manifest_src, dest / "manifest.json")
    copied = 0
    for item in selected_website_ready_media(media_map):
        website_path = Path(item["websitePath"])
        parts = website_path.parts
        if not parts or parts[0] != activity_folder_name:
            raise PublishError(f"媒体映射里的 websitePath 不在本活动目录下：{item['websitePath']}")
        src = Path(web_root) / website_path
        if not src.is_file():
            raise PublishError(f"展示副本缺失，先跑 archive.py mirror：{src}")
        # 去掉短哈希：目标 = <活动目录名>/<originalPath 按网站规则换扩展名>，网站按这个路径查
        target = dest / website_media_path(item["originalPath"])
        if target.exists():
            raise PublishError(f"暂存目录里目标文件重名：{target.relative_to(dest)}")
        target.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() == ".png" and target.suffix.lower() == ".jpg":
            # The site serves every image as .jpg; write a real JPEG (transparency on white) so type and bytes agree.
            from PIL import Image
            with Image.open(src) as im:
                im = im.convert("RGBA")
                flat = Image.new("RGB", im.size, "white")
                flat.paste(im, mask=im.getchannel("A"))
                flat.save(target, "JPEG", quality=90, optimize=True)
        else:
            shutil.copy2(src, target)
        copied += 1
    return dest, copied


def run_streaming(cmd, repo, env, label):
    """子进程输出直接打到终端，不吞；非 0 退出就中文报错停止。"""
    sys.stdout.flush()
    result = subprocess.run(resolve_command(cmd), cwd=repo, env=env)
    if result.returncode != 0:
        raise PublishError(f"{label} 失败（退出码 {result.returncode}），原因见上方输出。")
    return result


def resolve_command(cmd):
    # Windows 上 npm 是 npm.cmd，subprocess 不经 shell 找不到裸名 "npm"；which 会按 PATHEXT 解析。
    return [shutil.which(cmd[0]) or cmd[0], *cmd[1:]]


def run_node(repo, script_args, env, dry_run_label=None):
    label = dry_run_label or " ".join(script_args)
    return run_streaming(["node", *script_args], repo, env, label)


def run_upload(repo, web_staging_root, activity_folder_name, app, dry_run):
    args = [
        "scripts/upload-media.mjs",
        "--media-root",
        str(web_staging_root),
        "--folders",
        activity_folder_name,
        "--app",
        app,
    ]
    if dry_run:
        args.append("--dry-run")
    env = os.environ.copy()
    if not dry_run:
        env["BIGAPPLE_DEPLOY_SKILL_DIR"] = str(deploy_skill_dir())
    return run_node(repo, args, env=env, dry_run_label="upload-media.mjs")


def run_build_index_and_build(repo, library_staging_root, web_staging_root):
    env = os.environ.copy()
    env["BIGAPPLE_LIBRARY_ROOT"] = str(library_staging_root)
    env["ANLI_WEBSITE_MEDIA"] = str(web_staging_root)
    run_node(repo, ["scripts/build-media-index.mjs"], env=env, dry_run_label="build-media-index.mjs")
    return run_streaming(["npm", "run", "build"], repo, env, "npm run build")


def index_entries(repo, activity_id):
    """从 src/data/mediaIndex.generated.js 取本活动的索引条目（不依赖 url，干跑也能核对数量）。"""
    code = (
        "import {mediaIndex} from './src/data/mediaIndex.generated.js';"
        "const id=process.argv[1];"
        "console.log(JSON.stringify(mediaIndex.filter(i=>i.activityId===id).map(i=>({path:i.path,url:i.url}))));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", code, activity_id],
        cwd=repo, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise PublishError("读取 mediaIndex.generated.js 失败：\n" + result.stderr)
    return json.loads(result.stdout)


def expected_counts(media_map, activity_root):
    ready = selected_website_ready_media(media_map)
    photos = [m for m in ready if m["originalPath"].startswith("01_活动照片/")]
    gallery = [m for m in photos if Path(m["originalPath"]).suffix.lower() in IMAGE_SUFFIXES]
    videos = [m for m in photos if Path(m["originalPath"]).suffix.lower() in VIDEO_SUFFIXES]
    cases = [case_title(d.name) for d in case_directories(activity_root) if CASE_DIR_PATTERN.match(d.name)]
    return {"gallery": len(gallery), "videos": len(videos), "cases": cases}


def verify_build(repo, activity_id, expected_event_count, dry_run, expected=None, index_id=None, append=False):
    events_path = Path(repo) / "dist-server" / "events.json"
    if not events_path.exists():
        raise PublishError("构建完成但找不到 dist-server/events.json")
    events = json.loads(events_path.read_text(encoding="utf-8"))
    if len(events) < expected_event_count:
        raise PublishError(
            f"构建后活动数量不对：应至少 {expected_event_count} 场，现在 {len(events)} 场。"
        )
    matched = [e for e in events if e.get("uid") == activity_id or e.get("id") == activity_id]
    if not matched:
        raise PublishError(f"构建产物里找不到本活动（uid/id={activity_id}）")
    problems = []
    empty_image_urls = []
    for event in matched:
        detail = event.get("detail", {})
        for key in ("gallery", "highlights", "productionGallery"):
            for item in detail.get(key, []):
                if "image" in item and not item.get("image"):
                    empty_image_urls.append(f"{key}:{item.get('id')}")
        if expected is None:
            continue
        if not dry_run:
            if not event.get("image") and not append:  # 追加批次可以没有封面，封面留在服务器上
                problems.append("活动封面 url 为空")
            if len(detail.get("gallery", [])) != expected["gallery"]:
                problems.append(f"活动照片 gallery 有 {len(detail.get('gallery', []))} 张，归档里选中的是 {expected['gallery']} 张")
            if len(detail.get("videos", [])) != expected["videos"]:
                problems.append(f"活动视频 videos 有 {len(detail.get('videos', []))} 个，归档里选中的是 {expected['videos']} 个")
        has_image = {}
        for key in ("productions", "productionGallery"):
            for item in detail.get(key, []):
                title = item.get("title") or item.get("caption")
                has_image[title] = has_image.get(title, False) or bool(item.get("image"))
        for title in expected["cases"]:
            if title not in has_image:
                problems.append(f"案例「{title}」没有出现在 productions / productionGallery（网站丢弃了它）")
            elif not has_image[title] and not dry_run:
                problems.append(f"案例「{title}」没有图片 url")
    if expected is not None and index_id:
        photos = [e for e in index_entries(repo, index_id) if e["path"].startswith("01_活动照片/")]
        index_images = [e for e in photos if Path(e["path"]).suffix.lower() in IMAGE_SUFFIXES]
        index_videos = [e for e in photos if Path(e["path"]).suffix.lower() in VIDEO_SUFFIXES]
        if len(index_images) != expected["gallery"]:
            problems.append(f"媒体索引里活动照片 {len(index_images)} 张，归档里选中的是 {expected['gallery']} 张")
        if len(index_videos) != expected["videos"]:
            problems.append(f"媒体索引里活动视频 {len(index_videos)} 个，归档里选中的是 {expected['videos']} 个")
    if problems:
        raise PublishError("构建结果核对没通过：\n- " + "\n- ".join(problems))
    if empty_image_urls and not dry_run:
        raise PublishError(f"本活动有图片 url 为空：{'、'.join(empty_image_urls[:10])}")
    return len(events), bool(empty_image_urls)


def run_tests(repo):
    sys.stdout.flush()
    return subprocess.run(resolve_command(["npm", "test"]), cwd=repo)


def publish(activity_root, repo, web_root, app, dry_run, append=False):
    activity_root = Path(activity_root).resolve()
    repo = Path(repo).resolve()
    web_root = Path(web_root).resolve()

    manifest = read_json(activity_root / "manifest.json")
    media_map = read_json(activity_root / "媒体映射.json")
    media_map["_activity_root"] = str(activity_root)

    activity_folder_name = manifest.get("sourceFolder") or activity_root.name
    site = site_for_app(app)
    is_update, _ = run_preflight_checks(
        activity_root, manifest, media_map, lambda: load_site_activities(site), append
    )

    activity_id = manifest.get("uid") or manifest["id"]
    if append and not is_update:
        raise PublishError(f"{site} 上还没有这场活动（目录 {activity_folder_name}、id {manifest['id']}），不能追加。新活动去掉 --append 整场发布；补素材要让目录名和 id 与原活动一致。")
    expected = expected_counts(media_map, activity_root)

    import tempfile

    with tempfile.TemporaryDirectory(prefix="bigapple-publish-") as tmp:
        tmp_path = Path(tmp)
        library_staging_root = tmp_path / "library"
        web_staging_root = tmp_path / "web"
        library_staging_root.mkdir()
        web_staging_root.mkdir()

        build_library_staging(activity_root, library_staging_root, activity_folder_name)
        _, copied = build_web_staging(media_map, web_root, web_staging_root, activity_folder_name)
        if copied == 0:
            raise PublishError("没有任何 selected 且 website-ready 的素材可发布。")

        run_upload(repo, web_staging_root, activity_folder_name, app, dry_run)
        run_build_index_and_build(repo, library_staging_root, web_staging_root)

        _, empty_urls_in_dry_run = verify_build(
            repo, activity_id, 1, dry_run, expected, manifest["id"], append
        )

        test_result = run_tests(repo)
        if test_result.returncode != 0:
            raise PublishError("npm test 没有通过，请看上方输出。没有写入服务器。")
        source = built_source(repo, activity_id)
        if not dry_run:
            check_built_source(source, append)

    mode = "追加素材" if append else ("整场更新" if is_update else "新增活动")
    print(f"发布检查通过，活动 id：{manifest['id']}，活动目录：{activity_folder_name}（{mode}）")
    print(f"核对通过：活动照片 {expected['gallery']}、视频 {expected['videos']}、案例 {len(expected['cases'])} 个")
    if dry_run:
        label = "dry-run：upload 未写云端，url 预期为空" if empty_urls_in_dry_run else "dry-run：upload 未写云端"
        print(label)
        print(f"dry-run：没有写入 {site}")
        return
    result = write_activity(site, source, append)
    print(f"已写入 {site}：{mode}，网站现在共 {result.get('activities')} 场活动")
    print(f"打开查看：{site}/events/{urllib.parse.quote(activity_id)}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("activity", help="活动归档目录")
    parser.add_argument("--repo", required=True, help="网站仓库路径")
    parser.add_argument("--web-root", required=True, help="archive.py mirror 的输出根目录")
    parser.add_argument("--app", default=DEFAULT_APP, help="上传用的 app id")
    parser.add_argument("--dry-run", action="store_true", help="upload-media.mjs 加 --dry-run，不写云端")
    parser.add_argument("--append", action="store_true", help="给已有活动追加这批照片/案例，不整场替换")
    args = parser.parse_args(argv)
    try:
        publish(args.activity, args.repo, args.web_root, args.app, args.dry_run, args.append)
    except PublishError as exc:
        raise SystemExit("错误: " + str(exc))


if __name__ == "__main__":
    main()

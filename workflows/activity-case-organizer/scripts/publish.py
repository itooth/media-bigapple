#!/usr/bin/env python3
"""把一份实习生归档发布到 media-bigapple 网站仓库的线上数据。

前提：归档已 mirror 过（存在媒体映射.json），且已用 release_gate.py backup 记录原件在团队共享硬盘的位置
（预览已确认 + 原件已有共享硬盘备份）。本脚本只读归档、只在临时目录操作，
不修改归档本身；对网站仓库会写 src/data 和跑一次 npm run build（可用 --dry-run
让上传不写云端）。脚本本身不 commit、不 push、不部署。

用法：
  publish.py <活动归档目录> --repo <网站仓库> --web-root <mirror 输出根>
             [--app bigapple-onboarding-course] [--dry-run]
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_gate import require_backup  # noqa: E402

REQUIRED_MANIFEST_FIELDS = ("title", "date", "id")
DEFAULT_APP = "bigapple-onboarding-course"


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


def run_preflight_checks(activity_root, manifest, media_map):
    check_manifest(manifest)
    check_media_ready(media_map)
    check_publish_confirmation(activity_root)


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
        target = dest.joinpath(*parts[1:])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        copied += 1
    return dest, copied


def run_node(repo, script_args, env, dry_run_label=None):
    result = subprocess.run(
        ["node", *script_args],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    label = dry_run_label or " ".join(script_args)
    if result.returncode != 0:
        raise PublishError(f"{label} 失败：\n{result.stdout}\n{result.stderr}")
    return result


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
    return run_node(repo, args, env=os.environ.copy(), dry_run_label="upload-media.mjs")


def run_build_index_and_build(repo, library_staging_root, web_staging_root):
    env = os.environ.copy()
    env["BIGAPPLE_LIBRARY_ROOT"] = str(library_staging_root)
    env["ANLI_WEBSITE_MEDIA"] = str(web_staging_root)
    run_node(repo, ["scripts/build-media-index.mjs"], env=env, dry_run_label="build-media-index.mjs")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise PublishError(f"npm run build 失败：\n{result.stdout}\n{result.stderr}")
    return result


def verify_build(repo, activity_id, previous_event_count, dry_run):
    events_path = Path(repo) / "dist-server" / "events.json"
    if not events_path.exists():
        raise PublishError("构建完成但找不到 dist-server/events.json")
    events = json.loads(events_path.read_text(encoding="utf-8"))
    if len(events) < previous_event_count:
        raise PublishError(
            f"构建后活动数量变少了：之前 {previous_event_count} 场，现在 {len(events)} 场。"
        )
    matched = [e for e in events if e.get("uid") == activity_id or e.get("id") == activity_id]
    if not matched:
        raise PublishError(f"构建产物里找不到本活动（uid/id={activity_id}）")
    empty_image_urls = []
    for event in matched:
        detail = event.get("detail", {})
        for key in ("gallery", "highlights", "productionGallery"):
            for item in detail.get(key, []):
                if "image" in item and not item.get("image"):
                    empty_image_urls.append(f"{key}:{item.get('id')}")
    if empty_image_urls and not dry_run:
        raise PublishError(f"本活动有图片 url 为空：{'、'.join(empty_image_urls[:10])}")
    return len(events), bool(empty_image_urls)


def run_tests(repo):
    result = subprocess.run(["npm", "test"], cwd=repo, capture_output=True, text=True)
    return result


def git_diff_stat(repo):
    result = subprocess.run(["git", "diff", "--stat"], cwd=repo, capture_output=True, text=True)
    return result.stdout.strip()


def publish(activity_root, repo, web_root, app, dry_run):
    activity_root = Path(activity_root).resolve()
    repo = Path(repo).resolve()
    web_root = Path(web_root).resolve()

    manifest = read_json(activity_root / "manifest.json")
    media_map = read_json(activity_root / "媒体映射.json")
    media_map["_activity_root"] = str(activity_root)

    run_preflight_checks(activity_root, manifest, media_map)

    activity_id = manifest.get("uid") or manifest["id"]
    activity_folder_name = manifest.get("sourceFolder") or activity_root.name

    events_path = repo / "dist-server" / "events.json"
    previous_event_count = 0
    if events_path.exists():
        try:
            previous_event_count = len(json.loads(events_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            previous_event_count = 0

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

        new_event_count, empty_urls_in_dry_run = verify_build(
            repo, activity_id, previous_event_count, dry_run
        )

        test_result = run_tests(repo)

    diff_stat = git_diff_stat(repo)

    print(f"发布检查通过，活动 id：{activity_id}，活动目录：{activity_folder_name}")
    print(f"构建前活动数：{previous_event_count}，构建后活动数：{new_event_count}")
    if dry_run:
        label = "dry-run：upload 未写云端，url 预期为空" if empty_urls_in_dry_run else "dry-run：upload 未写云端"
        print(label)
    print(f"npm test：{'通过' if test_result.returncode == 0 else '失败'}")
    if test_result.returncode != 0:
        print(test_result.stdout)
        print(test_result.stderr)
    print("git diff --stat：")
    print(diff_stat or "(无变化)")
    print("\n下一步：确认无误后提交并推送 main，再用 APP 部署专员部署 media-staging 预览。")
    print("本脚本未 commit、未 push、未部署。")

    if test_result.returncode != 0:
        raise PublishError("npm test 没有通过，请看上方输出。")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("activity", help="活动归档目录")
    parser.add_argument("--repo", required=True, help="网站仓库路径")
    parser.add_argument("--web-root", required=True, help="archive.py mirror 的输出根目录")
    parser.add_argument("--app", default=DEFAULT_APP, help="上传用的 app id")
    parser.add_argument("--dry-run", action="store_true", help="upload-media.mjs 加 --dry-run，不写云端")
    args = parser.parse_args(argv)
    try:
        publish(args.activity, args.repo, args.web_root, args.app, args.dry_run)
    except PublishError as exc:
        raise SystemExit("错误: " + str(exc))


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# 开工前检查：当前电脑的 BigApple 身份能否更新案例网站 media / media-staging。
# 这两个应用挂在团队部署管理员名下；只有在管理员白名单（云端 BIGAPPLE_DEPLOY_ADMIN_PUBLISHER_IDS）
# 里的身份 resolve 才查得到它们，查不到就说明不在白名单，不能继续上传或部署。
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SKILL_DIR="${BIGAPPLE_DEPLOY_SKILL_DIR:-}"
for candidate in "$DEPLOY_SKILL_DIR" "$SKILL_ROOT/../bigapple-deploy" "$HOME/.claude/skills/bigapple-deploy"; do
  if [[ -n "$candidate" && -f "$candidate/scripts/deployment-auth.sh" ]]; then DEPLOY_SKILL_DIR="$candidate"; break; fi
done
if [[ ! -f "$DEPLOY_SKILL_DIR/scripts/deployment-auth.sh" ]]; then
  echo "错误：没找到「APP 部署专员」（bigapple-deploy）Skill。请在 BigApple 技能页安装它后重试。" >&2
  exit 2
fi

API_BASE="${BIGAPPLE_DEPLOY_API_BASE:-https://api.bigapple.work}"
APP_DATA_DIR="${CLAUDE_GUI_DATA_DIR:-$HOME/.bigapple}"
source "$DEPLOY_SKILL_DIR/scripts/deployment-auth.sh"
initialize_deployment_auth "$API_BASE" "$APP_DATA_DIR" "${BIGAPPLE_DEPLOY_PUBLISHER_ID:-}"
check_deployment_skill_version "$API_BASE" "$SKILL_ID" "$SKILL_VERSION"

missing=0
for slug in media media-staging; do
  found="$(curl -fsS --connect-timeout 10 --max-time 30 -X POST \
    -H "Content-Type: application/json" \
    -H "x-bigapple-publisher-id: $PUBLISHER_ID" \
    -H "Authorization: Bearer $DEPLOYMENT_TOKEN" \
    -H "x-bigapple-skill-id: $SKILL_ID" \
    -H "x-bigapple-skill-version: $SKILL_VERSION" \
    --data "{\"slug\":\"$slug\"}" "$API_BASE/api/apps/resolve" \
    | "$DEPLOYMENT_PYTHON_BIN" -c 'import json,sys; print((json.load(sys.stdin).get("app") or {}).get("publicUrl") or "")')"
  if [[ -n "$found" ]]; then echo "可以更新 ${slug}：$found"; else echo "查不到应用 $slug"; missing=1; fi
done

if [[ "$missing" == "1" ]]; then
  echo "你的 BigApple 身份不在团队部署白名单里，不能上传素材或部署案例网站。" >&2
  echo "请把这串 ID 发给查理，请他加进白名单：$PUBLISHER_ID" >&2
  exit 3
fi
echo "白名单检查通过（身份 ${PUBLISHER_ID}，部署专员 ${SKILL_VERSION}）"

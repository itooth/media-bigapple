/**
 * 活动目录名 ↔ 活动 id 的统一解析。
 *
 * 为什么需要：同一场活动在三个地方叫的名字可能不一样——
 *   - 母库（素材库）目录名，例如 `2026-09-05-光耀基金会活动一期`
 *   - 活动 manifest 里的 id，例如 `09-05-guangyao`
 *   - 压缩镜像（网站压缩素材）目录名，例如 `2026-09-05-光耀基金会活动`
 * 只按目录名精确匹配会漏掉这种差一份「一期」的情况，活动就拿不到自己的图
 * （前端按 id 取封面 → 取不到 → 卡片显示问号）。
 *
 * 这里的匹配顺序：
 *   1. 镜像目录里自带 manifest.json 的 id，且活动清单里有这个 id；
 *   2. 归一化后相等：去掉 `_ - 空格 （）` 和结尾的「一期/二期/三期」再比；
 *   3. 再不行退回目录名本身。
 * 只读目录，不改任何文件。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 去掉写法差异，只保留"认的是不是同一场活动"这个信息。 */
export function normalizeFolderName(name) {
  return String(name || '')
    .replace(/[\s_\-（）()]/g, '')
    .replace(/(一期|二期|三期)$/u, '');
}

export function readActivityManifest(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 读「素材库」里的活动清单（以它的 manifest.json 为准）。 */
export function readLibraryActivities(libraryRoot) {
  const activities = [];
  if (!libraryRoot || !fs.existsSync(libraryRoot)) return activities;
  for (const entry of fs.readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readActivityManifest(path.join(libraryRoot, entry.name, 'manifest.json'));
    if (!manifest) continue;
    activities.push({
      id: manifest.id || entry.name,
      folder: entry.name,
      title: manifest.title || entry.name,
      sourceFolder: manifest.sourceFolder || '',
    });
  }
  return activities;
}

function aliasKeys(activity) {
  // 归一化后同名的写法都算同一场活动（母库目录名 / sourceFolder / 标题 / id）
  return [activity.folder, activity.sourceFolder, activity.title, activity.id]
    .filter(Boolean)
    .map(normalizeFolderName);
}

function byAlias(activities) {
  const map = new Map();
  for (const activity of activities) {
    for (const key of aliasKeys(activity)) if (!map.has(key)) map.set(key, activity);
  }
  return map;
}

/**
 * 扫一个镜像根，算出「该根里的目录名 → 活动 id」。
 * @returns {Map<string,string>}
 */
export function activityIdsByMediaFolder(mediaRoot, activities) {
  const result = new Map();
  if (!mediaRoot || !fs.existsSync(mediaRoot)) return result;
  const alias = byAlias(activities);
  const knownIds = new Set(activities.map((activity) => activity.id));
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const own = readActivityManifest(path.join(mediaRoot, entry.name, 'manifest.json'));
    if (own?.id && knownIds.has(own.id)) { result.set(entry.name, own.id); continue; }
    const matched = alias.get(normalizeFolderName(entry.name));
    result.set(entry.name, matched ? matched.id : entry.name);
  }
  return result;
}

/**
 * 反向：某个镜像根里，活动 id 实际对应的目录名。
 * 前端请求 `/local-media/<activityId>/...` 时用它把 id 还原成磁盘上的目录。
 * @returns {Map<string,string>}
 */
export function mediaFoldersByActivityId(mediaRoot, activities) {
  const result = new Map();
  for (const [folder, activityId] of activityIdsByMediaFolder(mediaRoot, activities)) {
    // 目录名能被认成某活动 id 就登记；id 与目录名相同的兜底情况也登记，便于直接命中。
    if (!result.has(activityId)) result.set(activityId, folder);
    if (!result.has(folder)) result.set(folder, folder);
  }
  return result;
}

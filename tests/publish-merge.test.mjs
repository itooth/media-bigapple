// 发布链路的核心防护：本地素材库/网站压缩素材只覆盖本次出现的活动，
// 本地没有的旧活动（按 id）必须原样保留，不能被一次「只整理一场新活动」的构建悄悄删掉。
// 明确要删除的活动走 BIGAPPLE_REMOVE_ACTIVITIES，默认不删。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

function writeManifest(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

// 跑 build-media-index.mjs 必须在一份隔离的工作目录副本里执行：脚本会就地改写
// src/data/mediaIndex.generated.js 和 docs/media-index-report.md，直接在真实仓库里跑
// 会和并发执行的其它测试（例如 event-presentation.test.mjs 起的真实构建）抢同一份文件。
function cloneWorkdir(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-build-media-index-'));
  for (const rel of ['scripts', 'src', 'docs']) {
    fs.cpSync(path.join(ROOT, rel), path.join(tmp, rel), { recursive: true });
  }
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

// 完整克隆一份可跑 `npm run build -- --catalog-only` 的工作目录：node_modules 用软链接，
// 不实际复制 82MB；其余必须的源码目录按内容复制，避免写坏真实仓库的 snapshot。
function cloneFullWorkdir(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-vite-merge-'));
  for (const rel of ['scripts', 'src', 'server', 'bootstrap', 'vite.config.js', 'package.json']) {
    fs.cpSync(path.join(ROOT, rel), path.join(tmp, rel), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

function runBuildMediaIndex(workdir, env) {
  return spawnSync(process.execPath, ['scripts/build-media-index.mjs'], {
    cwd: workdir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function readGeneratedEventIds(workdir) {
  const generated = fs.readFileSync(path.join(workdir, 'src/data/mediaIndex.generated.js'), 'utf8');
  return [...generated.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
}

function readGeneratedMediaActivityIds(workdir) {
  const generated = fs.readFileSync(path.join(workdir, 'src/data/mediaIndex.generated.js'), 'utf8');
  return [...generated.matchAll(/activityId: "([^"]+)"/g)].map((m) => m[1]);
}

test('build-media-index：本地只有一场新活动时，旧活动的索引条目原样保留，新活动加入', (t) => {
  const workdir = cloneWorkdir(t);
  const materialTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-new-activity-'));
  t.after(() => fs.rmSync(materialTmp, { recursive: true, force: true }));

  const libraryRoot = path.join(materialTmp, '素材库');
  const activityId = 'test-new-activity';
  const activityFolder = '2026-11-01_测试新活动';
  const websiteRoot = path.join(materialTmp, '网站压缩素材', activityFolder);
  writeManifest(path.join(libraryRoot, activityFolder), {
    version: 6,
    id: activityId,
    title: '测试新活动',
    date: '2026-11-01',
    venue: '深圳',
  });
  fs.mkdirSync(path.join(websiteRoot, '01_活动照片'), { recursive: true });
  fs.writeFileSync(path.join(websiteRoot, '01_活动照片', '10050_封面_合照.jpg'), 'fake-image-bytes');

  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const beforeIds = new Set(before.activityManifests.map((item) => item.id));
  assert.ok(beforeIds.size > 1, '基线应已有多场活动');

  const result = runBuildMediaIndex(workdir, {
    BIGAPPLE_LIBRARY_ROOT: libraryRoot,
    ANLI_WEBSITE_MEDIA: path.join(materialTmp, '网站压缩素材'),
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);

  const generatedEventIds = readGeneratedEventIds(workdir);
  const generatedActivityIds = readGeneratedMediaActivityIds(workdir);

  for (const id of beforeIds) assert.ok(generatedEventIds.includes(id), `旧活动事件丢失: ${id}`);
  assert.ok(generatedEventIds.includes(activityId), '新活动未加入 mediaEvents');
  assert.ok(generatedActivityIds.includes(activityId), '新活动未加入 mediaIndex');
});

test('build-media-index：BIGAPPLE_REMOVE_ACTIVITIES 能删除指定活动', (t) => {
  const workdir = cloneWorkdir(t);
  const materialTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-remove-activity-'));
  t.after(() => fs.rmSync(materialTmp, { recursive: true, force: true }));

  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const victimId = before.activityManifests[0].id;

  // 空素材库 + 空网站压缩素材：不删的话应保留全部旧条目；这里显式删掉第一个活动。
  fs.mkdirSync(path.join(materialTmp, '素材库'));
  fs.mkdirSync(path.join(materialTmp, '网站压缩素材'));
  const result = runBuildMediaIndex(workdir, {
    BIGAPPLE_LIBRARY_ROOT: path.join(materialTmp, '素材库'),
    ANLI_WEBSITE_MEDIA: path.join(materialTmp, '网站压缩素材'),
    BIGAPPLE_REMOVE_ACTIVITIES: victimId,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);

  const generatedEventIds = readGeneratedEventIds(workdir);
  assert.ok(!generatedEventIds.includes(victimId), '指定删除的活动应不再出现');
  const otherIds = before.activityManifests.slice(1).map((item) => item.id);
  for (const id of otherIds) assert.ok(generatedEventIds.includes(id), `未删除的活动不应丢失: ${id}`);
});

test('vite.config.js：BIGAPPLE_LIBRARY_ROOT 指向只有一场新活动的素材库时，snapshot 里旧活动原样保留，新活动加入', (t) => {
  const workdir = cloneFullWorkdir(t);
  const materialTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-vite-new-activity-'));
  t.after(() => fs.rmSync(materialTmp, { recursive: true, force: true }));

  const libraryRoot = path.join(materialTmp, '素材库');
  const activityId = 'test-vite-new-activity';
  writeManifest(path.join(libraryRoot, '2026-11-02_测试活动二'), {
    version: 6,
    id: activityId,
    title: '测试活动二',
    date: '2026-11-02',
    venue: '深圳',
  });

  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const beforeIds = before.activityManifests.map((item) => item.id);
  assert.ok(beforeIds.length > 1, '基线应已有多场活动');

  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--ssr', 'src/data/events.js', '--outDir', '.catalog-build'], {
    cwd: workdir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CATALOG_BUILD: '1',
      BIGAPPLE_LIBRARY_ROOT: libraryRoot,
      ANLI_WEBSITE_MEDIA: path.join(materialTmp, '网站压缩素材'),
    },
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);

  const after = JSON.parse(fs.readFileSync(path.join(workdir, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const afterIds = new Set(after.activityManifests.map((item) => item.id));
  for (const id of beforeIds) assert.ok(afterIds.has(id), `旧活动丢失: ${id}`);
  assert.ok(afterIds.has(activityId), '新活动未加入 snapshot');
  assert.equal(after.activityManifests.length, beforeIds.length + 1);
});

test('vite.config.js：BIGAPPLE_REMOVE_ACTIVITIES 能从 snapshot 里删除指定活动', (t) => {
  const workdir = cloneFullWorkdir(t);
  const materialTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-vite-remove-'));
  t.after(() => fs.rmSync(materialTmp, { recursive: true, force: true }));

  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const victimId = before.activityManifests[0].id;

  fs.mkdirSync(path.join(materialTmp, '素材库'));
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--ssr', 'src/data/events.js', '--outDir', '.catalog-build'], {
    cwd: workdir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CATALOG_BUILD: '1',
      BIGAPPLE_LIBRARY_ROOT: path.join(materialTmp, '素材库'),
      ANLI_WEBSITE_MEDIA: path.join(materialTmp, '网站压缩素材'),
      BIGAPPLE_REMOVE_ACTIVITIES: victimId,
    },
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);

  const after = JSON.parse(fs.readFileSync(path.join(workdir, 'src/data/siteContent.snapshot.json'), 'utf8'));
  const afterIds = new Set(after.activityManifests.map((item) => item.id));
  assert.ok(!afterIds.has(victimId), '指定删除的活动应不再出现');
  for (const item of before.activityManifests.slice(1)) assert.ok(afterIds.has(item.id), `未删除的活动不应丢失: ${item.id}`);
});

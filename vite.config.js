import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import { mediaIndex } from './src/data/mediaIndex.generated.js';
import contentSnapshot from './src/data/siteContent.snapshot.json' with { type: 'json' };

// 前端只认索引：案例封面在不在，查索引，不再查本地图片目录。
// 索引由 scripts/build-media-index.mjs 从「网站压缩素材」生成，是自足的快照。
const indexPaths = new Set(mediaIndex.map((item) => item.activityId + '/' + item.path));

// 目录名 -> 活动 id（由素材库那边的 manifest.json 决定）
let idByFolderCache = null;
function activityIdOfFolder(folder) {
  if (!idByFolderCache) {
    idByFolderCache = new Map(indexPaths.size ? [...indexPaths].map((key) => [key.split('/')[0], key.split('/')[0]]) : []);
    for (const key of indexPaths) idByFolderCache.set(key.split('/')[0], key.split('/')[0]);
    if (fs.existsSync(mediaRoot)) {
      for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(mediaRoot, entry.name, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
          idByFolderCache.set(entry.name, manifest.id || entry.name);
        } catch {}
      }
    }
  }
  return idByFolderCache.get(folder) || folder;
}

const mediaTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const opusGalleryRoot = path.resolve(process.cwd(), '..', 'opus-gallery-static');

// Media manifests are re-read whenever this config reloads, keeping deletions in sync.
const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const mediaRoot = path.join(workspaceRoot, '素材库');
// 前端不留任何图片：候选素材目录只可能在项目之外（归档位置），项目内已经清空。
const websiteMediaRoot = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.join(workspaceRoot, 'anli_web_图片存档', '网站压缩素材'),
  path.join(workspaceRoot, 'anli_web', 'anli_web', 'public', '网站压缩素材'),
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate)) || null;
const aichongFolder = fs.existsSync(mediaRoot)
  ? fs.readdirSync(mediaRoot).find((name) => /^2026-01(?:-|_)\d{1,2}.*爱宠黑客松$/u.test(name))
  : null;
const aichongCaseRoot = aichongFolder ? path.join(mediaRoot, aichongFolder, '02_案例') : path.join(mediaRoot, '__missing_aichong__');

function websiteMediaPath(relativePath) {
  return relativePath
    .replace(/\.(jpe?g|png|webp|gif|bmp)$/i, '.jpg')
    .replace(/\.(mp4|mov|m4v|avi|mkv|webm)$/i, '.mp4');
}

const caseImagePattern = /\.(png|jpe?g|webp|gif)$/i;

// 案例作品链接的来源不止「## 案例网址」一种写法：
// 有的案例把网址直接写在说明.md 里（「网址：」「案例链接：」或干脆单起一行），
// 有的写在同一活动的「案例链接.md」等共用清单里。这里统一兜住，避免网站漏掉链接。
const WORK_URL_PATTERN = /https?:\/\/[^\s)\]>"'，。；]+/g;
const WORK_URL_DENY = [
  'fonts.googleapis.com', 'fonts.gstatic.com', 'opencollective.com', 'tidelift.com',
  'npmjs.com', 'unpkg.com', 'jsdelivr.net', 'w3.org', 'schema.org', 'github.com',
  'zhipin.com', 'beian.miit.gov.cn',
];

function cleanWorkUrl(value) {
  const url = String(value || '').replace(/[。，,;；]+$/u, '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return WORK_URL_DENY.some((blocked) => url.includes(blocked)) ? '' : url;
}

function firstWorkUrl(text) {
  for (const match of String(text || '').matchAll(WORK_URL_PATTERN)) {
    const url = cleanWorkUrl(match[0]);
    if (url) return url;
  }
  return '';
}

function normalizeCaseKey(value) {
  return String(value || '')
    .replace(/^\d{5}_/, '')
    .replace(/^首页\d{2}_/, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/[\s_\-—–:：·、,，。()（）\[\]【】]/g, '')
    .toLowerCase();
}

const caseLinkPoolCache = new Map();

// 活动级共用清单（案例链接.md 等）：一行一条「案例名：链接」。
function caseLinkPool(activityFolder) {
  if (caseLinkPoolCache.has(activityFolder)) return caseLinkPoolCache.get(activityFolder);
  const pool = new Map();
  const activityRoot = path.join(mediaRoot, activityFolder);
  if (fs.existsSync(activityRoot)) {
    for (const relative of discoverFiles(activityRoot)) {
      const base = path.basename(relative);
      if (!/\.(md|txt|csv)$/i.test(relative)) continue;
      if (/^说明( \(\d+\))?\.md$/i.test(base)) continue;
      let text = '';
      try {
        text = fs.readFileSync(path.join(activityRoot, relative), 'utf8').replace(/^\uFEFF/, '');
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const raw = (line.match(/https?:\/\/[^\s)\]>"'，。；]+/) || [])[0];
        const url = cleanWorkUrl(raw);
        if (!url) continue;
        const label = line.slice(0, line.indexOf(raw))
          .replace(/^\s*[-*\d.#>|]+\s*/, '')
          .replace(/\[([^\]]+)\]\(.*/, '$1')
          .replace(/[：:|\-—–\s]+$/u, '')
          .trim();
        if (!label || label.length > 60) continue;
        const key = normalizeCaseKey(label);
        if (key && !pool.has(key)) pool.set(key, { url, file: `素材库/${activityFolder}/${relative}` });
      }
    }
  }
  caseLinkPoolCache.set(activityFolder, pool);
  return pool;
}

// 案例标题对不上时，用截图文件名当别名（例如「交易复盘」的截图叫 Deal Review移动端）。
function caseAliasKeys(folderName, caseDir) {
  const keys = [normalizeCaseKey(folderName)];
  const shotRoot = path.join(caseDir, '截图');
  if (fs.existsSync(shotRoot)) {
    for (const file of discoverFiles(shotRoot)) {
      if (!caseImagePattern.test(file)) continue;
      const base = path.basename(file, path.extname(file))
        .replace(/^\d{5}_/, '')
        .replace(/^主图[_-]?/u, '')
        .replace(/[_-]?(网页)?封面$/u, '')
        .replace(/[_-]?\d+$/, '');
      if (!base || /^[a-f\d]{16,}$/i.test(base) || base.startsWith('微信图片')) continue;
      keys.push(normalizeCaseKey(base));
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function sharedCaseLink(activityFolder, folderName, caseDir) {
  const pool = caseLinkPool(activityFolder);
  if (!pool.size) return null;
  for (const key of caseAliasKeys(folderName, caseDir)) {
    const hit = pool.get(key);
    if (hit) return hit;
  }
  return null;
}

function cleanCaseTitle(value) {
  return path.basename(value, path.extname(value))
    .replace(/^\d{5}_/, '')
    .replace(/^主图[_-]?/u, '')
    .replace(/[_-]?(网页)?封面$/u, '')
    .trim();
}

function readLooseCaseReferences(caseRoot) {
  const references = new Map();
  const markdownFiles = fs.existsSync(caseRoot)
    ? fs.readdirSync(caseRoot).filter((name) => /\.md$/i.test(name))
    : [];
  for (const markdownName of markdownFiles) {
    const lines = fs.readFileSync(path.join(caseRoot, markdownName), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    let currentTitle = '';
    let currentHref;
    for (const line of lines) {
      const heading = line.match(/^#{2,6}\s+(.+?)\s*$/u);
      if (heading) {
        currentTitle = heading[1].replace(/^[^：:]+[：:]\s*/u, '').trim();
        currentHref = undefined;
      }
      const url = line.match(/https?:\/\/[^\s\)\]>]+/u)?.[0];
      if (url) currentHref = url.replace(/[。，,;；]+$/u, '');
      for (const match of line.matchAll(/\[\[([^\]]+\.(?:png|jpe?g|webp|gif))\]\]/giu)) {
        const fileName = path.basename(match[1].replaceAll('/', path.sep).replaceAll('\\', path.sep));
        if (currentTitle) references.set(fileName.toLowerCase(), { title: currentTitle, href: currentHref });
      }
      if (url && currentTitle) {
        for (const [key, value] of references) {
          if (value.title === currentTitle && !value.href) references.set(key, { ...value, href: currentHref });
        }
      }
    }
  }
  return references;
}

function compressedCaseExists(activityFolder, relativePath) {
  const id = activityIdOfFolder(activityFolder);
  return indexPaths.has(id + '/' + websiteMediaPath(relativePath));
}

function readCaseMedia(activityFolder) {
  const caseRoot = path.join(mediaRoot, activityFolder, '02_案例');
  if (!fs.existsSync(caseRoot)) return [];
  const normalizedCases = fs.readdirSync(caseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^(?:首页\d{2}_.+|\d{5}_.+)/.test(entry.name))
    .map((entry) => {
      const folder = entry.name;
      const directory = path.join(caseRoot, folder);
      const readmePath = path.join(directory, '说明.md');
      const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8').replace(/^\uFEFF/, '') : '';
      const homeMatch = folder.match(/^首页(\d{2})_/);
      const title = folder.replace(/^首页\d{2}_/, '').replace(/^\d{5}_/, '').trim();
      // 作者在「## 案例网址」里明确写下的链接一律照用，不做噪声过滤（GitHub 仓库也可能是作品）；
      // 只有下面这些推断出来的来源才需要挡掉字体/npm/招聘网站之类的非作品链接。
      const declaredUrl = (readme.match(/## 案例网址\s+(https?:\/\/\S+)/)?.[1] || '').trim();
      const href = declaredUrl || firstWorkUrl(readme) || sharedCaseLink(activityFolder, folder, directory)?.url;
      const screenshotRoot = path.join(directory, '截图');
      const images = fs.existsSync(screenshotRoot) ? discoverFiles(screenshotRoot).filter((name) => caseImagePattern.test(name)) : [];
      // 首选主图；如果这一张在压缩素材里对不上（素材目录里常有 "主图 (2).png" 这类副本），
      // 就按顺序往后找第一张对得上的；全都对不上就不显示，绝不拿别的图顶上。
      const mainImageCandidates = images.filter((name) => /主图/u.test(path.basename(name)));
      if (!mainImageCandidates.length && images.length === 1) mainImageCandidates.push(images[0]);
      const relativePath = mainImageCandidates
        .map((name) => `02_案例/${folder}/截图/${name}`)
        .find((candidate) => compressedCaseExists(activityFolder, candidate)) || null;
      return relativePath && compressedCaseExists(activityFolder, relativePath)
        ? { folder, title, homeOrder: homeMatch ? Number(homeMatch[1]) : null, score: Number(folder.match(/(\d{5})_/)?.[1] || (homeMatch ? 10000 - Number(homeMatch[1]) : 0)), href, path: websiteMediaPath(relativePath), readme }
        : null;
    }).filter(Boolean);

  // Older activities may still contain one flat "案例素材" directory. Until
  // those source folders are normalized, use their existing file/link names;
  // never expose the generic parent directory as a case title.
  const references = readLooseCaseReferences(caseRoot);
  const looseCases = [];
  for (const entry of fs.readdirSync(caseRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || /^(?:首页\d{2}_.+|\d{5}_.+)/.test(entry.name)) continue;
    const directory = path.join(caseRoot, entry.name);
    for (const image of discoverFiles(directory).filter((name) => caseImagePattern.test(name))) {
      const fileName = path.basename(image);
      const reference = references.get(fileName.toLowerCase());
      const title = reference?.title || cleanCaseTitle(fileName);
      if (!title || title === '案例素材' || /^[a-f\d]{16,}$/i.test(title) || /^微信图片_/u.test(title)) continue;
      const relativePath = `02_案例/${entry.name}/${image}`;
      if (!compressedCaseExists(activityFolder, relativePath)) continue;
      looseCases.push({
        folder: `${entry.name}/${image}`,
        title,
        score: 8200,
        href: reference?.href,
        path: websiteMediaPath(relativePath),
      });
    }
  }

  const uniqueCases = new Map();
  for (const item of [...normalizedCases, ...looseCases]) {
    const current = uniqueCases.get(item.title);
    const itemIsPreferred = /(?:主图|封面)/u.test(path.basename(item.path));
    const currentIsPreferred = current && /(?:主图|封面)/u.test(path.basename(current.path));
    if (!current || (itemIsPreferred && !currentIsPreferred)) uniqueCases.set(item.title, item);
  }

  return [...uniqueCases.values()]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'));
}

function readActivityDirectories() {
  const directories = new Map();
  if (!fs.existsSync(mediaRoot)) return directories;
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(mediaRoot, entry.name);
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const content = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
    const manifest = JSON.parse(content);
    directories.set(manifest.id || entry.name, directory);
  }
  return directories;
}


function discoverFiles(root, current = root) {
  const result = [];
  if (!fs.existsSync(current)) return result;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...discoverFiles(root, full));
    else result.push(path.relative(root, full).replaceAll(path.sep, '/'));
  }
  return result;
}

function localMediaLibrary() {
  return {
    name: 'local-media-library',
    configureServer(server) {
      server.middlewares.use('/opus-gallery', (request, response, next) => {
        const relativePath = decodeURIComponent((request.url || '/').split('?')[0]).replace(/^\/+/, '');
        const filePath = path.resolve(opusGalleryRoot, relativePath);
        if (!filePath.startsWith(`${opusGalleryRoot}${path.sep}`)) return next();
        fs.stat(filePath, (error, stats) => {
          if (error || !stats.isFile()) return next();
          response.setHeader('Content-Type', mediaTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
          fs.createReadStream(filePath).pipe(response);
        });
      });
    },
  };
}

const virtualAichongCasesId = 'virtual:aichong-cases';
const resolvedVirtualAichongCasesId = `\0${virtualAichongCasesId}`;
const virtualCaseMediaId = 'virtual:case-media';
const resolvedVirtualCaseMediaId = `\0${virtualCaseMediaId}`;
const virtualActivityManifestsId = 'virtual:activity-manifests';
const resolvedVirtualActivityManifestsId = `\0${virtualActivityManifestsId}`;
const virtualSocialLinksId = 'virtual:social-links';
const resolvedVirtualSocialLinksId = `\0${virtualSocialLinksId}`;

function readActivityManifests() {
  const result = [];
  if (!fs.existsSync(mediaRoot)) return contentSnapshot.activityManifests;
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(mediaRoot, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
      result.push({
        id: manifest.id || entry.name,
        title: manifest.title || entry.name,
        folder: entry.name,
        date: manifest.date || '',
        place: manifest.place || manifest.venue || '',
        summary: manifest.summary || `${manifest.title || entry.name}活动资料与成员作品归档。`,
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      });
    } catch {}
  }
  return result;
}

function normalizeSocialUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

function fallbackSocialLabel(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'mp.weixin.qq.com') return '微信公众号相关链接';
    if (host === 'weixin.qq.com') return '视频号相关链接';
    if (host.endsWith('dutenews.com')) return '读特新闻报道';
    if (host.endsWith('sznews.com')) return '深圳新闻网报道';
    if (host.includes('airdrop')) return '活动资料链接';
    return '活动相关链接';
  } catch {
    return '活动相关链接';
  }
}

function cleanSocialLabel(value, url) {
  const markdown = value.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/);
  if (markdown) return markdown[1].trim();
  const before = value.slice(0, value.indexOf(url)).replace(/^\s*[-*]+\s*/, '').replace(/[：:]\s*$/, '').trim();
  return before || fallbackSocialLabel(url);
}

function readSocialLinks() {
  const result = {};
  if (!fs.existsSync(mediaRoot)) return contentSnapshot.socialLinks;
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(mediaRoot, entry.name);
    const manifestPath = path.join(directory, 'manifest.json');
    const linkPath = path.join(directory, '03_社交媒体', '活动相关链接.md');
    let id = entry.name;
    if (fs.existsSync(manifestPath)) {
      try { id = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')).id || id; } catch {}
    }
    const links = [];
    const seen = new Set();
    if (fs.existsSync(linkPath)) {
      for (const line of fs.readFileSync(linkPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        for (const match of line.matchAll(/https?:\/\/[^\s\)\]>]+/g)) {
          const href = match[0].replace(/[。，,;；]+$/, '');
          const key = normalizeSocialUrl(href);
          if (seen.has(key)) continue;
          seen.add(key);
          links.push({ label: cleanSocialLabel(line, href), href });
        }
      }
    }
    const labelTotals = links.reduce((totals, item) => totals.set(item.label, (totals.get(item.label) || 0) + 1), new Map());
    const labelIndexes = new Map();
    for (const item of links) {
      if ((labelTotals.get(item.label) || 0) < 2) continue;
      const index = (labelIndexes.get(item.label) || 0) + 1;
      labelIndexes.set(item.label, index);
      item.label = `${item.label} ${index}`;
    }
    result[id] = links;
    result[entry.name] = links;
  }
  return result;
}

function readAichongCases() {
  if (!fs.existsSync(mediaRoot)) return contentSnapshot.aichongCases;
  return aichongFolder ? readCaseMedia(aichongFolder) : [];
}

function currentCaseMedia() {
  if (!fs.existsSync(mediaRoot)) return contentSnapshot.caseMedia;
  const result = {};
  for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    result[entry.name] = readCaseMedia(entry.name);
    const manifestPath = path.join(mediaRoot, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
      if (manifest.id) result[manifest.id] = result[entry.name];
    }
  }
  return result;
}

function mediaLibraryIndex() {
  return {
    name: 'media-library-index',
    buildStart() {
      // Refresh the portable snapshot on the material owner's computer. Elsewhere
      // use the checked-in snapshot; never silently build an empty archive.
      const activityManifests = readActivityManifests();
      if (!activityManifests.length) throw new Error('活动资料为空，构建已停止');
      if (fs.existsSync(mediaRoot)) fs.writeFileSync('src/data/siteContent.snapshot.json', JSON.stringify({
        activityManifests, caseMedia: currentCaseMedia(), aichongCases: readAichongCases(), socialLinks: readSocialLinks(),
      }, null, 2) + '\n');
    },
    configureServer(server) {
      const manifestFiles = (fs.existsSync(mediaRoot) ? fs.readdirSync(mediaRoot, { withFileTypes: true }) : [])
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(mediaRoot, entry.name, 'manifest.json'));
      const watchTargets = [
        ...(websiteMediaRoot ? [websiteMediaRoot] : []),
        ...manifestFiles.filter((file) => fs.existsSync(file)),
      ];
      if (watchTargets.length) server.watcher.add(watchTargets);
      let timer;
      const refresh = (_event, filename) => {
        const absolute = path.resolve(filename);
        const insideWebsiteMedia = websiteMediaRoot
          ? absolute.startsWith(`${websiteMediaRoot}${path.sep}`)
          : false;
        if (!insideWebsiteMedia && !manifestFiles.includes(absolute)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const id of [resolvedVirtualActivityManifestsId, resolvedVirtualCaseMediaId, resolvedVirtualAichongCasesId, resolvedVirtualSocialLinksId]) {
            const module = server.moduleGraph.getModuleById(id);
            if (module) server.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: 'full-reload' });
        }, 300);
      };
      server.watcher.on('all', refresh);
      server.httpServer?.once('close', () => { clearTimeout(timer); server.watcher.off('all', refresh); });
    },
    resolveId(id) {
      if (id === virtualAichongCasesId) return resolvedVirtualAichongCasesId;
      if (id === virtualCaseMediaId) return resolvedVirtualCaseMediaId;
      if (id === virtualActivityManifestsId) return resolvedVirtualActivityManifestsId;
      if (id === virtualSocialLinksId) return resolvedVirtualSocialLinksId;
      return null;
    },
    load(id) {
      if (id === resolvedVirtualActivityManifestsId) return `export default ${JSON.stringify(readActivityManifests())};`;
      if (id === resolvedVirtualSocialLinksId) return `export default ${JSON.stringify(readSocialLinks())};`;
      if (id === resolvedVirtualAichongCasesId) return `export default ${JSON.stringify(readAichongCases())};`;
      if (id === resolvedVirtualCaseMediaId) {
        return `export default ${JSON.stringify(currentCaseMedia())};`;
      }
    },
  };
}

// 防止有人再把图片 import 进代码：构建后检查 HTML 里内联了多少 base64 图片，
// 超过上限直接让构建失败，避免前端体积悄悄回涨。
function guardBundledImages(limitBytes = 100 * 1024) {
  return {
    name: 'guard-bundled-images',
    apply: 'build',
    closeBundle() {
      if (process.env.CATALOG_BUILD) return;
      const output = path.resolve(process.cwd(), 'dist', 'index.html');
      if (!fs.existsSync(output)) return;
      const html = fs.readFileSync(output, 'utf8');
      const inline = html.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi) || [];
      const bytes = inline.reduce((total, item) => total + item.length, 0);
      const label = `${inline.length} 张，合计 ${(bytes / 1024).toFixed(1)} KB`;
      if (bytes <= limitBytes) { console.log(`[guard] 内联图片 ${label}，未超限`); return; }
      throw new Error(`构建中止：HTML 内联了 ${label}，超过 ${(limitBytes / 1024).toFixed(0)} KB 上限。图片请走云端链接，不要 import 进代码。`);
    },
  };
}

export default defineConfig({
  base: './',
  // Local previews serve media through middleware. Deploy builds can point this
  // at a prepared public directory containing only the selected activities.
  publicDir: process.env.VITE_PUBLIC_DIR || false,
  server: { proxy: { '/api': 'http://127.0.0.1:3001', '/logos': 'http://127.0.0.1:3001' } },
  plugins: [react(), mediaLibraryIndex(), localMediaLibrary(), viteSingleFile(), guardBundledImages()],
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

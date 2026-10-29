import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store.mjs';
import { saveLogo } from './logos.mjs';
import { respond } from './response.mjs';
import { renderEvent } from '../src/lib/renderEvent.js';

const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });

async function readBody(req, limit = 1024 * 1024) {
  if (Number(req.headers['content-length']) > limit) throw failure(413, '文件或请求过大');
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw failure(413, '文件或请求过大');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, '请使用 JSON 请求');
  try { return JSON.parse((await readBody(req)).toString()); }
  catch (error) { if (error.status) throw error; throw failure(400, '请求内容无效'); }
}

// Team writers are the BigApple deployment admins. Only they can resolve the shared `media`
// app with their own deployment credential, so that lookup is the membership check.
const DEPLOY_API = 'https://api.bigapple.work';
async function resolveTeamMember(headers) {
  const response = await fetch(`${DEPLOY_API}/api/apps/resolve`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'media' }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 426) throw failure(426, '「APP 部署专员」Skill 版本过旧，请在技能页更新后重试');
  if (!response.ok) return false;
  return Boolean((await response.json()).app);
}
const WRITER_HEADERS = ['x-bigapple-publisher-id', 'authorization', 'x-bigapple-skill-id', 'x-bigapple-skill-version'];

// A source is accepted only if it renders to a complete event under the same uid.
function renderSource(uid, source) {
  if (!/^[^/\\\u0000-\u001f]{1,120}$/.test(uid)) throw failure(400, '活动 uid 无效');
  if (!source || typeof source !== 'object' || source.uid !== uid || !source.record || typeof source.record !== 'object' || !Array.isArray(source.assets ?? [])) throw failure(400, '活动数据格式不对，或 uid 和地址不一致');
  let event;
  try { event = renderEvent(source); } catch { throw failure(400, '活动数据无法渲染'); }
  if (event.uid !== uid) throw failure(400, '活动 uid 和地址不一致');
  for (const key of ['id', 'partner', 'sourceDate']) if (typeof event[key] !== 'string' || !event[key].trim()) throw failure(400, `活动缺少 ${key}`);
  return event;
}
// Append: same-path entries are replaced, new ones added; everything else in the source stays.
const mergeByPath = (current = [], added = []) => [...current.filter((item) => !added.some((next) => next.path === item.path)), ...added];

export function createApplication({ events, dataDir, distDir, adminPassword, secureCookies = false, origin = '', storageUrl = '', storageToken = '', worksDir = path.join(distDir, '..', 'works'), isTeamMember = resolveTeamMember }) {
  if (!adminPassword || adminPassword.length < 4 || adminPassword.length > 512 || adminPassword === 'replace-with-a-long-private-password') throw new Error('请通过 ADMIN_PASSWORD 设置 4–512 位的管理员密码');
  if (!events.length) throw new Error('活动目录为空');
  const store = openStore(dataDir);
  try { store.syncCatalog(events); }
  catch (error) { store.close(); throw error; }
  async function activityBody(req) {
    try { return JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString()); }
    catch (error) { if (error.status) throw error; throw failure(400, '请求内容无效'); }
  }
  const teamCache = new Map(); const teamCacheMs = 10 * 60 * 1000;
  async function requireTeamMember(req) {
    const headers = Object.fromEntries(WRITER_HEADERS.map((name) => [name, req.headers[name]]).filter(([, value]) => typeof value === 'string' && value));
    if (headers.authorization?.startsWith('Bearer ') !== true || !headers['x-bigapple-publisher-id']) throw failure(401, '缺少 BigApple 部署身份');
    const key = digest(headers['x-bigapple-publisher-id'] + '\n' + headers.authorization);
    if ((teamCache.get(key) || 0) > Date.now()) return headers['x-bigapple-publisher-id'];
    if (!(await isTeamMember(headers))) throw failure(403, '你的 BigApple 身份不在团队部署白名单里，请联系查理加入');
    if (teamCache.size >= 200) teamCache.clear();
    teamCache.set(key, Date.now() + teamCacheMs);
    return headers['x-bigapple-publisher-id'];
  }
  const salt = crypto.randomBytes(16);
  const passwordHash = crypto.scryptSync(adminPassword, salt, 32);
  const sessions = new Map(); const attempts = new Map();
  const sessionMs = 8 * 60 * 60 * 1000;
  const cookieName = secureCookies ? '__Host-ba_admin' : 'ba_admin';
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const metadata = () => store.events().map((e) => ({ id: e.uid, title: e.partner, date: e.sourceDate }));
  const send = (res, status, data) => respond(res.req, res, status, 'application/json; charset=utf-8', JSON.stringify(data));
  const getSession = (req) => {
    const token = req.headers.cookie?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token) return null;
    const key = digest(token); const session = sessions.get(key);
    if (!session || session.expires < Date.now()) { sessions.delete(key); return null; }
    return { key, ...session };
  };
  function validate(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60) throw failure(400, '请填写 1–60 字的网站名称');
    if (typeof value.logoUrl !== 'string' || (value.logoUrl && !store.hasLogo(value.logoUrl))) throw failure(400, '请重新上传 Logo');
    const knownIds = new Set(store.events().map((e) => e.uid));
    if (!Array.isArray(value.activityIds) || !value.activityIds.length || value.activityIds.length > knownIds.size || value.activityIds.some((id) => !knownIds.has(id))) throw failure(400, '请至少选择一场有效活动；活动列表如有更新请刷新');
    return { name: value.name.trim(), logoUrl: value.logoUrl, activityIds: [...new Set(value.activityIds)].sort() };
  }
  function requireMutation(req) {
    if (req.headers['x-admin-request'] !== '1') throw failure(403, '请求校验失败');
    const requestOrigin = req.headers.origin;
    const allowedOrigin = origin || `${secureCookies ? 'https' : 'http'}://${req.headers.host}`;
    if (requestOrigin && requestOrigin !== allowedOrigin) throw failure(403, '请求来源不匹配');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw failure(403, '请求来源不匹配');
  }
  async function uploadLogo(req) {
    const bytes = await readBody(req, 2 * 1024 * 1024);
    if (req.headers['content-type'] !== 'image/png') throw failure(400, 'Logo 必须是有效 PNG 图片');
    const url = await saveLogo(bytes, { dataDir, secureCookies, storageUrl, storageToken });
    store.addLogo(url);
    return { url };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const method = req.method;
      if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: store.events().length > 0 });
      if (pathname === '/api/site' && method === 'GET') return send(res, 200, { brand: null, events: store.events() });
      const activityMatch = pathname.match(/^\/api\/activities\/([^/]+)$/);
      if (activityMatch && method === 'PUT') {
        const uid = decodeURIComponent(activityMatch[1]);
        const actor = await requireTeamMember(req);
        const body = await activityBody(req);
        const event = renderSource(uid, body?.source);
        const clash = store.events().find((e) => e.id === event.id && e.uid !== uid);
        if (clash) throw failure(409, `活动 id ${event.id} 已被「${clash.partner}」使用，请换一个 id`);
        const { created } = store.upsertActivity(body.source, actor);
        console.info('[api/activities] saved', { uid, actor, created });
        return send(res, created ? 201 : 200, { uid, created, activities: store.events().length });
      }
      if (activityMatch && method === 'PATCH') {
        const uid = decodeURIComponent(activityMatch[1]);
        const actor = await requireTeamMember(req);
        const body = await activityBody(req);
        const current = store.source(uid);
        if (!current) throw failure(404, '服务器上还没有这场活动，请用整场发布新增');
        if (current.detail) throw failure(409, '这场活动是旧格式，请先用完整整理目录整场更新一次');
        if (![body?.assets, body?.cases, body?.videos].some(Array.isArray)) throw failure(400, '没有要追加的素材');
        if ((body.assets || []).some((item) => item?.isCover === 1)) throw failure(400, '追加的照片不能带「封面」标记；要换封面请整场更新');
        const next = { ...current, record: { ...current.record, videos: mergeByPath(current.record.videos, body.videos || []) }, assets: mergeByPath(current.assets, body.assets || []), cases: mergeByPath(current.cases, body.cases || []) };
        renderSource(uid, next);
        store.upsertActivity(next, actor);
        console.info('[api/activities] appended', { uid, actor, assets: body.assets?.length || 0, cases: body.cases?.length || 0, videos: body.videos?.length || 0 });
        return send(res, 200, { uid, created: false, activities: store.events().length });
      }
      if (activityMatch && method === 'DELETE') {
        requireMutation(req);
        if (!getSession(req)) throw failure(401, '登录已过期，请重新登录');
        const uid = decodeURIComponent(activityMatch[1]);
        if (!store.deactivateActivity(uid, 'admin')) throw failure(404, '活动不存在');
        console.info('[api/activities] removed', { uid });
        return send(res, 200, { uid, activities: store.events().length });
      }
      const brandPage = pathname.match(/^\/api\/sites\/(\d+)\/page$/);
      if (brandPage && ['GET', 'HEAD'].includes(method)) {
        const record = store.get(brandPage[1]);
        if (!record) throw failure(404, '这个页面暂时不存在');
        const escape = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        const name = escape(record.name);
        const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
          .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${name}</title>`)
          .replace(/<meta name="description" content="[^"]*"\s*\/?>/i, () => `<meta name="description" content="${name}">`)
          .replace('</head>', '<meta name="brand-site" content="true"></head>');
        return respond(req, res, 200, 'text/html; charset=utf-8', html);
      }
      const publicMatch = pathname.match(/^\/api\/sites\/(\d+)$/);
      if (publicMatch && method === 'GET') {
        const record = store.get(publicMatch[1]);
        if (!record) throw failure(404, '这个页面暂时不存在');
        return send(res, 200, { brand: { name: record.name, logoUrl: record.logoUrl }, events: store.siteEvents(record.id) });
      }
      if (pathname.startsWith('/api/admin/')) {
        if (method !== 'GET') requireMutation(req);
        const session = getSession(req);
        if (pathname === '/api/admin/session' && method === 'GET') return send(res, 200, { authenticated: !!session });
        if (pathname === '/api/admin/login' && method === 'POST') {
          const key = req.socket.remoteAddress;
          const now = Date.now();
          for (const [id, state] of attempts) if (state.until <= now) attempts.delete(id);
          for (const [id, state] of sessions) if (state.expires <= now) sessions.delete(id);
          const state = attempts.get(key) || { count: 0, until: now + 10 * 60 * 1000 };
          if (state.count >= 8) throw failure(429, '尝试次数较多，请稍后再试');
          const { password } = await jsonBody(req);
          state.count += 1; attempts.set(key, state);
          if (typeof password !== 'string' || password.length > 512 || !crypto.timingSafeEqual(crypto.scryptSync(password, salt, 32), passwordHash)) throw failure(401, '管理员密码不正确');
          attempts.delete(key);
          if (session) sessions.delete(session.key);
          if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(digest(token), { expires: now + sessionMs });
          res.setHeader('Set-Cookie', cookie(token, sessionMs / 1000));
          return send(res, 200, { authenticated: true });
        }
        if (!session) throw failure(401, '登录已过期，请重新登录');
        if (pathname === '/api/admin/logout' && method === 'POST') {
          sessions.delete(session.key); res.setHeader('Set-Cookie', cookie('', 0));
          return send(res, 200, { ok: true });
        }
        if (pathname === '/api/admin/resellers' && method === 'GET') return send(res, 200, { resellers: store.list(), activities: metadata() });
        if (pathname === '/api/admin/logos' && method === 'POST') return send(res, 201, await uploadLogo(req));
        if (pathname === '/api/admin/resellers' && method === 'POST') {
          const body = await jsonBody(req); const value = validate(body);
          if (typeof body.clientKey !== 'string' || !/^[\w-]{16,80}$/.test(body.clientKey)) throw failure(400, '缺少请求编号');
          const result = store.create(value, body.clientKey, digest(JSON.stringify(value)));
          if (result.conflict) throw failure(409, '此新增操作已保存，请刷新后编辑');
          return send(res, 201, result.record);
        }
        const domainMatch = pathname.match(/^\/api\/admin\/resellers\/(\d+)\/domain$/);
        if (domainMatch && method === 'PUT') {
          if (!store.get(domainMatch[1])) throw failure(404, '代理商不存在');
          const { hostname } = await jsonBody(req);
          if (typeof hostname !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bigapple\.work$/.test(hostname) || ['media.bigapple.work', 'api.bigapple.work'].includes(hostname)) throw failure(400, '请填写已部署的代理商子域名');
          const record = store.bindDomain(domainMatch[1], hostname);
          if (!record) throw failure(409, '这个域名已绑定其他代理商');
          return send(res, 200, record);
        }
        const match = pathname.match(/^\/api\/admin\/resellers\/(\d+)$/);
        if (match && method === 'PUT') {
          const body = await jsonBody(req); const value = validate(body);
          if (!Number.isInteger(body.version)) throw failure(400, '缺少版本号');
          if (!store.get(match[1])) throw failure(404, '代理商不存在');
          const updated = store.update(match[1], value, body.version);
          if (!updated) throw failure(409, '配置已在其他窗口更新，请刷新后再编辑');
          return send(res, 200, updated);
        }
        throw failure(404, '接口不存在');
      }
      if (pathname.startsWith('/api/')) throw failure(404, '接口不存在');
      if (!['GET', 'HEAD'].includes(method)) throw failure(405, '不支持的操作');
      const oldLink = pathname.match(/^\/(\d+)(\/.*)?$/);
      if (oldLink) {
        const record = store.get(oldLink[1]);
        if (record?.publicUrl) {
          res.writeHead(302, { Location: record.publicUrl + (oldLink[2] || '/') + new URL(req.url, 'http://localhost').search });
          return res.end();
        }
      }
      // Archived single-file work pages (works/<slug>/index.html). The sandbox gives them an opaque origin,
      // so their scripts cannot call this site's admin APIs with the session cookie.
      const work = pathname.match(/^\/works\/([a-z0-9-]+)\/?$/);
      if (work) {
        const file = path.join(worksDir, work[1], 'index.html');
        if (!fs.existsSync(file)) throw failure(404, '作品不存在');
        res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads');
        return respond(req, res, 200, 'text/html; charset=utf-8', fs.readFileSync(file));
      }
      if (/^\/logos\/[a-f0-9]{64}\.png$/.test(pathname)) {
        const file = path.join(dataDir, 'logos', path.basename(pathname));
        if (!fs.existsSync(file)) throw failure(404, '图片不存在');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
        return res.end(method === 'HEAD' ? undefined : fs.readFileSync(file));
      }
      // Single-file Vite output. No filesystem path is derived from the request.
      const html = fs.readFileSync(path.join(distDir, 'index.html'));
      respond(req, res, 200, 'text/html; charset=utf-8', html);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : '操作未完成，请稍后重试' });
      else res.end();
      if (!error.status) console.error('Request failed:', error.message);
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  server.on('close', () => store.close());
  return server;
}

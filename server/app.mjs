import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store.mjs';

const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

export function createApplication({ events, dataDir, distDir, adminPassword, secureCookies = false, origin = '', storageUrl = '', storageToken = '' }) {
  if (!adminPassword || adminPassword.length < 12 || adminPassword === 'replace-with-a-long-private-password') throw new Error('请通过 ADMIN_PASSWORD 设置至少 12 位的管理员密码');
  if (!events.length) throw new Error('活动目录为空');
  const store = openStore(dataDir);
  const knownIds = new Set(events.map((e) => e.uid));
  const salt = crypto.randomBytes(16);
  const passwordHash = crypto.scryptSync(adminPassword, salt, 32);
  const sessions = new Map(); const attempts = new Map();
  const sessionMs = 8 * 60 * 60 * 1000;
  const cookieName = secureCookies ? '__Host-ba_admin' : 'ba_admin';
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const metadata = events.map((e) => ({ id: e.uid, title: e.partner, date: e.sourceDate }));
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
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
    if (!Array.isArray(value.activityIds) || !value.activityIds.length || value.activityIds.length > events.length || value.activityIds.some((id) => !knownIds.has(id))) throw failure(400, '请至少选择一场有效活动；活动列表如有更新请刷新');
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
    if (req.headers['content-type'] !== 'image/png' || bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw failure(400, 'Logo 必须是有效 PNG 图片');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 1024 || height > 1024) throw failure(400, 'Logo 尺寸超出限制');
    const file = `${digest(bytes)}.png`;
    let url;
    if (storageUrl && storageToken) {
      const response = await fetch(`${storageUrl.replace(/\/$/, '')}/public-objects/logos/${file}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${storageToken}`, 'Content-Type': 'image/png' }, body: bytes,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw failure(502, 'Logo 上传失败，请重试');
      const result = await response.json();
      url = result.publicUrl;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw failure(502, '存储服务未返回有效图片地址');
    } else {
      if (secureCookies) throw failure(503, '尚未配置 Logo 对象存储');
      fs.mkdirSync(path.join(dataDir, 'logos'), { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'logos', file), bytes);
      url = `/logos/${file}`;
    }
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
      if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
      if (pathname === '/api/site' && method === 'GET') return send(res, 200, { brand: null, events });
      const publicMatch = pathname.match(/^\/api\/sites\/(\d+)$/);
      if (publicMatch && method === 'GET') {
        const record = store.get(publicMatch[1]);
        if (!record) throw failure(404, '这个页面暂时不存在');
        const selected = new Set(record.activityIds);
        return send(res, 200, { brand: { name: record.name, logoUrl: record.logoUrl }, events: events.filter((e) => selected.has(e.uid)) });
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
        if (pathname === '/api/admin/resellers' && method === 'GET') return send(res, 200, { resellers: store.list(), activities: metadata });
        if (pathname === '/api/admin/logos' && method === 'POST') return send(res, 201, await uploadLogo(req));
        if (pathname === '/api/admin/resellers' && method === 'POST') {
          const body = await jsonBody(req); const value = validate(body);
          if (typeof body.clientKey !== 'string' || !/^[\w-]{16,80}$/.test(body.clientKey)) throw failure(400, '缺少请求编号');
          const result = store.create(value, body.clientKey, digest(JSON.stringify(value)));
          if (result.conflict) throw failure(409, '此新增操作已保存，请刷新后编辑');
          return send(res, 201, result.record);
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
      if (/^\/logos\/[a-f0-9]{64}\.png$/.test(pathname)) {
        const file = path.join(dataDir, 'logos', path.basename(pathname));
        if (!fs.existsSync(file)) throw failure(404, '图片不存在');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
        return res.end(method === 'HEAD' ? undefined : fs.readFileSync(file));
      }
      // Single-file Vite output. No filesystem path is derived from the request.
      const html = fs.readFileSync(path.join(distDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : html);
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

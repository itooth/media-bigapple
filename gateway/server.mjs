import http from 'node:http';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { respond } from '../server/response.mjs';

// A fixed public entrance: no catalog, database, credentials or frontend copy.
export function createGateway({ origin, resellerId, timeoutMs = 20000 }) {
  const upstream = new URL(origin);
  if (!/^\d+$/.test(String(resellerId)) || !['http:', 'https:'].includes(upstream.protocol) || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) throw new Error('Invalid gateway configuration');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const errorPage = (status, message) => respond(req, res, status, 'text/html; charset=utf-8', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面提示</title><body><p>${message}</p><a href="/">返回首页</a></body></html>`);
    try {
      const pathname = new URL(req.url, 'http://gateway.local').pathname;
      if (!['GET', 'HEAD'].includes(req.method)) return errorPage(405, '不支持的操作。');
      if (pathname === '/api/health') return respond(req, res, 200, 'application/json', '{"ok":true}');
      let target, expectedType;
      if (pathname === '/api/site') {
        target = `/api/sites/${resellerId}`; expectedType = 'application/json';
      } else if (/^\/logos\/[a-f0-9]{64}\.png$/.test(pathname)) {
        target = pathname; expectedType = 'image/png';
      } else if (['/', '/index.html'].includes(pathname) || /^\/(?:events\/[^/]+(?:\/(?:gallery|production-gallery))?|filter\/[^/]+)\/?$/.test(pathname)) {
        target = `/api/sites/${resellerId}/page`; expectedType = 'text/html';
      } else return errorPage(404, '这个页面暂时不存在。');
      // Never forward cookies, authorization, user-supplied target IDs or headers.
      const response = await fetch(new URL(target, upstream), { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return errorPage(response.status === 404 ? 404 : 502, '页面暂不可用，请稍后刷新。');
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith(expectedType)) throw new Error('Unexpected upstream response');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (expectedType === 'text/html' && !bytes.includes(Buffer.from('<meta name="brand-site" content="true">'))) throw new Error('Missing branded page marker');
      respond(req, res, 200, type, bytes);
    } catch { if (!res.headersSent) errorPage(502, '页面暂不可用，请稍后刷新。'); else res.end(); }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
  const server = createGateway(config);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Brand gateway ready'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}

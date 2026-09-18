import { gzipSync } from 'node:zlib';

export function respond(req, res, status, contentType, body) {
  let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some((part) => {
    const [encoding, ...params] = part.trim().split(';');
    return encoding === 'gzip' && !params.some((param) => /^\s*q=0(?:\.0*)?\s*$/.test(param));
  });
  res.setHeader('Vary', 'Accept-Encoding');
  if (bytes.length > 2048 && acceptsGzip && /json|html/.test(contentType)) {
    bytes = gzipSync(bytes); res.setHeader('Content-Encoding', 'gzip');
  }
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.length });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

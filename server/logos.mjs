import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const failure = (status, message) => Object.assign(new Error(message), { status });
export function validateLogo(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length > 2 * 1024 * 1024) throw failure(413, 'Logo 文件过大');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw failure(400, 'Logo 必须是有效 PNG 图片');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) throw failure(400, 'Logo 尺寸超出限制');
}

export async function saveLogo(bytes, { dataDir, secureCookies = false, storageUrl = '', storageToken = '' }) {
  validateLogo(bytes);
  const file = `${crypto.createHash('sha256').update(bytes).digest('hex')}.png`;
  if (storageUrl && storageToken) {
    const response = await fetch(`${storageUrl.replace(/\/$/, '')}/public-objects/logos/${file}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${storageToken}`, 'Content-Type': 'image/png' }, body: bytes,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw failure(502, 'Logo 上传失败，请重试');
    const { publicUrl } = await response.json();
    if (typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) throw failure(502, '存储服务未返回有效图片地址');
    return publicUrl;
  }
  if (secureCookies) throw failure(503, '尚未配置 Logo 对象存储');
  fs.mkdirSync(path.join(dataDir, 'logos'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'logos', file), bytes);
  return `/logos/${file}`;
}

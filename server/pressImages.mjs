import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const failure = (status, message) => Object.assign(new Error(message), { status });
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageKind(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

export function validateLogo(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length > 2 * 1024 * 1024) throw failure(413, 'Logo 文件过大');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw failure(400, 'Logo 必须是有效 PNG 图片');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) throw failure(400, 'Logo 尺寸超出限制');
}

/**
 * 报道截图：PNG / JPEG / WebP，单张 ≤ 5 MB。
 * 和 Logo 共用同一套对象存储通路，前端只拿到一个 https URL，不接触存储凭证。
 */
export function validatePressImage(bytes) {
  if (bytes.length > 5 * 1024 * 1024) throw failure(413, '报道截图不能超过 5 MB');
  if (bytes.length < 32 || !imageKind(bytes)) throw failure(400, '报道截图必须是 PNG、JPEG 或 WebP 图片');
  return imageKind(bytes);
}

export async function savePressImage(bytes, { dataDir, secureCookies = false, storageUrl = '', storageToken = '' }) {
  const ext = validatePressImage(bytes);
  const file = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  if (storageUrl && storageToken) {
    const response = await fetch(`${storageUrl.replace(/\/$/, '')}/public-objects/press/${file}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${storageToken}`, 'Content-Type': contentType }, body: bytes,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw failure(502, '报道截图上传失败，请重试');
    const { publicUrl } = await response.json();
    if (typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) throw failure(502, '存储服务未返回有效图片地址');
    return publicUrl;
  }
  if (secureCookies) throw failure(503, '尚未配置报道截图的对象存储');
  fs.mkdirSync(path.join(dataDir, 'press'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'press', file), bytes);
  return `/press/${file}`;
}

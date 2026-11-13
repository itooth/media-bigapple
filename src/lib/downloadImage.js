const extensions = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
};
const cleanName = (value) => String(value || '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
  .replace(/\.(jpe?g|png|webp|gif|avif|bmp|svg|ico)$/i, '').trim().replace(/[. ]+$/g, '');

async function imageSignature(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const starts = (...prefix) => prefix.every((byte, i) => bytes[i] === byte);
  const text = new TextDecoder().decode(bytes);
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (/^GIF8[79]a/.test(text)) return 'gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp';
  if (text.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text.slice(8, 12))) return 'avif';
  if (starts(0x42, 0x4d)) return 'bmp';
  if (starts(0, 0, 1, 0)) return 'ico';
  return '';
}

export async function fetchImageDownload(item, { label, index = 0, count = 1, signal } = {}) {
  signal?.throwIfAborted();
  // Displaying an <img> can cache a response without CORS headers. Refresh it for fetch.
  const response = await fetch(item.image, { signal, cache: 'reload' });
  if (!response.ok) throw new Error('图片暂不可下载');
  const blob = await response.blob();
  signal?.throwIfAborted();
  const type = blob.type.split(';')[0].toLowerCase();
  const urlExtension = new URL(item.image, 'https://local.invalid').pathname.match(/\.(jpe?g|png|webp|gif|avif|bmp|svg|ico)$/i)?.[1]?.toLowerCase();
  // Some historical JPEGs were uploaded with both a .png key and image/png metadata.
  const extension = await imageSignature(blob) || extensions[type] || ((!type || type === 'application/octet-stream') && urlExtension);
  signal?.throwIfAborted();
  if (!blob.size || !extension) throw new Error('未取得有效图片');
  const title = cleanName(item.title || item.caption || item.alt);
  const context = cleanName(label);
  const name = [...new Set([context, title].filter(Boolean))].join('-').slice(0, 120) || '图片';
  const sequence = count > 1 ? `-${String(index + 1).padStart(3, '0')}` : '';
  const mime = Object.keys(extensions).find((key) => extensions[key] === extension) || blob.type;
  return { blob: blob.slice(0, blob.size, mime), filename: `${name}${sequence}.${extension}` };
}

export function saveImageDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // Leave time for the browser to consume the download before releasing its bytes.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

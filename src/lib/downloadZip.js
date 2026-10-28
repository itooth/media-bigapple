const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes, crc = 0xffffffff) => { for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return crc; };
// STORE entries preserve already compressed media. ZIP headers use UTF-8 names.
export function zipStore(entries) {
  if (entries.length > 65535) throw new Error('素材过多，请分别保存');
  const parts = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46));
    if (name.length > 65535 || offset + entry.size + name.length + 30 >= 0xffffffff) throw new Error('素材过大，请分别保存');
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x800, true); local.setUint16(12, 33, true);
    local.setUint32(14, entry.crc, true); local.setUint32(18, entry.size, true); local.setUint32(22, entry.size, true); local.setUint16(26, name.length, true);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x800, true); central.setUint16(14, 33, true);
    central.setUint32(16, entry.crc, true); central.setUint32(20, entry.size, true); central.setUint32(24, entry.size, true); central.setUint16(28, name.length, true); central.setUint32(42, offset, true);
    parts.push(local.buffer, name, ...entry.chunks); directory.push(central.buffer, name); offset += 30 + name.length + entry.size;
  }
  const size = directory.reduce((sum, part) => sum + part.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  if (size + offset >= 0xffffffff) throw new Error('素材过大，请分别保存');
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.buffer], { type: 'application/zip' });
}
export async function downloadZip(items, notes, { signal, onProgress = () => {} } = {}) {
  const entries = []; let total = 0;
  for (const [index, item] of items.entries()) {
    signal?.throwIfAborted(); onProgress(Math.floor(index / items.length * 100));
    const request = new AbortController(); let timer;
    const abort = () => request.abort(); signal?.addEventListener('abort', abort, { once: true });
    const arm = () => { clearTimeout(timer); timer = setTimeout(abort, 60000); }; arm();
    try {
      // Image/video display may have populated a non-CORS browser cache entry.
      // Request a fresh CORS response instead of reusing that entry.
      const response = await fetch(item.url, { signal: request.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('素材暂不可下载');
      const reader = response.body.getReader(), chunks = []; let size = 0, crc = 0xffffffff;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        signal?.throwIfAborted(); arm(); total += value.length;
        if (total >= 0xffff0000) { request.abort(); throw new Error('素材过大，请分别保存'); }
        chunks.push(value); size += value.length; crc = crc32(value, crc);
      }
      if (!size) throw new Error('素材为空');
      entries.push({ name: item.name, chunks, size, crc: (crc ^ 0xffffffff) >>> 0 });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  signal?.throwIfAborted(); const bytes = encoder.encode(notes);
  entries.push({ name: '说明与网站链接.txt', chunks: [bytes], size: bytes.length, crc: (crc32(bytes) ^ 0xffffffff) >>> 0 });
  onProgress(100); return zipStore(entries);
}

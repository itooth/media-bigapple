/**
 * 读图片像素尺寸，用来识别「1×1 白图」这类压缩坏掉的占位图。
 *
 * 为什么需要：压缩那一步会产出 631 字节的 1×1 白图（文件名正常、能打开），
 * 一旦传上云端就会在页面上显示成一个个白方块。上传前必须先把它们挡掉。
 * 只解析文件头，不依赖任何第三方库，也不解码整张图。
 */
import fs from 'node:fs';

/** @returns {{width:number,height:number}|null} 认不出来时返回 null（不拦） */
export function imageDimensions(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(32);
    const read = fs.readSync(fd, head, 0, 32, 0);
    if (read < 16) return null;

    // PNG: 固定偏移 16 起是 IHDR 的宽高
    if (head.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    // JPEG: 逐个 marker 找到 SOFn，宽高在 SOFn 段里
    if (head[0] === 0xff && head[1] === 0xd8) {
      const buffer = fs.readFileSync(filePath);
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
      return null;
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** 占位图判定：任一边 ≤ 2 像素 */
export function isPlaceholderImage(filePath) {
  const size = imageDimensions(filePath);
  if (!size) return false;
  return size.width <= 2 || size.height <= 2;
}

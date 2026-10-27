import { useEffect, useRef } from 'react';
export default function StoryViewer({ items, index, onChange, onClose, label }) {
  const dialog = useRef(null), start = useRef(null), item = items[index], video = !!item?.src && !item?.image;
  useEffect(() => {
    const node = dialog.current, prior = document.activeElement, overflow = document.body.style.overflow;
    node.showModal(); document.body.style.overflow = 'hidden';
    return () => { node.close(); document.body.style.overflow = overflow; prior?.focus?.({ preventScroll: true }); };
  }, []);
  const move = (step) => { if (!video && items.length > 1) onChange((index + step + items.length) % items.length); };
  return <dialog ref={dialog} className="story-viewer" aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}
    onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); move(1); } }}>
    <div className="story-viewer-bar"><div><small>{label} · {index + 1} / {items.length}</small><h2>{item.title || item.caption || item.alt}</h2></div><div>{!video && <a href={item.image} download target="_blank" rel="noreferrer">保存图片 ↓</a>}<button type="button" onClick={onClose} aria-label="关闭查看">×</button></div></div>
    <div className="story-viewer-content" onPointerDown={(e) => { if (e.pointerType !== 'mouse') start.current = [e.clientX, e.clientY]; }} onPointerCancel={() => { start.current = null; }} onPointerUp={(e) => {
      if (!start.current) return; const [x, y] = start.current; start.current = null;
      if (Math.abs(e.clientX - x) > 40 && Math.abs(e.clientX - x) > Math.abs(e.clientY - y) * 1.3) move(e.clientX < x ? 1 : -1);
    }}>
      {video ? <video key={item.src} src={item.src} poster={item.poster || undefined} controls playsInline preload="metadata" /> : <img src={item.image} alt={item.alt || item.caption || ''} />}
      {!video && items.length > 1 && <><button className="story-viewer-prev" onClick={() => move(-1)} aria-label="上一张">‹</button><button className="story-viewer-next" onClick={() => move(1)} aria-label="下一张">›</button></>}
    </div><p className="story-viewer-tip">{video ? '点击播放 · Esc 关闭' : '← → 或左右滑动切换 · Esc 关闭'}</p>
  </dialog>;
}

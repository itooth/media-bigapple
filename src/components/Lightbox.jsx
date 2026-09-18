import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';
import IconButton from './IconButton.jsx';

export default function Lightbox({ items, index, onChange, onClose }) {
  const item = index === null ? null : items[index];

  useEffect(() => {
    if (!item) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && index > 0) onChange(index - 1);
      if (event.key === 'ArrowRight' && index < items.length - 1) onChange(index + 1);
    };
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [index, item, items.length, onChange, onClose]);

  if (!item) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`图片预览 ${index + 1} / ${items.length}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <IconButton className="lightbox-close" label="关闭图片预览" onClick={onClose}><X /></IconButton>
      <IconButton className="lightbox-prev" label="上一张图片" disabled={index === 0} onClick={() => onChange(index - 1)}><ChevronLeft /></IconButton>
      <figure className="lightbox-figure">
        <img src={item.image} alt={item.alt} style={{ objectPosition: item.position }} />
        <figcaption><span>{item.caption}</span><small>{index + 1} / {items.length}</small></figcaption>
      </figure>
      <IconButton className="lightbox-next" label="下一张图片" disabled={index === items.length - 1} onClick={() => onChange(index + 1)}><ChevronRight /></IconButton>
    </div>
  );
}

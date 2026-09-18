import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import IconButton from './IconButton.jsx';

export default function Carousel({ items, label, renderItem }) {
  const railRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState({ start: true, end: false, index: 0 });

  const updatePosition = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const firstCard = rail.firstElementChild;
    const step = firstCard ? firstCard.getBoundingClientRect().width + 20 : rail.clientWidth;
    setPosition({
      start: rail.scrollLeft <= 2,
      end: rail.scrollLeft >= max - 2,
      index: Math.min(items.length - 1, Math.round(rail.scrollLeft / step)),
    });
  }, [items.length]);

  const move = useCallback((direction) => {
    const rail = railRef.current;
    const card = rail?.firstElementChild;
    if (!rail || !card) return;
    const amount = card.getBoundingClientRect().width + 20;
    rail.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    updatePosition();
    rail.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition);
    return () => {
      rail.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    if (paused || items.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => {
      const rail = railRef.current;
      if (!rail) return;
      if (rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2) rail.scrollTo({ left: 0, behavior: 'smooth' });
      else move(1);
    }, 5600);
    return () => window.clearInterval(timer);
  }, [items.length, move, paused]);

  return (
    <div className="carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="carousel-rail" ref={railRef} aria-label={label} tabIndex="0">
        {items.map((item, index) => renderItem(item, index))}
      </div>
      <IconButton className="carousel-arrow carousel-arrow-left" label="查看上一项" disabled={position.start} onClick={() => move(-1)}>
        <ChevronLeft aria-hidden="true" />
      </IconButton>
      <IconButton className="carousel-arrow carousel-arrow-right" label="查看下一项" disabled={position.end} onClick={() => move(1)}>
        <ChevronRight aria-hidden="true" />
      </IconButton>
      <div className="carousel-dots" aria-hidden="true">
        {items.map((item, index) => <span key={item.id} className={index === position.index ? 'is-active' : ''} />)}
      </div>
    </div>
  );
}

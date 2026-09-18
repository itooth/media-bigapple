import { useEffect, useMemo, useRef, useState } from 'react';

const ratioOf = (item, dimensions) => dimensions[item.id]?.src === item.image ? dimensions[item.id].ratio : 1.5;

function buildRows(items, dimensions, width, targetHeight, gap) {
  if (!width) return [];
  const rows = [];
  let current = [];
  let ratioSum = 0;
  const flush = (fillWidth) => {
    if (!current.length) return;
    const available = width - gap * (current.length - 1);
    const fittedHeight = available / ratioSum;
    // A short final row must stay at the normal card height and align left.
    // Only a row with enough content is justified to the full container width.
    const height = fillWidth ? fittedHeight : Math.min(targetHeight, fittedHeight);
    rows.push({ items: current, height });
    current = [];
    ratioSum = 0;
  };

  items.forEach((item) => {
    const ratio = ratioOf(item, dimensions);
    current.push(item);
    ratioSum += ratio;
    const projected = ratioSum * targetHeight + gap * (current.length - 1);
    if (current.length >= 2 && projected >= width) flush(true);
  });
  flush(false);
  return rows;
}

export default function JustifiedGallery({ items, label, targetHeight = 240, onOpen, renderCaption, renderOverlay, fitToWidth = true, multiRow = false, firstRowOnly = false, onVisibleCountChange }) {
  const rootRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [dimensions, setDimensions] = useState({});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const update = () => setWidth(root.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    items.forEach((item) => {
      if (dimensions[item.id]?.src === item.image) return;
      const image = new Image();
      image.onload = () => {
        if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
        setDimensions((current) => ({
          ...current,
          [item.id]: { src: item.image, ratio: image.naturalWidth / image.naturalHeight },
        }));
      };
      image.src = item.image;
    });
    return () => { cancelled = true; };
  }, [dimensions, items]);

  const row = useMemo(() => {
    const gap = 12;
    const ratioSum = items.reduce((sum, item) => sum + ratioOf(item, dimensions), 0);
    const naturalHeight = (width - gap * Math.max(items.length - 1, 0)) / ratioSum;
    // Never enlarge a sparse strip just to consume the entire row. This keeps
    // one case (or a few cases) at the same visual size as a populated row.
    const height = fitToWidth ? Math.max(1, Math.min(targetHeight, naturalHeight)) : targetHeight;
    return { height, items };
  }, [dimensions, fitToWidth, items, targetHeight, width]);

  const rows = useMemo(() => {
    if (!multiRow && !firstRowOnly) return [row];
    const calculated = buildRows(items, dimensions, width, targetHeight, 12);
    return firstRowOnly ? calculated.slice(0, 1) : calculated;
  }, [dimensions, items, multiRow, firstRowOnly, row, targetHeight, width]);
  const visibleCount = rows.reduce((count, current) => count + current.items.length, 0);
  useEffect(() => { onVisibleCountChange?.(visibleCount); }, [onVisibleCountChange, visibleCount]);
  const captionHeight = renderCaption ? 48 : 0;

  const registerImage = (item, event) => {
    const image = event.currentTarget;
    if (!image.naturalWidth || !image.naturalHeight) return;
    setDimensions((current) => ({
      ...current,
      [item.id]: { src: item.image, ratio: image.naturalWidth / image.naturalHeight },
    }));
  };

  return (
    <div className="justified-gallery" ref={rootRef} aria-label={label}>
      {rows.map((currentRow, rowIndex) => <div
        className={`justified-row ${multiRow ? 'justified-row-multiple' : 'justified-row-single'}`}
        style={{ height: currentRow.height + captionHeight }}
        key={rowIndex}
      >
        {currentRow.items.map((item) => (
          <div
            className="justified-card"
            style={{
              width: `${ratioOf(item, dimensions) * currentRow.height}px`,
              height: currentRow.height + captionHeight,
            }}
            key={item.id}
          >
            <button className="justified-item" style={{ height: currentRow.height }} type="button" onClick={() => onOpen(item)}>
              <img src={item.image} alt={item.alt} onLoad={(event) => registerImage(item, event)} loading="lazy" />
              {renderOverlay ? renderOverlay(item) : null}
            </button>
            {renderCaption ? renderCaption(item) : null}
          </div>
        ))}
        </div>)}
    </div>
  );
}

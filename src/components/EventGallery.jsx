import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import Lightbox from './Lightbox.jsx';
import VideoStrip from './VideoStrip.jsx';
import JustifiedGallery from './JustifiedGallery.jsx';

export default function EventGallery({ event, onBack, type = 'activity' }) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const items = type === 'production' ? event.detail.productionGallery : event.detail.gallery;
  const heading = type === 'production' ? 'BigApple 用户案例' : '活动剪影';
  return (
    <main className="event-gallery shell">
      <header className="gallery-header">
        <button className="back-link" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> 返回活动</button>
        <p>{event.detail.date} · {event.detail.city}</p>
        <h1>{event.detail.title}</h1>
        <span>{heading} · {items.length} 项</span>
      </header>
      <JustifiedGallery
        items={items}
        label={heading}
        targetHeight={220}
        multiRow
        onOpen={(item) => setLightboxIndex(items.indexOf(item))}
        renderCaption={type === 'production' ? (item) => (
          <div className="justified-caption">
            <h3>{item.title}</h3>
            {item.href ? <a href={item.href} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />打开作品</a> : null}
          </div>
        ) : undefined}
      />
      <VideoStrip videos={type === 'production' ? event.detail.productionVideos : event.detail.videos} label={heading} />
      <Lightbox items={items} index={lightboxIndex} onChange={setLightboxIndex} onClose={closeLightbox} />
    </main>
  );
}

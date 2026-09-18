import { ArrowLeft, ArrowRight, ExternalLink, Link2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import JustifiedGallery from './JustifiedGallery.jsx';
import Lightbox from './Lightbox.jsx';

function SectionHeading({ children, onMore }) {
  return (
    <div className="detail-section-heading">
      <h2>{children}</h2>
      {onMore ? <button type="button" className="more-link" onClick={onMore}>更多 <ArrowRight aria-hidden="true" /></button> : null}
    </div>
  );
}

export default function EventDetail({ event, onGallery, onProductionGallery, onMediaNotice, onBack }) {
  const { detail } = event;
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [productionLightboxIndex, setProductionLightboxIndex] = useState(null);
  const [visibleHighlights, setVisibleHighlights] = useState(detail.highlights.length);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  return (
    <main className="event-detail shell">
      <button className="back-link detail-back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> 返回活动列表
      </button>
      <header className="detail-intro">
        <h1>{detail.title}</h1>
        <div className="detail-info-row">
          <p className="detail-summary detail-summary-line">
            <span className="detail-inline-meta"><span>{detail.date}</span><span>{detail.city}</span></span>
            <span className="detail-inline-summary">{detail.summary}</span>
          </p>
        </div>
      </header>

      <section className="detail-section" aria-labelledby="highlights-title">
        <SectionHeading onMore={detail.gallery.length > visibleHighlights ? onGallery : null}><span id="highlights-title">活动剪影</span></SectionHeading>
        <JustifiedGallery
          items={detail.highlights}
          label="活动剪影精选"
          targetHeight={250}
          fitToWidth
          firstRowOnly
          onVisibleCountChange={setVisibleHighlights}
          onOpen={(item) => setLightboxIndex(detail.highlights.indexOf(item))}
        />
      </section>

      {detail.productions.length > 0 ? (
        <section className="detail-section production-section" aria-labelledby="production-title">
          <SectionHeading onMore={detail.productionGallery.length > detail.productions.length ? onProductionGallery : null}><span id="production-title">用户案例</span></SectionHeading>
          <JustifiedGallery
            items={detail.productions}
            label="作品精选"
            targetHeight={225}
            fitToWidth
            onOpen={(item) => setProductionLightboxIndex(detail.productions.indexOf(item))}
            renderOverlay={(item) => item.href ? (
              <a className="production-external-button" href={item.href} target="_blank" rel="noreferrer" aria-label={`打开${item.title}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
            renderCaption={(item) => (
              <div className="justified-caption">
                <h3>{item.title}</h3>
                {item.href ? <a href={item.href} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />打开作品</a> : null}
              </div>
            )}
          />
        </section>
      ) : null}

      <section className="media-section" aria-labelledby="media-title">
        <h2 id="media-title">社媒报道</h2>
        {detail.media.length > 0 ? (
          <div className="media-grid">
            {detail.media.map((item) => (
              <a className="media-card" href={item.href} target="_blank" rel="noreferrer" key={item.id} title={item.label}>
                <Link2 aria-hidden="true" />
                <span>{item.label}</span>
                <ExternalLink className="media-action-icon" aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <Lightbox items={detail.highlights} index={lightboxIndex} onChange={setLightboxIndex} onClose={closeLightbox} />
      <Lightbox items={detail.productions} index={productionLightboxIndex} onChange={setProductionLightboxIndex} onClose={() => setProductionLightboxIndex(null)} />
    </main>
  );
}

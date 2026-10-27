import { useEffect, useMemo, useRef, useState } from 'react';
import { eventPresentation, downloadItems } from '../lib/eventPresentation.js';
import StoryViewer from './StoryViewer.jsx';
import '../event-detail.css';

function useSwipe(change) {
  const start = useRef(null), suppress = useRef(0);
  return {
    onPointerDown: (e) => { if (e.pointerType !== 'mouse') start.current = [e.clientX, e.clientY]; },
    onPointerCancel: () => { start.current = null; },
    onPointerUp: (e) => {
      if (!start.current) return;
      const [x, y] = start.current; start.current = null;
      if (Math.abs(e.clientX - x) > 40 && Math.abs(e.clientX - x) > Math.abs(e.clientY - y) * 1.3) {
        suppress.current = Date.now() + 500; change(e.clientX < x ? 1 : -1);
      }
    },
    onClickCapture: (e) => { if (Date.now() < suppress.current) { e.preventDefault(); e.stopPropagation(); } },
  };
}
function ImageGroup({ group, open }) {
  const [index, setIndex] = useState(0), slides = group.slides;
  const change = (step) => setIndex((n) => (n + step + slides.length) % slides.length);
  const swipe = useSwipe(change), slide = slides[index];
  return <article className="story-work"><div className="story-work-media" {...swipe}>
    <button className="story-work-open" onClick={() => open(slides, index, group.title)} aria-label={`查看${group.title}`}>
      <img src={slide.thumb || slide.image} alt={slide.alt} loading="lazy" decoding="async" /><span className="story-type">图片作品</span>
    </button>
    {slides.length > 1 && <div className="story-image-controls"><button onClick={() => change(-1)} aria-label={`${group.title}上一张`}>‹</button><span>{index + 1} / {slides.length}</span><button onClick={() => change(1)} aria-label={`${group.title}下一张`}>›</button></div>}
  </div><button className="story-work-title" onClick={() => open(slides, index, group.title)}><h3>{group.title}</h3><span>↗</span></button>{group.description && <p>{group.description}</p>}</article>;
}
function VideoCard({ video, open, label }) {
  return <article className="story-work"><button className="story-work-open story-video-open" onClick={() => open([video], 0, label)} aria-label={`播放${video.title}`}>
    {video.poster ? <img src={video.poster} alt="" loading="lazy" /> : <span className="story-video-placeholder">{video.title}</span>}
    <span className="story-type">{label}</span><span className="story-play" aria-hidden="true">▷</span>
    {video.durationLabel && <small className="story-duration">{video.durationLabel}</small>}
  </button><button className="story-work-title" onClick={() => open([video], 0, label)}><h3>{video.title}</h3><span>↗</span></button></article>;
}
function BulkDownload({ view }) {
  const [state, setState] = useState({ status: '', running: false, url: '' });
  const active = useRef(null), url = useRef(''), link = useRef(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; if (url.current) URL.revokeObjectURL(url.current); }, []);
  const start = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = ''; setState({ status: '下载中 0% ·', running: true, url: '' });
    try {
      const { downloadZip } = await import('../lib/downloadZip.js');
      const notes = `${view.title}\n页面展示版本，不包含拍摄原片或网站源码。\n\n` + [...view.websites, ...view.media, ...view.resources].map((item) => `${item.title || item.label || '链接'}\n${item.href}`).join('\n\n');
      const blob = await downloadZip(downloadItems(view), notes, { signal: controller.signal,
        onProgress: (percent) => { if (active.current === controller) setState({ status: `下载中 ${percent}% ·`, running: true, url: '' }); } });
      controller.signal.throwIfAborted(); url.current = URL.createObjectURL(blob);
      setState({ status: '已打包 ·', running: false, url: url.current });
    } catch {
      if (active.current === controller) setState({ status: controller.signal.aborted ? '已取消 ·' : '下载失败 ·', running: false, url: '' });
    } finally { if (active.current === controller) active.current = null; }
  };
  useEffect(() => { if (state.url) link.current?.click(); }, [state.url]);
  return <div className="story-download"><span role="status" aria-live="polite">{state.status}</span>
    {state.running ? <button onClick={() => active.current?.abort()}>取消</button> : state.url ? <a ref={link} href={state.url} download={`${view.title.replace(/[\\/:*?"<>|]/g, '_')}-全部素材.zip`}>再次保存</a> : <button onClick={start}>↓ 下载全部素材</button>}
  </div>;
}

export default function EventDetail({ event, onBack }) {
  const view = useMemo(() => eventPresentation(event), [event]);
  const [viewer, setViewer] = useState(null), [heroIndex, setHeroIndex] = useState(0), [playing, setPlaying] = useState(true);
  const heroArea = useRef(null), heroSwipe = useSwipe((step) => setHeroIndex((n) => (n + step + view.hero.length) % view.hero.length));
  const open = (items, index, label) => setViewer({ items, index, label });
  const worksExist = view.groups.length || view.websites.length || view.workVideos.length;
  useEffect(() => {
    if (view.hero.length < 2 || !playing || viewer) return undefined;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const timer = setInterval(() => {
      const rect = heroArea.current?.getBoundingClientRect();
      if (!motion.matches && !document.hidden && rect?.bottom > 0 && rect.top < innerHeight) setHeroIndex((n) => (n + 1) % view.hero.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [view.hero.length, playing, viewer]);
  const hero = view.hero[heroIndex];
  return <div className="event-story"><main className="story-shell" id="story-top">
    <button className="story-back" onClick={onBack}>← 所有活动</button>
    <section className={`story-hero ${hero ? '' : 'story-hero-text-only'}`} aria-labelledby="story-title">
      <div className="story-copy"><p className="story-eyebrow">{[view.date, view.city].filter(Boolean).join(' · ')}</p>
        <h1 id="story-title">{view.title}</h1>{view.summary && <p className="story-intro">{view.summary}</p>}
        {view.logos.length > 0 && <div className="story-partners" aria-label="活动合作方">{view.logos.map((logo, i) => <div key={logo.id || i}><img src={logo.image} alt={logo.name} /><span>{logo.name}{logo.role && <small>{logo.role}</small>}</span></div>)}</div>}
        <div className="story-hero-links">{worksExist ? <a href="#story-works" className="story-primary">查看案例 <span>↗</span></a> : null}{view.photos.length || view.sceneVideos.length ? <a href="#story-scene">图片视频 ↓</a> : null}</div>
      </div>
      {hero && <div className="story-hero-carousel" ref={heroArea} {...heroSwipe}><button className="story-hero-open" onClick={() => open(view.hero, heroIndex, '活动海报与封面')} aria-label={`放大${hero.caption || '活动封面'}`}>
        <img src={hero.image} alt={hero.alt || view.title} fetchPriority="high" /><span>↗</span></button>
        <div className="story-hero-bar"><span>{String(heroIndex + 1).padStart(2, '0')} — {hero.caption || '活动封面'}</span>{view.hero.length > 1 && <div>{view.hero.map((item, i) => <button className="story-hero-dot" key={item.image} onClick={() => setHeroIndex(i)} aria-label={`查看${item.caption || `第${i + 1}张`}`} aria-pressed={i === heroIndex}>●</button>)}<button onClick={() => setPlaying((value) => !value)} aria-label={playing ? '暂停首屏轮播' : '播放首屏轮播'}>{playing ? 'Ⅱ' : '▷'}</button></div>}</div>
      </div>}
    </section>
    <nav className="story-nav" aria-label="活动内容导航"><a href="#story-scene">图片视频</a><a href="#story-works">案例</a></nav>
    <section className="story-section" id="story-scene" aria-labelledby="story-scene-title"><div className="story-section-heading"><h2 id="story-scene-title">图片视频</h2><p>回看这次活动的现场。</p><small>{view.photos.length} 张照片 · {view.sceneVideos.length} 段视频</small><BulkDownload view={view} /></div>
      <div className="story-photo-grid">{view.photos.map((photo, index) => <button className="story-photo" key={photo.image} onClick={() => open(view.photos, index, '现场相册')} aria-label={`放大照片：${photo.caption || index + 1}`}><img src={photo.thumb} alt={photo.alt} loading="lazy" decoding="async" /><span aria-hidden="true">↗</span></button>)}</div>
      {view.sceneVideos.length > 0 && <div className="story-works-grid story-scene-videos">{view.sceneVideos.map((video) => <VideoCard key={video.id} video={video} open={open} label="现场视频" />)}</div>}
    </section>
    <section className="story-section" id="story-works" aria-labelledby="story-works-title"><div className="story-section-heading"><h2 id="story-works-title">案例</h2>{worksExist ? <p>图片、网站与视频，看看大家做出的作品。</p> : null}</div>
      <div className="story-works-grid">{view.groups.map((group) => <ImageGroup key={group.id} group={group} open={open} />)}
        {view.websites.map((website) => <article className="story-work" key={website.id || website.href}>{website.image && <button className="story-work-open" onClick={() => open([{ image: website.image, alt: website.title, caption: website.title }], 0, website.title)} aria-label={`预览${website.title}`}><img src={website.image} alt={website.title} loading="lazy" /><span className="story-type">网站作品</span></button>}<a className="story-work-title" href={website.href} target="_blank" rel="noreferrer"><h3>{website.title}</h3><span>↗</span></a>{website.description && <p>{website.description}</p>}<a className="story-visit" href={website.href} target="_blank" rel="noreferrer">打开网站 ↗</a></article>)}
        {view.workVideos.map((video) => <VideoCard key={video.id} video={video} open={open} label="作品视频" />)}
      </div>
    </section>
    {view.resources.length || view.media.length ? <details className="story-resources"><summary>活动资料{view.media.length ? '与报道' : ''}</summary>
      {view.resources.length > 0 && <div>{view.resources.map((item) => <a key={item.id} href={item.href} target="_blank" rel="noreferrer">{item.title}<span>↗</span></a>)}</div>}
      {view.media.length > 0 && <div><h3>社媒报道</h3>{view.media.map((item, i) => <a key={item.id || i} href={item.href} target="_blank" rel="noreferrer">{item.label || item.title || '活动报道'}<span>↗</span></a>)}</div>}
    </details> : null}
    <footer className="story-footer"><span>{view.title}</span><a href="#story-top">回到顶部 ↑</a></footer>
    {viewer && <StoryViewer {...viewer} onChange={(index) => setViewer((current) => ({ ...current, index }))} onClose={() => setViewer(null)} />}
  </main></div>;
}

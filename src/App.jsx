import { useEffect, useMemo, useState } from 'react';
import EventDetail from './components/EventDetail.jsx';
import EventGallery from './components/EventGallery.jsx';
import Header from './components/Header.jsx';
import MonthSection from './components/MonthSection.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import { allEvents, eventMonths, getEventById } from './data/events.js';
import useRoute from './hooks/useRoute.js';
import { SlidersHorizontal } from 'lucide-react';

export default function App() {
  const { route, navigate } = useRoute();
  const [activeNav, setActiveNav] = useState('events');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const activeEvent = route.eventId ? getEventById(route.eventId) : null;
  const activeTag = route.tag || null;

  const tagOptions = useMemo(() => {
    const counts = new Map();
    for (const event of allEvents) {
      for (const tag of event.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, []);

  const filteredMonths = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return eventMonths
      .map((month) => ({
        ...month,
        events: month.events.filter((event) => {
          if (activeTag && !(event.tags || []).includes(activeTag)) return false;
          const content = `${event.partner} ${event.description} ${(event.tags || []).join(' ')}`.toLocaleLowerCase('zh-CN');
          return !normalized || content.includes(normalized);
        }),
      }))
      .filter((month) => month.events.length > 0);
  }, [activeTag, query]);

  useEffect(() => {
    if (!filterOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest('.archive-filter')) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  useEffect(() => {
    const title = activeEvent?.detail.title;
    document.title = title ? `${title} - BigApple Events` : 'BigApple Events';
  }, [activeEvent]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const goArchive = () => {
    setSearchOpen(false);
    setActiveNav('events');
    navigate('/');
  };

  const openEvent = (event) => {
    window.sessionStorage.setItem('archive-scroll', String(window.scrollY));
    navigate(`/events/${event.id}`);
  };

  const openSearch = () => {
    if (route.page !== 'archive') navigate('/');
    setSearchOpen(true);
    setActiveNav('events');
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const selectTag = (tag) => {
    setFilterOpen(false);
    setSearchOpen(false);
    setActiveNav('events');
    navigate(tag ? `/filter/${encodeURIComponent(tag)}` : '/');
  };

  if (route.page !== 'archive' && !activeEvent) {
    return (
      <>
        <Header activeNav="events" onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} />
        <main className="not-found shell"><p>这个活动暂时不存在。</p><button className="text-button" type="button" onClick={goArchive}>返回活动列表</button></main>
      </>
    );
  }

  return (
    <>
      <Header activeNav={activeNav} onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} />
      {searchOpen ? <SearchPanel query={query} onQueryChange={setQuery} onClose={closeSearch} /> : null}

      {route.page === 'detail' ? (
        <EventDetail
          event={activeEvent}
          onGallery={() => navigate(`/events/${activeEvent.id}/gallery`)}
          onProductionGallery={() => navigate(`/events/${activeEvent.id}/production-gallery`)}
          onMediaNotice={(label) => setToast(`${label}内容将在素材接入后开放`)}
          onBack={goArchive}
        />
      ) : null}

      {route.page === 'gallery' ? (
        <EventGallery event={activeEvent} onBack={() => navigate(`/events/${activeEvent.id}`)} />
      ) : null}

      {route.page === 'production-gallery' ? (
        <EventGallery event={activeEvent} type="production" onBack={() => navigate(`/events/${activeEvent.id}`)} />
      ) : null}

      {route.page === 'archive' ? (
        <main className="event-archive shell" id="events" tabIndex="-1">
          <div className="archive-toolbar">
            <div className="archive-filter">
              <button
                className={`archive-filter-button ${activeTag ? 'is-active' : ''}`}
                type="button"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((current) => !current)}
              >
                <SlidersHorizontal aria-hidden="true" />
                <span>{activeTag ? `活动类型 · ${activeTag}` : '活动类型'}</span>
              </button>
              {filterOpen ? (
                <div className="archive-filter-panel">
                  <button className={activeTag ? '' : 'is-selected'} type="button" onClick={() => selectTag(null)}>
                    <span>全部活动</span>
                    <small>{allEvents.length}</small>
                  </button>
                  {tagOptions.map(([tag, count]) => (
                    <button className={activeTag === tag ? 'is-selected' : ''} type="button" key={tag} onClick={() => selectTag(tag)}>
                      <span>{tag}</span>
                      <small>{count}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {activeNav === 'about' ? <div className="inline-notice">BigApple Events · 合作活动档案</div> : null}
          {activeNav === 'partners' ? <div className="inline-notice">正在按合作伙伴浏览活动</div> : null}
          {filteredMonths.length > 0 ? (
            filteredMonths.map((month) => <MonthSection key={month.label} month={month} onOpen={openEvent} />)
          ) : (
            <div className="empty-state"><p>没有找到相关活动。</p><button className="text-button" type="button" onClick={() => { setQuery(''); if (activeTag) selectTag(null); }}>查看全部活动</button></div>
          )}
        </main>
      ) : null}

      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import EventDetail from './components/EventDetail.jsx';
import EventGallery from './components/EventGallery.jsx';
import Header from './components/Header.jsx';
import MonthSection from './components/MonthSection.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import useRoute from './hooks/useRoute.js';
import { Settings, SlidersHorizontal } from 'lucide-react';
import { api } from './lib/api.js';
import { groupEvents } from './lib/archive.js';
import AdminLogin from './components/AdminLogin.jsx';
import AdminPage from './components/AdminPage.jsx';
import './admin.css';

export default function App() {
  const { route, navigate, setNavigationGuard } = useRoute();
  const [site, setSite] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [login, setLogin] = useState(false);
  useEffect(() => {
    if (route.page === 'admin') return undefined;
    const controller = new AbortController(); setSite(null); setError('');
    api(route.tenant ? `/api/sites/${route.tenant}` : '/api/site', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setSite({ ...data, tenant: route.tenant }); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [route.tenant, route.page === 'admin', retry]);
  const goAdmin = async () => {
    try {
      const session = await api('/api/admin/session');
      if (session.authenticated) navigate('/admin'); else setLogin(true);
    } catch { setLogin(true); }
  };
  if (route.page === 'admin') return <AdminPage onBack={() => navigate('/', { global: true })} setNavigationGuard={setNavigationGuard} />;
  if (!site || site.tenant !== route.tenant) return <main className="site-loading shell" aria-live="polite"><h1>{error ? '页面暂不可访问' : '正在加载…'}</h1>{error && <><p>{error}</p><button className="text-button" onClick={() => setRetry((n) => n + 1)}>重新加载</button></>}</main>;
  return <>
    <Archive key={route.tenant || 'original'} route={route} navigate={navigate} site={site} onAdmin={goAdmin} />
    {login && <AdminLogin onClose={() => setLogin(false)} onSuccess={() => { setLogin(false); navigate('/admin'); }} />}
  </>;
}

function Archive({ route, navigate, site, onAdmin }) {
  const allEvents = site.events;
  const brand = site.brand;
  const eventMonths = useMemo(() => groupEvents(allEvents), [allEvents]);
  const [activeNav, setActiveNav] = useState('events');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const activeEvent = route.eventId ? allEvents.find((event) => event.uid === route.eventId) || allEvents.find((event) => event.id === route.eventId) : null;
  const activeTag = route.tag || null;

  const tagOptions = useMemo(() => {
    const counts = new Map();
    for (const event of allEvents) {
      for (const tag of event.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [allEvents]);

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
  }, [activeTag, query, eventMonths]);

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
    const name = brand?.name || 'BigApple Events';
    document.title = title ? `${title} - ${name}` : name;
  }, [activeEvent, brand]);

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
    window.sessionStorage.setItem(`archive-scroll-${route.tenant || 'original'}`, String(window.scrollY));
    navigate(`/events/${encodeURIComponent(event.uid)}`);
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
        <Header brand={brand} activeNav="events" onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} />
        <main className="not-found shell"><p>这个活动暂时不存在。</p><button className="text-button" type="button" onClick={goArchive}>返回活动列表</button></main>
      </>
    );
  }

  return (
    <>
      <Header brand={brand} activeNav={activeNav} onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} />
      {searchOpen ? <SearchPanel query={query} onQueryChange={setQuery} onClose={closeSearch} /> : null}

      {route.page === 'detail' ? (
        <EventDetail
          event={activeEvent}
          onGallery={() => navigate(`/events/${encodeURIComponent(activeEvent.uid)}/gallery`)}
          onProductionGallery={() => navigate(`/events/${encodeURIComponent(activeEvent.uid)}/production-gallery`)}
          onMediaNotice={(label) => setToast(`${label}内容将在素材接入后开放`)}
          onBack={goArchive}
        />
      ) : null}

      {route.page === 'gallery' ? (
        <EventGallery event={activeEvent} onBack={() => navigate(`/events/${encodeURIComponent(activeEvent.uid)}`)} />
      ) : null}

      {route.page === 'production-gallery' ? (
        <EventGallery event={activeEvent} type="production" onBack={() => navigate(`/events/${encodeURIComponent(activeEvent.uid)}`)} />
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
          {activeNav === 'about' ? <div className="inline-notice">{brand?.name || 'BigApple Events'} · 合作活动档案</div> : null}
          {activeNav === 'partners' ? <div className="inline-notice">正在按合作伙伴浏览活动</div> : null}
          {filteredMonths.length > 0 ? (
            filteredMonths.map((month) => <MonthSection key={month.label} month={month} onOpen={openEvent} />)
          ) : (
            <div className="empty-state"><p>没有找到相关活动。</p><button className="text-button" type="button" onClick={() => { setQuery(''); if (activeTag) selectTag(null); }}>查看全部活动</button></div>
          )}
        </main>
      ) : null}

      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
      {!route.tenant && <footer className="admin-entry shell"><button type="button" aria-label="管理员设置" title="管理员设置" onClick={onAdmin}><Settings size={17} /></button></footer>}
    </>
  );
}

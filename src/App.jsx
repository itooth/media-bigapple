import { useEffect, useMemo, useState } from 'react';
import EventDetail from './components/EventDetail.jsx';
import EventGallery from './components/EventGallery.jsx';
import Header from './components/Header.jsx';
import Lightbox from './components/Lightbox.jsx';
import MonthSection from './components/MonthSection.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import useRoute from './hooks/useRoute.js';
import { LayoutGrid, Settings, SlidersHorizontal } from 'lucide-react';
import { api } from './lib/api.js';
import { groupCases, groupEvents } from './lib/archive.js';
import { buildCaseItems, caseSearchText, eventSearchText, matchesTokens, tokenizeQuery } from './lib/caseArchive.js';
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
  const isCaseMode = route.page === 'cases';
  const eventMonths = useMemo(() => groupEvents(allEvents), [allEvents]);
  const allCases = useMemo(() => buildCaseItems(allEvents), [allEvents]);
  const [activeNav, setActiveNav] = useState('events');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [casePreview, setCasePreview] = useState(null);
  const activeEvent = route.eventId ? allEvents.find((event) => event.uid === route.eventId) || allEvents.find((event) => event.id === route.eventId) : null;
  const activeTag = route.tag || null;

  const caseTitlesByEvent = useMemo(() => {
    const map = new Map();
    for (const event of allEvents) {
      map.set(event.uid || event.id, (event.detail?.productionGallery || []).map((item) => item.title || '').filter(Boolean));
    }
    return map;
  }, [allEvents]);

  const tagOptions = useMemo(() => {
    const counts = new Map();
    if (isCaseMode) {
      for (const item of allCases) {
        for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    } else {
      for (const event of allEvents) {
        for (const tag of event.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [allEvents, allCases, isCaseMode]);

  const filteredMonths = useMemo(() => {
    const tokens = tokenizeQuery(query);
    return eventMonths
      .map((month) => ({
        ...month,
        events: month.events.filter((event) => {
          if (activeTag && !(event.tags || []).includes(activeTag)) return false;
          return matchesTokens(eventSearchText(event, caseTitlesByEvent.get(event.uid || event.id) || []), tokens);
        }),
      }))
      .filter((month) => month.events.length > 0);
  }, [activeTag, query, eventMonths, caseTitlesByEvent]);

  const filteredCaseMonths = useMemo(() => {
    if (!isCaseMode) return [];
    const tokens = tokenizeQuery(query);
    const list = allCases.filter((item) => {
      if (activeTag && !item.tags.includes(activeTag)) return false;
      return matchesTokens(caseSearchText(item), tokens);
    });
    return groupCases(list);
  }, [activeTag, allCases, isCaseMode, query]);

  const resultCount = isCaseMode
    ? filteredCaseMonths.reduce((total, month) => total + month.events.length, 0)
    : filteredMonths.reduce((total, month) => total + month.events.length, 0);

  useEffect(() => {
    if (!filterOpen && !contentOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest('.archive-filter')) {
        setFilterOpen(false);
        setContentOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen, contentOpen]);

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
    if (route.page !== 'archive' && route.page !== 'cases') navigate('/');
    setSearchOpen(true);
    setActiveNav('events');
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const selectTag = (tag) => {
    setFilterOpen(false);
    setContentOpen(false);
    setSearchOpen(false);
    setActiveNav('events');
    const suffix = tag ? `/filter/${encodeURIComponent(tag)}` : '';
    navigate(isCaseMode ? `/cases${suffix}` : suffix || '/');
  };

  const selectContent = (mode) => {
    setContentOpen(false);
    setFilterOpen(false);
    if (mode === 'cases') {
      navigate(activeTag ? `/cases/filter/${encodeURIComponent(activeTag)}` : '/cases');
    } else {
      navigate(activeTag ? `/filter/${encodeURIComponent(activeTag)}` : '/');
    }
  };

  const openCase = (item) => {
    if (item.href) {
      window.open(item.href, '_blank', 'noopener,noreferrer');
      return;
    }
    // 没有链接的案例：只做封面预览，不进任何详情页。
    setCasePreview({ items: [{ image: item.image, alt: item.alt || item.title, caption: `${item.title} · ${item.eventTitle}` }], index: 0 });
  };

  if (route.page !== 'archive' && route.page !== 'cases' && !activeEvent) {
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
      {searchOpen ? (
        <SearchPanel
          query={query}
          onQueryChange={setQuery}
          onClose={closeSearch}
          count={resultCount}
          placeholder={isCaseMode ? '搜索案例名、所属活动、说明、链接' : '搜索活动名、简介、标签、城市、案例名'}
        />
      ) : null}

      {route.page === 'detail' ? (
        <EventDetail
          key={activeEvent.uid || activeEvent.id}
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

      {route.page === 'archive' || route.page === 'cases' ? (
        <main className="event-archive shell" id="events" tabIndex="-1">
          <div className="archive-toolbar">
            <div className="archive-filter">
              <button
                className={`archive-filter-button ${isCaseMode ? 'is-active' : ''}`}
                type="button"
                aria-expanded={contentOpen}
                onClick={() => { setContentOpen((current) => !current); setFilterOpen(false); }}
              >
                <LayoutGrid aria-hidden="true" />
                <span>{isCaseMode ? '内容 · 案例' : '内容 · 活动'}</span>
              </button>
              {contentOpen ? (
                <div className="archive-filter-panel">
                  <button className={isCaseMode ? '' : 'is-selected'} type="button" onClick={() => selectContent('events')}>
                    <span>活动</span>
                    <small>{allEvents.length}</small>
                  </button>
                  <button className={isCaseMode ? 'is-selected' : ''} type="button" onClick={() => selectContent('cases')}>
                    <span>案例</span>
                    <small>{allCases.length}</small>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="archive-filter">
              <button
                className={`archive-filter-button ${activeTag ? 'is-active' : ''}`}
                type="button"
                aria-expanded={filterOpen}
                onClick={() => { setFilterOpen((current) => !current); setContentOpen(false); }}
              >
                <SlidersHorizontal aria-hidden="true" />
                <span>{activeTag ? `活动类型 · ${activeTag}` : '活动类型'}</span>
              </button>
              {filterOpen ? (
                <div className="archive-filter-panel">
                  <button className={activeTag ? '' : 'is-selected'} type="button" onClick={() => selectTag(null)}>
                    <span>{isCaseMode ? '全部案例' : '全部活动'}</span>
                    <small>{isCaseMode ? allCases.length : allEvents.length}</small>
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
          {isCaseMode ? (
            filteredCaseMonths.length > 0 ? (
              filteredCaseMonths.map((month) => <MonthSection key={month.label} month={month} kind="case" onOpenCase={openCase} />)
            ) : (
              <div className="empty-state"><p>没有找到相关案例。</p><button className="text-button" type="button" onClick={() => { setQuery(''); if (activeTag) selectTag(null); }}>查看全部案例</button></div>
            )
          ) : filteredMonths.length > 0 ? (
            filteredMonths.map((month) => <MonthSection key={month.label} month={month} onOpen={openEvent} />)
          ) : (
            <div className="empty-state"><p>没有找到相关活动。</p><button className="text-button" type="button" onClick={() => { setQuery(''); if (activeTag) selectTag(null); }}>查看全部活动</button></div>
          )}
        </main>
      ) : null}

      {casePreview ? (
        <Lightbox
          items={casePreview.items}
          index={casePreview.index}
          onChange={(index) => setCasePreview((current) => ({ ...current, index }))}
          onClose={() => setCasePreview(null)}
        />
      ) : null}

      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
      {!brand && <footer className="admin-entry shell"><button type="button" aria-label="管理员设置" title="管理员设置" onClick={onAdmin}><Settings size={17} /></button></footer>}
    </>
  );
}

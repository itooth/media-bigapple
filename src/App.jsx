import { useEffect, useMemo, useState } from 'react';
import EventDetail from './components/EventDetail.jsx';
import EventGallery from './components/EventGallery.jsx';
import Header from './components/Header.jsx';
import StoryViewer from './components/StoryViewer.jsx';
import MonthSection from './components/MonthSection.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import useRoute from './hooks/useRoute.js';
import { Settings, SlidersHorizontal } from 'lucide-react';
import { api } from './lib/api.js';
import { eventPath, findEvent } from './lib/eventSlug.js';
import { groupCases, groupEvents } from './lib/archive.js';
import { buildCaseItems, compareByAppeal, eventSearchText, matchesTokens, tokenizeQuery } from './lib/caseArchive.js';
import { CASE_CATEGORIES, displayCategory } from './lib/caseCategory.js';
import { createCaseSearch } from './lib/caseSearch.js';
import AdminLogin from './components/AdminLogin.jsx';
import AdminPage from './components/AdminPage.jsx';
import './admin.css';

export default function App() {
  const { route, navigate, setNavigationGuard } = useRoute();
  const [site, setSite] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [login, setLogin] = useState(false);
  const view = route.eventId ? 'event' : 'catalog';
  // Replacing a legacy URL with the returned canonical slug reuses the same response.
  const requestedId = site?.tenant === route.tenant && site?.view === 'event' && route.eventId === site.events[0]?.slug
    ? site.requestedId : route.eventId;
  const endpoint = route.tenant ? `/api/sites/${route.tenant}` : '/api/site';
  const requestKey = `${endpoint}?${view === 'event' ? `event=${encodeURIComponent(requestedId)}` : 'view=catalog'}`;
  useEffect(() => {
    if (route.page === 'admin') { setSite(null); return undefined; }
    const controller = new AbortController(); setError('');
    api(requestKey, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setSite({ ...data, tenant: route.tenant, view, requestedId, requestKey }); })
      .catch((error) => { if (!controller.signal.aborted) setError({ key: requestKey, message: error.message }); });
    return () => controller.abort();
  }, [requestKey, route.page === 'admin', retry]);
  const goAdmin = async () => {
    try {
      const session = await api('/api/admin/session');
      if (session.authenticated) navigate('/admin'); else setLogin(true);
    } catch { setLogin(true); }
  };
  if (route.page === 'admin') return <AdminPage onBack={() => navigate('/', { global: true })} setNavigationGuard={setNavigationGuard} />;
  const message = error?.key === requestKey ? error.message : '';
  const reload = () => setRetry((n) => n + 1);
  if (!site || site.tenant !== route.tenant) return <Loading error={message} onRetry={reload} />;
  return <>
    <Archive key={route.tenant || 'original'} route={route} navigate={navigate} site={site} onAdmin={goAdmin} catalogKey={`${endpoint}?view=catalog`}
      loading={site.requestKey !== requestKey} error={message} onRetry={reload} />
    {login && <AdminLogin onClose={() => setLogin(false)} onSuccess={() => { setLogin(false); navigate('/admin'); }} />}
  </>;
}

function Loading({ error, onRetry }) {
  return <main className="site-loading shell" aria-live="polite"><h1>{error ? '页面暂不可访问' : '正在加载…'}</h1>{error && <><p>{error}</p><button className="text-button" onClick={onRetry}>重新加载</button></>}</main>;
}

function Archive({ route, navigate, site, onAdmin, loading, error, onRetry, catalogKey }) {
  const allEvents = site.events;
  const brand = site.brand;
  const isCaseMode = route.page === 'cases';
  const eventMonths = useMemo(() => groupEvents(allEvents), [allEvents]);
  const allCases = useMemo(() => buildCaseItems(allEvents), [allEvents]);
  const [activeNav, setActiveNav] = useState('events');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // 活动详情页只加载了这一场；搜索要搜全站，所以打开搜索时补读一次全站目录（和列表页同一个接口）。
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    if (!searchOpen || site.view === 'catalog' || catalog) return undefined;
    const controller = new AbortController();
    api(catalogKey, { signal: controller.signal }).then((data) => setCatalog(data.events || [])).catch(() => {});
    return () => controller.abort();
  }, [searchOpen, site.view, catalog, catalogKey]);
  const searchEvents = site.view === 'catalog' ? allEvents : catalog || [];
  const searchPool = useMemo(() => (searchEvents === allEvents ? allCases : buildCaseItems(searchEvents)), [searchEvents, allEvents, allCases]);
  const searchCases = useMemo(() => createCaseSearch(searchPool), [searchPool]);
  const [toast, setToast] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [casePreview, setCasePreview] = useState(null);
  const activeEvent = findEvent(allEvents, route.eventId);
  // 旧链接（中文文件夹名、旧编号）打开后把地址栏换成 ASCII 短链，用户从地址栏复制出去也能直接点开。
  useEffect(() => {
    if (loading || !activeEvent?.slug || route.eventId === activeEvent.slug) return;
    const suffix = route.page === 'detail' ? '' : `/${route.page}`;
    navigate(`${eventPath(activeEvent)}${suffix}`, { replace: true, instant: true });
  }, [loading, activeEvent, route.eventId, route.page, navigate]);
  const activeTag = route.tag || null;

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

  // 列表页只按活动类型筛；搜索词走下面的全局搜索结果，不再只筛当前列表。
  const filteredMonths = useMemo(() => eventMonths
    .map((month) => ({ ...month, events: month.events.filter((event) => !activeTag || (event.tags || []).includes(activeTag)) }))
    .filter((month) => month.events.length > 0), [activeTag, eventMonths]);

  const filteredCaseMonths = useMemo(() => (isCaseMode
    ? groupCases(allCases.filter((item) => !activeTag || item.tags.includes(activeTag))) : []), [activeTag, allCases, isCaseMode]);

  // 案例墙默认按「吸引力」排（能打开的网站、视频作品、多图完整案例靠前），
  // 也可以切到「最新」（按所属活动日期倒序）。分类筛选和排序可以叠加。
  const caseCategory = route.category || '';
  const caseSort = route.sort === 'latest' ? 'latest' : 'appeal';
  const visibleCases = useMemo(() => {
    if (!isCaseMode) return [];
    const list = allCases.filter((item) => (!caseCategory || displayCategory(item) === caseCategory));
    return caseSort === 'latest' ? list : list.slice().sort(compareByAppeal);
  }, [allCases, caseCategory, caseSort, isCaseMode]);
  const caseCategoryCounts = useMemo(() => {
    const counts = new Map();
    for (const item of allCases) {
      const name = displayCategory(item);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    // 「其他」是兜底分类，永远排最后；其余按固定顺序。
    const rank = (name) => (name === '其他' ? CASE_CATEGORIES.length : CASE_CATEGORIES.indexOf(name));
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [allCases]);

  // 搜索按模块分：在 Cases 里只搜案例（和 /api/agent/search 的 cases 同一个函数），
  // 在 Events 里只搜活动。两个模块各搜各的，不再混在同一个结果页里。
  const searching = searchOpen && tokenizeQuery(query).length > 0;
  const searchResults = useMemo(() => {
    if (!searching) return { cases: [], events: [] };
    const tokens = tokenizeQuery(query);
    return {
      cases: isCaseMode ? searchCases(query) : [],
      events: isCaseMode ? [] : searchEvents.filter((event) => matchesTokens(eventSearchText(event, (event.detail?.productionGallery || []).map((item) => item.title || '').filter(Boolean)), tokens)),
    };
  }, [searching, query, searchCases, searchEvents, isCaseMode]);

  const resultCount = searching
    ? searchResults.cases.length + searchResults.events.length
    : isCaseMode ? allCases.length : allEvents.length;

  useEffect(() => {
    if (!filterOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest('.archive-filter')) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  useEffect(() => {
    if (loading) return;
    const title = activeEvent?.detail.title;
    const name = brand?.name || 'BigApple Showcase';
    document.title = title ? `${title} - ${name}` : name;
  }, [loading, activeEvent, brand]);

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

  const goCases = () => {
    setSearchOpen(false);
    setActiveNav('cases');
    navigate('/cases');
  };

  // 案例页的分类和排序写进地址栏，刷新、分享、后退都能还原。
  const goCasesQuery = (next) => {
    const params = new URLSearchParams();
    const category = next.category ?? caseCategory;
    const sort = next.sort ?? caseSort;
    if (category) params.set('cat', category);
    if (sort === 'latest') params.set('sort', 'latest');
    const query = params.toString();
    navigate(`/cases${query ? `?${query}` : ''}`);
  };

  const openEvent = (event) => {
    if (searching) closeSearch();
    window.sessionStorage.setItem(`archive-scroll-${route.tenant || 'original'}`, String(window.scrollY));
    navigate(eventPath(event));
  };

  const openSearch = () => {
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
    const suffix = tag ? `/filter/${encodeURIComponent(tag)}` : '';
    navigate(suffix || '/');
  };

  const openCase = (item) => {
    if (item.video && !item.href) {
      if (searching) closeSearch();
      navigate(eventPath({ slug: item.eventSlug, uid: item.eventUid }));
      return;
    }
    if (item.href) {
      window.open(item.href, '_blank', 'noopener,noreferrer');
      return;
    }
    setCasePreview({ items: item.slides?.length ? item.slides : [{ image: item.image, alt: item.alt || item.title, caption: item.title }], label: `${item.title} · ${item.eventTitle}`, index: 0 });
  };

  if (loading) return <>
    <Header brand={brand} activeNav={activeNav} onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} onCases={goCases} />
    <Loading error={error} onRetry={onRetry} />
  </>;

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
      <Header brand={brand} activeNav={activeNav} onNavChange={setActiveNav} onSearchOpen={openSearch} onBrandClick={goArchive} onCases={goCases} />
      {searchOpen ? (
        <SearchPanel
          query={query}
          onQueryChange={setQuery}
          onClose={closeSearch}
          count={resultCount}
          placeholder={isCaseMode ? '搜索案例，支持拼音，如 dafuweng' : '搜索活动，支持拼音'}
        />
      ) : null}

      {searching ? (
        <main className="event-archive shell search-results" id="events" tabIndex="-1">
          {searchResults.cases.length > 0 ? (
            <MonthSection month={{ label: `案例 · ${searchResults.cases.length}`, events: searchResults.cases }} kind="case" onOpenCase={openCase} />
          ) : null}
          {searchResults.events.length > 0 ? (
            <MonthSection month={{ label: `活动 · ${searchResults.events.length}`, events: searchResults.events }} onOpen={openEvent} />
          ) : null}
          {resultCount === 0 ? (
            <div className="empty-state"><p>没有找到相关案例或活动。</p><button className="text-button" type="button" onClick={() => setQuery('')}>清空搜索</button></div>
          ) : null}
        </main>
      ) : null}

      {!searching && route.page === 'detail' ? (
        <EventDetail
          key={activeEvent.uid || activeEvent.id}
          event={activeEvent}
          onGallery={() => navigate(`${eventPath(activeEvent)}/gallery`)}
          onProductionGallery={() => navigate(`${eventPath(activeEvent)}/production-gallery`)}
          onMediaNotice={(label) => setToast(`${label}内容将在素材接入后开放`)}
          onBack={goArchive}
        />
      ) : null}

      {!searching && route.page === 'gallery' ? (
        <EventGallery event={activeEvent} onBack={() => navigate(eventPath(activeEvent))} />
      ) : null}

      {!searching && route.page === 'production-gallery' ? (
        <EventGallery event={activeEvent} type="production" onBack={() => navigate(eventPath(activeEvent))} />
      ) : null}

      {!searching && (route.page === 'archive' || route.page === 'cases') ? (
        <main className="event-archive shell" id="events" tabIndex="-1">
          {isCaseMode ? null : <div className="archive-toolbar">
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
          </div>}
          {isCaseMode ? (
            <>
              <nav className="case-tabs" aria-label="案例分类">
                <button className={`case-tab${caseCategory ? '' : ' is-selected'}`} type="button" onClick={() => goCasesQuery({ category: '' })}>全部</button>
                {caseCategoryCounts.map(([name, count]) => (
                  <button
                    key={name}
                    className={`case-tab${caseCategory === name ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={caseCategory === name}
                    onClick={() => goCasesQuery({ category: caseCategory === name ? '' : name })}
                  >
                    {name}<span className="case-tab-count">{count}</span>
                  </button>
                ))}
                <div className="case-sort">
                  <button className={caseSort === 'appeal' ? 'is-selected' : ''} type="button" aria-pressed={caseSort === 'appeal'} onClick={() => goCasesQuery({ sort: 'appeal' })}>精选</button>
                  <button className={caseSort === 'latest' ? 'is-selected' : ''} type="button" aria-pressed={caseSort === 'latest'} onClick={() => goCasesQuery({ sort: 'latest' })}>时间线</button>
                </div>
              </nav>
              {visibleCases.length > 0 ? (
                caseSort === 'latest'
                  ? groupCases(visibleCases).map((month) => <MonthSection key={month.label} month={month} kind="case" onOpenCase={openCase} />)
                  : <MonthSection month={{ label: '', events: visibleCases }} kind="case" onOpenCase={openCase} />
              ) : (
                <div className="empty-state"><p>这个分类下还没有案例。</p><button className="text-button" type="button" onClick={() => goCasesQuery({ category: '' })}>查看全部案例</button></div>
              )}
            </>
          ) : filteredMonths.length > 0 ? (
            filteredMonths.map((month) => <MonthSection key={month.label} month={month} onOpen={openEvent} />)
          ) : (
            <div className="empty-state"><p>没有找到相关活动。</p><button className="text-button" type="button" onClick={() => selectTag(null)}>查看全部活动</button></div>
          )}
        </main>
      ) : null}

      {casePreview ? (
        <StoryViewer
          label={casePreview.label}
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

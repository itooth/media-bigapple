import { useCallback, useEffect, useState } from 'react';

function readRoute() {
  const routePath = window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1)
    : window.location.pathname;
  const filterMatch = routePath.match(/^\/filter\/([^/]+)\/?$/);
  if (filterMatch) return { page: 'archive', eventId: null, tag: decodeURIComponent(filterMatch[1]) };
  const match = routePath.match(/^\/events\/([^/]+)(?:\/(gallery|production-gallery))?\/?$/);
  if (!match) return { page: 'archive', eventId: null, tag: null };
  const page = match[2] === 'gallery' ? 'gallery' : match[2] === 'production-gallery' ? 'production-gallery' : 'detail';
  return { page, eventId: decodeURIComponent(match[1]), tag: null };
}

export default function useRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute());
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigate = useCallback((path, options = {}) => {
    const needsHashRoute = window.location.protocol === 'file:'
      || window.location.pathname.includes('/api/files/html-preview/')
      || window.location.pathname.endsWith('/index.html');
    const target = needsHashRoute ? `${window.location.pathname}${window.location.search}#${path}` : path;
    window.history[options.replace ? 'replaceState' : 'pushState']({}, '', target);
    setRoute(readRoute());
    window.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
  }, []);

  return { route, navigate };
}

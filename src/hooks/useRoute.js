import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRoute, tenantPath } from '../lib/routes.js';

function readRoute() {
  const routePath = window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1)
    : window.location.pathname;
  return parseRoute(routePath);
}

export default function useRoute() {
  const [route, setRoute] = useState(readRoute);
  const navigationGuard = useRef(null);
  const currentUrl = useRef(window.location.href);
  const setNavigationGuard = useCallback((guard) => { navigationGuard.current = guard; }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (navigationGuard.current && !navigationGuard.current()) {
        window.history.pushState({}, '', currentUrl.current);
        return;
      }
      currentUrl.current = window.location.href;
      setRoute(readRoute());
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigate = useCallback((path, options = {}) => {
    const scopedPath = options.global || path === '/admin' ? path : tenantPath(readRoute().tenant, path);
    const needsHashRoute = window.location.protocol === 'file:'
      || window.location.pathname.includes('/api/files/html-preview/')
      || window.location.pathname.endsWith('/index.html');
    const target = needsHashRoute ? `${window.location.pathname}${window.location.search}#${scopedPath}` : scopedPath;
    window.history[options.replace ? 'replaceState' : 'pushState']({}, '', target);
    currentUrl.current = window.location.href;
    setRoute(readRoute());
    window.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
  }, []);

  return { route, navigate, setNavigationGuard };
}

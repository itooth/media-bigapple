export function parseRoute(pathname, { branded = false, search = '' } = {}) {
  const path = pathname.replace(/\/$/, '') || '/';
  const params = new URLSearchParams(search);
  const filters = { category: params.get('cat') || null, sort: params.get('sort') === 'latest' ? 'latest' : null };
  if (branded && (path === '/admin' || /^\/\d+(?=\/|$)/.test(path))) return { page: 'not-found', tenant: null, eventId: null, tag: null, ...filters };
  if (path === '/admin') return { page: 'admin', tenant: null };
  const prefix = path.match(/^\/(\d+)(?=\/|$)/);
  const tenant = prefix?.[1] || null;
  const local = (prefix ? path.slice(prefix[0].length) : path) || '/';
  const base = { tenant, eventId: null, tag: null, ...filters };
  if (local === '/' || local === '/events') return { ...base, page: 'archive' };
  try {
    const filter = local.match(/^\/filter\/([^/]+)$/);
    if (filter) return { ...base, page: 'archive', tag: decodeURIComponent(filter[1]) };
    const caseFilter = local.match(/^\/cases\/filter\/([^/]+)$/);
    if (caseFilter) return { ...base, page: 'cases', tag: decodeURIComponent(caseFilter[1]) };
    if (local === '/cases') return { ...base, page: 'cases' };
    const event = local.match(/^\/events\/([^/]+)(?:\/(gallery|production-gallery))?$/);
    if (event) return { ...base, page: event[2] || 'detail', eventId: decodeURIComponent(event[1]) };
  } catch { /* malformed URL is a not-found page, never the full archive */ }
  return { ...base, page: 'not-found' };
}

export function tenantPath(tenant, path) {
  return tenant ? `/${tenant}${path === '/' ? '' : path}` : path;
}

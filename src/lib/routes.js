export function parseRoute(pathname, { branded = false } = {}) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (branded && (path === '/admin' || /^\/\d+(?=\/|$)/.test(path))) return { page: 'not-found', tenant: null, eventId: null, tag: null };
  if (path === '/admin') return { page: 'admin', tenant: null };
  const prefix = path.match(/^\/(\d+)(?=\/|$)/);
  const tenant = prefix?.[1] || null;
  const local = (prefix ? path.slice(prefix[0].length) : path) || '/';
  const base = { tenant, eventId: null, tag: null };
  if (local === '/') return { ...base, page: 'archive' };
  try {
    const filter = local.match(/^\/filter\/([^/]+)$/);
    if (filter) return { ...base, page: 'archive', tag: decodeURIComponent(filter[1]) };
    const event = local.match(/^\/events\/([^/]+)(?:\/(gallery|production-gallery))?$/);
    if (event) return { ...base, page: event[2] || 'detail', eventId: decodeURIComponent(event[1]) };
  } catch { /* malformed URL is a not-found page, never the full archive */ }
  return { ...base, page: 'not-found' };
}

export function tenantPath(tenant, path) {
  return tenant ? `/${tenant}${path === '/' ? '' : path}` : path;
}

// 活动链接只用 ASCII：微信等聊天软件识别链接时遇到中文会截断，导致复制出去点不开。
// 规则：当天只有一场 → 2026-10-11；同一天多场 → 2026-10-11-xxxx（由活动唯一标识算出的短后缀，稳定不变）。
// 素材清单里可手写 slug（小写字母/数字/连字符）覆盖自动结果，例如 2026-10-11-pkuhsbc。
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(36).padStart(4, '0').slice(-4);
}

function isoDate(value) {
  const match = String(value || '').match(/^(\d{4})[-年.](\d{1,2})[-月.](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

export function assignSlugs(events, registry = {}, { requireAllRegistered = false } = {}) {
  const ids = new Set(events.map(e => e.uid));
  if (ids.size !== events.length || events.some(e => typeof e.uid !== 'string' || !e.uid)) throw new Error('活动 uid 缺失或重复');
  const validate = (slug, uid) => {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error(`活动链接 slug 只能用小写字母、数字和连字符：${uid}`);
  };
  const owner = new Map();
  for (const [uid, slug] of Object.entries(registry)) {
    validate(slug, uid);
    if (owner.has(slug)) throw new Error(`活动链接 slug 重复：${slug}`);
    owner.set(slug, uid);
  }
  if (requireAllRegistered) {
    const missing = Object.keys(registry).filter(uid => !ids.has(uid));
    if (missing.length) throw new Error(`登记活动缺失，可能是文件夹改名：${missing.join('、')}。请人工核对并在 eventSlugs.json 修改 key（保留 slug）；若确实删除活动，请显式清理登记记录。`);
  }
  // Reserve explicit overrides before allocating any new address. Old allocations
  // remain reserved during this build to prevent silently handing a URL to another activity.
  const selected = new Map();
  for (const event of events) {
    const slug = event.slug !== undefined ? event.slug : registry[event.uid];
    if (slug === undefined) continue;
    validate(slug, event.uid);
    if (owner.has(slug) && owner.get(slug) !== event.uid) throw new Error(`活动链接 slug 重复：${slug}`);
    owner.set(slug, event.uid); selected.set(event.uid, slug);
  }
  // Sorting makes allocation independent of input/display order.
  for (const event of [...events].sort((a,b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)) {
    if (selected.has(event.uid)) continue;
    const base = isoDate(event.sourceDate) || 'event';
    const slug = base !== 'event' && !owner.has(base) ? base : `${base}-${shortHash(event.uid)}`;
    if (owner.has(slug)) throw new Error(`活动链接短码冲突：${slug}，请在 manifest 中指定唯一 slug`);
    owner.set(slug,event.uid); selected.set(event.uid,slug);
  }
  return events.map(event => ({...event, slug:selected.get(event.uid)}));
}

export function findEvent(events, key) {
  if (!key) return null;
  return events.find((event) => event.slug === key) || events.find((event) => event.uid === key) || events.find((event) => event.id === key) || null;
}

export const eventPath = (event) => `/events/${encodeURIComponent(event.slug || event.uid)}`;

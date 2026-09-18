export function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const value = String(event.sourceDate || '');
    const parts = value.match(/^(\d{4})[-年](\d{1,2})(?:[-月](\d{1,2}))?/);
    const key = parts ? `${parts[1]}-${parts[2].padStart(2, '0')}` : value;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, items]) => ({
    label: /^\d{4}-\d{2}$/.test(key) ? `${key.slice(0, 4)}年${Number(key.slice(5))}月` : key,
    events: items,
  }));
}

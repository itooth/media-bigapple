function monthKeyOf(value) {
  const parts = String(value || '').match(/^(\d{4})[-年](\d{1,2})(?:[-月](\d{1,2}))?/);
  return parts ? `${parts[1]}-${parts[2].padStart(2, '0')}` : String(value || '');
}

export function monthLabelOf(value) {
  const key = monthKeyOf(value);
  return /^\d{4}-\d{2}$/.test(key) ? `${key.slice(0, 4)}年${Number(key.slice(5))}月` : key;
}

/** 按日期分月：月份倒序，组内保持传入顺序（调用方负责组内排序）。 */
export function groupByMonth(items, dateOf) {
  const groups = new Map();
  for (const item of items) {
    const key = monthKeyOf(dateOf(item));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, items]) => ({
    key,
    label: monthLabelOf(key),
    events: items,
  }));
}

export function groupEvents(events) {
  return groupByMonth(events, (event) => event.sourceDate);
}

export function groupCases(cases) {
  return groupByMonth(cases, (item) => item.eventDate);
}

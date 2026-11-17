// 案例搜索：网页和 Agent 接口（/api/agent/search）共用这一份，保证同一个词搜到同样的案例。
// - 原来的写法照旧有效：每个词都在案例文字里出现（caseSearchText）就算命中。
// - 名称模糊：漏字、词序乱，只要名称里能对上大约 3/4 的字就算命中，如「光明大富」→「光明地标大富翁」。
// - 拼音：服务端给名称算好 titlePinyin（音节用空格隔开），这里支持全拼「dafuweng」和首字母「gmdfw」。
import MiniSearch from 'minisearch';
import { caseSearchText, matchesTokens, tokenizeQuery } from './caseArchive.js';

const HAN = /\p{Script=Han}/u;
const NAME_FIELDS = ['title', 'py', 'ini'];
const tokenize = (text) => [...String(text || '').toLocaleLowerCase('zh-CN').matchAll(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)].map((m) => m[0]);
const isSubsequence = (needle, hay) => { let i = 0; for (const ch of hay) if (ch === needle[i]) i += 1; return i === needle.length; };

function pinyinOf(item) {
  const syllables = String(item.titlePinyin || '').toLowerCase().split(/\s+/).filter(Boolean);
  return { syllables, full: syllables.join(''), initials: syllables.map((s) => s[0]).join('') };
}

export function createCaseSearch(items = []) {
  const docs = items.map((item, id) => {
    const p = pinyinOf(item);
    return { id, title: item.title, py: [...p.syllables, p.full].join(' '), ini: p.initials, full: p.full,
      description: item.description, eventTitle: item.eventTitle, rest: caseSearchText(item) };
  });
  const index = new MiniSearch({
    fields: ['title', 'py', 'ini', 'description', 'eventTitle', 'rest'], tokenize,
    searchOptions: {
      boost: { title: 4, py: 3, ini: 2, description: 1.5, eventTitle: 1, rest: 0.3 }, combineWith: 'OR',
      prefix: (term) => !HAN.test(term), fuzzy: (term) => (!HAN.test(term) && term.length > 4 ? 0.2 : false),
    },
  });
  index.addAll(docs);

  return function search(query) {
    const words = tokenizeQuery(query);
    if (!words.length) return items;
    const terms = [...new Set(tokenize(query))];
    const need = Math.ceil(terms.length * 0.75);
    const scores = new Map();
    for (const hit of terms.length ? index.search(query) : []) {
      // match 的键是索引里命中的词（前缀/容错时和查询词不同），按「名称里命中几个词」计数。
      const inName = Object.values(hit.match).filter((fields) => fields.some((f) => NAME_FIELDS.includes(f))).length;
      scores.set(hit.id, { score: hit.score, byName: Math.min(inName, hit.queryTerms.length) >= need });
    }
    const compact = words.join('');
    const latin = /^[a-z]+$/.test(compact) && compact.length >= 2;
    const picked = [];
    docs.forEach((doc, id) => {
      const hit = scores.get(id);
      const byPinyin = latin && (doc.full.includes(compact) || (compact.length >= 3 && (doc.ini.includes(compact) || (compact[0] === doc.ini[0] && isSubsequence(compact, doc.ini)))));
      if (hit?.byName || byPinyin || matchesTokens(doc.rest, words)) picked.push({ id, score: (hit?.score || 0) + (byPinyin ? 10 : 0) });
    });
    return picked.sort((a, b) => b.score - a.score).map(({ id }) => items[id]);
  };
}

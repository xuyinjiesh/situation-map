#!/usr/bin/env node
/**
 * 時局圖 · 采集器（Phase 2 第 1–4 步）
 * ---------------------------------------------------------------------------
 * 只做四件事，做完就交棒给 scripts/pipeline.mjs 的入库闸门：
 *   1. 抓取   —— 拉各个源的 RSS/Atom，**原文快照按日落盘**（唯一不可再生的资产）
 *   2. 解析   —— 归一成 {title, url, date, summary, source}
 *   3. 映射   —— 用规则词典把文本映射到行为体 / 门类 / 地点 / 强度
 *   4. 归并   —— 同一事件的多源报道合成一个簇，多源交叉本身就是可信度
 *
 * 它**永远不写 src/data/**。产物落在 data/raw/，必须人工过一眼再 promote。
 * 这条边界是故意的：自动抽取可以自动跑，但进了球面的东西要有人负责。
 *
 * 用法：
 *   node scripts/collect.mjs --probe                    # 只测源连通性
 *   node scripts/collect.mjs                            # 默认抓近 48 小时
 *   node scripts/collect.mjs --since-hours 24 --limit 30
 *   node scripts/collect.mjs --sources bbc-world,people-world
 *   node scripts/collect.mjs --no-snapshot --dry        # 不落盘，只看统计
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { SOURCES, TIER_CONFIDENCE } from './sources.mjs';
import { compileRules, RELEVANCE_FLOOR, TITLE_NOISE, NOISE_TITLE_PATTERNS, STOP_TOKENS, EXTRACT_FROM } from './lib/rules.mjs';
// 门类表的单一来源。Node ≥ 22.18 支持类型剥离，可以直接 import .ts。
import { CATEGORIES } from '../src/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  gazetteer: resolve(ROOT, 'data/gazetteer.json'),
  actorGazetteer: resolve(ROOT, 'data/gazetteer.actors.json'),
  countryGazetteer: resolve(ROOT, 'data/gazetteer.countries.json'),
  rawDir: resolve(ROOT, 'data/raw'),
  autoDir: resolve(ROOT, 'data/raw/auto'),
  snapshotDir: resolve(ROOT, 'data/raw/snapshots'),
};
const UA = 'Mozilla/5.0 (compatible; situation-map/0.3; +https://github.com/) research-collector';

// ------------------------------------------------------------------ 小工具

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const DAY = 86400000;

/** 把 fast-xml-parser 可能给出的各种形状（字符串/数字/对象/#text/数组）压成字符串。 */
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? v['@_href'] ?? '');
  return '';
}

function stripHtml(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(t) {
  let out = t;
  for (const re of TITLE_NOISE) out = out.replace(re, '');
  return out.replace(/\s+/g, ' ').trim();
}

/** 归一化 + 抽 token（中文取二元组，拉丁取词）。用于判断两条标题是不是同一件事。 */
function tokens(s) {
  const out = new Set();
  const lower = s.toLowerCase();
  for (const w of lower.match(/[a-z][a-z0-9'-]{2,}/g) ?? []) {
    if (!STOP_TOKENS.has(w)) out.add(w);
  }
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i += 1) out.add(run.slice(i, i + 2));
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * 短文本相似度。
 *
 * Jaccard 对标题这种短文本过于苛刻：Jaccard 的分母是并集，两条各 10 个词的标题
 * 只要各自多带了 2 个修饰词，分数就被稀释到 0.2 上下——而它们很可能就是同一件事。
 * 实测的一对：
 *   "Russia strikes Kyiv bridge as German chancellor visits Ukraine in show of support"
 *   "Kyiv bridge hit in further Russian drone attack as German chancellor makes surprise visit"
 * Jaccard = 4/18 = 0.22（撞不过 0.34），共享词 4 个（kyiv/bridge/german/chancellor）。
 *
 * 所以改成两个条件同时成立才算同一事件：
 *   1. 共享 token 数 ≥ 3 —— 保证不是靠一两个通用词凑出来的巧合；
 *   2. 重合度（共享 / 较短一边）≥ 0.35 —— 保证不是长标题把短标题"包住"。
 * 用重合度而不是 Jaccard，是因为并集惩罚对短文本没有意义。
 */
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return { shared: 0, ratio: 0 };
  let shared = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) shared += 1;
  return { shared, ratio: shared / small.size };
}

const hashId = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// -------------------------------------------------------------- 规则匹配
// 编译逻辑住在 rules.mjs 里，和模式串放在一起，避免"改了一处忘了另一处"。

/**
 * 命中即停：一条新闻只归一个门类。短语覆盖优先于关键词表，见 rules.mjs 的说明。
 *
 * minHits 是召回与精度之间的那道闸：
 *   标题命中 1 个关键词就认（标题是定性，信噪比高）；
 *   退回正文时要命中 2 个才认（正文是背景，单个词很容易是巧合）。
 * 这样既补回了召回率，又不会把行为体和地点也一起污染——那两样始终只看标题。
 */
function classifyCategory(haystack, rules, minHits = RELEVANCE_FLOOR) {
  for (const { category, re } of rules.overrides) {
    if (re.test(haystack)) return { category, hits: ['短语覆盖'] };
  }
  for (const { category, keywords, res } of rules.categories) {
    const hits = [];
    for (let i = 0; i < res.length; i += 1) {
      if (res[i].test(haystack)) hits.push(keywords[i]);
    }
    if (hits.length >= minHits) return { category, hits: hits.slice(0, 4) };
  }
  return null;
}

/**
 * 行为体识别，**按在文本中出现的先后排序**。
 *
 * 顺序不是装饰：地点解析在只定位到国家时会取第一个行为体作锚点，
 * 而记者习惯把主语前置——"North Korea launches missile after Seoul demands apology"
 * 的主语是朝鲜，锚点应该是平壤而不是首尔。
 * 第一版按 ACTOR_RULES 的书写顺序返回，导致几乎所有事件都锚到了 usa（因为美国在字典第一行），
 * 整张图变成了"全世界的事都发生在华盛顿"。
 */
function detectActors(text, rules) {
  const found = [];
  for (const { id, res } of rules.actors) {
    let pos = -1;
    for (const re of res) {
      const m = re.exec(text);
      if (m && (pos < 0 || m.index < pos)) pos = m.index;
    }
    if (pos >= 0) found.push({ id, pos });
  }
  return found.sort((a, b) => a.pos - b.pos).map((f) => f.id).slice(0, 4);
}

/** 正则元字符转义。
 * 用显式集合 + fromCharCode 写，而不是 /[.*+?^${}()|[\]\\]/g ：
 * 前者一眼能读懂，后者在多层字符串里嵌套转义时错一次就毁掉整个文件（已经毁过一次）。
 */
const BS = String.fromCharCode(92);
const REGEX_SPECIALS = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', BS]);
const esc = (t) => [...t].map((ch) => (REGEX_SPECIALS.has(ch) ? BS + ch : ch)).join('');

/**
 * 名称匹配索引。策展地名册、国家地名册共用这一套。
 *
 * 两个刻意的设计：
 *   1. **ASCII 名区分大小写**（不加 i 标志）。英文地名在标题里必定大写，因此
 *      "turkey"（火鸡）、"china"（瓷器）、"us"（我们）这类同形词不会被误命中。
 *      中文名没有大小写概念，走子串匹配。
 *   2. **词边界按首尾字符决定**。'U.S.' 以非单词字符结尾，若在尾部硬加 \b，
 *      "U.S. envoy" 就永远匹配不上（'.' 与空格之间没有词边界）。
 *
 * 每个名称一条 pattern，但都指向同一个 entry——所以别名命中时最终 emit 的
 * 仍然是规范中文名（"Kyiv" → 基辅）。
 */
function buildNameIndex(entries) {
  const out = [];
  for (const c of entries) {
    for (const name of c.names) {
      const head = /^[A-Za-z0-9]/.test(name) ? '\\b' : '';
      const tail = /[A-Za-z0-9]$/.test(name) ? '\\b' : '';
      out.push({
        re: new RegExp(`${head}${esc(name)}${tail}`),
        zh: c.zh,
        lat: c.lat,
        lon: c.lon,
        len: name.length,
      });
    }
  }
  return out;
}

/** 从 data/gazetteer.json 造索引：规范中文名 + 每条自带的英文别名。 */
function placeEntriesFromGazetteer(gz) {
  return Object.entries(gz)
    .filter(([zh]) => !zh.startsWith('_'))
    .map(([zh, v]) => ({ names: [zh, ...(v.aliases ?? [])], zh, lat: v.lat, lon: v.lon, kind: 'place' }));
}

/** 从 data/gazetteer.countries.json 造索引。 */
function countryEntriesFromGazetteer(raw) {
  return raw.countries.map((c) => ({
    names: c.names,
    zh: c.zh,
    lat: c.lat,
    lon: c.lon,
    kind: 'country',
  }));
}

/**
 * 地点解析：具体地点与国家**合并成一次检索**，按在标题中出现的先后取最优解。
 *
 * 这里曾经是严格分层的（先查 85 条具体地点，查不到再查 175 国），结果是
 * "North Korea launches ballistic missile after Seoul demands apology"
 * 落到了**首尔**——"首尔"一命中城市层就短路了，而导弹的现场是朝鲜。
 * 一条标题里的城市未必是事发地，它可能只是消息来源。
 * 同理，别名的价值在于英文标题终于能进这一层：以前 gazetteer.json 的键只有中文，
 * "German Chancellor in Kyiv" 匹配不到"基辅"，一路退到国家层，点落在乌克兰中部。
 *
 * 现在的规则只有一条：**取标题里最早提到的地点**。
 * 同位置取名字更长的（"几内亚比绍" 优先于 "几内亚"），
 * 名字一样长时取更具体的（具体地点优先于国家）。
 * 记者把主语和事发地前置，这条启发式在实测里比"分层短路"稳得多。
 *
 * 只取一个地点：自动抽取的事件给一个权威现场就够了，
 * 多现场的丰富度是人工策展才该有的东西。
 * 最后一层仍是行为体代表坐标（标题只提到"华盛顿"而没提"美国"时兜底）。
 */
function resolvePlaces(haystack, actorIds, nameIndex, actorGazetteer) {
  let best = null;
  for (const c of nameIndex) {
    const m = c.re.exec(haystack);
    if (!m) continue;
    const better =
      !best ||
      m.index < best.pos ||
      (m.index === best.pos && c.len > best.len) ||
      (m.index === best.pos && c.len === best.len && c.kind === 'place' && best.kind === 'country');
    if (better) best = { pos: m.index, len: c.len, kind: c.kind, entry: c };
  }
  if (best) {
    return [{ name: best.entry.zh, lat: best.entry.lat, lon: best.entry.lon, role: 'site' }];
  }

  // 最后一层：行为体代表坐标
  for (const id of actorIds) {
    const a = actorGazetteer[id];
    if (a) return [{ name: a.name, lat: a.lat, lon: a.lon, role: 'site' }];
  }

  return [];
}

function scoreSeverity(haystack, actorCount, rules) {
  let score = 2;
  for (const { delta, res } of rules.severity) {
    if (res.some((re) => re.test(haystack))) score += delta;
  }
  if (actorCount >= 3) score += 1;
  return Math.max(1, Math.min(5, score));
}

// ---------------------------------------------------------------- 抓取

/**
 * 把各种失败翻译成人能看懂的一句话。
 *
 * 原来所有失败都显示 `fetch failed`——那是 undici 的笼统外层错误，
 * 真正的原因藏在 `e.cause.code` 里（ECONNRESET / ENOTFOUND / UND_ERR_CONNECT_TIMEOUT）。
 * 分不清"超时"和"被限流"和"域名解析不了"，就没法判断该重试还是该换源。
 */
function describeFetchError(e) {
  if (!e) return '未知错误';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '超时';
  const code = e.cause?.code ?? e.code;
  if (code) return String(code);
  return e.message ?? '未知错误';
}

/**
 * 抓一个源。带重试与退避。
 *
 * 实测教训：同一批源十几分钟前全部正常，再跑一次就有 6 个报 `fetch failed`——
 * 全是瞬时故障。没有重试的话，一次网络抖动 = 整个源这一轮全军覆没，
 * 而且报告里只留一句没有信息量的错误，看起来像源挂了。
 *
 * 4xx 不重试（除了 429）：403/404 是源那边的问题，重试只是浪费时间和礼貌。
 */
async function fetchFeed(source, { timeoutMs = 20000, attempts = 3 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (!res.ok) {
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        const err = new Error(`HTTP ${res.status}`);
        if (permanent) err.permanent = true;
        throw err;
      }
      return await res.text();
    } catch (e) {
      last = e;
      if (e.permanent) break;
      if (i < attempts) await new Promise((r) => setTimeout(r, i === 1 ? 1200 : 3500));
    }
  }
  const tries = last?.permanent ? 1 : attempts;
  throw new Error(`${describeFetchError(last)}${tries > 1 ? `（重试 ${tries} 次仍失败）` : ''}`);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

function extractRawItems(xml) {
  const doc = parser.parse(xml);
  const rdf = doc['rdf:RDF'];
  if (rdf) return asArray(rdf.item);
  if (doc.rss) return asArray(doc.rss.channel?.item);
  if (doc.feed) return asArray(doc.feed.entry);
  return [];
}

function normalizeItem(item) {
  const title = stripHtml(text(item.title));

  let link = text(item.link);
  if (Array.isArray(item.link)) {
    const alt = item.link.find((l) => l?.['@_rel'] === 'alternate') ?? item.link[0];
    link = alt?.['@_href'] ?? '';
  }
  if (!link && item.link?.['@_href']) link = item.link['@_href'];
  if (!link) link = text(item.guid) || text(item['@_rdf:about']);

  const dateRaw =
    text(item.pubDate) || text(item['dc:date']) || text(item.published) || text(item.updated) || text(item.date);
  const body =
    text(item.description) || text(item.summary) || text(item['content:encoded']) || text(item.content);

  return { title, link, dateRaw, body: stripHtml(body) };
}

// ---------------------------------------------------------------- 归并

function cluster(items) {
  const clusters = [];

  for (const item of items) {
    // 簇键刻意**不含行为体集合**。第一版把它放进去了，结果不同媒体提到的行为体数量不同，
    // 同一个事件永远撞不到一起，85 条候选归并出 85 个簇——等于没归并。
    // 现在只按「门类 + 首要地点」分桶，是否同一事件交给标题相似度判断，并允许跨 1 天。
    // 桶键只按门类。曾经把"首要地点"也放进桶键，结果同一个事件在不同媒体那里
    // 因为锚点不同（莫斯科 vs 基辅）落进不同桶，永远比不到一起——多源交叉一直是 0。
    // 是不是同一个事件，本来就该由标题相似度判断，不该由桶键预先决定。
    const key = item.category;

    let target = null;
    for (const c of clusters) {
      if (c.key !== key) continue;
      if (Math.abs(c.day - item.day) > 1) continue;
      const hit = c.members.some((m) => {
        const { shared, ratio } = similarity(m.tokens, item.tokens);
        return shared >= 3 && ratio >= 0.35;
      });
      if (hit) {
        target = c;
        break;
      }
    }

    if (target) target.members.push(item);
    else clusters.push({ key, day: item.day, members: [item] });
  }

  return clusters;
}

const TIER_RANK = { official: 0, wire: 1, outlet: 2 };

function toEvent(cluster) {
  const members = cluster.members.slice().sort((a, b) => {
    const t = (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3);
    return t !== 0 ? t : a.date - b.date;
  });
  const rep = members[0];

  const actors = [...new Set(members.flatMap((m) => m.actors))].slice(0, 4);
  const places = [];
  for (const m of members) {
    for (const p of m.places) {
      if (places.length >= 3) break;
      if (!places.some((q) => q.name === p.name)) places.push(p);
    }
  }

  const merged = members.map((m) => `${m.title} ${m.body}`).join(' \n ');
  const severity = scoreSeverity(merged, actors.length, RULES);

  // 多源交叉：独立信源越多，越不像单家媒体的独家口径
  const distinctSources = new Set(members.map((m) => m.sourceId)).size;
  const base = TIER_CONFIDENCE[rep.tier] ?? 0.5;
  const crossFactor = distinctSources >= 3 ? 1.0 : distinctSources === 2 ? 0.8 : 0.5;

  return {
    id: `auto-${hashId(rep.url)}`,
    title: rep.title,
    date: isoDay(rep.date),
    category: rep.category,
    actors,
    places,
    summary: rep.body.slice(0, 220) || rep.title,
    severity,
    confidence: 'reported',
    sources: members.map((m) => ({ label: m.sourceName, url: m.url })),
    tags: [...new Set(members.flatMap((m) => m.categoryHits))].slice(0, 5),
    // 下面两个字段不在 schema 里，是给人工复核用的线索；promote 前会被闸门忽略
    _score: Number((base * crossFactor).toFixed(2)),
    _sources: distinctSources,
  };
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const args = argv.slice(2);
  const flag = (name, def) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return def;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
  return {
    probe: args.includes('--probe'),
    dry: args.includes('--dry'),
    noSnapshot: args.includes('--no-snapshot'),
    limit: Number(flag('limit', 60)),
    sinceHours: Number(flag('since-hours', 48)),
    sample: Number(flag('sample', 0)),
    sources: String(flag('sources', '')).split(',').filter(Boolean),
  };
}

const RULES = compileRules();

// 门类表的**成员**必须与 src/types.ts 的 CATEGORIES 完全一致。
// 出现过的两种腐烂方式，都值得当场失败：
//   加了新门类但忘了在 rules.mjs 加规则 → 图例上多出一个永远为空的格子
//     （加"政治"门类时就是先改了 types.ts，靠这条断言把 rules.mjs 补上）；
//   rules.mjs 里用了 types.ts 不认识的门类 → 事件带着非法值被闸门挡下。
//
// 但**顺序允许不同，而且刻意不同**：
//   src/types.ts 的顺序 = 图例的展示顺序（按语义分组：兵政交 / 财能技 / 候民）
//   rules.mjs 的顺序   = 判定优先级（越"硬"越靠前：技在能前、能在财前，
//                        所以一条"出口管制 + 贸易"的新闻归技术而不是经济）
// 写这条断言的副产物：它当场抓出这两张表从来就没同过序，只是之前没人比对过。
{
  const ruleSet = new Set(RULES.categories.map((c) => c.category));
  const missing = CATEGORIES.filter((c) => !ruleSet.has(c));
  const extra = [...ruleSet].filter((c) => !CATEGORIES.includes(c));
  if (missing.length || extra.length) {
    console.error('✗ 门类表成员不一致：');
    if (missing.length) console.error(`  rules.mjs 缺少这些门类的规则：${missing.join(', ')}`);
    if (extra.length) console.error(`  rules.mjs 多出未登记的门类：${extra.join(', ')}`);
    process.exit(1);
  }
}

async function probe() {
  console.log('源连通性实测（每个源只发一次请求）\n' + '─'.repeat(64));
  for (const s of SOURCES) {
    process.stdout.write(`${s.id.padEnd(20)} `);
    try {
      const xml = await fetchFeed(s);
      const n = extractRawItems(xml).length;
      console.log(`✓ ${String(n).padStart(3)} 条  ${(xml.length / 1024).toFixed(0)}KB  ${s.name}`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.probe) return probe();

  const gazetteer = existsSync(P.gazetteer) ? readJson(P.gazetteer) : {};
  const actorGazetteer = existsSync(P.actorGazetteer) ? readJson(P.actorGazetteer) : {};
  if (!existsSync(P.countryGazetteer)) {
    console.warn('⚠ 未找到 data/gazetteer.countries.json，地点检索将只有 85 条具体地点。');
    console.warn('  生成：npm run countries\n');
  }
  // 具体地点与国家合成**同一个索引**，由"出现位置"统一裁决，不再分层短路。
  const nameIndex = buildNameIndex([
    ...placeEntriesFromGazetteer(gazetteer),
    ...(existsSync(P.countryGazetteer) ? countryEntriesFromGazetteer(readJson(P.countryGazetteer)) : []),
  ]);
  const since = Date.now() - opts.sinceHours * 3600_000;
  const today = new Date().toISOString().slice(0, 10);

  // 参与采集的源：近事类、未停用、且匹配 --sources。
  // 停用的源仍然会出现在报告表格里（带着"已停用"的理由），但不该被算进
  // 批次元信息的 sources 列表——否则回头查"这批数据来自哪"会看到几个一条没抓的源。
  const selected = SOURCES.filter(
    (s) => !s.disabled && s.kind === 'news' && (opts.sources.length === 0 || opts.sources.includes(s.id)),
  );

  console.log(`采集窗口：近 ${opts.sinceHours} 小时    源：${selected.length} 个\n` + '─'.repeat(64));

  const stats = { fetched: 0, droppedNoDate: 0, droppedOld: 0, droppedNoActor: 0, droppedNoPlace: 0, droppedNoCategory: 0, droppedNoise: 0 };
  const collected = [];
  const droppedSamples = [];
  const thinktankItems = [];
  const sourceRows = [];

  if (!opts.noSnapshot) mkdirSync(resolve(P.snapshotDir, today), { recursive: true });

  for (const s of SOURCES) {
    // 停用的源也要进报告表（带着停用理由），但不抓取
    if (!selected.includes(s) && s.kind !== 'thinktank' && !s.disabled) continue;
    // 每个源的丢弃原因分开记。第一版只有总数，结果有三个源入库 0 条却看不出为什么——
    // 没有这个分解，调规则就是盲调。
    const st = { raw: 0, kept: 0, noDate: 0, old: 0, noCat: 0, noActor: 0, noPlace: 0, noise: 0, newest: 0 };
    if (s.disabled) {
      sourceRows.push([s.id, { ...st, error: `已停用：${s.note ?? '—'}` }]);
      continue;
    }
    try {
      const xml = await fetchFeed(s);
      if (!opts.noSnapshot) {
        writeFileSync(resolve(P.snapshotDir, today, `${s.id}.xml`), xml);
      }

      // 每个源只取前 N 条。RSS 一般按时间倒序，前 N 条就是最新的一批；
      // 人民网一次给 100 条，不设上限会稀释掉真正当日的新闻。
      const raw = extractRawItems(xml).slice(0, opts.limit);
      st.raw = raw.length;

      for (const r of raw) {
        const it = normalizeItem(r);
        if (!it.title || !it.link) continue;
        stats.fetched += 1;

        if (s.kind === 'thinktank') {
          thinktankItems.push({ title: it.title, url: it.link, date: it.dateRaw, source: s.name });
          continue;
        }

        const date = Date.parse(it.dateRaw);
        if (Number.isNaN(date)) {
          stats.droppedNoDate += 1;
          st.noDate += 1;
          continue;
        }
        if (date > st.newest) st.newest = date;
        if (date < since) {
          stats.droppedOld += 1;
          st.old += 1;
          continue;
        }

        // 聚合式报道（直播贴、图集、评论）是容器不是事件，入口就拦掉
        if (NOISE_TITLE_PATTERNS.some((re) => re.test(it.title))) {
          stats.droppedNoise += 1;
          st.noise += 1;
          continue;
        }

        // 行为体与地点只用标题（正文里的无关提及会把地点锚错，实测代价极大）；
        // 门类允许退回正文，但要求 ≥2 个关键词命中。见 rules.mjs 的 EXTRACT_FROM 说明。
        const titleHay = EXTRACT_FROM === 'title' ? it.title : `${it.title} ${it.body}`;
        let cat = classifyCategory(titleHay, RULES, 1);
        if (!cat && EXTRACT_FROM === 'title') {
          cat = classifyCategory(`${it.title} ${it.body.slice(0, 300)}`, RULES, 2);
        }
        if (!cat) {
          stats.droppedNoCategory += 1;
          st.noCat += 1;
          if (droppedSamples.length < 12) droppedSamples.push(`[${s.id}] ${it.title}`);
          continue;
        }
        const actors = detectActors(titleHay, RULES);
        if (actors.length === 0) st.noActor += 1; // 记录但不丢弃，见下方 places 的说明
        const places = resolvePlaces(titleHay, actors, nameIndex, actorGazetteer);
        // 只有"连地点都定不下来"才丢。行为体可以为空——那是视觉层的概念（有没有徽记字），
        // 不该反过来决定一条真新闻能不能进数据集。埃塞俄比亚不在 37 个行为体里，
        // 但"埃塞俄比亚提格雷的冲突"显然该进图。
        if (places.length === 0) {
          stats.droppedNoPlace += 1;
          st.noPlace += 1;
          continue;
        }

        st.kept += 1;
        collected.push({
          title: cleanTitle(it.title),
          url: it.link,
          date,
          day: Math.floor(date / DAY),
          body: it.body,
          sourceId: s.id,
          sourceName: s.name,
          tier: s.tier,
          category: cat.category,
          categoryHits: cat.hits,
          actors,
          places,
          tokens: tokens(cleanTitle(it.title)),
        });
      }
      sourceRows.push([s.id, st]);
    } catch (e) {
      sourceRows.push([s.id, { ...st, error: e.message }]);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // 同一条新闻可能被多个源引用，按 URL 去重
  const byUrl = new Map();
  for (const item of collected) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const unique = [...byUrl.values()];

  const clusters = cluster(unique).map(toEvent);
  clusters.sort((a, b) => b.severity - a.severity || b._score - a._score || (a.date < b.date ? 1 : -1));

  // ------------------------------------------------------------- 报告
  // 每源一行，丢弃原因分列。这比只有一个总数有用得多：一眼能看出是源本身的问题
  // （超窗 / 无日期），还是规则的问题（未分类 / 无行为体）。
  console.log(
    '源'.padEnd(18) + '原始'.padStart(5) + '入库'.padStart(6) +
    '聚合贴'.padStart(7) + '超窗'.padStart(6) + '未分类'.padStart(7) + '无行为体'.padStart(8) + '无日期'.padStart(7) + '无地点'.padStart(7),
  );
  for (const [id, st] of sourceRows) {
    if (st.error) {
      console.log(String(id).padEnd(18) + `   ✗ ${st.error}`);
      continue;
    }
    console.log(
      String(id).padEnd(18) +
        String(st.raw).padStart(5) + String(st.kept).padStart(6) +
        String(st.noise).padStart(7) + String(st.old).padStart(6) +
        String(st.noCat).padStart(7) + String(st.noActor).padStart(8) + String(st.noDate).padStart(7) + String(st.noPlace).padStart(7),
    );
  }

  // 新鲜度告警。死源最危险的形态不是报错，而是**安静地返回 0 条**——
  // 那样你只会觉得"今天新闻少"，永远不会去查源。所以这里主动把可疑的源点出来。
  const STALE_HOURS = 24 * 7;
  const stale = [];
  for (const [id, st] of sourceRows) {
    // 智库源按设计就不走日期/事件那条链，不参与新鲜度告警
    if (SOURCES.find((x) => x.id === id)?.kind === 'thinktank') continue;
    if (st.error || st.raw === 0) continue;
    if (st.newest === 0) {
      stale.push(`${id.padEnd(18)} ${st.raw} 条全部缺日期`);
    } else {
      const ageH = (Date.now() - st.newest) / 3600_000;
      if (ageH > STALE_HOURS) stale.push(`${id.padEnd(18)} 最新一条在 ${Math.round(ageH / 24)} 天前`);
    }
  }
  if (stale.length) {
    console.log(`\n⚠ 疑似失效的源（最新条目超过 ${STALE_HOURS / 24} 天，或整批缺日期）`);
    for (const s of stale) console.log(`   ${s}`);
    console.log('   保留在清单里是为了让告警每次都能报出来；源恢复后告警会自动消失。');
  }

  console.log('─'.repeat(64));
  console.log(`原始条目        ${stats.fetched}`);
  console.log(`丢弃 · 无日期   ${stats.droppedNoDate}`);
  console.log(`丢弃 · 超出窗口 ${stats.droppedOld}`);
  console.log(`丢弃 · 聚合贴   ${stats.droppedNoise}`);
  console.log(`丢弃 · 未分类   ${stats.droppedNoCategory}`);
  console.log(`丢弃 · 无行为体 ${stats.droppedNoActor}`);
  console.log(`丢弃 · 无地点   ${stats.droppedNoPlace}`);
  console.log(`通过            ${unique.length}`);
  console.log(`归并后事件簇    ${clusters.length}   （${unique.length - clusters.length} 条并入其他簇）`);

  const byCat = {};
  for (const e of clusters) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
  console.log(`门类分布        ${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join('  ')}`);

  const multi = clusters.filter((c) => c._sources > 1).length;
  console.log(`多源交叉         ${multi} 个事件由 ≥2 家独立信源报道`);

  if (thinktankItems.length) {
    console.log(`大势素材        ${thinktankItems.length} 篇智库文章（不做事件抽取，只进选题池）`);
  }

  if (opts.sample > 0) {
    if (droppedSamples.length) {
      console.log(`\n被丢弃的"未分类"样本 ${droppedSamples.length} 条（用于回头看是否误杀）`);
      console.log('─'.repeat(64));
      for (const t of droppedSamples) console.log(`  · ${t}`);
    }
    console.log(`\n抽样 ${Math.min(opts.sample, clusters.length)} 条（按强度与多源交叉排序）`);
    console.log('─'.repeat(64));
    for (const e of clusters.slice(0, opts.sample)) {
      console.log(`[${e.category}] 强度${e.severity} 确信${e._score} ${e._sources}源  ${e.date}`);
      console.log(`  ${e.title}`);
      console.log(`  ${e.actors.join(',')} → ${e.places.map((p) => p.name).join(',')}   tags: ${e.tags.join('/')}`);
    }
  }

  if (opts.dry) {
    console.log('\n--dry：未落盘。');
    return;
  }

  mkdirSync(P.autoDir, { recursive: true });
  const outFile = resolve(P.autoDir, `events-${today}.json`);
  const payload = {
    _meta: {
      generatedAt: new Date().toISOString(),
      windowHours: opts.sinceHours,
      sources: selected.map((s) => s.id),
      counts: { fetched: stats.fetched, kept: unique.length, clustered: clusters.length },
      note: '规则抽取产物，未经人工复核。promote 前请逐条核对标题、行为体与地点。',
    },
    events: clusters,
  };
  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(resolve(P.rawDir, 'events.auto.json'), `${JSON.stringify(payload.events, null, 2)}\n`);

  if (thinktankItems.length) {
    writeFileSync(
      resolve(P.autoDir, `thinktank-${today}.json`),
      `${JSON.stringify(thinktankItems, null, 2)}\n`,
    );
  }

  console.log(`\n✓ ${outFile}`);
  console.log(`✓ data/raw/events.auto.json（最新一次，供闸门直接读）`);
  if (!opts.noSnapshot) console.log(`✓ 原文快照 data/raw/snapshots/${today}/`);
  console.log(`\n下一步：\n  node scripts/pipeline.mjs --check data/raw/events.auto.json --kind events`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

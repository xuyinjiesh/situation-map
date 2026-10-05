#!/usr/bin/env node
/**
 * 時局圖 · 入库闸门
 * ---------------------------------------------------------------------------
 * 这个脚本是"手工策展"与"自动采集"之间的那条缝。Phase 1 里它主要做三件事：
 *   1. 用同一套规则校验候选数据，把坏条目挡在 src/data 之外；
 *   2. 用地名册（data/gazetteer.json）给只有地名、没有坐标的条目补经纬度；
 *   3. 打印当前数据集体检报告。
 *
 * 将来接 RSS / LLM 采集时，采集器只需要往 data/raw/ 里写候选 JSON，
 * 然后调用：node scripts/pipeline.mjs --promote data/raw/events.candidate.json --kind events
 *
 * 用法：
 *   node scripts/pipeline.mjs --report
 *   node scripts/pipeline.mjs --check   data/raw/events.candidate.json --kind events
 *   node scripts/pipeline.mjs --promote data/raw/events.candidate.json --kind events
 *
 * 注意：src/data/load.ts 里有同一套校验，浏览器端会再查一遍。
 * 两处规则必须同步修改——这里改动时请一并更新 load.ts，并在 README 的"数据契约"里记一笔。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = {
  actors: resolve(ROOT, 'src/data/actors.json'),
  events: resolve(ROOT, 'src/data/events.json'),
  trends: resolve(ROOT, 'src/data/trends.json'),
  meta: resolve(ROOT, 'src/data/meta.json'),
  gazetteer: resolve(ROOT, 'data/gazetteer.json'),
};

// 门类表**不在这里定义**，从 src/types.ts 读——单一来源。
//
// 这里原本有一份手抄的副本，加"政治"门类时忘了同步，闸门立刻把 8 条 politics 事件
// 判成"未知门类"。这类重复枚举是必然会腐烂的：app 侧、闸门侧、规则侧各有一份，
// 改一处另两处不会报错。
//
// Node ≥ 22.18 原生支持类型剥离，可以从 .mjs 直接 import .ts，所以这份副本可以删掉。
let CATEGORIES;
try {
  ({ CATEGORIES } = await import('../src/types.ts'));
} catch (e) {
  console.error('无法从 src/types.ts 读取门类表。');
  console.error('这需要 Node ≥ 22.18（原生类型剥离）。当前版本：' + process.version);
  console.error(e.message);
  process.exit(1);
}

const HORIZONS = ['1y', '3y', '10y'];
const DIRECTIONS = ['rising', 'falling', 'stable', 'volatile'];
const CONFIDENCES = ['illustrative', 'reported', 'verified'];
const ROLES = ['origin', 'site', 'target'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// --------------------------------------------------------------------- 校验

/**
 * 地名册现在是 `{ 规范中文名: { lat, lon, aliases[] } }`。
 * 建一张「任意名字 → 条目」的反查表，这样候选数据里写英文名（Kyiv）也能补出坐标，
 * 并且会被**规范化成中文名**——球面上的地点标签统一是中文。
 */
function buildPlaceResolver(gazetteer) {
  const map = new Map();
  for (const [zh, v] of Object.entries(gazetteer)) {
    if (zh.startsWith('_')) continue;
    const entry = { name: zh, lat: v.lat, lon: v.lon };
    map.set(zh, entry);
    for (const alias of v.aliases ?? []) {
      if (!map.has(alias)) map.set(alias, entry);
    }
  }
  return map;
}

function checkPlaces(places, where, issues, { gazetteer, fill }) {
  if (!Array.isArray(places) || places.length === 0) {
    issues.push({ level: 'error', where, message: '至少需要一个地点' });
    return [];
  }
  const out = [];
  for (const raw of places) {
    const place = { ...raw };
    if (place.name && (!isFiniteNumber(place.lat) || !isFiniteNumber(place.lon))) {
      const hit = gazetteer.get(place.name);
      if (hit) {
        place.lat = hit.lat;
        place.lon = hit.lon;
        // 别名命中时改写成规范中文名，球面标签才统一
        if (place.name !== hit.name) place.name = hit.name;
        if (fill) {
          issues.push({ level: 'warn', where, message: `坐标由地名册补全：${place.name}` });
        }
      } else {
        issues.push({ level: 'error', where, message: `缺少坐标，且地名册里没有「${place.name}」` });
      }
    }
    if (!isFiniteNumber(place.lat) || !isFiniteNumber(place.lon)) {
      issues.push({ level: 'error', where, message: `坐标非法：${JSON.stringify(raw)}` });
      continue;
    }
    if (Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
      issues.push({ level: 'error', where, message: `坐标越界：${place.name} ${place.lat},${place.lon}` });
    }
    if (!ROLES.includes(place.role)) {
      issues.push({ level: 'error', where, message: `未知角色：${String(place.role)}` });
      place.role = 'site';
    }
    out.push(place);
  }
  return out;
}

export function validateEvents(events, actorIds, gazetteer, { fill = false } = {}) {
  const issues = [];
  const seen = new Set();
  const out = [];

  if (!Array.isArray(events)) return { issues: [{ level: 'error', where: 'events', message: '不是数组' }], out };

  for (const raw of events) {
    const where = `event:${raw.id ?? '(无 id)'}`;
    const evt = { ...raw };

    if (!evt.id) issues.push({ level: 'error', where, message: '缺少 id' });
    else if (seen.has(evt.id)) issues.push({ level: 'error', where, message: 'id 重复' });
    seen.add(evt.id);

    if (!evt.title?.trim()) issues.push({ level: 'error', where, message: '缺少 title' });
    if (!CATEGORIES.includes(evt.category)) {
      issues.push({ level: 'error', where, message: `未知门类：${String(evt.category)}` });
    }
    if (Number.isNaN(Date.parse(evt.date))) {
      issues.push({ level: 'error', where, message: `日期无法解析：${String(evt.date)}` });
    }
    if (!isFiniteNumber(evt.severity) || evt.severity < 1 || evt.severity > 5) {
      issues.push({ level: 'error', where, message: `severity 应在 1..5，实为 ${String(evt.severity)}` });
    }
    if (!CONFIDENCES.includes(evt.confidence)) {
      issues.push({ level: 'warn', where, message: `未知可信度，按 illustrative 处理：${String(evt.confidence)}` });
      evt.confidence = 'illustrative';
    }
    // 声称已核实却没有链接，是数据里最容易糊弄过去的一处，单独拦一道。
    if (evt.confidence === 'verified' && !(evt.sources ?? []).some((s) => s?.url)) {
      issues.push({ level: 'error', where, message: 'confidence=verified 但没有任何带链接的信源' });
    }

    evt.actors = Array.isArray(evt.actors) ? evt.actors : [];
    for (const id of evt.actors) {
      if (!actorIds.has(id)) issues.push({ level: 'warn', where, message: `引用了未登记的行为体 ${id}` });
    }
    if (evt.actors.length === 0) issues.push({ level: 'warn', where, message: '没有登记任何行为体' });

    evt.places = checkPlaces(evt.places, where, issues, { gazetteer, fill });
    evt.sources = Array.isArray(evt.sources) ? evt.sources : [];
    out.push(evt);
  }

  return { issues, out };
}

export function validateTrends(trends, actorIds, gazetteer, { fill = false } = {}) {
  const issues = [];
  const seen = new Set();
  const out = [];

  if (!Array.isArray(trends)) return { issues: [{ level: 'error', where: 'trends', message: '不是数组' }], out };

  for (const raw of trends) {
    const where = `trend:${raw.id ?? '(无 id)'}`;
    const trend = { ...raw };

    if (!trend.id) issues.push({ level: 'error', where, message: '缺少 id' });
    else if (seen.has(trend.id)) issues.push({ level: 'error', where, message: 'id 重复' });
    seen.add(trend.id);

    if (!trend.title?.trim()) issues.push({ level: 'error', where, message: '缺少 title' });
    if (!HORIZONS.includes(trend.horizon)) {
      issues.push({ level: 'error', where, message: `未知时间尺度：${String(trend.horizon)}` });
    }
    if (!DIRECTIONS.includes(trend.direction)) {
      issues.push({ level: 'error', where, message: `未知方向：${String(trend.direction)}` });
    }
    if (!isFiniteNumber(trend.confidence) || trend.confidence < 0 || trend.confidence > 1) {
      issues.push({ level: 'error', where, message: `confidence 应在 0..1，实为 ${String(trend.confidence)}` });
    }
    if (Number.isNaN(Number(trend.since))) {
      issues.push({ level: 'warn', where, message: `since 不是年份：${String(trend.since)}` });
    }
    if (!trend.counterforce?.trim()) {
      issues.push({ level: 'warn', where, message: '没有写反向张力——趋势条目应当强迫自己写出对立面' });
    }

    trend.actors = Array.isArray(trend.actors) ? trend.actors : [];
    for (const id of trend.actors) {
      if (!actorIds.has(id)) issues.push({ level: 'warn', where, message: `引用了未登记的行为体 ${id}` });
    }

    trend.corridor = checkPlaces(trend.corridor, where, issues, { gazetteer, fill });
    if (trend.corridor.length < 2) {
      issues.push({ level: 'error', where, message: '走廊至少需要两个节点' });
    }

    trend.drivers = Array.isArray(trend.drivers) ? trend.drivers : [];
    trend.indicators = Array.isArray(trend.indicators) ? trend.indicators : [];
    if (trend.indicators.length === 0) {
      issues.push({ level: 'warn', where, message: '没有可观测指标，叙事无法被证伪' });
    }
    out.push(trend);
  }

  return { issues, out };
}

// ------------------------------------------------------------------- 报告

function report() {
  const actors = readJson(PATHS.actors);
  const events = readJson(PATHS.events);
  const trends = readJson(PATHS.trends);
  const meta = readJson(PATHS.meta);
  const gazetteer = buildPlaceResolver(existsSync(PATHS.gazetteer) ? readJson(PATHS.gazetteer) : {});
  const actorIds = new Set(actors.map((a) => a.id));

  const ev = validateEvents(events, actorIds, gazetteer);
  const tr = validateTrends(trends, actorIds, gazetteer, {});
  const issues = [...ev.issues, ...tr.issues];

  const byCat = {};
  for (const e of events) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
  const byHorizon = {};
  for (const t of trends) byHorizon[t.horizon] = (byHorizon[t.horizon] ?? 0) + 1;

  const usedActors = new Set();
  for (const e of events) for (const a of e.actors ?? []) usedActors.add(a);
  for (const t of trends) for (const a of t.actors ?? []) usedActors.add(a);
  const idle = actors.filter((a) => !usedActors.has(a.id)).map((a) => a.id);

  const dates = events.map((e) => Date.parse(e.date)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);

  console.log(`\n時局圖 数据集体检 · ${meta.version}（${meta.updated}）`);
  console.log('─'.repeat(56));
  console.log(`近事 ${events.length} 条   ${Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`大势 ${trends.length} 条   ${Object.entries(byHorizon).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`行为体 ${actors.length} 个（未使用 ${idle.length} 个${idle.length ? '：' + idle.join(',') : ''}）`);
  console.log(`地名册 ${gazetteer.size} 个名字（含别名）`);
  if (dates.length) {
    console.log(`时间跨度 ${new Date(dates[0]).toISOString().slice(0, 10)} → ${new Date(dates.at(-1)).toISOString().slice(0, 10)}`);
  }
  const dupes = events.map((e) => e.title).filter((t, i, arr) => arr.indexOf(t) !== i);
  if (dupes.length) console.log(`疑似重复标题：${dupes.join(' / ')}`);

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  console.log('─'.repeat(56));
  if (errors.length === 0 && warns.length === 0) {
    console.log('校验通过，无告警。\n');
    return 0;
  }
  for (const i of [...errors, ...warns]) {
    console.log(`${i.level === 'error' ? '✗' : '!'} [${i.where}] ${i.message}`);
  }
  console.log(`\n合计：${errors.length} 个错误，${warns.length} 个告警。\n`);
  return errors.length > 0 ? 1 : 0;
}

// -------------------------------------------------------------------- 闸门

function promote(file, kind) {
  if (!file || !existsSync(file)) {
    console.error(`候选文件不存在：${file}`);
    return 1;
  }
  const actors = readJson(PATHS.actors);
  const actorIds = new Set(actors.map((a) => a.id));
  const gazetteer = buildPlaceResolver(existsSync(PATHS.gazetteer) ? readJson(PATHS.gazetteer) : {});
  const candidate = readJson(file);

  const { issues, out } =
    kind === 'trends'
      ? validateTrends(candidate, actorIds, gazetteer, { fill: true })
      : validateEvents(candidate, actorIds, gazetteer, { fill: true });

  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '!'} [${i.where}] ${i.message}`);

  if (errors.length > 0) {
    console.error(`\n有 ${errors.length} 个错误，未写入。`);
    return 1;
  }

  const target = kind === 'trends' ? PATHS.trends : PATHS.events;
  copyFileSync(target, `${target}.bak`);
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

  const meta = readJson(PATHS.meta);
  const [major, minor, patch] = meta.version.replace(/^v/, '').split('.').map(Number);
  const nextVersion = meta.curated ? meta.version : `v${major}.${minor}.${(patch || 0) + 1}`;
  writeFileSync(
    PATHS.meta,
    `${JSON.stringify(
      { ...meta, version: nextVersion, updated: new Date().toISOString().slice(0, 10) },
      null,
      2,
    )}\n`,
  );

  console.log(`\n已写入 ${basename(target)}（原文件备份为 ${basename(target)}.bak），数据集版本 ${nextVersion}。`);
  console.log('记得跑一次 npm run typecheck && npm run build。');
  return 0;
}

function check(file, kind) {
  if (!file || !existsSync(file)) {
    console.error(`候选文件不存在：${file}`);
    return 1;
  }
  const actors = readJson(PATHS.actors);
  const actorIds = new Set(actors.map((a) => a.id));
  const gazetteer = buildPlaceResolver(existsSync(PATHS.gazetteer) ? readJson(PATHS.gazetteer) : {});
  const candidate = readJson(file);

  const { issues } =
    kind === 'trends'
      ? validateTrends(candidate, actorIds, gazetteer, { fill: true })
      : validateEvents(candidate, actorIds, gazetteer, { fill: true });

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '!'} [${i.where}] ${i.message}`);
  if (errors.length > 0) {
    console.log(`\n✗ ${errors.length} 个错误，${warns.length} 个告警 —— 不能入库。`);
  } else if (warns.length > 0) {
    console.log(`\n✓ 无错误，${warns.length} 个告警 —— 可以入库，但请先看过告警。`);
  } else {
    console.log('✓ 校验通过，无告警。');
  }
  return errors.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------- CLI

function main(argv) {
  if (!existsSync(resolve(ROOT, 'data'))) mkdirSync(resolve(ROOT, 'data'), { recursive: true });

  const args = argv.slice(2);
  const kindIdx = args.indexOf('--kind');
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : 'events';
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--kind');

  if (args.includes('--report') || args.length === 0) return report();
  if (args.includes('--check')) return check(positional[0], kind);
  if (args.includes('--promote')) return promote(positional[0], kind);

  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  return 1;
}

process.exit(main(process.argv));

import actorsRaw from './actors.json';
import eventsRaw from './events.json';
import trendsRaw from './trends.json';
import metaRaw from './meta.json';
import {
  CATEGORIES,
  type Actor,
  type Category,
  type Dataset,
  type DatasetMeta,
  type Direction,
  type Horizon,
  type SituationEvent,
  type Trend,
} from '../types';

export interface DatasetIssue {
  level: 'error' | 'warn';
  where: string;
  message: string;
}

const HORIZONS: readonly Horizon[] = ['1y', '3y', '10y'];
const DIRECTIONS: readonly Direction[] = ['rising', 'falling', 'stable', 'volatile'];

/**
 * 校验并装配数据集。
 *
 * 这里刻意不做静默兜底：任何引用不存在行为体、坐标越界、日期非法的条目都会被记成
 * issue 并在开发态打印。等接入自动管线后，同一套校验就是入库闸门。
 */
export function loadDataset(): { dataset: Dataset; issues: DatasetIssue[] } {
  const issues: DatasetIssue[] = [];

  const actors = actorsRaw as Actor[];
  const actorIds = new Set<string>();
  for (const a of actors) {
    if (actorIds.has(a.id)) issues.push({ level: 'error', where: `actor:${a.id}`, message: '行为体 id 重复' });
    actorIds.add(a.id);
    if (!a.emblem || a.emblem.length === 0) {
      issues.push({ level: 'warn', where: `actor:${a.id}`, message: '缺少徽记字' });
    }
  }

  const events = eventsRaw as unknown as SituationEvent[];
  const eventIds = new Set<string>();
  for (const e of events) {
    const where = `event:${e.id}`;
    if (eventIds.has(e.id)) issues.push({ level: 'error', where, message: '事件 id 重复' });
    eventIds.add(e.id);
    if (!CATEGORIES.includes(e.category)) {
      issues.push({ level: 'error', where, message: `未知门类 ${String(e.category)}` });
    }
    if (Number.isNaN(Date.parse(e.date))) {
      issues.push({ level: 'error', where, message: `日期无法解析：${e.date}` });
    }
    if (e.severity < 1 || e.severity > 5) {
      issues.push({ level: 'error', where, message: `severity 应在 1..5，实为 ${e.severity}` });
    }
    if (!e.places || e.places.length === 0) {
      issues.push({ level: 'error', where, message: '至少需要一个地点' });
    }
    for (const p of e.places ?? []) {
      if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
        issues.push({ level: 'error', where, message: `坐标越界：${p.name} ${p.lat},${p.lon}` });
      }
    }
    for (const id of e.actors ?? []) {
      if (!actorIds.has(id)) issues.push({ level: 'warn', where, message: `引用了未登记的行为体 ${id}` });
    }
  }

  const trends = trendsRaw as unknown as Trend[];
  const trendIds = new Set<string>();
  for (const t of trends) {
    const where = `trend:${t.id}`;
    if (trendIds.has(t.id)) issues.push({ level: 'error', where, message: '趋势 id 重复' });
    trendIds.add(t.id);
    if (!HORIZONS.includes(t.horizon)) {
      issues.push({ level: 'error', where, message: `未知时间尺度 ${String(t.horizon)}` });
    }
    if (!DIRECTIONS.includes(t.direction)) {
      issues.push({ level: 'error', where, message: `未知方向 ${String(t.direction)}` });
    }
    if (!t.corridor || t.corridor.length < 2) {
      issues.push({ level: 'error', where, message: '走廊至少需要两个节点' });
    }
    if (typeof t.confidence !== 'number' || t.confidence < 0 || t.confidence > 1) {
      issues.push({ level: 'error', where, message: `confidence 应在 0..1，实为 ${String(t.confidence)}` });
    }
    for (const id of t.actors ?? []) {
      if (!actorIds.has(id)) issues.push({ level: 'warn', where, message: `引用了未登记的行为体 ${id}` });
    }
  }

  const sortedEvents = [...events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  return {
    dataset: {
      meta: metaRaw as DatasetMeta,
      actors,
      events: sortedEvents,
      trends,
    },
    issues,
  };
}

/** 事件日期跨度，用于时间轴。 */
export function eventDateRange(events: SituationEvent[]): { min: number; max: number } {
  if (events.length === 0) {
    const now = Date.now();
    return { min: now - 90 * 864e5, max: now };
  }
  const times = events.map((e) => Date.parse(e.date));
  return { min: Math.min(...times), max: Math.max(...times) };
}

export function actorMap(actors: Actor[]): Map<string, Actor> {
  return new Map(actors.map((a) => [a.id, a]));
}

export type { Category };

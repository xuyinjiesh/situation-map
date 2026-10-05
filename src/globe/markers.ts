import type { Actor, SituationEvent, Trend } from '../types';
import { CATEGORY_META, DIRECTION_COLOR } from '../theme';
import { HORIZON_LABEL, DIRECTION_LABEL } from '../types';

/**
 * 地图标记。
 *
 * 事件用"印章"：外圈是门类色，中心是主行为体的动物喻体字——这正是《时局图》的做法，
 * 用兽首代表人，一眼读出"谁在场"。
 * 趋势用"罗盘":菱形 + 方向字（升降稳荡），外圈圈数对应时间尺度。
 */

export interface MarkerHandlers {
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const OTHER_COUNT_LIMIT = 4;

export function createEventMarker(
  evt: SituationEvent,
  actors: Map<string, Actor>,
  handlers: MarkerHandlers,
  selected: boolean,
): HTMLElement {
  const meta = CATEGORY_META[evt.category];
  const primary = actors.get(evt.actors[0] ?? '');
  const others = evt.actors.slice(1, 1 + OTHER_COUNT_LIMIT).length;

  const el = document.createElement('div');
  el.className = 'mk mk--event';
  el.dataset.category = evt.category;
  el.dataset.selected = String(selected);
  el.dataset.severity = String(evt.severity);
  el.style.setProperty('--mk-color', meta.color);
  el.style.setProperty('--mk-size', `${26 + evt.severity * 3.5}px`);
  el.style.pointerEvents = 'auto';

  const seal = document.createElement('div');
  seal.className = 'mk__seal';
  seal.textContent = primary?.emblem ?? meta.label;
  seal.style.setProperty('--seal-color', primary?.color ?? meta.color);
  el.appendChild(seal);

  if (others > 0) {
    const badge = document.createElement('div');
    badge.className = 'mk__badge';
    badge.textContent = `+${others}`;
    el.appendChild(badge);
  }

  const card = document.createElement('div');
  card.className = 'mk__card';
  card.innerHTML = `
    <div class="mk__card-head">
      <span class="mk__card-cat">${meta.label}·${meta.name}</span>
      <span class="mk__card-sev">${'●'.repeat(evt.severity)}</span>
    </div>
    <div class="mk__card-title"></div>
    <div class="mk__card-foot"></div>
  `;
  const titleNode = card.querySelector('.mk__card-title');
  if (titleNode) titleNode.textContent = evt.title;
  const footNode = card.querySelector('.mk__card-foot');
  if (footNode) footNode.textContent = `${evt.date} · ${evt.places.map((p) => p.name).join(' → ')}`;
  el.appendChild(card);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onSelect(evt.id);
  });
  el.addEventListener('pointerenter', () => handlers.onHover(evt.id));
  el.addEventListener('pointerleave', () => handlers.onHover(null));

  return el;
}

export function createTrendMarker(
  trend: Trend,
  actors: Map<string, Actor>,
  handlers: MarkerHandlers,
  selected: boolean,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk mk--trend';
  el.dataset.selected = String(selected);
  el.dataset.direction = trend.direction;
  el.style.setProperty('--mk-color', DIRECTION_COLOR[trend.direction]);
  el.style.pointerEvents = 'auto';

  const core = document.createElement('div');
  core.className = 'mk__rosette';
  const glyph = document.createElement('span');
  glyph.textContent = DIRECTION_LABEL[trend.direction];
  core.appendChild(glyph);
  el.appendChild(core);

  const ring = document.createElement('div');
  ring.className = 'mk__horizon';
  ring.dataset.horizon = trend.horizon;
  el.appendChild(ring);

  const seals = document.createElement('div');
  seals.className = 'mk__seals';
  for (const id of trend.actors.slice(0, 4)) {
    const actor = actors.get(id);
    if (!actor) continue;
    const s = document.createElement('span');
    s.className = 'mk__seal-mini';
    s.textContent = actor.emblem;
    s.style.setProperty('--seal-color', actor.color);
    seals.appendChild(s);
  }
  el.appendChild(seals);

  const card = document.createElement('div');
  card.className = 'mk__card';
  card.innerHTML = `
    <div class="mk__card-head">
      <span class="mk__card-cat">大势 · ${HORIZON_LABEL[trend.horizon]}</span>
      <span class="mk__card-sev">确信 ${Math.round(trend.confidence * 100)}%</span>
    </div>
    <div class="mk__card-title"></div>
    <div class="mk__card-foot"></div>
  `;
  const titleNode = card.querySelector('.mk__card-title');
  if (titleNode) titleNode.textContent = trend.title;
  const footNode = card.querySelector('.mk__card-foot');
  if (footNode) footNode.textContent = `${trend.since} 年起 · ${trend.corridor.map((p) => p.name).join(' → ')}`;
  el.appendChild(card);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onSelect(trend.id);
  });
  el.addEventListener('pointerenter', () => handlers.onHover(trend.id));
  el.addEventListener('pointerleave', () => handlers.onHover(null));

  return el;
}

/** 趋势走廊的锚点：取折线的中间节点，徽记挂在那里最不容易被遮住。 */
export function corridorAnchor(trend: Trend): { lat: number; lon: number } {
  const mid = trend.corridor[Math.floor((trend.corridor.length - 1) / 2)];
  return { lat: mid.lat, lon: mid.lon };
}

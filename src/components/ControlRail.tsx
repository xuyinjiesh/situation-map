import { CATEGORY_META, DIRECTION_COLOR } from '../theme';
import { HORIZON_LABEL, type Horizon, type SituationEvent, type Trend } from '../types';
import { formatShort, relativeTo } from '../lib/time';
import type { ViewMode } from './GlobeStage';

interface ControlRailProps {
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  activeHorizons: Set<Horizon>;
  onToggleHorizon: (h: Horizon) => void;
  events: SituationEvent[];
  trends: Trend[];
  /** 全部趋势（未筛选），用来显示各尺度的总数。 */
  allTrends: Trend[];
  anchor: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  activeCategories: Set<string>;
}

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'events', label: '近事', hint: '只显示短期事件' },
  { id: 'trends', label: '大勢', hint: '只显示长期结构性趋势' },
  { id: 'both', label: '合觀', hint: '两层叠加，用体温读底图' },
];

export function ControlRail({
  mode,
  onMode,
  activeHorizons,
  onToggleHorizon,
  events,
  trends,
  allTrends,
  anchor,
  selectedId,
  onSelect,
  activeCategories,
}: ControlRailProps) {
  const showEvents = mode !== 'trends';
  const showTrends = mode !== 'events';

  const horizonCounts = allTrends.reduce<Record<string, number>>((acc, t) => {
    acc[t.horizon] = (acc[t.horizon] ?? 0) + 1;
    return acc;
  }, {});

  const eventList = [...events].reverse();

  return (
    <section className="rail" aria-label="控制台">
      <div className="rail__block">
        <h2 className="rail__title">视域</h2>
        <div className="mode-switch" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className="mode-switch__btn"
              data-on={mode === m.id}
              onClick={() => onMode(m.id)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {showTrends && (
        <div className="rail__block">
          <h2 className="rail__title">
            大势尺度 <span className="rail__count">{trends.length}/{allTrends.length}</span>
          </h2>
          <div className="chip-row">
            {(['1y', '3y', '10y'] as Horizon[]).map((h) => (
              <button
                key={h}
                type="button"
                className="chip"
                data-on={activeHorizons.has(h)}
                onClick={() => onToggleHorizon(h)}
              >
                {HORIZON_LABEL[h]}
                <span className="chip__count">{horizonCounts[h] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rail__block rail__block--scroll">
        {showEvents && (
          <>
            <h2 className="rail__title">
              近事编年 <span className="rail__count">{eventList.length}</span>
            </h2>
            <ol className="feed">
              {eventList.map((e) => {
                const meta = CATEGORY_META[e.category];
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="feed__item"
                      data-selected={selectedId === e.id}
                      data-muted={!activeCategories.has(e.category)}
                      style={{ ['--chip' as string]: meta.color }}
                      onClick={() => onSelect(e.id)}
                    >
                      <span className="feed__glyph">{meta.label}</span>
                      <span className="feed__body">
                        <span className="feed__title">{e.title}</span>
                        <span className="feed__meta">
                          {formatShort(e.date)} · {relativeTo(Date.parse(e.date), anchor)}
                        </span>
                      </span>
                      <span className="feed__sev" aria-label={`强度 ${e.severity}`}>
                        {'●'.repeat(e.severity)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {eventList.length === 0 && (
                <li className="feed__empty">
                  当前筛选与游标下没有近事
                  <span className="feed__hint">（可能是门类被关掉了，或游标还没走到）</span>
                </li>
              )}
            </ol>
          </>
        )}

        {showTrends && (
          <>
            <h2 className="rail__title">
              大势条目 <span className="rail__count">{trends.length}</span>
            </h2>
            <ol className="feed">
              {trends.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="feed__item feed__item--trend"
                    data-selected={selectedId === t.id}
                    style={{ ['--chip' as string]: DIRECTION_COLOR[t.direction] }}
                    onClick={() => onSelect(t.id)}
                  >
                    <span className="feed__glyph">{HORIZON_LABEL[t.horizon].slice(0, 1)}</span>
                    <span className="feed__body">
                      <span className="feed__title">{t.title}</span>
                      <span className="feed__meta">
                        {t.since} 年起 · 确信 {Math.round(t.confidence * 100)}%
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {trends.length === 0 && <li className="feed__empty">当前尺度下没有条目</li>}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

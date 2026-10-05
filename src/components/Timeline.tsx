import { CATEGORY_META } from '../theme';
import { DAY, formatStamp, relativeTo } from '../lib/time';
import type { SituationEvent } from '../types';

interface TimelineProps {
  range: { min: number; max: number };
  asOf: number;
  onAsOf: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  events: SituationEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 时间游标。
 *
 * 这个控件的语义是"截至某日已知的情形"，而不是"播放一段动画"——所以游标右侧的事件一律不出现，
 * 事件一旦越过游标就留在图上。回放只是连续地推游标，用来观察事态在时间上的堆积节奏。
 */

/** 滑块的拇指直径，用来把刻度对齐到滑块可行驶的区间而不是整条轨道的两端。 */
const THUMB = 16;

function tickLeft(p: number): string {
  return `calc(${p}% + ${(THUMB / 2 - (p / 100) * THUMB).toFixed(2)}px)`;
}

export function Timeline({
  range,
  asOf,
  onAsOf,
  playing,
  onPlaying,
  events,
  selectedId,
  onSelect,
}: TimelineProps) {
  const span = Math.max(1, range.max - range.min);
  const pct = (t: number) => ((t - range.min) / span) * 100;

  const passed = events.filter((e) => Date.parse(e.date) <= asOf).length;

  return (
    <div className="timeline">
      <div className="timeline__head">
        <button
          type="button"
          className="timeline__play"
          onClick={() => onPlaying(!playing)}
          aria-label={playing ? '暂停回放' : '开始回放'}
        >
          {playing ? '暫停' : '回放'}
        </button>
        <div className="timeline__now">
          <span className="timeline__date">{formatStamp(asOf)}</span>
          <span className="timeline__rel">已过 {passed} / {events.length} 条</span>
        </div>
        <button type="button" className="timeline__reset" onClick={() => onAsOf(range.max)}>
          回到最新
        </button>
      </div>

      <div className="timeline__track">
        <input
          className="timeline__slider"
          type="range"
          min={range.min}
          max={range.max}
          step={DAY}
          value={asOf}
          onChange={(e) => onAsOf(Number(e.target.value))}
          aria-label="时间游标"
        />
        <div className="timeline__ticks">
          {events.map((e) => {
            const t = Date.parse(e.date);
            const meta = CATEGORY_META[e.category];
            return (
              <button
                key={e.id}
                type="button"
                className="timeline__tick"
                data-past={t <= asOf}
                data-selected={selectedId === e.id}
                style={{
                  left: tickLeft(pct(t)),
                  ['--chip' as string]: meta.color,
                }}
                onClick={() => onSelect(e.id)}
                title={`${e.date} ${e.title} · ${relativeTo(t, range.max)}`}
                aria-label={e.title}
              />
            );
          })}
        </div>
      </div>

      <div className="timeline__scale">
        <span>{formatStamp(range.min)}</span>
        <span>{formatStamp(range.max)}</span>
      </div>
    </div>
  );
}

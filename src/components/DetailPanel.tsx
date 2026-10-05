import { CATEGORY_META, CONFIDENCE_LABEL, DIRECTION_COLOR } from '../theme';
import { DIRECTION_LABEL, HORIZON_LABEL, type Actor, type SituationEvent, type Trend } from '../types';
import { formatDate, relativeTo } from '../lib/time';

interface DetailPanelProps {
  event: SituationEvent | null;
  trend: Trend | null;
  actors: Map<string, Actor>;
  anchor: number;
  onClose: () => void;
  onFocus: (lat: number, lon: number, altitude: number) => void;
}

function ActorRow({ ids, actors }: { ids: string[]; actors: Map<string, Actor> }) {
  return (
    <ul className="actors-row">
      {ids.map((id) => {
        const a = actors.get(id);
        if (!a) return null;
        return (
          <li key={id} className="actor actor--lg" title={a.note ?? a.name}>
            <span className="actor__seal" style={{ ['--seal-color' as string]: a.color }}>
              {a.emblem}
            </span>
            <span className="actor__name">{a.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DetailPanel({ event, trend, actors, anchor, onClose, onFocus }: DetailPanelProps) {
  if (!event && !trend) return null;

  return (
    <aside className="detail" aria-label="条目详情">
      <button type="button" className="detail__close" onClick={onClose} aria-label="关闭">
        ×
      </button>

      {event && (
        <>
          <div className="detail__kicker">
            <span
              className="detail__cat"
              style={{ ['--chip' as string]: CATEGORY_META[event.category].color }}
            >
              {CATEGORY_META[event.category].label}·{CATEGORY_META[event.category].name}
            </span>
            <span className="detail__conf">{CONFIDENCE_LABEL[event.confidence]}</span>
          </div>

          <h2 className="detail__title">{event.title}</h2>

          <p className="detail__when">
            {formatDate(event.date)}
            <span className="dim"> · {relativeTo(Date.parse(event.date), anchor)}</span>
          </p>

          <div className="detail__severity" aria-label={`强度 ${event.severity} / 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="pip" data-on={n <= event.severity} />
            ))}
            <span className="dim">强度 {event.severity}/5</span>
          </div>

          <ActorRow ids={event.actors} actors={actors} />

          <section className="detail__section">
            <h3>现场</h3>
            <ul className="places">
              {event.places.map((p) => (
                <li key={`${p.name}-${p.lat}`}>
                  <button type="button" onClick={() => onFocus(p.lat, p.lon, 1.35)}>
                    <span className="places__dot" data-role={p.role} />
                    {p.name}
                    <span className="places__coord">
                      {p.lat.toFixed(1)}°, {p.lon.toFixed(1)}°
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="detail__section">
            <h3>研判</h3>
            <p className="detail__body">{event.summary}</p>
          </section>

          {event.emblem && (
            <blockquote className="detail__emblem">{event.emblem}</blockquote>
          )}

          {event.tags && event.tags.length > 0 && (
            <ul className="tags">
              {event.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}

          <section className="detail__section detail__section--sources">
            <h3>信源</h3>
            {event.sources.length === 0 && <p className="dim">暂未登记信源。</p>}
            <ul className="sources">
              {event.sources.map((s) => (
                <li key={s.label}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.label}
                    </a>
                  ) : (
                    <span>{s.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {trend && (
        <>
          <div className="detail__kicker">
            <span className="detail__cat" style={{ ['--chip' as string]: DIRECTION_COLOR[trend.direction] }}>
              大势 · {HORIZON_LABEL[trend.horizon]}
            </span>
            <span className="detail__conf">{DIRECTION_LABEL[trend.direction]}势</span>
          </div>

          <h2 className="detail__title">{trend.title}</h2>

          <p className="detail__when">
            {trend.since} 年起
            <span className="dim">
              {' '}
              · 已延续约 {Math.max(1, new Date(anchor).getFullYear() - Number(trend.since))} 年
            </span>
          </p>

          <div className="confidence">
            <div className="confidence__bar">
              <span style={{ width: `${Math.round(trend.confidence * 100)}%` }} />
            </div>
            <span className="dim">确信度 {Math.round(trend.confidence * 100)}%</span>
          </div>

          <ActorRow ids={trend.actors} actors={actors} />

          <section className="detail__section">
            <h3>走廊</h3>
            <ol className="corridor">
              {trend.corridor.map((p) => (
                <li key={`${p.name}-${p.lat}`}>
                  <button type="button" onClick={() => onFocus(p.lat, p.lon, 1.6)}>
                    <span className="corridor__node" />
                    {p.name}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="detail__section">
            <h3>研判</h3>
            <p className="detail__body">{trend.summary}</p>
          </section>

          <section className="detail__section">
            <h3>驱动</h3>
            <ul className="bullets">
              {trend.drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>

          <section className="detail__section">
            <h3>指标</h3>
            <table className="indicators">
              <tbody>
                {trend.indicators.map((i) => (
                  <tr key={i.label}>
                    <th scope="row">{i.label}</th>
                    <td>{i.value}</td>
                    <td className="dim">{i.change ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {trend.counterforce && (
            <section className="detail__section detail__section--counter">
              <h3>反向张力</h3>
              <p className="detail__body">{trend.counterforce}</p>
            </section>
          )}
        </>
      )}

      <footer className="detail__foot">
        <span className="dim">按 Esc 关闭 · 数据为策展示例，接入管线后逐条替换</span>
      </footer>
    </aside>
  );
}

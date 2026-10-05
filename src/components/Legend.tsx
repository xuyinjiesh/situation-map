import { CATEGORY_META } from '../theme';
import { CATEGORIES, type Actor, type Category } from '../types';

interface LegendProps {
  actors: Actor[];
  activeCategories: Set<Category>;
  onToggleCategory: (c: Category) => void;
  actorIdsInView: Set<string>;
}

export function Legend({ actors, activeCategories, onToggleCategory, actorIdsInView }: LegendProps) {
  const shown = actors.filter((a) => actorIdsInView.has(a.id));

  return (
    <aside className="legend" aria-label="图例">
      <div className="legend__group">
        <h2 className="legend__title">门类</h2>
        <ul className="legend__cats">
          {CATEGORIES.map((c) => {
            const meta = CATEGORY_META[c];
            const on = activeCategories.has(c);
            return (
              <li key={c}>
                <button
                  type="button"
                  className="cat-chip"
                  data-on={on}
                  style={{ ['--chip' as string]: meta.color }}
                  onClick={() => onToggleCategory(c)}
                  title={meta.gloss}
                >
                  <span className="cat-chip__glyph">{meta.label}</span>
                  <span className="cat-chip__name">{meta.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="legend__group">
        <h2 className="legend__title">在场行为体</h2>
        <ul className="legend__actors">
          {shown.map((a) => (
            <li key={a.id} className="actor" title={a.note ?? a.name}>
              <span className="actor__seal" style={{ ['--seal-color' as string]: a.color }}>
                {a.emblem}
              </span>
              <span className="actor__name">{a.name}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="legend__empty">当前筛选下无行为体</li>}
        </ul>
      </div>
    </aside>
  );
}

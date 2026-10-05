import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlobeStage, type ViewMode } from './components/GlobeStage';
import { Header } from './components/Header';
import { Legend } from './components/Legend';
import { ControlRail } from './components/ControlRail';
import { Timeline } from './components/Timeline';
import { DetailPanel } from './components/DetailPanel';
import { DataNotice } from './components/DataNotice';
import { actorMap, eventDateRange, loadDataset } from './data/load';
import { CATEGORIES, type Category, type Horizon } from './types';

const { dataset, issues } = loadDataset();

if (import.meta.env.DEV && issues.length > 0) {
  console.warn('[時局圖] 数据集校验发现问题：', issues);
}

const ACTORS = actorMap(dataset.actors);
const RANGE = eventDateRange(dataset.events);

/** 回放整段历史需要的真实时间。太长会无聊，太短看不清堆积节奏。 */
const PLAYBACK_MS = 24000;

export default function App() {
  const [mode, setMode] = useState<ViewMode>('both');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(new Set(CATEGORIES));
  const [activeHorizons, setActiveHorizons] = useState<Set<Horizon>>(new Set(['1y', '3y', '10y']));
  const [asOf, setAsOf] = useState<number>(RANGE.max);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lon: number; altitude: number } | null>(null);
  const [ready, setReady] = useState(false);

  const eventsById = useMemo(() => new Map(dataset.events.map((e) => [e.id, e])), []);
  const trendsById = useMemo(() => new Map(dataset.trends.map((t) => [t.id, t])), []);

  const visibleEvents = useMemo(
    () => dataset.events.filter((e) => activeCategories.has(e.category) && Date.parse(e.date) <= asOf),
    [activeCategories, asOf],
  );

  const visibleTrends = useMemo(
    () => dataset.trends.filter((t) => activeHorizons.has(t.horizon)),
    [activeHorizons],
  );

  const actorIdsInView = useMemo(() => {
    const ids = new Set<string>();
    for (const e of visibleEvents) for (const a of e.actors) ids.add(a);
    for (const t of visibleTrends) for (const a of t.actors) ids.add(a);
    return ids;
  }, [visibleEvents, visibleTrends]);

  const selectedEvent = selectedId ? (eventsById.get(selectedId) ?? null) : null;
  const selectedTrend = selectedId ? (trendsById.get(selectedId) ?? null) : null;

  /** 选中任何条目都把它转正：调视角，并确保它所在的图层是打开的。 */
  const select = useCallback(
    (id: string | null) => {
      if (!id) {
        setSelectedId(null);
        return;
      }
      setSelectedId(id);
      const evt = eventsById.get(id);
      if (evt) {
        if (mode === 'trends') setMode('both');
        const site = evt.places.find((p) => p.role === 'site') ?? evt.places[0];
        if (site) setFocus({ lat: site.lat, lon: site.lon, altitude: 1.5 });
        return;
      }
      const trend = trendsById.get(id);
      if (trend) {
        if (mode === 'events') setMode('both');
        const mid = trend.corridor[Math.floor(trend.corridor.length / 2)];
        setFocus({ lat: mid.lat, lon: mid.lon, altitude: 1.9 });
      }
    },
    [eventsById, trendsById, mode],
  );

  const toggleCategory = useCallback((c: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next.size === 0 ? new Set(CATEGORIES) : next;
    });
  }, []);

  const toggleHorizon = useCallback((h: Horizon) => {
    setActiveHorizons((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next.size === 0 ? new Set<Horizon>(['1y', '3y', '10y']) : next;
    });
  }, []);

  // 回放：连续推进时间游标。用真实时间比例换算，保证整段历史恒定耗时。
  useEffect(() => {
    if (!playing) return;
    const span = Math.max(1, RANGE.max - RANGE.min);
    const speed = span / PLAYBACK_MS;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      setAsOf((prev) => {
        const next = prev + dt * speed;
        if (next >= RANGE.max) {
          setPlaying(false);
          return RANGE.max;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startPlayback = useCallback(
    (next: boolean) => {
      if (next && asOf >= RANGE.max - 1000) setAsOf(RANGE.min);
      setPlaying(next);
    },
    [asOf],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
      if (e.key === ' ') {
        e.preventDefault();
        startPlayback(!playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, startPlayback]);

  return (
    <div className="app" data-ready={ready} data-mode={mode}>
      <div className="stage">
        <GlobeStage
          mode={mode}
          events={visibleEvents}
          trends={visibleTrends}
          actors={ACTORS}
          selectedId={selectedId}
          onSelect={select}
          focus={focus}
          onReady={() => setReady(true)}
        />
      </div>

      <div className="frame" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <div className="overlay">
        <div className="overlay__area overlay__area--head">
          <Header
            meta={dataset.meta}
            eventCount={dataset.events.length}
            trendCount={dataset.trends.length}
          />
          <DataNotice meta={dataset.meta} issues={issues} />
        </div>

        <div className="overlay__area overlay__area--legend">
          <Legend
            actors={dataset.actors}
            activeCategories={activeCategories}
            onToggleCategory={toggleCategory}
            actorIdsInView={actorIdsInView}
          />
        </div>

        <div className="overlay__area overlay__area--rail">
          {selectedId ? (
            <DetailPanel
              event={selectedEvent}
              trend={selectedTrend}
              actors={ACTORS}
              anchor={asOf}
              onClose={() => setSelectedId(null)}
              onFocus={(lat, lon, altitude) => setFocus({ lat, lon, altitude })}
            />
          ) : (
            <ControlRail
              mode={mode}
              onMode={setMode}
              activeHorizons={activeHorizons}
              onToggleHorizon={toggleHorizon}
              events={visibleEvents}
              trends={visibleTrends}
              allTrends={dataset.trends}
              anchor={asOf}
              selectedId={selectedId}
              onSelect={select}
              activeCategories={activeCategories}
            />
          )}
        </div>

        {mode !== 'trends' && (
          <div className="overlay__area overlay__area--timeline">
            <Timeline
              range={RANGE}
              asOf={asOf}
              onAsOf={(t) => {
                setPlaying(false);
                setAsOf(t);
              }}
              playing={playing}
              onPlaying={startPlayback}
              events={dataset.events}
              selectedId={selectedId}
              onSelect={select}
            />
          </div>
        )}
      </div>
    </div>
  );
}

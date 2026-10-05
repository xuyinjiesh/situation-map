import { useEffect, useRef } from 'react';
import Globe, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { createEarthTextures, type EarthTextures } from '../globe/parchment';
import { corridorAnchor, createEventMarker, createTrendMarker, type MarkerHandlers } from '../globe/markers';
import { CATEGORY_META } from '../theme';
import type { Actor, SituationEvent, Trend } from '../types';

export type ViewMode = 'events' | 'trends' | 'both';

/** 贴图生成要几百毫秒，缓存住；React 严格模式下 effect 会跑两遍，不能每次重算。 */
let textureCache: EarthTextures | null = null;
function earthTextures(): EarthTextures {
  if (!textureCache) textureCache = createEarthTextures();
  return textureCache;
}

interface RingDatum {
  id: string;
  lat: number;
  lng: number;
  maxR: number;
  speed: number;
  period: number;
  color: string;
}

interface MarkerDatum {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  element: HTMLElement;
}

function buildRings(events: SituationEvent[], mode: ViewMode): RingDatum[] {
  if (mode === 'trends') return [];
  return events
    .filter((e) => e.severity >= 4)
    .map((e) => {
      const site = e.places.find((p) => p.role === 'site') ?? e.places[0];
      return {
        id: `ring-${e.id}`,
        lat: site.lat,
        lng: site.lon,
        maxR: 2.4 + e.severity * 0.7,
        speed: 0.9 + e.severity * 0.18,
        period: 1500 - e.severity * 120,
        color: `${CATEGORY_META[e.category].color}66`,
      };
    });
}

export interface GlobeStageProps {
  mode: ViewMode;
  events: SituationEvent[];
  trends: Trend[];
  actors: Map<string, Actor>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focus: { lat: number; lon: number; altitude: number } | null;
  onReady?: () => void;
}

export function GlobeStage({
  mode,
  events,
  trends,
  actors,
  selectedId,
  onSelect,
  focus,
  onReady,
}: GlobeStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeInstance | null>(null);

  // 回调放进 ref，避免因为父组件重渲染导致地球被销毁重建（重建一次要几百毫秒）。
  const handlersRef = useRef<MarkerHandlers>({ onSelect, onHover: () => {} });
  handlersRef.current = {
    onSelect: (id) => onSelect(id),
    onHover: (id) => {
      if (containerRef.current) containerRef.current.dataset.hover = id ?? '';
    },
  };
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // rendererConfig 里的 alpha 必须显式打开：three.js 的 WebGLRenderer 默认
    // alpha=false，那样 canvas 是不透明黑，CSS 的羊皮纸底永远透不出来。
    const world = new Globe(el, {
      animateIn: true,
      rendererConfig: { alpha: true, antialias: true, powerPreference: 'high-performance' },
    });
    globeRef.current = world;

    const { map, bumpMap } = earthTextures();
    const material = world.globeMaterial() as THREE.MeshPhongMaterial;
    material.map = map;
    material.bumpMap = bumpMap;
    material.bumpScale = 6;
    material.color = new THREE.Color('#ffffff');
    material.specular = new THREE.Color('#6b5333');
    material.shininess = 5;
    material.needsUpdate = true;

    world
      // 背景必须给一个 alpha=0 的 rgba。three-render-objects 默认背景是 '#000011'
      // 且不透明，只调 renderer.setClearAlpha() 会在下一次 resize 时被它覆盖回来。
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#d9b06a')
      .atmosphereAltitude(0.21)
      .globeCurvatureResolution(4)
      .htmlAltitude(0.01)
      .htmlTransitionDuration(400)
      .ringAltitude(0.0015);

    // 暖色主光 + 冷色补光。旧地图册是印在纸上的，不是被聚光灯打着的球，
    // 所以环境光给得很足，让背光面仍然读得出海岸线。
    world.lights([
      new THREE.AmbientLight(new THREE.Color('#f0dfba'), 2.4),
      new THREE.DirectionalLight(new THREE.Color('#fff4da'), 1.55),
      new THREE.DirectionalLight(new THREE.Color('#9a7b54'), 0.65),
    ]);
    world.lights()[1].position.set(1, 0.8, 1.2);
    world.lights()[2].position.set(-1.2, -0.5, -0.8);

    const renderer = world.renderer();
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const controls = world.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.75;
    controls.minDistance = 180;
    controls.maxDistance = 1000;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    const stopAutoRotate = () => {
      controls.autoRotate = false;
    };
    controls.addEventListener('start', stopAutoRotate);

    world.onGlobeClick(() => handlersRef.current.onSelect(''));

    // 容器尺寸会因为侧栏开合而变，window 的 resize 事件管不到这里。
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      world.width(Math.max(1, rect.width)).height(Math.max(1, rect.height));
    });
    observer.observe(el);

    onReadyRef.current?.();

    return () => {
      observer.disconnect();
      controls.removeEventListener('start', stopAutoRotate);
      controls.autoRotate = false;
      world._destructor();
      el.replaceChildren();
      globeRef.current = null;
    };
    // 只在挂载时建球；数据变化走下面几个 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 涟漪。球面上已经没有任何线条，事件只靠印章 + 涟漪 + 详情面板表达。
  useEffect(() => {
    const world = globeRef.current;
    if (!world) return;

    const rings = buildRings(events, mode);
    world
      .ringsData(rings)
      .ringLat((d) => (d as RingDatum).lat)
      .ringLng((d) => (d as RingDatum).lng)
      .ringMaxRadius((d) => (d as RingDatum).maxR)
      .ringPropagationSpeed((d) => (d as RingDatum).speed)
      .ringRepeatPeriod((d) => (d as RingDatum).period)
      .ringColor((d: object) => (d as RingDatum).color);
  }, [events, mode]);

  // 印章与罗盘
  useEffect(() => {
    const world = globeRef.current;
    if (!world) return;

    const markers: MarkerDatum[] = [];

    if (mode !== 'trends') {
      for (const evt of events) {
        const site = evt.places.find((p) => p.role === 'site') ?? evt.places[0];
        if (!site) continue;
        markers.push({
          id: evt.id,
          lat: site.lat,
          lng: site.lon,
          altitude: 0.012 + evt.severity * 0.004,
          element: createEventMarker(evt, actors, handlersRef.current, selectedId === evt.id),
        });
      }
    }

    if (mode !== 'events') {
      for (const trend of trends) {
        const anchor = corridorAnchor(trend);
        markers.push({
          id: trend.id,
          lat: anchor.lat,
          lng: anchor.lon,
          altitude: 0.02,
          element: createTrendMarker(trend, actors, handlersRef.current, selectedId === trend.id),
        });
      }
    }

    world
      .htmlElementsData(markers)
      .htmlLat((d) => (d as MarkerDatum).lat)
      .htmlLng((d) => (d as MarkerDatum).lng)
      .htmlAltitude((d) => (d as MarkerDatum).altitude)
      .htmlElement((d) => (d as MarkerDatum).element);
  }, [events, trends, mode, actors, selectedId]);

  // 视角
  useEffect(() => {
    const world = globeRef.current;
    if (!world || !focus) return;
    world.pointOfView({ lat: focus.lat, lng: focus.lon, altitude: focus.altitude }, 900);
  }, [focus]);

  return <div className="globe-stage" ref={containerRef} />;
}

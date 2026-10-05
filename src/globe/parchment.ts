import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import * as THREE from 'three';
import land110m from 'world-atlas/land-110m.json';
import countries110m from 'world-atlas/countries-110m.json';

/**
 * 程序化生成"羊皮纸版画"地球贴图。
 *
 * 为什么不直接用卫星影像：
 *  1. 风格。这个应用要的是《时局图》那种铜版画/旧地图的质感，而不是 Google Earth 的写实感。
 *  2. 体积与版权。world-atlas 的 110m 边界只有 160KB，且是公有领域数据；生成的贴图不需要任何
 *     外部图片请求，整个应用可以完全离线跑。
 *
 * 生成步骤：羊皮纸底 → 陈旧斑驳 → 经纬网 → 国界（细墨线）→ 海岸线（粗墨线）→ 陆地排线（hatch）
 *          → 极区加深 → 海洋点刻。另出一张灰度图作为 bumpMap，让球面在光照下有浮雕感。
 */

/** 贴图尺寸。4096×2048 在近距离观察时海岸线仍然锐利。 */
export const TEX_W = 4096;
export const TEX_H = 2048;

const COLOR = {
  base: '#e9dab6',
  paper: '#f3e8cd',
  // 陆地与海洋的明度差要够：整颗球都在缩小到 600px 时还要能一眼分出海陆。
  land: '#d3bc8c',
  landDeep: '#c9b17f',
  coast: 'rgba(66, 43, 20, 0.95)',
  border: 'rgba(92, 64, 34, 0.5)',
  grid: 'rgba(122, 94, 58, 0.26)',
  gridMajor: 'rgba(110, 80, 46, 0.44)',
  hatch: 'rgba(104, 72, 38, 0.2)',
  stipple: 'rgba(104, 72, 38, 0.16)',
  vignette: 'rgba(92, 62, 30, 0.44)',
};

/** 确定性伪随机，保证每次生成的地球完全一致（否则截图/回归测试没法比对）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toX = (lon: number) => ((lon + 180) / 360) * TEX_W;
const toY = (lat: number) => ((90 - lat) / 180) * TEX_H;

type PolygonalGeometry = Polygon | MultiPolygon;

function polygonsOf(geometry: PolygonalGeometry): number[][][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

/**
 * 把经纬度环投到等距圆柱画布上。
 *
 * 跨 180° 经线的多边形如果直接连线，会在图上拉出一条横贯整幅的墨线（俄罗斯、斐济是典型受害者）。
 * 这里检测相邻点之间超过半幅的跳变，断成新的子路径。
 */
function traceRing(ctx: CanvasRenderingContext2D, ring: number[][]): void {
  let prevX = Number.NaN;
  let started = false;
  for (const [lon, lat] of ring) {
    const x = toX(lon);
    const y = toY(lat);
    if (!started || Math.abs(x - prevX) > TEX_W * 0.5) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    prevX = x;
  }
  ctx.closePath();
}

function traceGeometry(ctx: CanvasRenderingContext2D, geometry: PolygonalGeometry, offsetX = 0): void {
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      ctx.save();
      ctx.translate(offsetX, 0);
      traceRing(ctx, ring);
      ctx.restore();
    }
  }
}

function loadGeometries(): { land: PolygonalGeometry[]; countries: PolygonalGeometry[] } {
  const land = feature(
    land110m as unknown as Topology<{ land: GeometryCollection }>,
    (land110m as unknown as Topology<{ land: GeometryCollection }>).objects.land,
  ) as unknown as FeatureCollection<PolygonalGeometry>;
  const countries = feature(
    countries110m as unknown as Topology<{ countries: GeometryCollection }>,
    (countries110m as unknown as Topology<{ countries: GeometryCollection }>).objects.countries,
  ) as unknown as FeatureCollection<PolygonalGeometry>;
  return {
    land: land.features.map((f) => f.geometry),
    countries: countries.features.map((f) => f.geometry),
  };
}

function fillPaper(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.base;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const rand = mulberry32(20261005);

  // 大尺度的陈旧斑驳：几十团极淡的晕染，让底色不再均匀。
  for (let i = 0; i < 90; i += 1) {
    const cx = rand() * TEX_W;
    const cy = rand() * TEX_H;
    const r = 120 + rand() * 620;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = rand() > 0.45;
    g.addColorStop(0, warm ? 'rgba(160, 122, 66, 0.10)' : 'rgba(248, 240, 214, 0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // 细颗粒纸纹：在小画布上做噪声再放大，避免 800 万像素逐点循环。
  const noiseW = 1024;
  const noiseH = 512;
  const noise = document.createElement('canvas');
  noise.width = noiseW;
  noise.height = noiseH;
  const nctx = noise.getContext('2d');
  if (nctx) {
    const img = nctx.createImageData(noiseW, noiseH);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = 128 + (rand() - 0.5) * 78;
      data[i] = v;
      data[i + 1] = v - 6;
      data[i + 2] = v - 18;
      data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(noise, 0, 0, TEX_W, TEX_H);
    ctx.restore();
  }
}

function drawGraticule(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineCap = 'butt';

  // 每 15° 一条细线。
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = toX(lon);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX_H);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = toY(lat);
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_W, y);
  }
  ctx.stroke();

  // 赤道与本初子午线加重。
  ctx.strokeStyle = COLOR.gridMajor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, toY(0));
  ctx.lineTo(TEX_W, toY(0));
  ctx.moveTo(toX(0), 0);
  ctx.lineTo(toX(0), TEX_H);
  ctx.stroke();

  // 南北回归线用虚线，方便一眼读出纬度带。
  ctx.strokeStyle = 'rgba(122, 94, 58, 0.34)';
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 16]);
  ctx.beginPath();
  for (const lat of [23.4367, -23.4367, 66.5633, -66.5633]) {
    const y = toY(lat);
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_W, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawLand(ctx: CanvasRenderingContext2D, land: PolygonalGeometry[], countries: PolygonalGeometry[]): void {
  // 1) 陆地底色。
  ctx.save();
  ctx.fillStyle = COLOR.land;
  ctx.beginPath();
  for (const g of land) traceGeometry(ctx, g);
  ctx.fill();
  ctx.restore();

  // 2) 国界：细墨线。画两遍 + 经度偏移，让跨越日界线的接缝也能连着。
  ctx.save();
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  for (const g of countries) traceGeometry(ctx, g);
  for (const g of countries) traceGeometry(ctx, g, TEX_W);
  for (const g of countries) traceGeometry(ctx, g, -TEX_W);
  ctx.stroke();
  ctx.restore();

  // 3) 陆地排线：铜版画的阴影靠斜线，不靠色块。
  ctx.save();
  ctx.beginPath();
  for (const g of land) traceGeometry(ctx, g);
  ctx.clip();
  ctx.strokeStyle = COLOR.hatch;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const step = 9;
  for (let i = -TEX_H; i < TEX_W + TEX_H; i += step) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + TEX_H, TEX_H);
  }
  ctx.stroke();
  ctx.restore();

  // 4) 海岸线：最后落在最上层，最重的墨。
  ctx.save();
  ctx.strokeStyle = COLOR.coast;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  for (const g of land) traceGeometry(ctx, g);
  for (const g of land) traceGeometry(ctx, g, TEX_W);
  for (const g of land) traceGeometry(ctx, g, -TEX_W);
  ctx.stroke();
  ctx.restore();
}

function drawOceanStipple(ctx: CanvasRenderingContext2D, land: PolygonalGeometry[]): void {
  // 海洋点刻。先在小尺寸遮罩上把陆地填白，再一次性读回像素做查表——
  // 直接对 ctx 反复 isPointInPath 会退化成"点数 × 路径段数"的复杂度，慢到不可用。
  const maskScale = 0.25;
  const maskW = Math.round(TEX_W * maskScale);
  const maskH = Math.round(TEX_H * maskScale);
  const mask = document.createElement('canvas');
  mask.width = maskW;
  mask.height = maskH;
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  if (!mctx) return;
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  for (const g of land) traceGeometry(mctx, g);
  mctx.fill();
  const pixels = mctx.getImageData(0, 0, maskW, maskH).data;

  const isLand = (x: number, y: number): boolean => {
    const mx = Math.min(maskW - 1, Math.max(0, Math.floor(x * maskScale)));
    const my = Math.min(maskH - 1, Math.max(0, Math.floor(y * maskScale)));
    return pixels[(my * maskW + mx) * 4] > 127;
  };

  ctx.save();
  ctx.fillStyle = COLOR.stipple;
  const rand = mulberry32(7788);
  for (let i = 0; i < 60000; i += 1) {
    const x = rand() * TEX_W;
    const y = rand() * TEX_H;
    if (isLand(x, y)) continue;
    // 两极附近经线收敛，点也跟着缩小，否则会糊成一片脏。
    const band = Math.abs(y - TEX_H / 2) / (TEX_H / 2);
    const r = 0.9 + rand() * 1.1 * (1 - band * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPolarShading(ctx: CanvasRenderingContext2D): void {
  const band = TEX_H * 0.24;
  const top = ctx.createLinearGradient(0, 0, 0, band);
  top.addColorStop(0, COLOR.vignette);
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, TEX_W, band);

  const bottom = ctx.createLinearGradient(0, TEX_H, 0, TEX_H - band);
  bottom.addColorStop(0, COLOR.vignette);
  bottom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, TEX_H - band, TEX_W, band);
}

function buildBump(land: PolygonalGeometry[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W / 2;
  canvas.height = TEX_H / 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(0.5, 0.5);
  // 多次错位叠加代替 blur 滤镜，兼容性更稳。
  for (const [dx, dy, alpha] of [
    [0, 0, 0.32],
    [10, 0, 0.18],
    [-10, 0, 0.18],
    [0, 10, 0.18],
    [0, -10, 0.18],
    [22, 0, 0.1],
    [-22, 0, 0.1],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const g of land) traceGeometry(ctx, g);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  return canvas;
}

export interface EarthTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export function createEarthTextures(): EarthTextures {
  const { land, countries } = loadGeometries();

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D canvas 上下文，地球贴图生成失败');

  fillPaper(ctx);
  drawGraticule(ctx);
  drawLand(ctx, land, countries);
  drawOceanStipple(ctx, land);
  drawPolarShading(ctx);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;
  map.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(buildBump(land));
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.anisotropy = 4;
  bumpMap.needsUpdate = true;

  return { map, bumpMap };
}

import type { Category, Direction, Horizon } from './types';

/** 版画/羊皮纸调色板。整套 UI 与地球配色都从这里取，避免色散。 */
export const PALETTE = {
  parchment: '#efe3c8',
  parchmentDeep: '#e0cfa6',
  ink: '#3a2b1c',
  inkSoft: '#6b5333',
  inkFaint: 'rgba(90, 66, 38, 0.28)',
  seal: '#9e2b25',
  gold: '#b8892f',
  night: '#20242b',
} as const;

export interface CategoryMeta {
  /** 中文单字标签，用于图例与印章。 */
  label: string;
  name: string;
  color: string;
  /** 一句门类释义，出现在详情面板。 */
  gloss: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  conflict: { label: '兵', name: '冲突', color: '#9e2b25', gloss: '武装冲突、军事对峙与灰色地带摩擦' },
  // 色相取在洋红位（约 330°），是既有七色里空得最开的一段：
  // 最近的邻居是冲突的朱砂（4°，差 34°）和技术的紫檀（281°，差 49°）。
  // 试过更"像政治"的深蓝（藏青、黛），但都和外交的靛青挤在同一条色相上，
  // 而印章外圈只有 1.5px，那点差别肉眼分辨不出来。
  politics: { label: '政', name: '政治', color: '#8c3f6b', gloss: '选举、组阁、公投、政变与弹劾' },
  diplomacy: { label: '交', name: '外交', color: '#2f5d8c', gloss: '结盟、斡旋、谈判与秩序安排' },
  economy: { label: '财', name: '经济', color: '#b07a2b', gloss: '贸易、金融、债务与资本流动' },
  energy: { label: '能', name: '能源', color: '#3f6b4a', gloss: '能源、航运通道与关键矿产' },
  tech: { label: '技', name: '技术', color: '#6b4a7a', gloss: '技术标准、算力与出口管制' },
  climate: { label: '候', name: '气候', color: '#2f7a6f', gloss: '气候、粮食、水资源与物流约束' },
  society: { label: '民', name: '社会', color: '#7a5c3f', gloss: '人口、移民与社会承受力' },
};

export const DIRECTION_COLOR: Record<Direction, string> = {
  rising: '#9e2b25',
  falling: '#2f5d8c',
  stable: '#4b6b52',
  volatile: '#b8892f',
};

export const HORIZON_RING: Record<Horizon, number> = {
  '1y': 1,
  '3y': 2,
  '10y': 3,
};

export const CONFIDENCE_LABEL: Record<string, string> = {
  illustrative: '策展示例',
  reported: '有报道',
  verified: '已核实',
};


/**
 * 時局圖 · 数据模型
 *
 * 两条时间尺度是这套应用的核心分野：
 *  - SituationEvent（近事）：某日某地发生的、可定位的事件 —— 有明确日期、有起讫两端、有强度。
 *  - Trend（大勢）：跨年度的结构性走向 —— 没有确切日期，只有起点年份、方向、置信度与走廊。
 *
 * 二者共用 Actor（行为体）与 Place（地点）两套基础词汇，因此可以叠在同一个地球上互相印证：
 * 短期事件是长期趋势的"体温"，长期趋势是短期事件的"底图"。
 */

/** 事件门类。决定颜色与图例分组。 */
export type Category =
  | 'conflict' // 兵：武装冲突、军事对峙
  | 'politics' // 政：选举、组阁、公投、政变
  | 'diplomacy' // 交：外交、结盟、谈判
  | 'economy' // 财：贸易、金融、债务
  | 'energy' // 能：能源、航运、矿产
  | 'tech' // 技：技术、算力、出口管制
  | 'climate' // 候：气候、粮食、水资源
  | 'society'; // 民：人口、移民、社会动荡

/**
 * 这个数组的**成员**是门类的权威定义（闸门与采集端都从这里读）。
 *
 * 顺序 = **图例的展示顺序**，按语义分组（兵政交 / 财能技 / 候民），三行刚好排满。
 * 它**不等于**采集端的判定优先级——那个在 scripts/lib/rules.mjs 的 CATEGORY_RULES 里，
 * 顺序是"越硬越靠前"（技在能前、能在财前，所以一条"出口管制 + 贸易"的新闻归技术而非经济）。
 * 两者刻意不同，collect.mjs 启动时只断言成员一致。
 */
export const CATEGORIES: readonly Category[] = [
  'conflict',
  'politics',
  'diplomacy',
  'economy',
  'energy',
  'tech',
  'climate',
  'society',
];

/** 地点在地理上的角色，决定它被画成起点、终点还是现场。 */
export type PlaceRole = 'origin' | 'site' | 'target';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  role: PlaceRole;
}

export interface SourceRef {
  /** 来源机构/媒体名。种子数据集里可能只有名字，没有链接。 */
  label: string;
  url?: string;
}

/** 数据可信度：策展示例 > 有报道 > 已核实。UI 必须如实呈现这个差别。 */
export type Confidence = 'illustrative' | 'reported' | 'verified';

/** 短期事件。 */
export interface SituationEvent {
  id: string;
  title: string;
  /** ISO 日期 YYYY-MM-DD。 */
  date: string;
  category: Category;
  /** 参与行为体，引用 Actor.id。 */
  actors: string[];
  /** 至少一个地点。第一个是起点，详情面板据此标出起点 / 现场 / 终点的角色。 */
  places: Place[];
  summary: string;
  /** 1..5，决定印章大小、涟漪半径与列表排序。 */
  severity: number;
  /** 该事件在「时局图」里对应的喻体或一句话隐喻，用于详情页文案。 */
  emblem?: string;
  confidence: Confidence;
  sources: SourceRef[];
  tags?: string[];
}

/** 趋势的时间尺度。 */
export type Horizon = '1y' | '3y' | '10y';

export const HORIZON_LABEL: Record<Horizon, string> = {
  '1y': '一年内',
  '3y': '三五年',
  '10y': '十年以上',
};

export type Direction = 'rising' | 'falling' | 'stable' | 'volatile';

export const DIRECTION_LABEL: Record<Direction, string> = {
  rising: '升',
  falling: '降',
  stable: '稳',
  volatile: '荡',
};

export interface Indicator {
  label: string;
  value: string;
  change?: string;
}

/** 长期结构性趋势。 */
export interface Trend {
  id: string;
  title: string;
  /** 起点年份，如 "2018"。 */
  since: string;
  horizon: Horizon;
  direction: Direction;
  /** 0..1。策展阶段凭判断给出，接管线后应由证据数量推导。 */
  confidence: number;
  actors: string[];
  /** 走廊折线，至少两个点。数据保留但不再画到球上，罗盘徽记挂在折线中点。 */
  corridor: Place[];
  /** 驱动因素。 */
  drivers: string[];
  /** 可观测指标，用于把叙事钉在数字上。 */
  indicators: Indicator[];
  summary: string;
  /** 反向张力：什么会让这条趋势逆转。强迫自己写出对立面。 */
  counterforce?: string;
}

/** 行为体。徽记沿用《时局图》以动物喻国的传统，但用一字篆印表达。 */
export interface Actor {
  id: string;
  name: string;
  /** 简短代号，用于徽记。 */
  short: string;
  /** 一个字，画在印章里。 */
  emblem: string;
  /** 印章主色。 */
  color: string;
  note?: string;
}

/** 数据集元信息。UI 顶部据此显示"种子数据"横幅。 */
export interface DatasetMeta {
  version: string;
  updated: string;
  curated: boolean;
  disclaimer: string;
}

export interface Dataset {
  meta: DatasetMeta;
  actors: Actor[];
  events: SituationEvent[];
  trends: Trend[];
}

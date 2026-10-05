/**
 * 源清单。
 *
 * 这份清单是**实测出来的**，不是抄来的：每个 URL 都在本机 curl 过，
 * 注释里记着实测结果。换网络环境后请重跑 `node scripts/collect.mjs --probe` 重新判定。
 *
 * tier 决定可信度：一手官方 1.0 / 主流通讯社大报 0.8 / 单一媒体与智库 0.5。
 * 这个分值会进入 confidence 的计算，见 docs/ARCHITECTURE.md 6.5。
 *
 * kind 决定用途：
 *   news     → 近事（有日期、有地点、可定位）
 *   thinktank→ 大势素材（不做事件抽取，只进选题池）
 */

export const TIER_CONFIDENCE = { official: 1.0, wire: 0.8, outlet: 0.5 };

export const SOURCES = [
  // ---------------------------------------------------------------- 英文通讯社 / 大报
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en', tier: 'wire', kind: 'news' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', lang: 'en', tier: 'wire', kind: 'news' },
  { id: 'dw-world', name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-world', lang: 'en', tier: 'wire', kind: 'news' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss', lang: 'en', tier: 'wire', kind: 'news' },
  { id: 'guardian-world', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', lang: 'en', tier: 'wire', kind: 'news' },
  { id: 'nyt-world', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', lang: 'en', tier: 'wire', kind: 'news' },

  // ---------------------------------------------------------------- 亚太视角
  { id: 'scmp-china', name: 'South China Morning Post', url: 'https://www.scmp.com/rss/4/feed', lang: 'en', tier: 'outlet', kind: 'news' },
  {
    id: 'nikkei-asia',
    name: 'Nikkei Asia',
    url: 'https://asia.nikkei.com/rss/feed/nar',
    lang: 'en',
    tier: 'outlet',
    kind: 'news',
    // 实测：item 只有 title / link / rdf:about，**没有任何日期字段**。
    // 没有日期就进不了时间序列模型（"截至某日已知的情形"这个语义直接塌掉），
    // 所以停用。硬要用就得抓正文页取日期，成本远高于换一个源。
    disabled: true,
    note: 'RSS 不含日期字段',
  },

  // ---------------------------------------------------------------- 中文源
  { id: 'bbc-zhongwen', name: 'BBC 中文', url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', lang: 'zh', tier: 'wire', kind: 'news' },
  { id: 'chinanews-world', name: '中国新闻网', url: 'https://www.chinanews.com.cn/rss/world.xml', lang: 'zh', tier: 'outlet', kind: 'news' },
  {
    id: 'people-world',
    name: '人民网',
    url: 'http://www.people.com.cn/rss/world.xml',
    lang: 'zh',
    tier: 'official',
    kind: 'news',
    // 实测：最新一条的 pubDate 是 2025-06-05，距采集时已 11992 小时（约 16 个月）。
    // 这个 RSS 实际上已经停止更新。保留在清单里是为了让新鲜度告警能持续把它标出来，
    // 而不是悄悄删掉——哪天它复活了，告警会自动消失。
    disabled: true,
    note: 'RSS 已停更（最新条目 2025-06-05）',
  },

  // ---------------------------------------------------------------- 智库（大势素材）
  { id: 'diplomat', name: 'The Diplomat', url: 'https://thediplomat.com/feed/', lang: 'en', tier: 'outlet', kind: 'thinktank' },
  { id: 'warontherocks', name: 'War on the Rocks', url: 'https://warontherocks.com/feed/', lang: 'en', tier: 'outlet', kind: 'thinktank' },
];

/**
 * 实测不通 / 需要额外条件的源，留档备查。别反复重试浪费时间。
 *
 *   reuters-world    404   路透社已停掉公开 RSS
 *   zaobao           404   联合早报改动过路径
 *   rsshub.app       403   公共实例已禁止匿名访问，自建可解
 *   ecfr / crisisgroup  连接失败（DNS 或区域不可达）
 *   reliefweb v1     410   官方已下线 v1，v2 需要注册 appname
 *   acled            需付费 key
 *   gdelt            429   可用，但必须 ≥5 秒间隔（见 collect.mjs 的 GDeltRateLimiter）
 */
export const DEAD_SOURCES = [
  { id: 'reuters-world', url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/world/?outputType=xml', status: 404, note: '公开 RSS 已停' },
  { id: 'zaobao', url: 'https://www.zaobao.com/realtime/world/rss.xml', status: 404, note: '路径变更' },
  { id: 'rsshub', url: 'https://rsshub.app/reuters/world', status: 403, note: '公共实例禁匿名' },
  { id: 'reliefweb-v1', url: 'https://api.reliefweb.int/v1/disasters', status: 410, note: 'API v1 已下线' },
];

/**
 * 规则词典：把一条新闻标题/摘要映射到数据模型的各个字段。
 *
 * 为什么是规则而不是 LLM：
 *   1. 这套环境里没有任何模型 API key，规则是唯一今天就能跑通的方案；
 *   2. 分类、行为体识别、强度打分这些环节本来就是**可枚举**的，规则比模型更可审计
 *      —— 每条自动事件都会把自己命中的关键词写进 tags，你可以直接看到"它凭什么被归到冲突"；
 *   3. 规则是确定性的，同样输入永远同样输出，便于回归。
 *
 * LLM 该用在哪里、不该用在哪里，见 docs/ARCHITECTURE.md 6.2 节。
 * 简单说：**枚举得出来的用规则，判断和命名才用模型。**
 *
 * ⚠️ 拉丁字母模式必须加词边界。第一版忘了加，`war` 直接匹配上了 `warning` 和 `toward`，
 * 导致 85 条候选里 60 条被误判成冲突。`compileRules()` 现在会自动补 `\b`，
 * 所以下面写单数词就够了，不用手写 `\bwar\b`。
 */

/** 行为体识别。id 必须存在于 src/data/actors.json。 */
export const ACTOR_RULES = {
  usa: ['美国', '华盛顿', '白宫', '五角大楼', '美联储', 'U\\.S\\.', '=US', 'United States', 'American', 'Washington', 'White House', 'Pentagon', 'Federal Reserve', 'Congress'],
  chn: ['中国', '北京', '商务部', '解放军', '中共', 'China', 'Chinese', 'Beijing', 'PLA'],
  rus: ['俄罗斯', '莫斯科', '克里姆林宫', '俄军', '普京', 'Russia', 'Russian', 'Moscow', 'Kremlin', 'Putin'],
  eu: ['欧盟', '布鲁塞尔', '欧洲联盟', 'EU', 'European Union', 'Brussels'],
  fra: ['法国', '巴黎', '马克龙', 'France', 'French', 'Paris', 'Macron'],
  gbr: ['英国', '伦敦', '唐宁街', 'Britain', 'British', 'UK', 'London'],
  jpn: ['日本', '东京', 'Japan', 'Japanese', 'Tokyo'],
  kor: ['韩国', '首尔', 'South Korea', 'Seoul'],
  prk: ['朝鲜', '平壤', 'North Korea', 'Pyongyang', 'DPRK'],
  ind: ['印度', '新德里', '莫迪', 'India', 'Indian', 'Delhi', 'Modi'],
  tur: ['土耳其', '安卡拉', '埃尔多安', 'Turkey', 'Türkiye', 'Ankara', 'Erdogan'],
  irn: ['伊朗', '德黑兰', 'Iran', 'Iranian', 'Tehran'],
  sau: ['沙特', '利雅得', 'Saudi', 'Riyadh'],
  isr: ['以色列', '耶路撒冷', '特拉维夫', '内塔尼亚胡', 'Israel', 'Israeli', 'Jerusalem', 'Netanyahu'],
  qat: ['卡塔尔', '多哈', 'Qatar', 'Doha'],
  egy: ['埃及', '开罗', 'Egypt', 'Cairo'],
  sdn: ['苏丹', '喀土穆', 'Sudan', 'Khartoum'],
  are: ['阿联酋', '迪拜', '阿布扎比', 'Emirates', 'Dubai', 'Abu Dhabi'],
  ukr: ['乌克兰', '基辅', '泽连斯基', 'Ukraine', 'Ukrainian', 'Kyiv', 'Kiev'],
  bra: ['巴西', 'Brazil', 'Brasilia'],
  arg: ['阿根廷', 'Argentina'],
  chl: ['智利', 'Chile'],
  cod: ['刚果', 'Congo'],
  zmb: ['赞比亚', 'Zambia'],
  gha: ['加纳', 'Ghana'],
  lka: ['斯里兰卡', 'Sri Lanka'],
  mli: ['马里', 'Mali'],
  ner: ['尼日尔', 'Niger'],
  bfa: ['布基纳法索', 'Burkina'],
  pan: ['巴拿马', 'Panama'],
  ven: ['委内瑞拉', 'Venezuela'],
  guy: ['圭亚那', 'Guyana'],
  phl: ['菲律宾', '马尼拉', 'Philippines', 'Manila'],
  mex: ['墨西哥', 'Mexico', 'Mexican'],
  ita: ['意大利', 'Italy', 'Italian'],
  nor: ['挪威', 'Norway'],
  zaf: ['南非', 'South Africa'],
};

/**
 * 短语覆盖：优先级高于门类关键词表。
 *
 * 存在的理由是一些**跨门类的固定搭配**，靠优先级顺序解决不了：
 *   "trade war" 会被 conflict 的 `war` 吃掉，但它是经济新闻；
 *   "cyberattack" 在 `\battack\b` 下已经不匹配了，但中文"网络攻击"仍会命中"攻击"。
 * 这类例外必须是显式的一等公民，否则就只能靠调关键词顺序来打地鼠。
 */
export const PHRASE_OVERRIDES = [
  { pattern: '贸易战|关税战|货币战|trade war|tariff war|price war|currency war', category: 'economy' },
  { pattern: '网络攻击|勒索软件|cyberattack|cyber attack|ransomware', category: 'tech' },
  { pattern: '气候变化|climate change|global warming', category: 'climate' },
  // 固定搭配的假阳性。实测踩到的：
  //   "Tear Gas" 命中 energy 的 gas → 法国学生抗议被归成能源
  //   "Trade Blame" 命中 economy 的 trade → 以色列互相指责被归成经济
  // 这类搭配无法靠调优先级解决，只能显式列出。
  { pattern: '催泪瓦斯|催泪弹|tear gas|teargas', category: 'society' },
  { pattern: '相互指责|互相指责|trade blame|trade barbs|trade blows', category: 'diplomacy' },
];

/**
 * 门类识别。顺序即优先级——一条新闻同时命中"停火"和"空袭"时归冲突。
 * 所以 conflict 在前，命中即停。清单要**精确**：宁可漏判，不可错判。
 */
export const CATEGORY_RULES = [
  {
    category: 'conflict',
    keywords: [
      '袭击', '空袭', '交火', '冲突', '开火', '炮击', '军事行动', '军演', '演习', '导弹', '无人机',
      '战线', '武装', '进攻', '击落', '停火线', '轰炸', '伤亡',
      '轰炸', '围攻', '封锁', '叛军', '武装分子', '入侵',
      'airstrike', 'clash', 'conflict', 'military', 'missile', 'drone', 'troop', 'offensive',
      'shelling', 'warfare', 'war', 'attack', 'bombing', 'casualt',
      // 下面这些是从"被丢弃的未分类样本"里捞回来的。它们本来是真新闻，
      // 只因为词表没有对应词就被扔了：rebel→提格雷、invasion→加拿大兵推、siege→围城。
      'rebel', 'insurgent', 'militia', 'invasion', 'invade', 'retreat', 'siege', 'blockade', 'weapon', 'arms',
      'fighting', 'combat', 'militant', 'offensive',
    ],
  },
  {
    category: 'politics',
    keywords: [
      '选举', '大选', '公投', '组阁', '内阁', '政党', '政变', '弹劾', '就职', '当选', '投票', '议会', '执政', '在野',
      'election', 'referendum', 'ballot', 'parliament', 'coalition', 'cabinet', 'coup', 'impeach', 'inaugurat',
      'vote', 'poll', 'campaign',
    ],
  },
  {
    category: 'diplomacy',
    keywords: [
      '会谈', '谈判', '磋商', '峰会', '访问', '联合声明', '斡旋', '停火', '建交', '召见', '会晤', '签署', '外交',
      '干涉', '干预', '同盟', '结盟',
      'talks', 'summit', 'visit', 'ceasefire', 'treaty', 'accord', 'agreement', 'diplomat', 'negotiat',
      'interference', 'alliance', 'deterren',
    ],
  },
  {
    category: 'tech',
    keywords: [
      '芯片', '半导体', '人工智能', '算力', '出口管制', '先进制程', '光刻', '数据中心', '技术封锁', '航天', '卫星',
      'semiconductor', 'chip', 'artificial intelligence', 'export control', 'data cent', 'lithograph', 'satellite',
    ],
  },
  {
    category: 'energy',
    keywords: [
      '石油', '天然气', '原油', '能源', '管道', '航运', '航线', '油轮', '矿产', '稀土', '锂矿', '钴矿', '液化天然气', '核电站',
      'oil', 'gas', 'energy', 'pipeline', 'shipping', 'tanker', 'mineral', 'rare earth', 'lithium', 'refinery',
    ],
  },
  {
    category: 'economy',
    keywords: [
      '关税', '贸易', '制裁', '出口', '进口', '债务', '通胀', '汇率', '降息', '加息', '外汇', '投资', '供应链', '财政',
      'tariff', 'trade', 'sanction', 'export', 'import', 'debt', 'inflation', 'interest rate', 'supply chain', 'econom',
    ],
  },
  {
    category: 'climate',
    keywords: [
      '气候', '干旱', '洪水', '台风', '飓风', '粮食', '水位', '碳排放', '热浪', '山火', '温室', '龙卷风', '气旋',
      'climate', 'drought', 'flood', 'typhoon', 'hurricane', 'tornado', 'cyclone', 'storm surge',
      'food security', 'emission', 'heatwave', 'wildfire',
    ],
  },
  {
    category: 'society',
    keywords: [
      '移民', '难民', '边境', '人口', '抗议', '骚乱', '示威', '劳工', '罢工', '游行', '贫困', '歧视',
      'migrant', 'refugee', 'border', 'protest', 'population', 'strike action', 'poverty',
      // 选举类词汇原先挤在这里，是**凑合**——七门类里没有"政治"这一格。
      // 2026-10-05 补上了独立的 politics 门类，它们搬走了。
      // society 回到本来的范围：人口、移民、社会运动与承受力。
    ],
  },
];

/** 强度加成。基础 2 分，逐条累加后夹到 1..5。 */
export const SEVERITY_RULES = [
  { delta: 1, keywords: ['空袭', '交火', '开火', '炮击', '导弹', '无人机', '击落', '军事行动', 'airstrike', 'clash', 'shelling', 'missile', 'offensive'] },
  { delta: 1, keywords: ['死亡', '伤亡', '遇难', '丧生', 'killed', 'dead', 'casualt', 'death toll'] },
  { delta: 1, keywords: ['联合国', '安理会', '紧急状态', '撤离', 'UN', 'Security Council', 'evacuat', 'state of emergency'] },
];

/** 用于"这是不是地缘相关"的最低要求：必须命中至少一个门类关键词。 */
export const RELEVANCE_FLOOR = 1;

/** 标题归并时要去掉的噪音词（源名后缀等）。 */
export const TITLE_NOISE = [
  /[-–—|]\s*(BBC|CNN|Reuters|AP|Al Jazeera|DW|France 24|The Guardian|Nikkei|SCMP)[^]*$/i,
  /^\s*\[[^\]]*\]\s*/,
  /\s*[-–—]\s*(新华网|人民网|中国新闻网|央视新闻)\s*$/,
];

/**
 * 聚合式报道的标题特征，命中即整条丢弃。
 *
 * 这类条目是灾难：Guardian 的 "…– Europe live" 把当天十几条不相关的新闻塞进同一个
 * description，于是正文里什么关键词都有。第一版拿"标题+正文"做匹配，结果一条法国
 * 学校抗议的直播贴被归类成冲突、强度 4、地点华盛顿。
 * 直播贴本身不是事件，是一个容器，必须在入口就拦住。
 */
export const NOISE_TITLE_PATTERNS = [
  /[-–—]\s*[A-Za-z ]{0,24}\blive\b\s*$/i,
  /\blive\s*[:：]/i,
  /\blive updates?\b/i,
  /\bas it happened\b/i,
  /^\s*(watch|video|podcast|in pictures|photo|opinion|analysis|editorial)\b/i,
  /^\s*(观察|图集|视频|直播|评论|解读)[:：]/,
];

/** 表意过于宽泛、不参与归并相似度计算的词。 */
export const STOP_TOKENS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'with', 'as', 'at', 'by', 'from', 'after', 'over',
  'says', 'said', 'new', 'will', 'its', 'his', 'her', 'their', 'that', 'this', 'has', 'have', 'be', 'is', 'are',
  'news', 'live', 'update', 'updates',
]);

/**
 * 抽取时用哪段文本。
 *
 * 这是整个规则层最容易做错的一个决定。第一版用「标题 + 正文」：
 * 结论是灾难——正文里充满了与事件无关的提及（一篇讲提格雷冲突的文章会顺手提到沙特、
 * 埃及、阿联酋），于是"埃塞俄比亚提格雷的冲突"被锚到了利雅得。
 *
 * 现在的分工：
 *   标题 → 定性（门类 / 行为体 / 地点）。标题是记者对这条新闻的定性，信噪比最高。
 *   正文 → 只用来写摘要，不参与任何判定。
 *
 * 代价是召回率下降（很多标题不含地名），但**错判比漏判贵得多**：
 * 漏掉一条只是少一个点，错锚一个点会让人对整张图失去信任。
 */
export const EXTRACT_FROM = 'title';

/**
 * 把上面的模式串编译成正则。
 *
 * 三条规则，每一条都是踩过坑之后定的：
 *
 * 1. **纯 ASCII 且没自带断言的模式一律补 `\\b`**。第一版忘了，`war` 直接匹配上
 *    `warning` 和 `toward`，85 条候选里 60 条被误判成冲突。
 *
 * 2. **单数英文词自动接受常见词形变化**（`s / es / ed / ing`）。第一版写 `troop`，
 *    结果匹配不到 `troops`；写 `sanction`，匹配不到 `sanctions`——而新闻标题里
 *    复数才是常态。补上之后 `war` 仍然不会匹配 `warning`，因为 `warning` 是
 *    `warn`+`ing` 而不是 `war`+`ning`（`\\b` 卡住了）。
 *
 * 3. **以 `=` 开头的模式区分大小写**。`US` 必须区分：加了 `i` 之后它会匹配英文单词
 *    "us"（"...told us..."），把一堆无关新闻锚到华盛顿。写成 `=US` 就只认大写。
 *
 * 中文模式走子串匹配（中文没有词边界概念），以 `\\w*` 结尾的模式走"已是完整正则"分支。
 */
export function compileRules() {
  const compile = (patterns) =>
    patterns.map((p) => {
      if (!/^[\x00-\x7F]+$/.test(p)) return new RegExp(p);
      const caseSensitive = p.startsWith('=');
      const body = caseSensitive ? p.slice(1) : p;
      const flags = caseSensitive ? '' : 'i';
      if (body.includes('\\')) return new RegExp(body, flags);
      const stem = body.replace(/\s+/g, '\\s+');
      const suffix = /\s/.test(body) ? '' : '(?:s|es|ed|ing)?';
      return new RegExp(`\\b${stem}${suffix}\\b`, flags);
    });

  return {
    actors: Object.entries(ACTOR_RULES).map(([id, pats]) => ({ id, res: compile(pats) })),
    categories: CATEGORY_RULES.map(({ category, keywords }) => ({ category, keywords, res: compile(keywords) })),
    severity: SEVERITY_RULES.map(({ delta, keywords }) => ({ delta, res: compile(keywords) })),
    overrides: PHRASE_OVERRIDES.map(({ pattern, category }) => ({ category, re: new RegExp(pattern, 'i') })),
  };
}

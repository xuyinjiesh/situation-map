#!/usr/bin/env node
/**
 * 時局圖 · 离线生成国家地名册
 * ---------------------------------------------------------------------------
 * 目的：补上采集管线最大的召回瓶颈——行为体表只有 37 个精选行为体，
 * 而现实新闻里的国家远不止这些（"Ethiopia's forces retake Mekelle" 因为
 * 埃塞俄比亚不在表里被整条丢弃）。
 *
 * 关键的设计分离：
 *   data/gazetteer.actors.json   37 个精选行为体 → **视觉层**（有徽记字、有印色，出现在图例里）
 *   data/gazetteer.countries.json 177 个国家  → **地理层**（只有名字和坐标，用于定位）
 * 把两者混为一谈，就会逼着你给 177 个国家各配一个动物徽记，图例直接爆掉。
 *
 * 数据来源：world-atlas 的 countries-110m.json（Natural Earth，公有领域）。
 * 英文名直接取自 properties.name，坐标**离线算**，不依赖任何地理编码服务。
 *
 * 用法：node scripts/build-country-gazetteer.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'node_modules/world-atlas/countries-110m.json');
const OUT = resolve(ROOT, 'data/gazetteer.countries.json');

// ---------------------------------------------------------------- 中文国名
/** Natural Earth 英文名 → 中文名。这些是**地理名称**，不构成任何政治表态。 */
const ZH = {
  Afghanistan: '阿富汗', Albania: '阿尔巴尼亚', Algeria: '阿尔及利亚', Angola: '安哥拉',
  Argentina: '阿根廷', Armenia: '亚美尼亚', Australia: '澳大利亚', Austria: '奥地利',
  Azerbaijan: '阿塞拜疆', Bahamas: '巴哈马', Bangladesh: '孟加拉国', Belarus: '白俄罗斯',
  Belgium: '比利时', Belize: '伯利兹', Benin: '贝宁', Bhutan: '不丹', Bolivia: '玻利维亚',
  'Bosnia and Herz.': '波黑', Botswana: '博茨瓦纳', Brazil: '巴西', Brunei: '文莱',
  Bulgaria: '保加利亚', 'Burkina Faso': '布基纳法索', Burundi: '布隆迪', Cambodia: '柬埔寨',
  Cameroon: '喀麦隆', Canada: '加拿大', 'Central African Rep.': '中非共和国', Chad: '乍得',
  Chile: '智利', China: '中国', Colombia: '哥伦比亚', Congo: '刚果（布）',
  'Costa Rica': '哥斯达黎加', Croatia: '克罗地亚', Cuba: '古巴', Cyprus: '塞浦路斯',
  Czechia: '捷克', "Côte d'Ivoire": '科特迪瓦', 'Dem. Rep. Congo': '刚果（金）',
  Denmark: '丹麦', Djibouti: '吉布提', 'Dominican Rep.': '多米尼加', Ecuador: '厄瓜多尔',
  Egypt: '埃及', 'El Salvador': '萨尔瓦多', 'Eq. Guinea': '赤道几内亚', Eritrea: '厄立特里亚',
  Estonia: '爱沙尼亚', Ethiopia: '埃塞俄比亚', 'Falkland Is.': '福克兰群岛', Fiji: '斐济',
  Finland: '芬兰', France: '法国', Gabon: '加蓬', Gambia: '冈比亚', Georgia: '格鲁吉亚',
  Germany: '德国', Ghana: '加纳', Greece: '希腊', Greenland: '格陵兰', Guatemala: '危地马拉',
  Guinea: '几内亚', 'Guinea-Bissau': '几内亚比绍', Guyana: '圭亚那', Haiti: '海地',
  Honduras: '洪都拉斯', Hungary: '匈牙利', Iceland: '冰岛', India: '印度',
  Indonesia: '印度尼西亚', Iran: '伊朗', Iraq: '伊拉克', Ireland: '爱尔兰', Israel: '以色列',
  Italy: '意大利', Jamaica: '牙买加', Japan: '日本', Jordan: '约旦', Kazakhstan: '哈萨克斯坦',
  Kenya: '肯尼亚', Kosovo: '科索沃', Kuwait: '科威特', Kyrgyzstan: '吉尔吉斯斯坦',
  Laos: '老挝', Latvia: '拉脱维亚', Lebanon: '黎巴嫩', Lesotho: '莱索托',
  Liberia: '利比里亚', Libya: '利比亚', Lithuania: '立陶宛', Luxembourg: '卢森堡',
  Macedonia: '北马其顿', Madagascar: '马达加斯加', Malawi: '马拉维', Malaysia: '马来西亚',
  Mali: '马里', Mauritania: '毛里塔尼亚', Mexico: '墨西哥', Moldova: '摩尔多瓦',
  Mongolia: '蒙古', Montenegro: '黑山', Morocco: '摩洛哥', Mozambique: '莫桑比克',
  Myanmar: '缅甸', 'N. Cyprus': '北塞浦路斯', Namibia: '纳米比亚', Nepal: '尼泊尔',
  Netherlands: '荷兰', 'New Caledonia': '新喀里多尼亚', 'New Zealand': '新西兰',
  Nicaragua: '尼加拉瓜', Niger: '尼日尔', Nigeria: '尼日利亚', 'North Korea': '朝鲜',
  Norway: '挪威', Oman: '阿曼', Pakistan: '巴基斯坦', Palestine: '巴勒斯坦',
  Panama: '巴拿马', 'Papua New Guinea': '巴布亚新几内亚', Paraguay: '巴拉圭', Peru: '秘鲁',
  Philippines: '菲律宾', Poland: '波兰', Portugal: '葡萄牙', 'Puerto Rico': '波多黎各',
  Qatar: '卡塔尔', Romania: '罗马尼亚', Russia: '俄罗斯', Rwanda: '卢旺达',
  'S. Sudan': '南苏丹', 'Saudi Arabia': '沙特阿拉伯', Senegal: '塞内加尔', Serbia: '塞尔维亚',
  'Sierra Leone': '塞拉利昂', Slovakia: '斯洛伐克', Slovenia: '斯洛文尼亚',
  'Solomon Is.': '所罗门群岛', Somalia: '索马里', Somaliland: '索马里兰',
  'South Africa': '南非', 'South Korea': '韩国', Spain: '西班牙', 'Sri Lanka': '斯里兰卡',
  Sudan: '苏丹', Suriname: '苏里南', Sweden: '瑞典', Switzerland: '瑞士', Syria: '叙利亚',
  Taiwan: '台湾', Tajikistan: '塔吉克斯坦', Tanzania: '坦桑尼亚', Thailand: '泰国',
  'Timor-Leste': '东帝汶', Togo: '多哥', 'Trinidad and Tobago': '特立尼达和多巴哥',
  Tunisia: '突尼斯', Turkey: '土耳其', Turkmenistan: '土库曼斯坦', Uganda: '乌干达',
  Ukraine: '乌克兰', 'United Arab Emirates': '阿联酋', 'United Kingdom': '英国',
  'United States of America': '美国', Uruguay: '乌拉圭', Uzbekistan: '乌兹别克斯坦',
  Vanuatu: '瓦努阿图', Venezuela: '委内瑞拉', Vietnam: '越南', 'W. Sahara': '西撒哈拉',
  Yemen: '也门', Zambia: '赞比亚', Zimbabwe: '津巴布韦', eSwatini: '斯威士兰',
};

// ---------------------------------------------------------------- 别名
/**
 * 英文别名 / 简称 / 形容词形式。
 *
 * 注意这里的**大小写**：国家的英文名在标题里必定大写，所以采集端对 ASCII 名称
 * 做区分大小写的匹配。这样 "turkey"（火鸡）、"china"（瓷器）、"us"（我们）
 * 这类同形词就不会误命中。代价是全小写的正文匹配不到——但抽取本来就只看标题。
 */
const ALIASES = {
  'United States of America': ['United States', 'USA', 'U.S.', 'American'],
  'United Kingdom': ['UK', 'Britain', 'British'],
  'Dem. Rep. Congo': ['DR Congo', 'Democratic Republic of the Congo', 'Congo-Kinshasa'],
  Congo: ['Republic of the Congo', 'Congo-Brazzaville'],
  'S. Sudan': ['South Sudan'],
  'W. Sahara': ['Western Sahara'],
  'Central African Rep.': ['Central African Republic'],
  'Eq. Guinea': ['Equatorial Guinea'],
  'Dominican Rep.': ['Dominican Republic'],
  'Bosnia and Herz.': ['Bosnia', 'Bosnia and Herzegovina'],
  'Solomon Is.': ['Solomon Islands'],
  'Falkland Is.': ['Falkland Islands', 'Malvinas'],
  Czechia: ['Czech Republic'],
  Macedonia: ['North Macedonia'],
  Myanmar: ['Burma'],
  "Côte d'Ivoire": ['Ivory Coast'],
  'Timor-Leste': ['East Timor'],
  eSwatini: ['Eswatini', 'Swaziland'],
  Netherlands: ['Holland'],
  'North Korea': ['DPRK'],
  'South Korea': ['Republic of Korea'],
  Turkey: ['Türkiye'],
  Vietnam: ['Viet Nam'],
  Laos: ['Lao PDR'],
  Russia: ['Russian Federation'],
  Iran: ['Islamic Republic of Iran'],
  Syria: ['Syrian Arab Republic'],
};

/** 这些是《时局图》不会关心的地物，留着只会让"南极洲"这种匹配污染结果。 */
const SKIP = new Set(['Antarctica', 'Fr. S. Antarctic Lands']);

// ------------------------------------------------------- 几何：代表点

/**
 * 把环的经度展开成连续序列。
 * 跨越 180° 经线的多边形（斐济、俄罗斯、新西兰）如果直接用原始经度算重心，
 * 会得到"地球另一侧"的结果。逐点消解 ±360 跳变即可。
 */
function unwrap(ring) {
  const out = [ring[0].slice(0, 2)];
  for (let i = 1; i < ring.length; i += 1) {
    let x = ring[i][0];
    const prev = out[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push([x, ring[i][1]]);
  }
  return out;
}

/** 鞋带公式求多边形重心与面积（平面近似，选"最大块"足够用）。 */
function ringCentroid(ring) {
  const p = unwrap(ring);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length - 1; i += 1) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return null;
  return {
    lon: ((((cx / (6 * a)) + 540) % 360) - 180),
    lat: cy / (6 * a),
    area: Math.abs(a),
  };
}

/**
 * 国家代表点 = **面积最大的那个多边形的重心**。
 *
 * 不用"所有多边形的加权平均"是有意的：美国含阿拉斯加与夏威夷、法国含海外省、
 * 挪威含斯瓦尔巴，平均下来会把这些国家的点拖到奇怪的地方。
 * 取最大块，美国落在大陆中部、法国落在本土、俄罗斯落在西伯利亚——都符合直觉。
 */
function representativePoint(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const poly of polys) {
    const c = ringCentroid(poly[0]);
    if (c && (!best || c.area > best.area)) best = c;
  }
  return best;
}

// ------------------------------------------------------------------ 主流程

const topo = JSON.parse(readFileSync(SRC, 'utf8'));
const collection = feature(topo, topo.objects.countries);

const countries = [];
const missingZh = [];

for (const f of collection.features) {
  const en = f.properties?.name;
  if (!en || SKIP.has(en)) continue;

  const pt = representativePoint(f.geometry);
  if (!pt) {
    console.warn(`⚠ ${en}: 无法计算代表点，跳过`);
    continue;
  }

  const zh = ZH[en];
  if (!zh) missingZh.push(en);

  const names = [en, ...(ALIASES[en] ?? [])];
  if (zh) names.push(zh);

  countries.push({
    iso: String(f.id ?? ''),
    en,
    zh: zh ?? en,
    names: [...new Set(names)],
    lat: Number(pt.lat.toFixed(3)),
    lon: Number(pt.lon.toFixed(3)),
  });
}

countries.sort((a, b) => a.en.localeCompare(b.en));

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      _comment:
        '国家地名册，由 scripts/build-country-gazetteer.mjs 离线生成（world-atlas / Natural Earth，公有领域）。' +
        '英文名取自 Natural Earth，中文名为地理名称。采集端对 ASCII 名称做区分大小写的整词匹配，' +
        '对中文名做最长优先的子串匹配（保证"南苏丹"先于"苏丹"命中）。不要手改，改生成器。',
      _generated: new Date().toISOString().slice(0, 10),
      count: countries.length,
      countries,
    },
    null,
    1,
  )}\n`,
);

console.log(`✓ ${OUT}`);
console.log(`  ${countries.length} 个国家/地区`);
if (missingZh.length) {
  console.log(`  ⚠ ${missingZh.length} 个缺中文名（只能按英文匹配）：${missingZh.join(', ')}`);
} else {
  console.log('  中文名覆盖：100%');
}

// 抽查几个几何上最容易算错的国家
const probe = ['China', 'United States of America', 'Russia', 'France', 'Ethiopia', 'Fiji', 'Chile', 'Norway'];
console.log('\n代表点抽查（用于判断几何是否算错）：');
for (const name of probe) {
  const c = countries.find((x) => x.en === name);
  if (c) console.log(`  ${c.zh.padEnd(8)} ${String(c.lat).padStart(8)}, ${String(c.lon).padStart(8)}`);
}

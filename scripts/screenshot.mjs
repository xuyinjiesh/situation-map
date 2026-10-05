#!/usr/bin/env node
/**
 * 开发用的视觉验收脚本。
 *
 * WebGL 在无头环境里要靠 SwiftShader 软件渲染，慢但可用；关键是必须显式打开
 * --enable-unsafe-swiftshader，否则 three.js 会拿不到上下文，页面白屏而控制台只报一句
 * "Error creating WebGL context"。
 *
 * 依赖没有写进 package.json，避免 CI 为了静态站去下载整个 Chromium：
 *   npm i -D playwright && npx playwright install chromium
 *
 * 用法：
 *   node scripts/screenshot.mjs                       # 默认抓 http://127.0.0.1:5180
 *   node scripts/screenshot.mjs --url http://127.0.0.1:4173/situation-map/
 */

import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(ROOT, 'docs/shots');
mkdirSync(outDir, { recursive: true });

const urlArg = process.argv.indexOf('--url');
const BASE = urlArg >= 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:5180/';

const { chromium } = await import('playwright');

const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));

console.log(`→ ${BASE}`);
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });

// 地球贴图是同步生成的，但球体入场动画要一会儿。
await page.waitForSelector('.app[data-ready="true"]', { timeout: 60000 });
await page.waitForTimeout(6000);

const shot = async (name) => {
  const file = resolve(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${file}`);
};

await shot('01-both');

// 大勢：只剩长期趋势
await page.getByRole('tab', { name: '大勢' }).click();
await page.waitForTimeout(3500);
await shot('02-trends');

// 回近事并打开一条事件的详情
await page.getByRole('tab', { name: '近事' }).click();
await page.waitForTimeout(2500);
const first = page.locator('.feed__item').first();
if (await first.count()) {
  await first.click();
  await page.waitForTimeout(3000);
  await shot('03-detail-event');
}

// 打开一条趋势的详情。详情面板会顶掉控制台，所以先按 Esc 收起。
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.getByRole('tab', { name: '大勢' }).click();
await page.waitForTimeout(2000);
const firstTrend = page.locator('.feed__item--trend').first();
if (await firstTrend.count()) {
  await firstTrend.click();
  await page.waitForTimeout(3000);
  await shot('04-detail-trend');
}

// 回放：确认时间游标真的会过滤事件
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.getByRole('tab', { name: '近事' }).click();
await page.waitForTimeout(800);
const slider = page.locator('.timeline__slider');
const bounds = await slider.evaluate((el) => ({ min: el.min, max: el.max }));
await slider.fill(String(Math.round((Number(bounds.min) + Number(bounds.max)) / 2)));
await page.waitForTimeout(2500);
const passed = await page.locator('.timeline__ticks .timeline__tick[data-past="true"]').count();
const total = await page.locator('.timeline__ticks .timeline__tick').count();
console.log(`  时间游标过滤：${passed}/${total} 条越过游标`);
await shot('05-timeline-midpoint');

const counts = await page.evaluate(() => ({
  markers: document.querySelectorAll('.mk').length,
  canvas: document.querySelectorAll('canvas').length,
  feed: document.querySelectorAll('.feed__item').length,
}));
console.log('  DOM:', counts);

await browser.close();

if (problems.length > 0) {
  console.log('\n控制台输出：');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
} else {
  console.log('\n控制台干净。');
}

/**
 * 生成 Postflare 标志（assets/logo.svg）与几何构造图（assets/logo-construction.svg）。
 *
 * 构造规则：
 * - 画布 128，内容边距 16。机头 N 在右上角，折点 F 与 N 同在 45° 轴上（内容框对角线）
 * - 尾圆以 F 为圆心，半径是 |NF| 的一半。尾部凹口的两个边是尾圆的两条半径，夹角 120°
 * - 翼尖 A、B 是凹口的两个端点。机翼的两条边是机头圆（圆心 N、经过 A、B）的半径
 * - 火花由四段 90° 圆弧组成，圆弧半径等于火花半宽，圆心位于火花中心的对角线上
 *
 * 调整图形在脚本中完成，运行 `bun run scripts/logo.ts` 重新生成。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 128;
const MARGIN = 16;
const NOSE = { x: SIZE - MARGIN, y: MARGIN };
const SPARK = { x: MARGIN * 2, y: MARGIN * 2, radius: MARGIN };
const AXIS = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
const NOTCH_DEGREES = 60;

const rotate = (point: { x: number; y: number }, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;

  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
};

const back = { x: -AXIS.x, y: -AXIS.y };
const armA = rotate(back, NOTCH_DEGREES);
const armB = rotate(back, -NOTCH_DEGREES);

// 让翼尖 A 正好落在左边距线上，解出 |NF|。
const distance = (NOSE.x - MARGIN) / (AXIS.x - armA.x / 2);
const FOLD = { x: NOSE.x - AXIS.x * distance, y: NOSE.y - AXIS.y * distance };
const TAIL_RADIUS = distance / 2;
const wingA = {
  x: FOLD.x + armA.x * TAIL_RADIUS,
  y: FOLD.y + armA.y * TAIL_RADIUS,
};
const wingB = {
  x: FOLD.x + armB.x * TAIL_RADIUS,
  y: FOLD.y + armB.y * TAIL_RADIUS,
};
const NOSE_RADIUS = Math.hypot(wingA.x - NOSE.x, wingA.y - NOSE.y);

const n = (value: number) => Number(value.toFixed(4));

const planePath = [
  `M${n(NOSE.x)} ${n(NOSE.y)}`,
  `L${n(wingA.x)} ${n(wingA.y)}`,
  `L${n(FOLD.x)} ${n(FOLD.y)}`,
  `L${n(wingB.x)} ${n(wingB.y)}`,
  'Z',
].join(' ');

const sparkPath = [
  `M${n(SPARK.x)} ${n(SPARK.y - SPARK.radius)}`,
  `A${SPARK.radius} ${SPARK.radius} 0 0 0 ${n(SPARK.x + SPARK.radius)} ${n(SPARK.y)}`,
  `A${SPARK.radius} ${SPARK.radius} 0 0 0 ${n(SPARK.x)} ${n(SPARK.y + SPARK.radius)}`,
  `A${SPARK.radius} ${SPARK.radius} 0 0 0 ${n(SPARK.x - SPARK.radius)} ${n(SPARK.y)}`,
  `A${SPARK.radius} ${SPARK.radius} 0 0 0 ${n(SPARK.x)} ${n(SPARK.y - SPARK.radius)}`,
  'Z',
].join(' ');

const markers = [
  `M${n(NOSE.x - 2)} ${n(NOSE.y)}h4 M${n(NOSE.x)} ${n(NOSE.y - 2)}v4`,
  `M${n(FOLD.x - 2)} ${n(FOLD.y)}h4 M${n(FOLD.x)} ${n(FOLD.y - 2)}v4`,
  `M${n(SPARK.x - 2)} ${n(SPARK.y)}h4 M${n(SPARK.x)} ${n(SPARK.y - 2)}v4`,
].join(' ');

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Postflare">
  <style>@media (prefers-color-scheme: dark) { path { fill: #6f9dff; } }</style>
  <path fill="#2f6be4" d="${planePath}"/>
  <path fill="#2f6be4" d="${sparkPath}"/>
</svg>
`;

const construction = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-28 -28 184 184" role="img" aria-labelledby="title desc">
<title id="title">Postflare: geometric construction</title>
<desc id="desc">纸飞机与火花。机头 N 与折点 F 位于 45° 轴上，轴是内容框的对角线。尾圆以 F 为圆心，半径是 NF 的一半。尾部凹口的两条边是尾圆的两条半径，夹角 120°，端点即翼尖 A、B。机翼的两条边从 N 连到 A、B，是机头圆的半径，机头圆以 N 为圆心并经过 A、B。火花由四段 90° 圆弧组成，圆弧半径等于火花半宽，四个圆心位于火花中心的对角线上。内容边距为 16。</desc>
<style>
  :root { color-scheme: light dark; }
  .background { fill: #fff; }
  .guide { stroke: #8a94a5; }
  .outline { stroke: #2f6be4; }
  .shape { fill: #2f6be4; fill-opacity: .16; }
  .contact { fill: #a84910; }
  .label { fill: #354154; font-family: ui-sans-serif, system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) {
    .background { fill: #191b21; }
    .guide { stroke: #8993a3; }
    .outline { stroke: #6f9dff; }
    .shape { fill: #6f9dff; fill-opacity: .18; }
    .contact { fill: #f4aa72; }
    .label { fill: #e5e9f1; }
  }
</style>
<rect class="background" x="-28" y="-28" width="184" height="184"/>
<g class="guide" fill="none" stroke-width=".4">
<rect x="${MARGIN}" y="${MARGIN}" width="${SIZE - MARGIN * 2}" height="${SIZE - MARGIN * 2}" stroke-dasharray="2 2.5"/>
<path d="M${n(MARGIN - 4)} ${n(SIZE - MARGIN + 4)} ${n(SIZE - MARGIN + 4)} ${n(MARGIN - 4)}"/>
<circle cx="${n(NOSE.x)}" cy="${n(NOSE.y)}" r="${n(NOSE_RADIUS)}"/>
<circle cx="${n(FOLD.x)}" cy="${n(FOLD.y)}" r="${n(TAIL_RADIUS)}"/>
<circle cx="${n(SPARK.x + SPARK.radius)}" cy="${n(SPARK.y - SPARK.radius)}" r="${SPARK.radius}"/>
<circle cx="${n(SPARK.x + SPARK.radius)}" cy="${n(SPARK.y + SPARK.radius)}" r="${SPARK.radius}"/>
<circle cx="${n(SPARK.x - SPARK.radius)}" cy="${n(SPARK.y + SPARK.radius)}" r="${SPARK.radius}"/>
<circle cx="${n(SPARK.x - SPARK.radius)}" cy="${n(SPARK.y - SPARK.radius)}" r="${SPARK.radius}"/>
</g>
<g class="shape">
<path d="${planePath}"/>
<path d="${sparkPath}"/>
</g>
<g class="outline" fill="none" stroke-width=".5">
<path d="${planePath}"/>
<path d="${sparkPath}"/>
</g>
<g class="guide" fill="none" stroke-width=".6">
${markers}
</g>
<circle class="contact" cx="${n(wingA.x)}" cy="${n(wingA.y)}" r="1.1"/>
<circle class="contact" cx="${n(wingB.x)}" cy="${n(wingB.y)}" r="1.1"/>
<text class="label" x="${n(NOSE.x + 4)}" y="${n(NOSE.y - 3)}" font-size="7">N</text>
<text class="label" x="${n(FOLD.x - 5)}" y="${n(FOLD.y + 6.5)}" font-size="7" text-anchor="end">F</text>
<text class="label" x="${n(SPARK.x - 5.5)}" y="${n(SPARK.y - 2.5)}" font-size="7" text-anchor="end">S</text>
<text class="label" x="${n(wingA.x - 4.5)}" y="${n(wingA.y + 4.5)}" font-size="7" text-anchor="end">A</text>
<text class="label" x="${n(wingB.x + 4.5)}" y="${n(wingB.y + 5.5)}" font-size="7">B</text>
</svg>
`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await mkdir(join(root, 'assets'), { recursive: true });
await writeFile(join(root, 'assets/logo.svg'), logo);
await writeFile(join(root, 'assets/logo-construction.svg'), construction);
console.log('已生成 assets/logo.svg 与 assets/logo-construction.svg');

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { inspectInkySource } from '#/client/components/editor/inky/guard';
import { compileInky, injectFrameworkCss } from '#/client/inky';
import { initSync } from '#/client/inky/inky.js';

test('当前模板用到的 Inky 片段可以进入可视化模式', () => {
  const source = `
    <style>
      @media (max-width: 596px) {
        .mail-content { width: 100% !important; }
      }
    </style>
    <preview>你的 pixiv API Key 已创建</preview>
    <wrapper class="mail-wrapper">
      <container class="mail-card" style="background-color: #fff">
        <image src="/api/attachments/a1" alt="pixiv" width="620" class="mail-hero"></image>
        <row>
          <column class="mail-content">
            <p class="mail-text">你好，</p>
            <callout color="primary" class="mail-panel"><strong>YOUR API KEY</strong><br>{{API_KEY}}</callout>
            <button href="https://example.com" size="small" color="primary" class="rounded mail-action" bulletproof>
              查看文档
            </button>
            <alert type="warning" class="mail-warning">请妥善保管 API Key。</alert>
            <p class="mail-site"><a href="https://example.com">example.com</a></p>
          </column>
        </row>
      </container>
    </wrapper>
  `;

  expect(inspectInkySource(source)).toEqual({ blocked: false, issues: [] });
});

test('段落和标题的 id/title 会命中', () => {
  expect(inspectInkySource('<p id="intro">Hello</p>').issues).toContain(
    'paragraph-attributes',
  );

  expect(inspectInkySource('<h1 title="Title">Hello</h1>').issues).toContain(
    'paragraph-attributes',
  );
});

test('带 class 或 style 的 span 会命中', () => {
  expect(inspectInkySource('<span class="price">$1</span>').issues).toContain(
    'span-attributes',
  );

  expect(
    inspectInkySource('<span style="color:red">$1</span>').issues,
  ).toContain('span-attributes');
});

test('原生 img 的 style 或 height 会命中，Inky image 不会', () => {
  expect(
    inspectInkySource('<img src="/x.png" style="height:10px">').issues,
  ).toContain('native-image');

  expect(inspectInkySource('<img src="/x.png" height="10">').issues).toContain(
    'native-image',
  );

  expect(
    inspectInkySource('<image src="/x.png" class="hero"></image>').blocked,
  ).toBe(false);
});

test('Alert 和 Callout 里的真实块内容会命中', () => {
  expect(
    inspectInkySource('<alert type="warning"><p>Paragraph</p></alert>').issues,
  ).toContain('nested-block');

  expect(
    inspectInkySource(
      '<callout color="primary"><ul><li>Item</li></ul></callout>',
    ).issues,
  ).toContain('nested-block');
});

test('style 的 media/type 会命中，内部 @media 不会', () => {
  expect(
    inspectInkySource('<style media="print">p{color:red}</style>').issues,
  ).toContain('style-attributes');

  expect(
    inspectInkySource('<style type="text/less">p{color:red}</style>').issues,
  ).toContain('style-attributes');

  expect(
    inspectInkySource('<style>@media (max-width: 596px){p{color:red}}</style>')
      .blocked,
  ).toBe(false);
});

test('完整文档的 doctype/html/body 会命中', () => {
  expect(
    inspectInkySource('<!doctype html><html><body><p>Hello</p></body></html>')
      .issues,
  ).toContain('document');

  expect(
    inspectInkySource(
      '<html lang="en"><body class="mail"><p>Hello</p></body></html>',
    ).issues,
  ).toContain('document');
});

test('按钮内部的链接标记会命中', () => {
  expect(
    inspectInkySource('<button href="/x"><a href="/y">Link</a></button>')
      .issues,
  ).toContain('button-link');
});

test('raw 内容不参与检查', () => {
  expect(
    inspectInkySource(
      '<container><raw><p id="intro" style="color:red">Hello</p></raw></container>',
    ).blocked,
  ).toBe(false);
});

test('Inky 编译在完整文档中保留 html/body 属性并一次内联 callout 圆角边框规则', async () => {
  initSync({
    module: readFileSync(
      new URL('../src/client/inky/inky_bg.wasm', import.meta.url),
    ),
  });

  const fullDoc = [
    '<!doctype html>',
    '<html lang="zh" class="mail-root">',
    '<head><style>.mail-body { background-color: #123456; }</style></head>',
    '<body class="mail-body">',
    '<container><callout color="primary">Hello Callout</callout></container>',
    '</body></html>',
  ].join('');

  expect(injectFrameworkCss(fullDoc).startsWith('<!doctype html>')).toBe(true);

  const compiled = await compileInky(fullDoc);

  expect(compiled.html).toContain('lang="zh"');
  expect(compiled.html).toContain('class="mail-root"');
  expect(compiled.html).toContain('class="mail-body"');
  expect(compiled.html).toContain('background-color:#123456');

  expect(compiled.html).toMatch(
    /<table[^>]*class="[^"]*\bcallout\b[^"]*"[^>]*border-collapse:separate/,
  );
  expect(compiled.text).toContain('Hello Callout');
});

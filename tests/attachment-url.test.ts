import { expect, test } from 'bun:test';

import {
  extractAttachmentIds,
  hasUnreferencedAttachments,
  replaceAttachmentUrls,
} from '#/attachment-url';

test('提取属性和 CSS url() 中的附件引用', () => {
  const html = [
    '<img src="/api/attachments/a1">',
    "<td background='/api/attachments/a2'>",
    '<a href=/api/attachments/a3>',
    '<div style="background:url(/api/attachments/a4)">',
    '<style>div{background:url("/api/attachments/a5")}</style>',
  ].join('');

  expect(extractAttachmentIds(html)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
});

test('按 HTML 属性语义解码实体后解析 CSS', () => {
  const html =
    '<div style="background-image:url(&quot;/api/attachments/a1&quot;)"></div>';

  expect(extractAttachmentIds(html)).toEqual(['a1']);

  expect(replaceAttachmentUrls(html, () => '/api/attachments/b1')).toBe(
    '<div style="background-image:url(&quot;/api/attachments/b1&quot;)"></div>',
  );
});

test('实体编码的资源路径也能识别和替换', () => {
  const html = [
    '<div style="background:url(&quot;&#47;api/attachments/a1&quot;)"></div>',
    '<img src="&#47;api/attachments/a2">',
  ].join('');

  expect(extractAttachmentIds(html)).toEqual(['a1', 'a2']);

  const output = replaceAttachmentUrls(
    html,
    id => `/api/attachments/${id === 'a1' ? 'b1' : 'b2'}`,
  );

  expect(output).toContain('url(&quot;/api/attachments/b1&quot;)');
  expect(output).toContain('src="/api/attachments/b2"');
});

test('实体解码后的非 BMP 字符不会错位后续引用', () => {
  const html =
    '<div style="content:&quot;&#x1F600;&quot;;background:url(&quot;/api/attachments/a1&quot;)"></div>';

  expect(extractAttachmentIds(html)).toEqual(['a1']);
});

test('srcset 单候选保留描述符和原始区间', () => {
  const html = '<img srcset="/api/attachments/a1 1x">';

  expect(extractAttachmentIds(html)).toEqual(['a1']);

  expect(replaceAttachmentUrls(html, () => '/api/attachments/b1')).toBe(
    '<img srcset="/api/attachments/b1 1x">',
  );
});

test('srcset 多候选、data URL 和描述符', () => {
  const html =
    '<img srcset=" /api/attachments/a1 1x, data:image/png;base64,aaa 2x, /api/attachments/a2 3x ">';

  expect(extractAttachmentIds(html)).toEqual(['a1', 'a2']);

  const output = replaceAttachmentUrls(html, id =>
    id === 'a1' ? '/api/attachments/b1' : '/api/attachments/b2',
  );

  expect(output).toContain('/api/attachments/b1 1x');
  expect(output).toContain('data:image/png;base64,aaa 2x');
  expect(output).toContain('/api/attachments/b2 3x');
});

test('srcset 实体编码的候选也能识别', () => {
  const html =
    '<img srcset="&#47;api/attachments/a1 1x, /api/attachments/a2 2x">';

  expect(extractAttachmentIds(html)).toEqual(['a1', 'a2']);
});

test('CSS URL 转义按 CSS 语义解码', () => {
  const html = [
    '<div style="background-image:url(\\/api/attachments/a1)"></div>',
    '<div style="background:url(\\2f api/attachments/a2)"></div>',
    '<div style="background:url(&quot;\\/api/attachments/a3&quot;)"></div>',
  ].join('');

  expect(extractAttachmentIds(html)).toEqual(['a1', 'a2', 'a3']);

  const output = replaceAttachmentUrls(
    html,
    id => `/api/attachments/${id.slice(1)}`,
  );

  expect(output).toContain('url(/api/attachments/1)');
  expect(output).toContain('url(/api/attachments/2)');
  expect(output).toContain('url(&quot;/api/attachments/3&quot;)');
});

test('CSS 字符串里的转义路径不当作资源', () => {
  const html = '<style>div::before{content:"\\/api/attachments/fake"}</style>';

  expect(extractAttachmentIds(html)).toEqual([]);
});

test('style 标签内容不按属性实体解码', () => {
  const html =
    '<style>div{background:url(&quot;/api/attachments/fake&quot;)}</style>';

  expect(extractAttachmentIds(html)).toEqual([]);
});

test('属性值里的 > 不会截断后续 src', () => {
  const html = '<img alt="1 > 0" src="/api/attachments/a1">';

  expect(extractAttachmentIds(html)).toEqual(['a1']);

  expect(replaceAttachmentUrls(html, () => '/api/attachments/b1')).toBe(
    '<img alt="1 > 0" src="/api/attachments/b1">',
  );
});

test('只提取真实资源属性，不扫描 title 和 CSS 字符串', () => {
  const html = [
    '<img title="url(/api/attachments/title)" src="/api/attachments/a1">',
    '<style>div::before{content:"url(/api/attachments/css-string)"}</style>',
    '<img src="data:image/svg+xml,<svg><image href=\'/api/attachments/svg\'/></svg>">',
    '<video poster="/api/attachments/poster"></video>',
  ].join('');

  expect(extractAttachmentIds(html)).toEqual(['a1', 'poster']);
});

test('重复引用使用线性扫描', () => {
  const html = '<img src="/api/attachments/a1">'.repeat(8_000);
  const started = performance.now();
  const ids = extractAttachmentIds(html);
  const elapsed = performance.now() - started;

  expect(ids).toEqual(['a1']);
  expect(elapsed).toBeLessThan(500);
});

test('忽略注释、普通文本和 data URL 里的路径', () => {
  const html = [
    '<!-- <img src="/api/attachments/comment"> -->',
    '<p>/api/attachments/plain</p>',
    '<p>src="/api/attachments/text"</p>',
    '<p>1 < 2 src="/api/attachments/less-than"</p>',
    '<img src="data:image/png;base64,/api/attachments/data">',
    '<style>/* url(/api/attachments/css-comment) */</style>',
  ].join('');

  expect(extractAttachmentIds(html)).toEqual([]);
});

test('只替换真实引用，保留注释和 data URL', () => {
  const html = [
    '<!-- <img src="/api/attachments/a1"> -->',
    '<img src="/api/attachments/a1">',
    '<img src="data:image/png;base64,/api/attachments/a1">',
    '<style>/* url(/api/attachments/a1) */</style>',
  ].join('');

  const output = replaceAttachmentUrls(html, id =>
    id === 'a1' ? '/api/attachments/b1' : null,
  );

  expect(output).toContain('<!-- <img src="/api/attachments/a1"> -->');
  expect(output).toContain('<img src="/api/attachments/b1">');
  expect(output).toContain('data:image/png;base64,/api/attachments/a1');
  expect(output).toContain('/* url(/api/attachments/a1) */');
});

test('未知 id 保留原地址', () => {
  const html = '<img src="/api/attachments/a1">';

  expect(replaceAttachmentUrls(html, () => null)).toBe(html);
});

test('按当前源码判断是否仍有未引用附件', () => {
  expect(
    hasUnreferencedAttachments('<img src="/api/attachments/a1">', ['a1']),
  ).toBe(false);

  expect(
    hasUnreferencedAttachments('<img alt="1 > 0" src="/api/attachments/a1">', [
      'a1',
    ]),
  ).toBe(false);

  expect(
    hasUnreferencedAttachments(
      '<div style="background-image:url(&quot;/api/attachments/a1&quot;)"></div>',
      ['a1'],
    ),
  ).toBe(false);

  expect(
    hasUnreferencedAttachments(
      '<img srcset="/api/attachments/a1 1x, /api/attachments/a2 2x">',
      ['a1', 'a2'],
    ),
  ).toBe(false);

  expect(
    hasUnreferencedAttachments('<img src="/api/attachments/a1">', ['a1', 'a2']),
  ).toBe(true);

  expect(
    hasUnreferencedAttachments('<img title="url(/api/attachments/a1)">', [
      'a1',
    ]),
  ).toBe(true);
  expect(hasUnreferencedAttachments('<p>text</p>', ['a2'])).toBe(true);
});

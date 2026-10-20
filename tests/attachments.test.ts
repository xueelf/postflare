import { expect, test } from 'bun:test';

import { normalizeContentId, replaceCidImages } from '#/worker/attachments';

const ATTACHMENTS = [
  { id: 'a1', content_id: '<inline-1>' },
  { id: 'a2', content_id: 'background-1' },
  { id: 'a3', content_id: 'url-1' },
];

test('normalizeContentId 去掉尖括号和空白', () => {
  expect(normalizeContentId(' <inline-1> ')).toBe('inline-1');
  expect(normalizeContentId('inline-1')).toBe('inline-1');
});

test('normalizeContentId 为空时返回 null', () => {
  expect(normalizeContentId(null)).toBeNull();
  expect(normalizeContentId(undefined)).toBeNull();
  expect(normalizeContentId('   ')).toBeNull();
});

test('replaceCidImages 替换 src、background 和 href 里的 cid', () => {
  const html = [
    '<img src="cid:inline-1">',
    "<td background='cid:background-1'>",
    '<a href="cid:inline-1">',
  ].join('');
  const output = replaceCidImages(html, ATTACHMENTS);

  expect(output).toContain('src="/api/attachments/a1"');
  expect(output).toContain("background='/api/attachments/a2'");
  expect(output).toContain('href="/api/attachments/a1"');
});

test('replaceCidImages 替换 style 和 style 标签里的 cid url()', () => {
  const html = [
    '<div style="background:url(cid:url-1)">',
    '<style>div{background:url("cid:url-1")}</style>',
  ].join('');
  const output = replaceCidImages(html, ATTACHMENTS);

  expect(output).toContain('url(/api/attachments/a3)');
  expect(output).toContain('url("/api/attachments/a3")');
});

test('replaceCidImages 解码百分号编码的 cid', () => {
  expect(replaceCidImages('<img src="cid:inline%2D1">', ATTACHMENTS)).toContain(
    'src="/api/attachments/a1"',
  );
});

test('replaceCidImages 未知 cid 原样保留', () => {
  const output = replaceCidImages('<img src="cid:missing">', ATTACHMENTS);

  expect(output).toContain('src="cid:missing"');
});

test('replaceCidImages 没有可替换内容时原样返回', () => {
  expect(replaceCidImages('', ATTACHMENTS)).toBe('');
  expect(replaceCidImages('<p>text</p>', [])).toBe('<p>text</p>');
});

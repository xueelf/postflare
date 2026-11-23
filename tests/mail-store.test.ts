import { expect, test } from 'bun:test';

import {
  capBody,
  htmlToPlainText,
  normalizeMessageId,
} from '#/worker/mail-store';

test('normalizeMessageId 去掉包裹的尖括号', () => {
  expect(normalizeMessageId('<abc@example.com>')).toBe('abc@example.com');
  expect(normalizeMessageId('abc@example.com')).toBe('abc@example.com');
  expect(normalizeMessageId(' <abc@example.com> ')).toBe('abc@example.com');
});

test('normalizeMessageId 对空值和空尖括号返回 null', () => {
  expect(normalizeMessageId(null)).toBeNull();
  expect(normalizeMessageId(undefined)).toBeNull();
  expect(normalizeMessageId('')).toBeNull();
  expect(normalizeMessageId('   ')).toBeNull();
  expect(normalizeMessageId('<>')).toBeNull();
  expect(normalizeMessageId(' <   > ')).toBeNull();
});

test('htmlToPlainText 提取正文并跳过 style、head 与注释', () => {
  const html = [
    '<html><head><title>隐藏标题</title><style>.a { color: red; }</style></head>',
    '<body><!-- 隐藏注释 --><p>你好，&nbsp;<strong>API Key</strong> 已创建 &amp; 生效 &#x2728;</p></body></html>',
  ].join('');

  expect(htmlToPlainText(html)).toBe('你好， API Key 已创建 & 生效 ✨');
});

test('capBody 在字节上限内原样返回', () => {
  expect(capBody(null, '…', 10)).toBeNull();
  expect(capBody('短正文', '…', 100)).toBe('短正文');
});

test('capBody 超限时截断并补说明，且总字节数不超上限', () => {
  const encoder = new TextEncoder();
  const limit = 1000;
  const notice = '（正文过长，已截断）';

  const ascii = capBody('A'.repeat(1_200_000), notice, limit);

  expect(ascii?.endsWith(notice)).toBe(true);
  expect(encoder.encode(ascii ?? '').length).toBeLessThanOrEqual(limit);

  // 多字节字符按字节比例粗切后会超标，需要再收窄
  const cjk = capBody('好'.repeat(400_000), notice, limit);

  expect(cjk?.endsWith(notice)).toBe(true);
  expect(encoder.encode(cjk ?? '').length).toBeLessThanOrEqual(limit);
});

test('capBody 在完整 Unicode 字符边界截断', () => {
  const encoder = new TextEncoder();
  const emoji = capBody('😀😀', '', 5);

  expect(emoji).toBe('😀');
  expect(encoder.encode(emoji ?? '').length).toBeLessThanOrEqual(5);
  expect(emoji).not.toContain('\uFFFD');
});

test('capBody 保留预算内的最大前缀', () => {
  const result = capBody('A'.repeat(1_001), 'X', 1_000);

  expect(result).toHaveLength(1_000);
  expect(result?.endsWith('X')).toBe(true);
});

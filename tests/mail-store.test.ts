import { expect, test } from 'bun:test';

import {
  BODY_MAX_BYTES,
  capBody,
  normalizeMessageId,
} from '#/worker/mail-store';

test('normalizeMessageId 去掉包裹的尖括号', () => {
  expect(normalizeMessageId('<abc@example.com>')).toBe('abc@example.com');
  expect(normalizeMessageId('abc@example.com')).toBe('abc@example.com');
  expect(normalizeMessageId(' <abc@example.com> ')).toBe('abc@example.com');
});

test('normalizeMessageId 对空值返回 null', () => {
  expect(normalizeMessageId(null)).toBeNull();
  expect(normalizeMessageId(undefined)).toBeNull();
  expect(normalizeMessageId('')).toBeNull();
  expect(normalizeMessageId('   ')).toBeNull();
});

test('capBody 在字节上限内原样返回', () => {
  expect(capBody(null, '…')).toBeNull();
  expect(capBody('短正文', '…')).toBe('短正文');
});

test('capBody 超限时截断并补说明，且总字节数不超上限', () => {
  const encoder = new TextEncoder();
  const limit = BODY_MAX_BYTES;
  const notice = '（正文过长，已截断）';

  const ascii = capBody('A'.repeat(1_200_000), notice);

  expect(ascii?.endsWith(notice)).toBe(true);
  expect(encoder.encode(ascii ?? '').length).toBeLessThanOrEqual(limit);

  // 多字节字符按字节比例粗切后会超标，需要再收窄
  const cjk = capBody('好'.repeat(400_000), notice);

  expect(cjk?.endsWith(notice)).toBe(true);
  expect(encoder.encode(cjk ?? '').length).toBeLessThanOrEqual(limit);
});

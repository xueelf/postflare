import { expect, test } from 'bun:test';

import { rowTooLarge, sqliteRowBytes } from '#/worker/row-size';

test('文本 serial type 使用 13 + 2 * 字节数', () => {
  // 58 字节文本的 serial type 为 129，需要两个 varint 字节
  expect(sqliteRowBytes(['a'.repeat(58)])).toBe(61);
});

test('整数列使用 SQLite 整数 serial type', () => {
  expect(sqliteRowBytes([0])).toBe(2);
  expect(sqliteRowBytes([1])).toBe(2);
  expect(sqliteRowBytes([128])).toBe(4);
});

test('记录预算以 SQLite payload 为边界，不额外扣除固定余量', () => {
  const boundary = 'a'.repeat(1_999_995);

  expect(sqliteRowBytes([boundary])).toBe(2_000_000);
  expect(rowTooLarge([boundary])).toBe(false);
  expect(rowTooLarge([`${boundary}a`])).toBe(true);
});

test('多字段文本按完整记录头累计', () => {
  expect(
    sqliteRowBytes([
      'id',
      'user',
      'a'.repeat(200),
      null,
      '2026-10-28 00:00:00',
    ]),
  ).toBeGreaterThan(200);
});

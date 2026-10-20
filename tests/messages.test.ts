import { expect, test } from 'bun:test';

import { formatListCursor, parseListCursor } from '#/worker/messages';

test('formatListCursor 与 parseListCursor 往返', () => {
  const cursor = formatListCursor('2026-10-19 12:00:00', 42);

  expect(cursor).toBe('2026-10-19 12:00:00|42');

  expect(parseListCursor(cursor)).toEqual({
    sort: '2026-10-19 12:00:00',
    rowId: 42,
  });
});

test('parseListCursor 拒绝畸形游标', () => {
  expect(parseListCursor(null)).toBeNull();
  expect(parseListCursor('')).toBeNull();
  expect(parseListCursor('2026-10-19 12:00:00')).toBeNull();
  expect(parseListCursor('|42')).toBeNull();
  expect(parseListCursor('2026-10-19 12:00:00|abc')).toBeNull();
  expect(parseListCursor('2026-10-19 12:00:00|4.5')).toBeNull();
});

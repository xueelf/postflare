import { expect, test } from 'bun:test';

import { validRecipients } from '#/worker/compose';

test('validRecipients 接受单个与逗号分隔的地址', () => {
  expect(validRecipients('me@example.com')).toBe(true);
  expect(validRecipients('a@b.c, d@e.f')).toBe(true);
  expect(validRecipients(' a@b.c , d@e.f ')).toBe(true);
});

test('validRecipients 拒绝缺域名与多个 @ 的输入', () => {
  expect(validRecipients('a@b@c')).toBe(false);
  expect(validRecipients('@')).toBe(false);
  expect(validRecipients('a@b')).toBe(false);
  expect(validRecipients('a@b ')).toBe(false);
  expect(validRecipients('')).toBe(false);
});

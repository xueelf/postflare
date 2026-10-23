import { expect, test } from 'bun:test';

import { trimTrailingEmptyParagraph } from '#/client/components/editor/inky/serialize';

test('trimTrailingEmptyParagraph 去掉末尾空段落', () => {
  expect(trimTrailingEmptyParagraph('<p>Hello</p><p></p>')).toBe(
    '<p>Hello</p>',
  );

  expect(trimTrailingEmptyParagraph('<p>Hello</p><p><br></p>')).toBe(
    '<p>Hello</p>',
  );

  expect(trimTrailingEmptyParagraph('<p></p>')).toBe('');
});

test('trimTrailingEmptyParagraph 保留正文中的空段落', () => {
  expect(trimTrailingEmptyParagraph('<p>A</p><p></p><p>B</p>')).toBe(
    '<p>A</p><p></p><p>B</p>',
  );
});

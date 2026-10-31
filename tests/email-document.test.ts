import { expect, test } from 'bun:test';

import { hasRemoteContent } from '#/client/email-document';

test('CSS 转义的远程图片触发远程内容提示', () => {
  const html =
    '<div style="background-image:url(\\68 ttps://example.invalid/image.png)">图片区域</div>';

  expect(hasRemoteContent(html)).toBe(true);
});

test('普通外部链接不触发远程内容提示', () => {
  expect(
    hasRemoteContent('<a href="https://example.invalid/page">链接</a>'),
  ).toBe(false);

  expect(hasRemoteContent('<a href="//example.invalid/page">链接</a>')).toBe(
    false,
  );
});

test('远程 srcset 候选触发远程内容提示', () => {
  expect(
    hasRemoteContent(
      '<img srcset="/api/attachments/a1 1x, https://example.invalid/i.png 2x">',
    ),
  ).toBe(true);

  expect(
    hasRemoteContent(
      '<img srcset="data:image/png;base64,aaa 1x, /api/attachments/a1 2x">',
    ),
  ).toBe(false);
});

test('远程 @import 触发远程内容提示', () => {
  expect(
    hasRemoteContent(
      '<style>@import url(\\68 ttps://example.invalid/a.css);</style>',
    ),
  ).toBe(true);

  expect(
    hasRemoteContent('<style>@import "https://example.invalid/a.css";</style>'),
  ).toBe(true);
});

test('本地附件和 data URL 不触发远程内容提示', () => {
  expect(hasRemoteContent('<img src="/api/attachments/a1">')).toBe(false);

  expect(
    hasRemoteContent(
      '<div style="background-image:url(&quot;/api/attachments/a1&quot;)"></div>',
    ),
  ).toBe(false);
  expect(hasRemoteContent('<img src="data:image/png;base64,aaa">')).toBe(false);
});

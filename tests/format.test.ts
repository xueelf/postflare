import { expect, test } from 'bun:test';

import { templateHtml, textToHtml } from '#/client/format';

test('textToHtml 按空行拆段并保留段内换行', () => {
  expect(textToHtml('a\n\nb')).toBe('<p>a</p><p>b</p>');
  expect(textToHtml('a\nb')).toBe('<p>a<br>b</p>');
});

test('textToHtml 转义 HTML 特殊字符', () => {
  expect(textToHtml('<b>&</b>')).toBe('<p>&lt;b&gt;&amp;&lt;/b&gt;</p>');
});

test('templateHtml 已含标签时原样返回', () => {
  expect(templateHtml('<p>x</p>')).toBe('<p>x</p>');
});

test('templateHtml 纯文本按段落转换', () => {
  expect(templateHtml('hello')).toBe('<p>hello</p>');
});

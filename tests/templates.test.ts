import { expect, test } from 'bun:test';

import { extractDataImages } from '../src/worker/templates';

test('extractDataImages 提取内联图片并重写为应用地址', () => {
  const png = Buffer.from('fake-image').toString('base64');
  const result = extractDataImages(
    `<p>正文</p><img src="data:image/png;base64,${png}"><img src="https://example.com/a.png">`,
  );

  if (typeof result === 'string') {
    throw new Error('unexpected error');
  }
  expect(result.images).toHaveLength(1);
  expect(result.images[0]?.mimeType).toBe('image/png');
  expect(result.html).toContain(`/api/attachments/${result.images[0]?.id}`);
  expect(result.html).toContain('https://example.com/a.png');
  expect(result.html).not.toContain('data:image');
});

test('extractDataImages 相同图片只存一份', () => {
  const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
  const result = extractDataImages(
    `<img src="${dataUrl}"><img src="${dataUrl}">`,
  );

  if (typeof result === 'string') {
    throw new Error('unexpected error');
  }
  expect(result.images).toHaveLength(1);

  const url = `/api/attachments/${result.images[0]?.id}`;

  expect(result.html).toBe(`<img src="${url}"><img src="${url}">`);
});

test('extractDataImages 无内联图片时原样返回', () => {
  const result = extractDataImages('<p>纯文本</p>');

  if (typeof result === 'string') {
    throw new Error('unexpected error');
  }
  expect(result.images).toHaveLength(0);
  expect(result.html).toBe('<p>纯文本</p>');
});

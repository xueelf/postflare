import { expect, test } from 'bun:test';

import PostalMime from 'postal-mime';

import { buildRawMessage } from '#/worker/mime';

test('buildRawMessage 生成带内联图片的 multipart/related', () => {
  const raw = buildRawMessage({
    from: 'me@example.com',
    fromName: 'Me',
    to: 'a@example.com, b@example.com',
    subject: '测试主题',
    text: '纯文本',
    html: '<p>你好 <img src="cid:image-1"></p>',
    messageId: '<message@example.com>',
    attachments: [
      {
        filename: 'image.png',
        type: 'image/png',
        content: new Uint8Array([1, 2, 3]).buffer,
        disposition: 'inline',
        contentId: 'image-1',
      },
    ],
  });

  expect(raw).toContain('Content-Type: multipart/related');
  expect(raw).toContain('Content-ID: <image-1>');
  expect(raw).toContain('Content-Disposition: inline; filename="image.png"');
  expect(raw).toContain('Message-ID: <message@example.com>');
  expect(raw).toContain('<a@example.com>');
  expect(raw).toContain('<b@example.com>');
  expect(raw).toContain('PHA+5L2g5aW9');
  expect(raw).toContain('AQID');
});

test('buildRawMessage 无附件时生成 multipart/alternative', () => {
  const raw = buildRawMessage({
    from: 'me@example.com',
    to: 'a@example.com',
    subject: 'Hello',
    text: 'text',
    html: '<p>html</p>',
    attachments: [],
  });

  expect(raw).toContain('Content-Type: multipart/alternative');
  expect(raw).not.toContain('multipart/related');
  expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
  expect(raw).toContain('Content-Type: text/html; charset=UTF-8');
});

test('buildRawMessage 折叠长主题并折行 base64 正文', async () => {
  const subject = '很长的中文主题'.repeat(30);
  const text = '正文'.repeat(2000);
  const raw = buildRawMessage({
    from: 'me@example.com',
    fromName: '发件人'.repeat(30),
    to: 'a@example.com, b@example.com',
    subject,
    text,
    html: `<p>${text}</p>`,
    attachments: [],
  });

  expect(raw.split('\r\n').every(line => line.length <= 78)).toBe(true);

  const words = [...raw.matchAll(/=\?utf-8\?B\?([^?]*)\?=/g)];

  expect(words.length).toBeGreaterThan(1);

  for (const word of words) {
    const bytes = Uint8Array.from(atob(word[1] ?? ''), char =>
      char.charCodeAt(0),
    );

    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ).not.toThrow();
  }

  const parsed = await PostalMime.parse(raw);

  expect(parsed.subject).toBe(subject);
  expect(parsed.text).toBe(text);
});

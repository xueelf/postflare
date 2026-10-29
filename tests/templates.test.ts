import { expect, test } from 'bun:test';

import { MAX_TEMPLATE_BYTES } from '#/limits';
import {
  createTemplatePayload,
  parseTemplatePayload,
  templateRowTooLarge,
} from '#/worker/templates';

test('模板保留用户写入的 base64 data URL，不做解码或替换', () => {
  const source =
    '<image src="data:image/png;base64,not-valid-base64" alt=""></image>';
  const payload = createTemplatePayload(
    '测试',
    '主题',
    `<p>${source}</p>`,
    source,
  );

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.body_html).toContain(
      'data:image/png;base64,not-valid-base64',
    );
    expect(payload.body_source).toBe(source);
  }
});

test('模板允许用户清空正文和源码', () => {
  const payload = createTemplatePayload('空模板', '', '', '');

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.body_html).toBe('');
    expect(payload.body_source).toBe('');
  }
});

test('模板字段类型错误返回 400，不解释成清空', () => {
  const wrongSubject = parseTemplatePayload({
    name: '模板',
    subject: 1,
    body_html: '',
    body_source: '',
  });
  const wrongBody = parseTemplatePayload({
    name: '模板',
    subject: '',
    body_html: null,
    body_source: '',
  });

  expect(wrongSubject instanceof Response).toBe(true);
  expect(wrongBody instanceof Response).toBe(true);

  if (wrongSubject instanceof Response) {
    expect(wrongSubject.status).toBe(400);
  }

  if (wrongBody instanceof Response) {
    expect(wrongBody.status).toBe(400);
  }
});

test('模板允许合法空字符串字段', () => {
  const payload = parseTemplatePayload({
    name: '空模板',
    subject: '',
    body_html: '',
    body_source: '',
  });

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.subject).toBe('');
    expect(payload.body_html).toBe('');
    expect(payload.body_source).toBe('');
  }
});

test('模板超过 D1 单行上限时拒绝保存', () => {
  const payload = createTemplatePayload(
    '大模板',
    '主题',
    `<p>${'a'.repeat(MAX_TEMPLATE_BYTES)}</p>`,
    '<p>正文</p>',
  );

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(templateRowTooLarge('template-id', 'user-id', payload)).toBe(true);
  }
});

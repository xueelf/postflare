import { expect, test } from 'bun:test';

import {
  isSettingsDialog,
  isTemplateDialog,
  parseRoute,
  viewPath,
} from '../src/client/route';

test('parseRoute 识别五个文件夹与其中的邮件', () => {
  expect(parseRoute('/inbox')).toEqual({ view: 'inbox', messageId: null });

  expect(parseRoute('/drafts/abc')).toEqual({
    view: 'drafts',
    messageId: 'abc',
  });
  expect(parseRoute('/sent')).toEqual({ view: 'sent', messageId: null });
  expect(parseRoute('/spam/1')).toEqual({ view: 'spam', messageId: '1' });
  expect(parseRoute('/trash')).toEqual({ view: 'trash', messageId: null });
});

test('parseRoute 识别模板与用户管理', () => {
  expect(parseRoute('/templates')).toEqual({
    view: 'templates',
    messageId: null,
  });

  expect(parseRoute('/templates/tpl-1')).toEqual({
    view: 'templates',
    messageId: 'tpl-1',
  });
  expect(parseRoute('/users')).toEqual({ view: 'users', messageId: null });
});

test('parseRoute 按完整路径段匹配，无效路径回落收件箱', () => {
  expect(parseRoute('/zhongwen')).toEqual({ view: 'inbox', messageId: null });
  expect(parseRoute('/nonsense')).toEqual({ view: 'inbox', messageId: null });
  expect(parseRoute('/')).toEqual({ view: 'inbox', messageId: null });
});

test('弹窗片段只认一级，内部层级不算打开', () => {
  expect(isTemplateDialog('#template')).toBe(true);
  expect(isTemplateDialog('#template/tpl-1')).toBe(false);
  expect(isTemplateDialog('#compose')).toBe(false);
  expect(isTemplateDialog('')).toBe(false);

  expect(isSettingsDialog('#settings')).toBe(true);
  expect(isSettingsDialog('#settings/username')).toBe(false);
  expect(isSettingsDialog('#template')).toBe(false);
  expect(isSettingsDialog('')).toBe(false);
});

test('viewPath 生成路径与查询串', () => {
  expect(viewPath('inbox')).toBe('/inbox');
  expect(viewPath('drafts', 'abc')).toBe('/drafts/abc');
  expect(viewPath('inbox', null, 'a b')).toBe('/inbox?q=a%20b');
});

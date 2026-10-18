import PostalMime, { type Attachment } from 'postal-mime';

import { IMAGE_MAX_BYTES } from './api';
import { readAsDataUrl, textToHtml } from './format';
import type { MessageKey } from './i18n';

export interface ImportedTemplate {
  name: string;
  bodyHtml: string;
}

/**
 * 解析 .eml 为模板草稿：主题作名称，正文取 HTML 部分，内嵌图片转为本地预览（保存时上传）。
 */
export async function parseTemplateFile(
  file: File,
  t: (key: MessageKey) => string,
): Promise<ImportedTemplate> {
  const parsed = await PostalMime.parse(await file.arrayBuffer()).catch(
    () => null,
  );

  if (!parsed) {
    throw new Error(t('templates.parseFailed'));
  }

  const name = (parsed.subject ?? '').trim();
  const html = parsed.html ?? '';

  if (html) {
    return {
      name,
      bodyHtml: await replaceCidImages(html, parsed.attachments, t),
    };
  }

  if (parsed.text) {
    return { name, bodyHtml: textToHtml(parsed.text) };
  }
  throw new Error(t('templates.emlNoBody'));
}

// cid: 引用的内嵌图片转为 data URL 本地预览；引用不到的图片直接丢弃
async function replaceCidImages(
  html: string,
  attachments: Attachment[],
  t: (key: MessageKey) => string,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const image of doc.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';

    if (!src.startsWith('cid:')) {
      continue;
    }
    const contentId = src.slice(4);
    const part = attachments.find(
      attachment =>
        attachment.mimeType.startsWith('image/') &&
        attachment.contentId?.replace(/^</, '').replace(/>$/, '') === contentId,
    );

    if (!part) {
      image.remove();
      continue;
    }
    // postal-mime 默认按 arraybuffer 返回内容
    const content = part.content as ArrayBuffer;

    if (content.byteLength > IMAGE_MAX_BYTES) {
      throw new Error(t('templates.imageTooLarge'));
    }
    image.setAttribute(
      'src',
      await readAsDataUrl(new Blob([content], { type: part.mimeType })),
    );
  }

  return doc.body.innerHTML;
}

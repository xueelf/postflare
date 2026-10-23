import type { Editor } from '@tiptap/react';

import { INKY_TAGS } from './tags';

/**
 * 取 Inky 源码中的 style 块，编辑器画布需要和邮件共用同一套样式。
 */
export function getSourceStyles(source: string): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');

  return Array.from(doc.querySelectorAll('style'), element =>
    element.textContent?.trim(),
  )
    .filter(Boolean)
    .join('\n');
}

/**
 * 去掉 TipTap 序列化时补在末尾的空段落，避免源码多出无意义的结构。
 */
export function trimTrailingEmptyParagraph(html: string): string {
  return html
    .replace(/(?:<p(?:\s[^>]*)?>(?:\s|<br\s*\/?>)*<\/p>\s*)+$/i, '')
    .trim();
}

const BLOCK_TAGS = new Set([
  ...INKY_TAGS,
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'hr',
]);

/**
 * 把编辑器序列化出的紧凑 HTML 排成稳定的 Inky 源码。
 * 文本型节点保持单行，避免在正文中引入无意义的空白。
 */
function formatHtml(root: HTMLElement): string {
  const lines: string[] = [];

  const append = (node: Node, depth: number): void => {
    const indent = '  '.repeat(depth);

    if (node.nodeType === 3) {
      const text = node.textContent ?? '';

      if (text.trim()) {
        lines.push(indent + text);
      }
      return;
    }

    if (node.nodeType === 8) {
      lines.push(`${indent}<!--${node.textContent ?? ''}-->`);

      return;
    }

    if (node.nodeType !== 1) {
      return;
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const hasBlockChild = Array.from(element.children).some(child =>
      BLOCK_TAGS.has(child.tagName.toLowerCase()),
    );

    if (!BLOCK_TAGS.has(tag) || !hasBlockChild) {
      lines.push(indent + element.outerHTML);

      return;
    }

    const clone = element.cloneNode(false) as Element;
    const closing = `</${tag}>`;
    const open = clone.outerHTML.endsWith(closing)
      ? clone.outerHTML.slice(0, -closing.length)
      : clone.outerHTML;

    lines.push(indent + open);

    for (const child of element.childNodes) {
      append(child, depth + 1);
    }
    lines.push(indent + closing);
  };

  for (const child of root.childNodes) {
    append(child, 0);
  }
  return lines.join('\n');
}

/**
 * 从可视化编辑器取 Inky 源码。原始块在编辑器里用占位元素保存，
 * 序列化时替换回原始 HTML，保证未支持的标签不会被可视化模式改写。
 */
export function getInkySource(editor: Editor): string {
  const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
  // DOMParser 会把正文开头的 style 提升到 head，序列化 body 前要先取回来
  const styles = Array.from(
    doc.head.querySelectorAll('style'),
    element => element.outerHTML,
  ).join('\n');

  // DOMParser 会把 <image> 归一成 <img>，序列化时恢复 Inky 的 image 标签
  for (const element of doc.querySelectorAll('img[data-inky-image]')) {
    const image = doc.createElement('image');

    for (const attribute of element.attributes) {
      if (attribute.name !== 'data-inky-image') {
        image.setAttribute(attribute.name, attribute.value);
      }
    }
    element.replaceWith(image);
  }

  for (const element of doc.querySelectorAll('[data-inky-raw]')) {
    const template = doc.createElement('template');

    template.innerHTML = element.getAttribute('data-inky-raw') ?? '';
    element.replaceWith(template.content);
  }

  const body = formatHtml(doc.body);

  return trimTrailingEmptyParagraph(styles ? `${styles}\n${body}` : body);
}

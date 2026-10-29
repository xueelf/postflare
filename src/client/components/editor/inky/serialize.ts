import { type Node as PMNode, DOMSerializer, Fragment } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

import { INKY_TAGS, INLINE_CONTEXT_TAGS, RAW_TAGS } from './tags';

const SOURCE_CURSOR_MARKER = '__PHYLLO_CURSOR_9F3A__';

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
 * 只处理 HTML 片段里解析出的真实 Comment 节点，跳过 raw 块与 style 文本。
 * 用 template 按片段解析，前导注释、head 中的注释和正文注释都保持原有顺序。
 */
export function protectComments(source: string): string {
  const template = document.createElement('template');

  template.innerHTML = source;

  const comments: Comment[] = [];
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_COMMENT,
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const comment = node as Comment;

    let parent = comment.parentElement;
    let preserved = false;

    while (parent) {
      if (RAW_TAGS.includes(parent.tagName.toLowerCase())) {
        preserved = true;

        break;
      }
      parent = parent.parentElement;
    }

    if (!preserved) {
      comments.push(comment);
    }
  }

  if (comments.length === 0) {
    return source;
  }

  for (const comment of comments) {
    const parentTag = comment.parentElement?.tagName.toLowerCase() ?? '';
    const inline = INLINE_CONTEXT_TAGS.has(parentTag);
    const placeholder = document.createElement(
      inline ? 'inky-comment-inline' : 'inky-comment-block',
    );

    placeholder.setAttribute('data-comment', comment.data);
    comment.replaceWith(placeholder);
  }

  return template.innerHTML;
}

const BLOCK_TAGS = new Set([
  ...INKY_TAGS.filter(tag => tag !== 'badge'),
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
  'column',
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
 * 从可视化编辑器取 Inky 源码。未建模的块级 HTML、Inky 标签和注释
 * 用 raw 节点整体保留，不在可视化模式里扁平化。
 */
function formatInkySource(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
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

  return styles ? `${styles}\n${body}` : body;
}

function cleanNode(node: PMNode): PMNode | null {
  if (node.type.name === 'inkyImage') {
    const attrs = node.attrs['attrs'] as Record<string, string> | undefined;

    // 本地预览只用于画布，进入持久化源码前必须换成 R2 地址
    if (attrs?.src?.startsWith('blob:')) {
      return null;
    }
  }

  if (
    node.type.name === 'paragraph' &&
    node.attrs.transient &&
    node.content.size === 0
  ) {
    return null;
  }

  if (node.isLeaf) {
    return node;
  }
  const children: PMNode[] = [];

  let changed = false;

  for (const child of node.content.content) {
    const cleaned = cleanNode(child);

    if (cleaned !== child) {
      changed = true;
    }

    if (cleaned) {
      children.push(cleaned);
    }
  }

  if (!changed) {
    return node;
  }
  return node.copy(Fragment.fromArray(children));
}

function serializeDoc(editor: Editor, doc: PMNode): string {
  const cleaned = cleanNode(doc) ?? doc;
  const container = document.createElement('div');
  const serializer = DOMSerializer.fromSchema(editor.schema);

  container.appendChild(serializer.serializeFragment(cleaned.content));

  return formatInkySource(container.innerHTML);
}

export function getInkySource(editor: Editor): string {
  return serializeDoc(editor, editor.state.doc);
}

/**
 * 取可视化光标在格式化源码中的位置。源码模式与可视化模式使用同一份结构，
 * 这里通过临时插入标记再序列化，避免为每种组件单独维护位置映射。
 */
export function getInkySourceSelection(editor: Editor): number | null {
  const { schema, selection } = editor.state;
  const paragraph = schema.nodes.paragraph;

  if (!paragraph) {
    return null;
  }

  const transaction = editor.state.tr;

  try {
    if (selection instanceof NodeSelection) {
      transaction.insert(
        selection.to,
        paragraph.create(null, schema.text(SOURCE_CURSOR_MARKER)),
      );
    } else {
      transaction.insertText(SOURCE_CURSOR_MARKER, selection.from);
    }
  } catch {
    return null;
  }

  const source = serializeDoc(editor, transaction.doc);
  const index = source.indexOf(SOURCE_CURSOR_MARKER);

  if (index < 0) {
    return null;
  }

  if (selection instanceof NodeSelection) {
    const lineStart = source.lastIndexOf('\n', index - 1) + 1;

    return Math.max(0, lineStart - 1);
  }
  return index;
}

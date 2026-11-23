import { htmlLanguage } from '@codemirror/lang-html';
import type { SyntaxNode } from '@lezer/common';

/**
 * 可视化模式能完整保留的 Inky 源码子集。
 * 这里只拦已经在当前 schema 上验证会丢失语义的结构，不做通用 HTML 往返比较。
 */
export type InkySourceGuardIssue =
  | 'document'
  | 'paragraph-attributes'
  | 'span-attributes'
  | 'native-image'
  | 'nested-block'
  | 'style-attributes'
  | 'button-link';

export interface InkySourceGuardResult {
  blocked: boolean;
  issues: InkySourceGuardIssue[];
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'hr',
  'container',
  'wrapper',
  'row',
  'column',
  'callout',
  'alert',
  'menu',
  'card',
  'hero',
  'accordion',
  'accordion-item',
  'raw',
]);

function startTag(element: SyntaxNode): SyntaxNode | null {
  const first = element.firstChild;

  return first && (first.name === 'OpenTag' || first.name === 'SelfClosingTag')
    ? first
    : null;
}

function tagNameOf(element: SyntaxNode, source: string): string {
  const tag = startTag(element)?.getChild('TagName');

  return tag ? source.slice(tag.from, tag.to).toLowerCase() : '';
}

function attributesOf(
  element: SyntaxNode,
  source: string,
): Map<string, string | null> {
  const attributes = new Map<string, string | null>();
  const start = startTag(element);

  if (!start) {
    return attributes;
  }

  for (let child = start.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Attribute') {
      continue;
    }
    const name = child.getChild('AttributeName');

    if (!name) {
      continue;
    }
    const value = child.getChild('AttributeValue');

    attributes.set(
      source.slice(name.from, name.to).toLowerCase(),
      value ? source.slice(value.from, value.to) : null,
    );
  }

  return attributes;
}

function hasDescendantTag(
  element: SyntaxNode,
  source: string,
  tags: Set<string>,
): boolean {
  let found = false;

  element.cursor().iterate(node => {
    if (node.name !== 'Element' || node.from === element.from) {
      return;
    }
    const tag = tagNameOf(node.node, source);

    if (tags.has(tag)) {
      found = true;

      return false;
    }

    // raw 内容由 schema 整块保存，内部标签不参与检查。
    if (tag === 'raw') {
      return false;
    }
  });

  return found;
}

/**
 * 检查外部 Inky 源码是否包含可视化模式会静默丢弃的结构。
 * 结果只绑定到传入的源码快照，调用方应缓存到源码变化为止。
 */
export function inspectInkySource(source: string): InkySourceGuardResult {
  const issues = new Set<InkySourceGuardIssue>();
  const tree = htmlLanguage.parser.parse(source);

  tree.iterate({
    enter(node) {
      if (node.name === 'DoctypeDecl') {
        issues.add('document');

        return;
      }

      if (node.name !== 'Element') {
        return;
      }
      const tag = tagNameOf(node.node, source);

      if (!tag) {
        return;
      }

      if (tag === 'raw') {
        return false;
      }

      if (tag === 'html' || tag === 'body') {
        issues.add('document');

        return;
      }
      const attributes = attributesOf(node.node, source);

      if (
        (tag === 'p' || HEADING_TAGS.has(tag)) &&
        (attributes.has('id') || attributes.has('title'))
      ) {
        issues.add('paragraph-attributes');
      }

      if (
        tag === 'span' &&
        (attributes.has('class') || attributes.has('style'))
      ) {
        issues.add('span-attributes');
      }

      if (
        tag === 'img' &&
        (attributes.has('style') || attributes.has('height'))
      ) {
        issues.add('native-image');
      }

      if (
        tag === 'style' &&
        (attributes.has('media') || attributes.has('type'))
      ) {
        issues.add('style-attributes');
      }

      if (
        tag === 'button' &&
        hasDescendantTag(node.node, source, new Set(['a']))
      ) {
        issues.add('button-link');
      }

      if (
        (tag === 'callout' || tag === 'alert') &&
        hasDescendantTag(node.node, source, BLOCK_TAGS)
      ) {
        issues.add('nested-block');
      }
    },
  });

  return { blocked: issues.size > 0, issues: [...issues] };
}

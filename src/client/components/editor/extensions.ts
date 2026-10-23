import { Extension, Node } from '@tiptap/core';

// 邮件正文常用但 ProseMirror 默认丢弃的结构，保留后才能做到导入原样保存
const PRESERVED_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  'textStyle',
  'link',
  'bold',
  'italic',
  'strike',
  'underline',
  'code',
];

/**
 * 保留元素上的 class 与内联 style，邮件排版主要依赖它们。
 */
export const PreservedAttributes = Extension.create({
  name: 'preservedAttributes',
  addGlobalAttributes() {
    return [
      {
        types: PRESERVED_TYPES,
        attributes: {
          class: {
            default: null,
            parseHTML: element => element.getAttribute('class'),
            renderHTML: attributes =>
              attributes.class ? { class: attributes.class } : {},
          },
          style: {
            default: null,
            parseHTML: element => element.getAttribute('style'),
            renderHTML: attributes =>
              attributes.style ? { style: attributes.style } : {},
          },
        },
      },
    ];
  },
});

/**
 * head 里的样式表，作为不可编辑的整体节点原样保留。
 */
export const StyleBlock = Node.create({
  name: 'styleBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      css: {
        default: '',
        parseHTML: element => element.textContent ?? '',
      },
    };
  },
  parseHTML() {
    return [{ tag: 'style' }];
  },
  renderHTML({ node }) {
    return ['style', {}, node.attrs.css];
  },
});

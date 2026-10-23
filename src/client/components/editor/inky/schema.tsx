import { type NodeViewRendererProps, Node } from '@tiptap/core';

import { INKY_TAGS } from './tags';

type DocNode = NodeViewRendererProps['node'];

interface InkyAttributes {
  [name: string]: string;
}

function readAttributes(element: HTMLElement): InkyAttributes {
  return Object.fromEntries(
    Array.from(element.attributes, attribute => [
      attribute.name,
      attribute.value,
    ]),
  );
}

function renderAttributes(node: {
  attrs: Record<string, unknown>;
}): InkyAttributes {
  return (node.attrs.attrs as InkyAttributes | undefined) ?? {};
}

function createAttributes() {
  return {
    attrs: {
      default: {} as InkyAttributes,
      parseHTML: (element: HTMLElement) => readAttributes(element),
    },
  };
}

function applyAttributes(
  element: HTMLElement,
  baseClass: string,
  attributes: InkyAttributes,
): void {
  element.className = [baseClass, attributes.class].filter(Boolean).join(' ');

  if (attributes.style) {
    element.setAttribute('style', attributes.style);
  } else {
    element.removeAttribute('style');
  }
}

function nodeAttributes(props: NodeViewRendererProps): InkyAttributes {
  return props.node.attrs.attrs as InkyAttributes;
}

function selected(element: HTMLElement) {
  return {
    selectNode() {
      element.classList.add('inky-selected');
    },
    deselectNode() {
      element.classList.remove('inky-selected');
    },
  };
}

function createWrapperView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const content = document.createElement('td');

  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(content);
  content.className = 'wrapper-inner';
  table.setAttribute('role', 'presentation');
  table.setAttribute('align', 'center');

  const apply = () => applyAttributes(table, 'wrapper', nodeAttributes(props));

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(table),
  };
}

function createContainerView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const content = document.createElement('td');

  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(content);
  content.className = 'container-inner';
  table.setAttribute('role', 'presentation');
  table.setAttribute('align', 'center');

  const apply = () =>
    applyAttributes(table, 'container', nodeAttributes(props));

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(table),
  };
}

function createRowView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const content = document.createElement('tr');

  table.appendChild(body);
  body.appendChild(content);
  table.setAttribute('role', 'presentation');

  const apply = () => applyAttributes(table, 'row', nodeAttributes(props));

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(table),
  };
}

function createColumnView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const cell = document.createElement('th');
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const content = document.createElement('th');

  table.setAttribute('role', 'presentation');
  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(content);
  cell.appendChild(table);

  const apply = () => {
    const attributes = nodeAttributes(props);
    const position = props.getPos();

    let index = 0;
    let count = 1;

    if (typeof position === 'number') {
      const resolved = props.editor.state.doc.resolve(position);

      count = resolved.parent.childCount;
      index = resolved.index();
    }

    const small = /^\d+$/.test(attributes.small ?? '')
      ? attributes.small
      : '12';
    const large = /^\d+$/.test(attributes.large ?? '')
      ? attributes.large
      : String(Math.max(1, Math.floor(12 / count)));

    cell.className = [
      `small-${small}`,
      `large-${large}`,
      'columns',
      index === 0 ? 'first' : '',
      index === count - 1 ? 'last' : '',
      attributes.class ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    if (attributes.style) {
      cell.setAttribute('style', attributes.style);
    } else {
      cell.removeAttribute('style');
    }

    if (attributes.valign) {
      cell.setAttribute('valign', attributes.valign);
    } else {
      cell.removeAttribute('valign');
    }
  };

  apply();

  return {
    dom: cell,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(cell),
  };
}

function createButtonView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  const innerTable = document.createElement('table');
  const innerBody = document.createElement('tbody');
  const innerRow = document.createElement('tr');
  const innerCell = document.createElement('td');
  const link = document.createElement('a');

  innerTable.setAttribute('role', 'presentation');
  innerCell.appendChild(link);
  innerRow.appendChild(innerCell);
  innerBody.appendChild(innerRow);
  innerTable.appendChild(innerBody);
  cell.appendChild(innerTable);
  row.appendChild(cell);
  body.appendChild(row);
  table.appendChild(body);
  table.setAttribute('role', 'presentation');
  link.addEventListener('click', event => event.preventDefault());

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = ['button', attributes.class].filter(Boolean).join(' ');
    table.removeAttribute('style');

    if (attributes.href) {
      link.setAttribute('href', attributes.href);
    } else {
      link.removeAttribute('href');
    }

    if (attributes.target) {
      link.setAttribute('target', attributes.target);
    } else {
      link.removeAttribute('target');
    }

    if (attributes.style) {
      link.setAttribute('style', attributes.style);
    } else {
      link.removeAttribute('style');
    }
  };

  apply();

  return {
    dom: table,
    contentDOM: link,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(table),
  };
}

function createImageView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const image = document.createElement('img');

  image.setAttribute('contenteditable', 'false');

  const apply = () => {
    const attributes = nodeAttributes(props);

    if (attributes.src) {
      image.setAttribute('src', attributes.src);
    } else {
      image.removeAttribute('src');
    }

    image.setAttribute('alt', attributes.alt ?? '');

    if (attributes.width) {
      image.setAttribute('width', attributes.width);

      image.setAttribute(
        'style',
        `width: ${/^\d+$/.test(attributes.width) ? `${attributes.width}px` : attributes.width}; max-width: 100%;`,
      );
    } else {
      image.removeAttribute('width');
      image.setAttribute('style', 'max-width: 100%;');
    }

    image.removeAttribute('height');

    if (attributes.class) {
      image.className = attributes.class;
    } else {
      image.removeAttribute('class');
    }
  };

  apply();

  return {
    dom: image,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    ...selected(image),
  };
}

function createRawView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const container = document.createElement('div');
  const pre = document.createElement('pre');

  container.className = 'inky-raw';
  container.setAttribute('contenteditable', 'false');
  pre.textContent = String(props.node.attrs.html ?? '');
  container.appendChild(pre);

  return {
    dom: container,
    update: (updated: DocNode) => {
      pre.textContent = String(updated.attrs.html ?? '');

      return true;
    },
    ...selected(container),
  };
}

export const InkyWrapper = Node.create({
  name: 'inkyWrapper',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'wrapper' }],
  renderHTML: ({ node }) => ['wrapper', renderAttributes(node), 0],
  addNodeView() {
    return createWrapperView;
  },
});

export const InkyContainer = Node.create({
  name: 'inkyContainer',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'container' }],
  renderHTML: ({ node }) => ['container', renderAttributes(node), 0],
  addNodeView() {
    return createContainerView;
  },
});

export const InkyRow = Node.create({
  name: 'inkyRow',
  group: 'block',
  content: 'inkyColumn+',
  defining: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'row' }],
  renderHTML: ({ node }) => ['row', renderAttributes(node), 0],
  addNodeView() {
    return createRowView;
  },
});

export const InkyColumn = Node.create({
  name: 'inkyColumn',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'columns' }],
  renderHTML: ({ node }) => ['columns', renderAttributes(node), 0],
  addNodeView() {
    return createColumnView;
  },
});

export const InkyButton = Node.create({
  name: 'inkyButton',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'button' }],
  renderHTML: ({ node }) => ['button', renderAttributes(node), 0],
  addNodeView() {
    return createButtonView;
  },
});

export const InkyImage = Node.create({
  name: 'inkyImage',
  group: 'block',
  atom: true,
  addAttributes: createAttributes,
  // 浏览器会把 <image> 归一到 <img>，两种标签都要能解析
  parseHTML: () => [{ tag: 'image' }, { tag: 'img' }],
  renderHTML: ({ node }) => [
    'image',
    { ...renderAttributes(node), 'data-inky-image': '' },
  ],
  addNodeView() {
    return createImageView;
  },
});

// 尚未实现可视化编辑的 Inky 标签按原始源码保留，避免切换模式时丢内容
const RAW_TAGS = INKY_TAGS.filter(
  tag =>
    ![
      'wrapper',
      'container',
      'row',
      'columns',
      'button',
      'image',
      'blockquote',
    ].includes(tag),
);

export const InkyRaw = Node.create({
  name: 'inkyRaw',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      html: {
        default: '',
      },
    };
  },
  parseHTML() {
    return RAW_TAGS.map(tag => ({
      tag,
      getAttrs: (element: HTMLElement) => ({ html: element.outerHTML }),
    }));
  },
  // 实际源码由序列化时替换占位元素，避免 renderHTML 无法直接返回源码片段
  renderHTML: ({ node }) => [
    'div',
    { 'data-inky-raw': String(node.attrs.html ?? '') },
  ],
  addNodeView() {
    return createRawView;
  },
});

export const InkyExtensions = [
  InkyWrapper,
  InkyContainer,
  InkyRow,
  InkyColumn,
  InkyButton,
  InkyImage,
  InkyRaw,
];

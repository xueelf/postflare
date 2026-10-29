import { type NodeViewRendererProps, Extension, Node } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import {
  type Selection,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

import { RAW_TAGS } from './tags';

type DocNode = NodeViewRendererProps['node'];

interface InkyAttributes {
  [name: string]: string;
}

function hasAttribute(attributes: InkyAttributes, name: string): boolean {
  return Object.hasOwn(attributes, name);
}

function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
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

function applyStyle(
  element: HTMLElement,
  attributes: InkyAttributes,
  extra = '',
): void {
  const style = [extra, attributes.style].filter(Boolean).join('; ');

  if (style) {
    element.setAttribute('style', style);
  } else {
    element.removeAttribute('style');
  }
}

function nodeAttributes(props: NodeViewRendererProps): InkyAttributes {
  return props.node.attrs.attrs as InkyAttributes;
}

function updateNodeAttributes(
  props: NodeViewRendererProps,
  attrs: InkyAttributes,
): void {
  const position = props.getPos();

  if (typeof position !== 'number') {
    return;
  }
  const transaction = props.editor.state.tr.setNodeAttribute(
    position,
    'attrs',
    attrs,
  );

  props.editor.view.dispatch(transaction);
}

export const InkyParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      transient: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'p' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', HTMLAttributes, 0];
  },
});

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

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = classNames('wrapper', attributes.class);
    applyStyle(table, attributes);
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
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

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = classNames('container', attributes.class);
    applyStyle(table, attributes);
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
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

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = classNames(
      'row',
      hasAttribute(attributes, 'collapse') && 'collapse',
      attributes.class,
    );
    applyStyle(table, attributes);
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
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

    const small = /^\d+$/.test(attributes.sm ?? '') ? attributes.sm : '12';
    const large = /^\d+$/.test(attributes.lg ?? '')
      ? attributes.lg
      : String(Math.max(1, Math.floor(12 / count)));
    const offset = /^\d+$/.test(attributes.offset ?? '')
      ? `large-offset-${attributes.offset}`
      : '';

    cell.className = classNames(
      `small-${small}`,
      `large-${large}`,
      'columns',
      index === 0 && 'first',
      index === count - 1 && 'last',
      offset,
      hasAttribute(attributes, 'no-expander') && 'no-expander',
      attributes.class,
    );
    applyStyle(cell, attributes);

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
  };
}

function createButtonView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const wrapper = document.createElement('div');
  const link = document.createElement('a');

  wrapper.className = 'inky-button-block';
  wrapper.appendChild(link);
  link.addEventListener('click', event => event.preventDefault());

  const apply = () => {
    const attributes = nodeAttributes(props);

    link.className = classNames(
      'inky-button-view',
      attributes.size,
      attributes.color,
      attributes.hollow === '' && 'hollow',
      attributes.rounded === '' && 'rounded',
      attributes.class,
    );

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

    if (attributes.rel) {
      link.setAttribute('rel', attributes.rel);
    } else {
      link.removeAttribute('rel');
    }
    applyStyle(link, attributes);
  };

  apply();

  return {
    dom: wrapper,
    contentDOM: link,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createBadgeView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const badge = document.createElement('span');

  const apply = () => {
    const attributes = nodeAttributes(props);
    const color = attributes.color || '#333333';
    const textColor = attributes['text-color'] || '#ffffff';

    badge.className = classNames('badge', attributes.class);

    badge.setAttribute(
      'style',
      `display: inline-block; padding: 2px 8px; background-color: ${color}; color: ${textColor}; border-radius: 12px; font-size: 12px; font-weight: bold; line-height: 1.4;${attributes.style ? ` ${attributes.style}` : ''}`,
    );
  };

  apply();

  return {
    dom: badge,
    contentDOM: badge,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

const CALLOUT_COLORS = new Set([
  'primary',
  'secondary',
  'success',
  'alert',
  'warning',
]);

function createCalloutView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const content = document.createElement('th');

  table.setAttribute('role', 'presentation');
  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(content);
  content.className = 'callout-inner';

  const apply = () => {
    const attributes = nodeAttributes(props);
    const color = attributes.color || '';

    table.className = 'callout';

    content.className = classNames(
      'callout-inner',
      CALLOUT_COLORS.has(color) && color,
      attributes.class,
    );
    applyStyle(content, attributes);

    if (!CALLOUT_COLORS.has(color) && color) {
      content.style.backgroundColor = color;
    } else {
      content.style.removeProperty('background-color');
    }
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

const ALERT_COLORS: Record<string, string> = {
  success: '#dff0d8',
  warning: '#fcf8e3',
  error: '#f2dede',
  info: '#d9edf7',
};

function createAlertView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const content = document.createElement('td');

  table.setAttribute('role', 'presentation');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('width', '100%');
  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(content);

  const apply = () => {
    const attributes = nodeAttributes(props);
    const type = attributes.type || 'info';
    const background =
      attributes.color || ALERT_COLORS[type] || ALERT_COLORS.info;

    table.className = classNames('alert', `alert-${type}`, attributes.class);

    content.setAttribute(
      'style',
      `padding: 12px 16px; background-color: ${background}; border-radius: 4px;${attributes.style ? ` ${attributes.style}` : ''}`,
    );
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createBlockquoteView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const contentRow = document.createElement('tr');
  const content = document.createElement('td');
  const citeRow = document.createElement('tr');
  const cite = document.createElement('td');

  table.setAttribute('role', 'presentation');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('width', '100%');
  table.appendChild(body);
  body.appendChild(contentRow);
  contentRow.appendChild(content);
  body.appendChild(citeRow);
  citeRow.appendChild(cite);

  content.setAttribute('style', 'padding: 0 0 0 16px; font-style: italic;');

  cite.setAttribute(
    'style',
    'padding: 8px 0 0 16px; font-size: 14px; color: #999999;',
  );

  const apply = () => {
    const attributes = nodeAttributes(props);
    const color = attributes.color || '#cccccc';

    table.className = classNames('blockquote', attributes.class);
    table.setAttribute('style', `border-left: 4px solid ${color};`);
    cite.textContent = attributes.cite ? `— ${attributes.cite}` : '';
    citeRow.hidden = !attributes.cite;
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createMenuView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const content = document.createElement('tr');

  table.setAttribute('role', 'presentation');
  table.appendChild(body);
  body.appendChild(content);

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = classNames(
      'menu',
      attributes.direction === 'vertical' && 'vertical',
      attributes.align === 'center' && 'text-center',
      attributes.class,
    );
    applyStyle(table, attributes);
  };

  apply();

  return {
    dom: table,
    contentDOM: content,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createItemView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const cell = document.createElement('td');
  const link = document.createElement('a');

  cell.className = 'menu-item';
  cell.appendChild(link);

  const apply = () => {
    const attributes = nodeAttributes(props);

    cell.className = classNames('menu-item', attributes.class);

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

    applyStyle(link, attributes);
  };

  apply();

  return {
    dom: cell,
    contentDOM: link,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createPreviewView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const wrapper = document.createElement('div');
  const label = document.createElement('span');
  const content = document.createElement('div');

  wrapper.className = 'inky-preview';
  label.className = 'inky-preview-label';
  label.textContent = 'Preview';
  content.className = 'inky-preview-content';
  wrapper.appendChild(label);
  wrapper.appendChild(content);

  return {
    dom: wrapper,
    contentDOM: content,
  };
}

interface MediaViewOptions {
  kind: 'image' | 'video';
}

function mediaDisplayWidth(
  attributes: InkyAttributes,
  kind: MediaViewOptions['kind'],
): number {
  const raw = Number(attributes.width);

  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  const retina = kind === 'image' && hasAttribute(attributes, 'retina');

  return retina ? Math.max(1, Math.round(raw / 2)) : raw;
}

function mediaSourceWidth(
  attributes: InkyAttributes,
  kind: MediaViewOptions['kind'],
  width: number,
): number {
  const retina = kind === 'image' && hasAttribute(attributes, 'retina');

  return Math.max(1, Math.round(retina ? width * 2 : width));
}

function createMediaView(
  props: NodeViewRendererProps,
  { kind }: MediaViewOptions,
) {
  const document = props.view.dom.ownerDocument;
  const wrapper = document.createElement('div');
  const frame = document.createElement('div');
  const media =
    kind === 'image'
      ? document.createElement('img')
      : document.createElement('video');
  const handle = document.createElement('span');

  wrapper.className = classNames('inky-media', `inky-media-${kind}`);
  frame.className = 'inky-media-frame';
  handle.className = 'inky-resize-handle';
  handle.setAttribute('contenteditable', 'false');
  media.setAttribute('contenteditable', 'false');
  frame.appendChild(media);
  frame.appendChild(handle);
  wrapper.appendChild(frame);

  if (media instanceof HTMLVideoElement) {
    media.muted = true;
    media.playsInline = true;
    media.preload = 'metadata';
  }

  const apply = () => {
    const attributes = nodeAttributes(props);
    const width = mediaDisplayWidth(attributes, kind);

    if (attributes.src) {
      media.setAttribute('src', attributes.src);
    } else {
      media.removeAttribute('src');
    }

    if (media instanceof HTMLImageElement) {
      media.alt = attributes.alt ?? '';
    } else {
      if (attributes.poster) {
        media.setAttribute('poster', attributes.poster);
      } else {
        media.removeAttribute('poster');
      }
    }

    if (width > 0) {
      media.setAttribute('width', String(width));

      media.setAttribute(
        'style',
        `width: ${width}px; max-width: 100%; height: auto; display: block;${attributes.style ? ` ${attributes.style}` : ''}`,
      );
    } else {
      media.removeAttribute('width');

      media.setAttribute(
        'style',
        `max-width: 100%; height: auto; display: block;${attributes.style ? ` ${attributes.style}` : ''}`,
      );
    }
  };

  let active = false;
  let startX = 0;
  let startWidth = 0;

  const updateWidth = (width: number) => {
    const attributes = nodeAttributes(props);
    const nextWidth = mediaSourceWidth(attributes, kind, width);

    media.setAttribute('width', String(width));
    media.style.width = `${width}px`;

    return nextWidth;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !props.editor.isEditable) {
      return;
    }
    active = true;
    startX = event.clientX;
    startWidth = media.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active) {
      return;
    }

    if (!props.editor.isEditable) {
      active = false;
      apply();

      return;
    }
    const width = Math.max(40, Math.round(startWidth + event.clientX - startX));

    media.style.width = `${width}px`;
    media.setAttribute('width', String(width));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!active) {
      return;
    }
    active = false;

    if (!props.editor.isEditable) {
      apply();

      return;
    }
    const width = Math.max(40, Math.round(startWidth + event.clientX - startX));
    const sourceWidth = updateWidth(width);

    updateNodeAttributes(props, {
      ...nodeAttributes(props),
      width: String(sourceWidth),
    });
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);

  apply();

  return {
    dom: wrapper,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
    selectNode: () => wrapper.classList.add('inky-media-selected'),
    deselectNode: () => wrapper.classList.remove('inky-media-selected'),
    stopEvent: (event: Event) =>
      event.target === handle || (event instanceof PointerEvent && active),
    ignoreMutation: () => true,
  };
}

function createSpacerView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const cell = document.createElement('td');

  table.setAttribute('role', 'presentation');
  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(cell);

  const apply = () => {
    const attributes = nodeAttributes(props);
    const height = /^\d+$/.test(attributes.height ?? '')
      ? (attributes.height ?? '16')
      : '16';

    table.className = classNames('spacer', attributes.class);
    cell.setAttribute('height', height);

    cell.setAttribute(
      'style',
      `font-size:${height}px; line-height:${height}px;${attributes.style ? ` ${attributes.style}` : ''}`,
    );
  };

  apply();

  return {
    dom: table,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
  };
}

function createDividerView(props: NodeViewRendererProps) {
  const document = props.view.dom.ownerDocument;
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const cell = document.createElement('th');

  table.setAttribute('role', 'presentation');
  table.appendChild(body);
  body.appendChild(row);
  row.appendChild(cell);

  const apply = () => {
    const attributes = nodeAttributes(props);

    table.className = classNames('divider', attributes.class);
    applyStyle(table, attributes);
  };

  apply();

  return {
    dom: table,
    update: (updated: DocNode) => {
      props = { ...props, node: updated };
      apply();

      return true;
    },
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
  };
}

function createInlineRawView() {
  const span = document.createElement('span');

  span.className = 'inky-inline-raw';
  span.setAttribute('contenteditable', 'false');
  span.textContent = '<!-- -->';

  return { dom: span };
}

export const InkyWrapper = Node.create({
  name: 'inkyWrapper',
  group: 'block',
  content: 'block+',
  defining: true,
  selectable: false,
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
  selectable: false,
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
  selectable: false,
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
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'column' }],
  renderHTML: ({ node }) => ['column', renderAttributes(node), 0],
  addNodeView() {
    return createColumnView;
  },
});

export const InkyButton = Node.create({
  name: 'inkyButton',
  group: 'block',
  content: 'inline*',
  defining: true,
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'button' }],
  renderHTML: ({ node }) => ['button', renderAttributes(node), 0],
  addNodeView() {
    return createButtonView;
  },
});

export const InkyBadge = Node.create({
  name: 'inkyBadge',
  group: 'inline',
  inline: true,
  content: 'inline*',
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'badge' }],
  renderHTML: ({ node }) => ['badge', renderAttributes(node), 0],
  addNodeView() {
    return createBadgeView;
  },
});

export const InkyCallout = Node.create({
  name: 'inkyCallout',
  group: 'block',
  content: 'inline*',
  defining: true,
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'callout' }],
  renderHTML: ({ node }) => ['callout', renderAttributes(node), 0],
  addNodeView() {
    return createCalloutView;
  },
});

export const InkyAlert = Node.create({
  name: 'inkyAlert',
  group: 'block',
  content: 'inline*',
  defining: true,
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'alert' }],
  renderHTML: ({ node }) => ['alert', renderAttributes(node), 0],
  addNodeView() {
    return createAlertView;
  },
});

export const InkyBlockquote = Node.create({
  name: 'inkyBlockquote',
  group: 'block',
  content: 'inline*',
  defining: true,
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'blockquote' }],
  renderHTML: ({ node }) => ['blockquote', renderAttributes(node), 0],
  addNodeView() {
    return createBlockquoteView;
  },
});

export const InkyMenu = Node.create({
  name: 'inkyMenu',
  group: 'block',
  content: 'inkyItem+',
  defining: true,
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'menu' }],
  renderHTML: ({ node }) => ['menu', renderAttributes(node), 0],
  addNodeView() {
    return createMenuView;
  },
});

export const InkyItem = Node.create({
  name: 'inkyItem',
  group: 'inkyItem',
  content: 'inline*',
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'item' }],
  renderHTML: ({ node }) => ['item', renderAttributes(node), 0],
  addNodeView() {
    return createItemView;
  },
});

export const InkyPreview = Node.create({
  name: 'inkyPreview',
  group: 'block',
  content: 'inline*',
  selectable: false,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'preview' }],
  renderHTML: ({ node }) => ['preview', renderAttributes(node), 0],
  addNodeView() {
    return createPreviewView;
  },
});

export const InkyImage = Node.create({
  name: 'inkyImage',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'image' }, { tag: 'img' }],
  renderHTML: ({ node }) => [
    'image',
    { ...renderAttributes(node), 'data-inky-image': '' },
  ],
  addNodeView() {
    return props => createMediaView(props, { kind: 'image' });
  },
});

export const InkyVideo = Node.create({
  name: 'inkyVideo',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'video' }],
  renderHTML: ({ node }) => ['video', renderAttributes(node)],
  addNodeView() {
    return props => createMediaView(props, { kind: 'video' });
  },
});

export const InkySpacer = Node.create({
  name: 'inkySpacer',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'spacer' }],
  renderHTML: ({ node }) => ['spacer', renderAttributes(node)],
  addNodeView() {
    return createSpacerView;
  },
});

export const InkyDivider = Node.create({
  name: 'inkyDivider',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: createAttributes,
  parseHTML: () => [{ tag: 'divider' }],
  renderHTML: ({ node }) => ['divider', renderAttributes(node)],
  addNodeView() {
    return createDividerView;
  },
});

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
    return [
      ...RAW_TAGS.map(tag => ({
        tag,
        getAttrs: (element: HTMLElement) => ({ html: element.outerHTML }),
      })),
      {
        tag: 'inky-comment-block',
        getAttrs: (element: HTMLElement) => ({
          html: `<!--${element.getAttribute('data-comment') ?? ''}-->`,
        }),
      },
    ];
  },
  renderHTML: ({ node }) => [
    'div',
    { 'data-inky-raw': String(node.attrs.html ?? '') },
  ],
  addNodeView() {
    return createRawView;
  },
});

// 行内注释保持原位置，避免把所在段落拆成块
export const InkyInlineRaw = Node.create({
  name: 'inkyInlineRaw',
  group: 'inline',
  inline: true,
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
    return [
      {
        tag: 'inky-comment-inline',
        getAttrs: (element: HTMLElement) => ({
          html: `<!--${element.getAttribute('data-comment') ?? ''}-->`,
        }),
      },
    ];
  },
  renderHTML: ({ node }) => [
    'span',
    { 'data-inky-raw': String(node.attrs.html ?? '') },
  ],
  addNodeView() {
    return createInlineRawView;
  },
});

const TEXT_COMPONENTS = new Set([
  'inkyButton',
  'inkyBadge',
  'inkyCallout',
  'inkyAlert',
  'inkyBlockquote',
  'inkyItem',
  'inkyPreview',
]);

const ATOM_COMPONENTS = new Set([
  'inkyImage',
  'inkyVideo',
  'inkySpacer',
  'inkyDivider',
  'inkyRaw',
]);

const COMPONENT_BLOCKS = new Set([
  ...TEXT_COMPONENTS,
  'inkyMenu',
  ...ATOM_COMPONENTS,
]);

const LAYOUT_COMPONENTS = new Set([
  'inkyWrapper',
  'inkyContainer',
  'inkyRow',
  'inkyColumn',
]);

const LAYOUT_CONTAINERS = new Set([
  'inkyWrapper',
  'inkyContainer',
  'inkyColumn',
]);

const transientParagraphKey = new PluginKey('inkyTransientParagraph');

interface ParagraphRange {
  node: PMNode;
  pos: number;
}

function paragraphAt(doc: PMNode, pos: number): ParagraphRange | null {
  const $pos = doc.resolve(pos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (node.type.name === 'paragraph') {
      return { node, pos: $pos.before(depth) };
    }
  }
  return null;
}

function childAt(parent: PMNode, index: number): PMNode | null {
  return index >= 0 && index < parent.childCount ? parent.child(index) : null;
}

function outerBlockDepth($from: ResolvedPos): number {
  let depth = $from.depth;

  while (depth > 1) {
    const parent = $from.node(depth - 1);

    if (parent.type.name === 'doc' || LAYOUT_CONTAINERS.has(parent.type.name)) {
      break;
    }
    depth -= 1;
  }
  return depth;
}

export function isInsideTextComponent($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (TEXT_COMPONENTS.has($from.node(depth).type.name)) {
      return true;
    }
  }
  return false;
}

function setBlockSelection(
  editor: Editor,
  pos: number,
  node: PMNode,
  align: 'start' | 'end',
): void {
  if (node.isAtom) {
    if (NodeSelection.isSelectable(node)) {
      editor.commands.setNodeSelection(pos);
    } else {
      editor.commands.setTextSelection(pos + 1);
    }
    editor.view.focus();

    return;
  }
  const target = align === 'start' ? pos + 1 : pos + node.nodeSize - 1;
  const selection = TextSelection.near(
    editor.state.doc.resolve(target),
    align === 'start' ? 1 : -1,
  );

  editor.commands.setTextSelection(selection);
  editor.view.focus();
}

function insertTransientParagraph(editor: Editor, pos: number): void {
  const paragraph = editor.state.schema.nodes.paragraph;

  if (!paragraph) {
    return;
  }
  const node = paragraph.create({ transient: true });
  const transaction = editor.state.tr.insert(pos, node);

  transaction.setSelection(TextSelection.create(transaction.doc, pos + 1));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function deleteEmptyParagraphAndSelectNext(
  editor: Editor,
  paragraph: ParagraphRange,
  next: PMNode,
): void {
  const start = paragraph.pos;
  const transaction = editor.state.tr.delete(
    start,
    start + paragraph.node.nodeSize,
  );
  const selection =
    next.isAtom && NodeSelection.isSelectable(next)
      ? NodeSelection.create(transaction.doc, start)
      : TextSelection.near(transaction.doc.resolve(start + 1), 1);

  transaction.setSelection(selection);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function insertParagraphAfterNode(
  editor: Editor,
  selection: NodeSelection,
): void {
  const paragraph = editor.state.schema.nodes.paragraph;

  if (!paragraph) {
    return;
  }
  const pos = selection.to;
  const transaction = editor.state.tr.insert(pos, paragraph.create());

  transaction.setSelection(TextSelection.create(transaction.doc, pos + 1));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function removeTransientParagraph(
  editor: Editor,
  paragraph: ParagraphRange,
  direction: 'up' | 'down',
): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(paragraph.pos);
  const parent = $pos.parent;
  const index = $pos.index();

  if (parent.childCount <= 1) {
    return true;
  }
  const previous = childAt(parent, index - 1);
  const next = childAt(parent, index + 1);

  if (direction === 'down' && !next) {
    return true;
  }

  if (direction === 'up' && !previous) {
    return true;
  }

  const transaction = state.tr.delete(
    paragraph.pos,
    paragraph.pos + paragraph.node.nodeSize,
  );

  if (direction === 'down' && next) {
    if (next.isAtom) {
      transaction.setSelection(
        NodeSelection.create(transaction.doc, paragraph.pos),
      );
    } else {
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(paragraph.pos + 1), 1),
      );
    }
  } else if (previous) {
    if (previous.isAtom) {
      transaction.setSelection(
        NodeSelection.create(
          transaction.doc,
          paragraph.pos - previous.nodeSize,
        ),
      );
    } else {
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(paragraph.pos - 1), -1),
      );
    }
  }

  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

export function removeTransientParagraphs(editor: Editor): void {
  const { state, view } = editor;
  const ranges: ParagraphRange[] = [];

  state.doc.descendants((node, pos) => {
    if (
      node.type.name === 'paragraph' &&
      node.attrs.transient &&
      node.content.size === 0
    ) {
      ranges.push({ node, pos });

      return false;
    }
    return true;
  });

  if (ranges.length === 0) {
    return;
  }
  const transaction = state.tr;
  const onlyTransient = state.doc.childCount === ranges.length;

  for (const range of ranges.sort((left, right) => right.pos - left.pos)) {
    transaction.delete(range.pos, range.pos + range.node.nodeSize);
  }

  if (onlyTransient) {
    const first = transaction.doc.firstChild;

    if (
      first?.type.name === 'paragraph' &&
      first.content.size === 0 &&
      !first.attrs.transient
    ) {
      transaction.setNodeMarkup(0, undefined, {
        ...first.attrs,
        transient: true,
      });
    }
  }

  const mapped = Math.min(
    transaction.mapping.map(state.selection.from),
    transaction.doc.content.size,
  );

  transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(mapped), 1),
  );
  view.dispatch(transaction);
}

export const InkyTransientCleanup = Extension.create({
  name: 'inkyTransientCleanup',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: transientParagraphKey,
        appendTransaction: (_transactions, oldState, newState) => {
          const oldSelection = oldState.selection;

          if (!oldSelection.empty) {
            return null;
          }
          const paragraph = paragraphAt(oldState.doc, oldSelection.from);

          if (
            !paragraph ||
            !paragraph.node.attrs.transient ||
            paragraph.node.content.size > 0
          ) {
            return null;
          }
          const current =
            paragraph.pos < newState.doc.content.size
              ? newState.doc.nodeAt(paragraph.pos)
              : null;

          if (
            !current ||
            current.type.name !== 'paragraph' ||
            !current.attrs.transient ||
            current.content.size > 0
          ) {
            return null;
          }
          const end = paragraph.pos + paragraph.node.nodeSize;

          if (
            newState.selection.from >= paragraph.pos &&
            newState.selection.to <= end
          ) {
            return null;
          }
          const transaction = newState.tr.delete(paragraph.pos, end);
          const mapped = Math.min(
            transaction.mapping.map(newState.selection.from),
            transaction.doc.content.size,
          );
          const $mapped = transaction.doc.resolve(mapped);

          if (newState.selection instanceof NodeSelection) {
            const node = transaction.doc.nodeAt(mapped);

            if (node && NodeSelection.isSelectable(node)) {
              transaction.setSelection(
                NodeSelection.create(transaction.doc, mapped),
              );
            } else {
              transaction.setSelection(TextSelection.near($mapped, 1));
            }
          } else {
            transaction.setSelection(TextSelection.near($mapped, 1));
          }
          return transaction;
        },
      }),
    ];
  },
});

function handleArrowDown(editor: Editor, selection: Selection): boolean {
  if (selection instanceof NodeSelection) {
    const $pos = editor.state.doc.resolve(selection.from);
    const parent = $pos.parent;
    const index = $pos.index();
    const next = childAt(parent, index + 1);

    if (next) {
      setBlockSelection(
        editor,
        selection.from + selection.node.nodeSize,
        next,
        'start',
      );

      return true;
    }

    if (!COMPONENT_BLOCKS.has(selection.node.type.name)) {
      return false;
    }
    insertTransientParagraph(editor, selection.from + selection.node.nodeSize);

    return true;
  }

  if (!selection.empty) {
    return false;
  }

  if (!editor.view.endOfTextblock('down')) {
    return false;
  }
  const current = paragraphAt(editor.state.doc, selection.from);

  if (current?.node.attrs.transient && current.node.content.size === 0) {
    return removeTransientParagraph(editor, current, 'down');
  }
  const { $from } = selection;
  const depth = outerBlockDepth($from);

  if (depth < 1) {
    return false;
  }
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const block = $from.node(depth);

  const next = childAt(parent, index + 1);

  if (next) {
    setBlockSelection(editor, $from.after(depth), next, 'start');

    return true;
  }

  if (!COMPONENT_BLOCKS.has(block.type.name)) {
    return false;
  }
  insertTransientParagraph(editor, $from.after(depth));

  return true;
}

function handleArrowUp(editor: Editor, selection: Selection): boolean {
  if (selection instanceof NodeSelection) {
    const $pos = editor.state.doc.resolve(selection.from);
    const parent = $pos.parent;
    const index = $pos.index();
    const previous = childAt(parent, index - 1);

    if (previous) {
      setBlockSelection(
        editor,
        selection.from - previous.nodeSize,
        previous,
        'end',
      );

      return true;
    }

    if (!COMPONENT_BLOCKS.has(selection.node.type.name)) {
      return false;
    }
    insertTransientParagraph(editor, selection.from);

    return true;
  }

  if (!selection.empty) {
    return false;
  }

  if (!editor.view.endOfTextblock('up')) {
    return false;
  }
  const current = paragraphAt(editor.state.doc, selection.from);

  if (current?.node.attrs.transient && current.node.content.size === 0) {
    return removeTransientParagraph(editor, current, 'up');
  }
  const { $from } = selection;
  const depth = outerBlockDepth($from);

  if (depth < 1) {
    return false;
  }
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const block = $from.node(depth);
  const previous = childAt(parent, index - 1);

  if (previous) {
    setBlockSelection(
      editor,
      $from.before(depth) - previous.nodeSize,
      previous,
      'end',
    );

    return true;
  }

  if (!COMPONENT_BLOCKS.has(block.type.name)) {
    return false;
  }
  insertTransientParagraph(editor, $from.before(depth));

  return true;
}

function handleBackspace(editor: Editor, selection: Selection): boolean {
  if (!selection.empty) {
    return false;
  }
  const { $from } = selection;

  if ($from.parentOffset === 0) {
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);

      if (
        TEXT_COMPONENTS.has(node.type.name) &&
        node.textContent.trim() === ''
      ) {
        editor
          .chain()
          .deleteRange({
            from: $from.before(depth),
            to: $from.after(depth),
          })
          .run();

        return true;
      }
    }
  }

  const before = $from.nodeBefore;

  if (before && TEXT_COMPONENTS.has(before.type.name)) {
    editor.commands.setTextSelection(
      $from.pos - before.nodeSize + 1 + before.content.size,
    );

    return true;
  }

  if ($from.parentOffset !== 0 || $from.depth < 1) {
    return false;
  }
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);

  if (index === 0) {
    return false;
  }
  const previous = parent.child(index - 1);

  if (COMPONENT_BLOCKS.has(previous.type.name)) {
    const start = $from.before($from.depth) - previous.nodeSize;

    setBlockSelection(editor, start, previous, 'end');

    return true;
  }

  if (LAYOUT_COMPONENTS.has(previous.type.name)) {
    return true;
  }
  return false;
}

function handleDelete(editor: Editor, selection: Selection): boolean {
  if (!selection.empty) {
    return false;
  }
  const { $from } = selection;

  if ($from.parentOffset !== $from.parent.content.size || $from.depth < 1) {
    return false;
  }
  const depth = outerBlockDepth($from);

  if (depth < 1) {
    return false;
  }
  const current = $from.node(depth);
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const next = childAt(parent, index + 1);

  if (!next) {
    return true;
  }

  if (current.type.name === 'paragraph' && current.content.size === 0) {
    deleteEmptyParagraphAndSelectNext(
      editor,
      { node: current, pos: $from.before(depth) },
      next,
    );

    return true;
  }

  if (
    current.type.name !== 'paragraph' &&
    next.type.name === 'paragraph' &&
    next.content.size === 0
  ) {
    const start = $from.after(depth);

    editor.view.dispatch(editor.state.tr.delete(start, start + next.nodeSize));
    editor.view.focus();

    return true;
  }
  return current.type.name !== 'paragraph' || next.type.name !== 'paragraph';
}

export function handleInkyKeyDown(
  editor: Editor,
  event: KeyboardEvent,
): boolean {
  if (
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const { selection } = editor.state;

  if (selection instanceof NodeSelection) {
    if (event.key === 'Enter') {
      insertParagraphAfterNode(editor, selection);
      event.preventDefault();

      return true;
    }

    if (event.key.length === 1) {
      event.preventDefault();

      return true;
    }
  }

  let handled = false;

  if (event.key === 'ArrowDown') {
    handled = handleArrowDown(editor, selection);
  } else if (event.key === 'ArrowUp') {
    handled = handleArrowUp(editor, selection);
  } else if (event.key === 'ArrowRight') {
    if (selection.empty) {
      const { $from } = selection;
      const depth = outerBlockDepth($from);

      handled = depth > 0 && selection.from >= $from.after(depth) - 1;
    }
  } else if (event.key === 'ArrowLeft') {
    if (selection.empty) {
      const { $from } = selection;
      const depth = outerBlockDepth($from);

      handled = depth > 0 && selection.from <= $from.before(depth) + 1;
    }
  } else if (event.key === 'Backspace') {
    handled = handleBackspace(editor, selection);
  } else if (event.key === 'Delete') {
    handled = handleDelete(editor, selection);
  }

  if (handled) {
    event.preventDefault();
  }
  return handled;
}

export const InkyExtensions = [
  InkyWrapper,
  InkyContainer,
  InkyRow,
  InkyColumn,
  InkyButton,
  InkyBadge,
  InkyCallout,
  InkyAlert,
  InkyBlockquote,
  InkyMenu,
  InkyItem,
  InkyPreview,
  InkyImage,
  InkyVideo,
  InkySpacer,
  InkyDivider,
  InkyRaw,
  InkyInlineRaw,
  InkyTransientCleanup,
];

import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiBold,
  RiItalic,
  RiLayoutGridLine,
  RiLink,
  RiStrikethrough,
  RiUnderline,
} from '@remixicon/react';
import type { JSONContent } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions/placeholder';
import type { Node as PMNode } from '@tiptap/pm/model';
import { type Selection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Popover } from '#/client/components/popover';
import { formatSize } from '#/client/format';
import { useI18n } from '#/client/i18n';
import { inkyFrameworkCss } from '#/client/inky';

import { PreservedAttributes, StyleBlock } from '../extensions';

import {
  type InkyComponentResult,
  InkyComponentDialog,
} from './component-dialog';
import {
  type InkyComponentType,
  INKY_COMPONENT_ORDER,
  INKY_COMPONENTS,
} from './components';
import { LinkDialog } from './link-dialog';
import {
  handleInkyKeyDown,
  InkyExtensions,
  InkyParagraph,
  isInsideTextComponent,
  removeTransientParagraphs,
} from './schema';
import {
  getInkySource,
  getInkySourceSelection,
  getSourceStyles,
  protectComments,
} from './serialize';
import { InkySourceEditor } from './source-editor';

import '../style.css';
import './style.css';

import { Button } from '#/client/components/button';

export interface InkyEditorProps {
  source: string;
  onChange: (source: string) => void;
  onUploadImage?: (
    file: File,
    apply: (url: string) => boolean,
  ) => Promise<void>;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  componentEnd?: ReactNode;
  toolbarTarget?: HTMLElement | null;
  modeTarget?: HTMLElement | null;
  statusTarget?: HTMLElement | null;
  componentsAnchor: string;
  maxBytes: number;
}

interface LinkDialogState {
  from: number;
  to: number;
  text: string;
  url: string;
}

type VisualSelection =
  { type: 'text'; from: number; to: number } | { type: 'node'; from: number };

function captureSelection(selection: Selection): VisualSelection {
  if (selection instanceof NodeSelection) {
    return { type: 'node', from: selection.from };
  }
  return { type: 'text', from: selection.from, to: selection.to };
}

function restoreSelection(
  editor: Editor,
  snapshot: VisualSelection | null,
): void {
  if (!snapshot) {
    return;
  }
  const size = editor.state.doc.content.size;
  const from = Math.min(snapshot.from, size);

  if (snapshot.type === 'node') {
    const node = editor.state.doc.nodeAt(from);

    if (node && NodeSelection.isSelectable(node)) {
      editor.commands.setNodeSelection(from);
    }
    return;
  }

  editor.commands.setTextSelection({
    from,
    to: Math.min(snapshot.to, size),
  });
}

const LAYOUT_CONTAINERS = new Set([
  'inkyWrapper',
  'inkyContainer',
  'inkyColumn',
]);

const TEXT_ENCODER = new TextEncoder();

function countCharacters(value: string): number {
  let count = 0;

  for (const _ of value) {
    count += 1;
  }

  return count;
}

function insertBlockNode(
  editor: Editor,
  content: JSONContent,
): { node: PMNode; pos: number } | null {
  const { state } = editor;
  const node = state.schema.nodeFromJSON(content);
  const { selection } = state;

  let insertAt: number;
  let replaceFrom: number | null = null;
  let replaceTo = 0;

  if (selection instanceof NodeSelection) {
    insertAt = selection.to;
  } else {
    const { $from } = selection;

    let depth = $from.depth;

    while (depth > 1) {
      const parent = $from.node(depth - 1);

      if (
        parent.type.name === 'doc' ||
        LAYOUT_CONTAINERS.has(parent.type.name)
      ) {
        break;
      }
      depth -= 1;
    }

    if (depth < 1) {
      return null;
    }
    const block = $from.node(depth);

    insertAt = $from.after(depth);

    if (block.type.name === 'paragraph' && block.content.size === 0) {
      replaceFrom = $from.before(depth);
      replaceTo = insertAt;
      insertAt = replaceFrom;
    }
  }

  const transaction = state.tr;

  if (replaceFrom !== null) {
    transaction.replaceWith(replaceFrom, replaceTo, node);
  } else {
    transaction.insert(insertAt, node);
  }

  if (node.isAtom) {
    transaction.setSelection(NodeSelection.create(transaction.doc, insertAt));
  } else {
    const target =
      node.content.size > 0 ? insertAt + node.nodeSize - 1 : insertAt + 1;

    transaction.setSelection(
      TextSelection.near(transaction.doc.resolve(target), -1),
    );
  }

  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();

  return { node, pos: insertAt };
}

function markSoleEmptyParagraphTransient(editor: Editor): void {
  const doc = editor.state.doc;

  if (doc.childCount !== 1) {
    return;
  }
  const first = doc.firstChild;

  if (
    first?.type.name === 'paragraph' &&
    first.content.size === 0 &&
    !first.attrs.transient
  ) {
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...first.attrs,
        transient: true,
      }),
    );
  }
}

const FRAME_STYLE = `
  :host {
    color-scheme: light;
    display: block;
    min-height: 100%;
  }
  .inky-canvas-mount {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 100%;
  }
  .inky-canvas-mount > div {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }
  .tiptap {
    flex: 1 1 auto;
    width: 100%;
    min-height: 100%;
    outline: none;
  }
  .tiptap [data-node-view-content],
  .tiptap [data-node-view-content-react] { white-space: normal !important; }
  .tiptap.ProseMirror-focused .ProseMirror-selectednode,
  .tiptap.ProseMirror-focused .inky-selected {
    outline: 2px solid #5d82dc;
    outline-offset: -2px;
  }
  /*
   * Tiptap 把 ProseMirror 基础样式注入 document.head，Shadow DOM 内收不到。
   * 节点被 NodeSelection 选中时，这里补上原生光标和选区的隐藏规则。
   */
  .tiptap.ProseMirror-hideselection *::selection {
    background: transparent;
  }
  .tiptap.ProseMirror-hideselection *::-moz-selection {
    background: transparent;
  }
  .tiptap.ProseMirror-hideselection,
  .tiptap.ProseMirror-hideselection * {
    caret-color: transparent;
  }
  /*
   * 空段落没有文本，浏览器仍可能在光标处绘制原生选区块。
   * 这里只把空段落的选区背景设为透明，光标本身保持可见。
   */
  .tiptap p.is-empty::selection,
  .tiptap p.is-empty *::selection {
    background: transparent;
  }
  .tiptap p.is-empty::-moz-selection,
  .tiptap p.is-empty *::-moz-selection {
    background: transparent;
  }
  .tiptap .inky-raw {
    margin: 8px 0;
    border: 1px dashed #dce6ff;
    background: #f7f9fc;
    color: #91a0bd;
  }
  .tiptap .inky-raw pre {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tiptap .inky-inline-raw {
    padding: 0 2px;
    border-radius: 3px;
    background: #f0f4fc;
    color: #91a0bd;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  .tiptap table.callout {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }
  .tiptap .inky-button-block {
    margin-block: 0 16px;
  }
  .tiptap .inky-button-view {
    display: inline-block;
    padding: 8px 16px;
    border-radius: 3px;
    background: #1a73b5;
    color: #fff;
    font-weight: bold;
    line-height: 1.4;
    text-decoration: none;
    white-space: pre-wrap;
  }
  .tiptap .inky-button-view.small {
    padding: 5px 10px;
    font-size: 12px;
  }
  .tiptap .inky-button-view.large {
    padding: 10px 20px;
    font-size: 20px;
  }
  .tiptap .inky-button-view.tiny {
    padding: 4px 8px;
    font-size: 10px;
  }
  .tiptap .inky-button-view.secondary {
    background: #777;
  }
  .tiptap .inky-button-view.success {
    background: #3adb76;
  }
  .tiptap .inky-button-view.alert {
    background: #ec5840;
  }
  .tiptap .inky-button-view.warning {
    background: #ffae00;
  }
  .tiptap .inky-button-view.hollow {
    border: 1px solid currentColor;
    background: transparent;
    color: #1a73b5;
  }
  .tiptap .inky-button-view.rounded {
    border-radius: 500px;
  }
  .tiptap table.callout,
  .tiptap table.alert,
  .tiptap table.blockquote,
  .tiptap table.menu,
  .tiptap .inky-media,
  .tiptap .inky-preview {
    margin-block: 0 16px;
  }
  .tiptap .inky-media {
    display: flex;
    max-width: 100%;
    margin: 0 0 16px;
  }
  .tiptap .inky-media-frame {
    position: relative;
    display: block;
    min-width: 0;
    max-width: 100%;
    outline: 2px solid transparent;
    outline-offset: -2px;
  }
  .tiptap.ProseMirror-focused .inky-media-selected .inky-media-frame {
    outline-color: #5d82dc;
  }
  .tiptap .inky-media img,
  .tiptap .inky-media video {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .tiptap .inky-resize-handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 12px;
    height: 12px;
    border: 2px solid #ffffff;
    border-radius: 3px;
    background: #5d82dc;
    cursor: nwse-resize;
    opacity: 0;
  }
  .tiptap.ProseMirror-focused .inky-media-selected .inky-resize-handle {
    opacity: 1;
  }
  .tiptap .inky-preview {
    margin: 0 0 16px;
    padding: 10px 12px;
    border: 1px dashed #cbd8ed;
    border-radius: 6px;
    background: #f7f9fc;
  }
  .tiptap .inky-preview-label {
    display: block;
    margin-bottom: 4px;
    color: #91a0bd;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .tiptap .inky-preview-content {
    color: #52617a;
  }
  .tiptap p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: #91a0bd;
    pointer-events: none;
  }
`;

function imageFiles(data: DataTransfer | null): File[] {
  const files = Array.from(data?.files ?? []).filter(file =>
    file.type.startsWith('image/'),
  );

  if (files.length > 0) {
    return files;
  }

  return Array.from(data?.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/**
 * Inky 正文编辑器：可视化模式用 Inky 组件 schema，源码模式编辑同一份 Inky 源码。
 */
export function InkyEditor({
  source,
  onChange,
  onUploadImage,
  onUploadingChange,
  disabled = false,
  componentEnd,
  toolbarTarget,
  modeTarget,
  statusTarget,
  componentsAnchor,
  maxBytes,
}: InkyEditorProps) {
  const { t, locale } = useI18n();
  const onChangeRef = useRef(onChange);
  const editorRef = useRef<Editor | null>(null);
  const uploadImageRef = useRef(onUploadImage);
  const onUploadingChangeRef = useRef(onUploadingChange);
  const disabledRef = useRef(disabled);
  const insertImageRef = useRef<(file: File) => void>(() => {});
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasRoot, setCanvasRoot] = useState<HTMLElement | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [componentType, setComponentType] = useState<InkyComponentType | null>(
    null,
  );
  const [uploadingCount, setUploadingCount] = useState(0);
  const componentReturnRef = useRef(false);
  const focusVisualRef = useRef(false);
  const linkReturnRef = useRef(false);
  const sourceSelectionRef = useRef<number | null>(null);
  const sourceSnapshotRef = useRef('');
  const visualSelectionRef = useRef<VisualSelection | null>(null);

  onChangeRef.current = onChange;
  uploadImageRef.current = onUploadImage;
  onUploadingChangeRef.current = onUploadingChange;
  disabledRef.current = disabled;

  useEffect(() => {
    onUploadingChangeRef.current?.(uploadingCount > 0);
  }, [uploadingCount]);

  const editor = useEditor({
    editorProps: {
      handleKeyDown: (view, event) => {
        const current = editorRef.current;

        if (current && handleInkyKeyDown(current, event)) {
          return true;
        }

        if (
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.isComposing
        ) {
          return false;
        }
        const { selection } = view.state;

        if (!selection.empty || !isInsideTextComponent(selection.$from)) {
          return false;
        }
        const hardBreak = view.state.schema.nodes.hardBreak;

        if (!hardBreak) {
          return false;
        }
        event.preventDefault();

        view.dispatch(
          view.state.tr
            .replaceSelectionWith(hardBreak.create())
            .scrollIntoView(),
        );

        return true;
      },
      handlePaste: (_view, event) => {
        if (disabledRef.current) {
          return false;
        }
        const files = imageFiles(event.clipboardData);

        if (!files.length) {
          return false;
        }
        event.preventDefault();

        for (const file of files) {
          insertImageRef.current(file);
        }
        return true;
      },
      handleDrop: (_view, event) => {
        if (disabledRef.current) {
          return false;
        }
        const files = imageFiles(event.dataTransfer);

        if (!files.length) {
          return false;
        }
        event.preventDefault();

        for (const file of files) {
          insertImageRef.current(file);
        }
        return true;
      },
    },
    extensions: [
      InkyParagraph,
      StarterKit.configure({
        blockquote: false,
        gapcursor: false,
        paragraph: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          HTMLAttributes: { target: null, rel: null, class: null },
        },
      }),
      PreservedAttributes,
      StyleBlock,
      ...InkyExtensions,
      Placeholder.configure({ placeholder: t('compose.body') }),
    ],
    content: protectComments(source),
    editable: !disabled,
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(getInkySource(instance));
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  // Backspace/Delete 会被 ProseMirror 的基础 keymap 优先处理，这里在捕获阶段截住组件边界。
  useEffect(() => {
    if (!canvasRoot) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        editor.isDestroyed ||
        (event.key !== 'Backspace' && event.key !== 'Delete')
      ) {
        return;
      }

      if (handleInkyKeyDown(editor, event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    canvasRoot.addEventListener('keydown', onKeyDown, true);

    return () => canvasRoot.removeEventListener('keydown', onKeyDown, true);
  }, [canvasRoot, editor]);

  // 用 Shadow DOM 隔离邮件样式，编辑画布和邮件使用同一套表格与 CSS
  useEffect(() => {
    const host = canvasRef.current;

    if (!host) {
      return;
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    let style = shadow.querySelector<HTMLStyleElement>(
      'style[data-inky-style]',
    );

    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.dataset.inkyStyle = '';
      shadow.appendChild(style);
    }
    style.textContent = [
      inkyFrameworkCss,
      getSourceStyles(source),
      FRAME_STYLE,
    ].join('\n');

    let mount = shadow.querySelector<HTMLElement>('.inky-canvas-mount');

    if (!(mount instanceof HTMLElement)) {
      mount = document.createElement('div');
      mount.className = 'inky-canvas-mount';
      shadow.appendChild(mount);
    }
    setCanvasRoot(mount);
  }, [source]);

  // 外部内容变化（载入草稿或切回可视化）时同步进编辑器
  useEffect(() => {
    if (editor.isDestroyed || sourceMode) {
      return;
    }
    const current = getInkySource(editor);

    if (source !== current) {
      editor.commands.setContent(protectComments(source));
    }

    if (!source.trim()) {
      markSoleEmptyParagraphTransient(editor);
    }
  }, [editor, source, sourceMode]);

  useEffect(() => {
    if (!sourceMode && focusVisualRef.current) {
      focusVisualRef.current = false;
      editor.commands.focus();
    }
  }, [editor, sourceMode]);

  // 弹窗关闭后回到正文，取消和插入都走这里
  useEffect(() => {
    if (!linkDialog && linkReturnRef.current) {
      linkReturnRef.current = false;
      editor.commands.focus();
    }
  }, [editor, linkDialog]);

  useEffect(() => {
    if (!componentType && componentReturnRef.current) {
      componentReturnRef.current = false;
      editor.commands.focus();
    }
  }, [componentType, editor]);

  const openLinkDialog = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').run();
    }

    const { from, to } = editor.state.selection;
    const attributes = editor.getAttributes('link') as { href?: string };

    linkReturnRef.current = true;

    setLinkDialog({
      from,
      to,
      text: editor.state.doc.textBetween(from, to, ' ').trim(),
      url: attributes.href ?? '',
    });
  };

  const insertLink = (text: string, url: string) => {
    if (!linkDialog) {
      return;
    }
    const { from, to, text: originalText } = linkDialog;

    if (from !== to && text === originalText) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setLink({ href: url })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from, to },
          {
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href: url } }],
          },
        )
        .run();
    }
    setLinkDialog(null);
  };

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      underline: instance.isActive('underline'),
      strike: instance.isActive('strike'),
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
    }),
  });

  const componentsPopoverId = `components-${componentsAnchor.replace(
    /^--/,
    '',
  )}`;
  const sizeBytes = useMemo(
    () => (sourceMode ? 0 : TEXT_ENCODER.encode(source).length),
    [source, sourceMode],
  );
  const characterCount = useMemo(
    () => (sourceMode ? countCharacters(source) : 0),
    [source, sourceMode],
  );
  const sizePercent = Math.min(100, (sizeBytes / maxBytes) * 100);

  const toggleSource = () => {
    if (uploadingCount > 0) {
      return;
    }

    if (sourceMode) {
      const restore = source === sourceSnapshotRef.current;

      focusVisualRef.current = true;
      editor.commands.setContent(protectComments(source));

      if (!source.trim()) {
        markSoleEmptyParagraphTransient(editor);
      }

      if (restore) {
        restoreSelection(editor, visualSelectionRef.current);
      }
      setSourceMode(false);

      const normalized = getInkySource(editor);

      if (normalized !== source) {
        onChangeRef.current(normalized);
      }
      return;
    }

    removeTransientParagraphs(editor);

    const current = getInkySource(editor);

    sourceSelectionRef.current = getInkySourceSelection(editor);
    sourceSnapshotRef.current = current;
    visualSelectionRef.current = captureSelection(editor.state.selection);

    if (current !== source) {
      onChangeRef.current(current);
    }
    setSourceMode(true);
  };

  const changeSource = (value: string) => {
    onChangeRef.current(value);
  };

  const updateImageSource = (localUrl: string, remoteUrl: string): boolean => {
    if (editor.isDestroyed) {
      return false;
    }
    const { state, view } = editor;

    let updated = false;

    state.doc.descendants((node, pos) => {
      const attrs = node.attrs['attrs'] as Record<string, string> | undefined;

      if (node.type.name !== 'inkyImage' || attrs?.src !== localUrl) {
        return true;
      }

      view.dispatch(
        state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          attrs: { ...attrs, src: remoteUrl },
        }),
      );
      updated = true;

      return false;
    });

    return updated;
  };

  const removeImage = (src: string) => {
    if (editor.isDestroyed) {
      return;
    }
    const { state } = editor;

    let target: { from: number; to: number } | null = null;

    state.doc.descendants((node, pos) => {
      const attrs = node.attrs['attrs'] as Record<string, string> | undefined;

      if (node.type.name !== 'inkyImage' || attrs?.src !== src) {
        return true;
      }
      target = { from: pos, to: pos + node.nodeSize };

      return false;
    });

    if (target) {
      editor.chain().focus().deleteRange(target).run();
    }
  };

  const uploadPreviewImage = async (file: File, localUrl: string) => {
    const upload = uploadImageRef.current;

    if (!upload) {
      return;
    }

    onUploadingChangeRef.current?.(true);
    setUploadingCount(count => count + 1);

    try {
      await upload(file, remoteUrl => {
        if (editor.isDestroyed) {
          return false;
        }
        return updateImageSource(localUrl, remoteUrl);
      });
    } catch {
      removeImage(localUrl);
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploadingCount(count => Math.max(0, count - 1));
    }
  };

  const insertImageFile = (file: File) => {
    const localUrl = URL.createObjectURL(file);
    const inserted = insertBlockNode(editor, {
      type: 'inkyImage',
      attrs: { attrs: { src: localUrl, alt: file.name } },
    });

    if (inserted) {
      uploadPreviewImage(file, localUrl);
    } else {
      URL.revokeObjectURL(localUrl);
    }
  };

  insertImageRef.current = insertImageFile;

  const insertComponent = (result: InkyComponentResult) => {
    const text = result.text ? [{ type: 'text', text: result.text }] : [];

    let node: JSONContent;
    let localImageUrl = '';

    if (result.type === 'image') {
      const attrs = { ...result.attrs };

      if (result.file) {
        localImageUrl = URL.createObjectURL(result.file);
        attrs.src = localImageUrl;
        attrs.alt ||= result.file.name;
      }
      node = {
        type: 'inkyImage',
        attrs: { attrs },
      };
    } else if (result.type === 'video') {
      node = {
        type: 'inkyVideo',
        attrs: { attrs: result.attrs },
      };
    } else if (result.type === 'menu') {
      const items = result.items?.length
        ? result.items
        : [{ text: '', href: '' }];

      node = {
        type: 'inkyMenu',
        attrs: { attrs: result.attrs },
        content: items.map(item => ({
          type: 'inkyItem',
          attrs: { attrs: item.href ? { href: item.href } : {} },
          content: item.text ? [{ type: 'text', text: item.text }] : [],
        })),
      };
    } else if (result.type === 'badge') {
      node = {
        type: 'inkyBadge',
        attrs: { attrs: result.attrs },
        content: text,
      };
    } else if (result.type === 'button') {
      node = {
        type: 'inkyButton',
        attrs: { attrs: result.attrs },
        content: text,
      };
    } else if (result.type === 'preview') {
      node = {
        type: 'inkyPreview',
        attrs: { attrs: result.attrs },
        content: text,
      };
    } else {
      const typeName = {
        callout: 'inkyCallout',
        alert: 'inkyAlert',
        blockquote: 'inkyBlockquote',
      }[result.type] as string;

      node = {
        type: typeName,
        attrs: { attrs: result.attrs },
        content: text,
      };
    }

    if (result.type === 'badge') {
      const insertAt = editor.state.selection.to;

      editor.chain().focus().insertContentAt(insertAt, node).run();

      let insertedAt: number | null = null;

      editor.state.doc.nodesBetween(
        insertAt,
        editor.state.doc.content.size,
        (child, pos) => {
          if (child.type.name === 'inkyBadge') {
            insertedAt = pos;

            return false;
          }
          return true;
        },
      );

      if (insertedAt !== null) {
        const inserted = editor.state.doc.nodeAt(insertedAt);

        if (inserted) {
          editor.commands.setTextSelection(
            insertedAt + 1 + inserted.content.size,
          );
        }
      }
    } else {
      insertBlockNode(editor, node);
    }

    componentReturnRef.current = true;
    setComponentType(null);

    if (result.file && localImageUrl) {
      uploadPreviewImage(result.file, localImageUrl);
    }
  };

  return (
    <div className="compose-editor">
      {uploadingCount > 0 ? (
        <div className="inky-uploading" role="status" aria-live="polite">
          {t('common.loading')}
        </div>
      ) : null}
      <div className="inky-frame" ref={canvasRef} hidden={sourceMode}>
        {canvasRoot
          ? createPortal(<EditorContent editor={editor} />, canvasRoot)
          : null}
      </div>
      {sourceMode ? (
        <InkySourceEditor
          value={source}
          onChange={changeSource}
          selection={sourceSelectionRef.current}
          readOnly={disabled}
        />
      ) : null}
      {toolbarTarget
        ? createPortal(
            <div className="compose-toolbar" inert={disabled || undefined}>
              {sourceMode ? null : (
                <>
                  <Popover
                    id={componentsPopoverId}
                    anchorName={componentsAnchor}
                    popoverClassName="compose-components-popover"
                    triggerClassName="icon-btn compose-components-trigger"
                    triggerLabel={t('compose.insertComponent')}
                    triggerTitle={t('compose.insertComponent')}
                    side="top"
                    trigger={<RiLayoutGridLine size={20} aria-hidden />}
                  >
                    <div className="compose-components-grid">
                      {INKY_COMPONENT_ORDER.map(type => {
                        const item = INKY_COMPONENTS[type];
                        const Icon = item.icon;

                        return (
                          <button
                            key={type}
                            type="button"
                            className="popover-item"
                            popoverTarget={componentsPopoverId}
                            popoverTargetAction="hide"
                            onClick={() => {
                              componentReturnRef.current = true;
                              setComponentType(type);
                            }}
                          >
                            <Icon size={20} aria-hidden />
                            <span>{t(item.label)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </Popover>
                  <span className="compose-toolbar-divider" aria-hidden />
                  <Button
                    variant="icon"
                    className="compose-history-btn"
                    disabled={!state.canUndo}
                    onClick={() => editor.chain().focus().undo().run()}
                    aria-label={t('compose.undo')}
                    title={t('compose.undo')}
                  >
                    <RiArrowGoBackLine size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="icon"
                    className="compose-history-btn"
                    disabled={!state.canRedo}
                    onClick={() => editor.chain().focus().redo().run()}
                    aria-label={t('compose.redo')}
                    title={t('compose.redo')}
                  >
                    <RiArrowGoForwardLine size={20} aria-hidden />
                  </Button>
                  <span className="compose-toolbar-divider" aria-hidden />
                  <Button
                    variant="icon"
                    data-active={state.bold}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    aria-label={t('compose.bold')}
                    title={t('compose.bold')}
                  >
                    <RiBold size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="icon"
                    data-active={state.italic}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    aria-label={t('compose.italic')}
                    title={t('compose.italic')}
                  >
                    <RiItalic size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="icon"
                    data-active={state.underline}
                    onClick={() =>
                      editor.chain().focus().toggleUnderline().run()
                    }
                    aria-label={t('compose.underline')}
                    title={t('compose.underline')}
                  >
                    <RiUnderline size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="icon"
                    data-active={state.strike}
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    aria-label={t('compose.strike')}
                    title={t('compose.strike')}
                  >
                    <RiStrikethrough size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="icon"
                    onClick={openLinkDialog}
                    aria-label={t('compose.link')}
                    title={t('compose.link')}
                  >
                    <RiLink size={20} aria-hidden />
                  </Button>
                </>
              )}
            </div>,
            toolbarTarget,
          )
        : null}
      {modeTarget
        ? createPortal(
            <>
              {componentEnd}
              <div
                className="compose-mode-switch"
                inert={disabled || undefined}
              >
                <button
                  type="button"
                  className="compose-mode-option"
                  data-active={!sourceMode}
                  aria-pressed={!sourceMode}
                  disabled={disabled || uploadingCount > 0}
                  onClick={() => {
                    if (sourceMode) {
                      toggleSource();
                    }
                  }}
                >
                  {t('compose.visualMode')}
                </button>
                <button
                  type="button"
                  className="compose-mode-option"
                  data-active={sourceMode}
                  aria-pressed={sourceMode}
                  disabled={disabled || uploadingCount > 0}
                  onClick={() => {
                    if (!sourceMode) {
                      toggleSource();
                    }
                  }}
                >
                  {t('compose.sourceMode')}
                </button>
              </div>
            </>,
            modeTarget,
          )
        : null}
      {statusTarget
        ? createPortal(
            <span className="compose-status-info">
              {sourceMode ? (
                `${characterCount.toLocaleString(locale)} ${t(
                  'compose.characters',
                )}`
              ) : (
                <>
                  <span className="compose-size-current">
                    {formatSize(sizeBytes)}
                  </span>
                  <span className="compose-size-bar" aria-hidden>
                    <span style={{ width: `${sizePercent}%` }} />
                  </span>
                  <span className="compose-size-max">
                    {formatSize(maxBytes)}
                  </span>
                </>
              )}
            </span>,
            statusTarget,
          )
        : null}
      {linkDialog ? (
        <LinkDialog
          initialText={linkDialog.text}
          initialUrl={linkDialog.url}
          onSubmit={insertLink}
          onDismiss={() => setLinkDialog(null)}
        />
      ) : null}
      {componentType ? (
        <InkyComponentDialog
          type={componentType}
          onSubmit={insertComponent}
          onDismiss={() => setComponentType(null)}
        />
      ) : null}
    </div>
  );
}

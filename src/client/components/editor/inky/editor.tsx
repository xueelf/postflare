import {
  RiBold,
  RiCodeLine,
  RiItalic,
  RiLink,
  RiStrikethrough,
  RiTableLine,
  RiUnderline,
} from '@remixicon/react';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useI18n } from '#/client/i18n';
import { compileInky, inkyFrameworkCss } from '#/client/inky';

import { PreservedAttributes, StyleBlock } from '../extensions';

import { LinkDialog } from './link-dialog';
import { InkyExtensions } from './schema';
import { getInkySource, getSourceStyles } from './serialize';
import { InkySourceEditor } from './source-editor';
import { TableDialog } from './table-dialog';

import '../style.css';
import './style.css';

import { Button } from '#/client/components/button';

export interface InkyEditorContent {
  source: string;
  text: string;
  html: string;
}

export interface InkyEditorProps {
  source: string;
  onChange: (content: InkyEditorContent) => void;
  toolbarEnd?: ReactNode;
}

interface LinkDialogState {
  from: number;
  to: number;
  text: string;
  url: string;
}

const FRAME_STYLE = `
  :host {
    color-scheme: light;
    display: block;
    min-height: 100%;
  }
  .inky-canvas-mount { width: 100%; min-height: 100%; }
  .tiptap { width: 100%; outline: none; min-height: 100%; }
  .tiptap [data-node-view-content],
  .tiptap [data-node-view-content-react] { white-space: normal !important; }
  .tiptap .ProseMirror-selectednode,
  .tiptap .inky-selected {
    outline: 2px solid #5d82dc;
    outline-offset: 2px;
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
  .tiptap p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: #91a0bd;
    pointer-events: none;
  }
`;

/**
 * Inky 正文编辑器：可视化模式用 Inky 组件 schema，源码模式编辑同一份 Inky 源码。
 */
export function InkyEditor({ source, onChange, toolbarEnd }: InkyEditorProps) {
  const { t } = useI18n();
  const onChangeRef = useRef(onChange);
  const htmlRef = useRef('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasRoot, setCanvasRoot] = useState<HTMLElement | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [tableDialog, setTableDialog] = useState(false);
  const focusVisualRef = useRef(false);
  const linkReturnRef = useRef(false);
  const tableReturnRef = useRef(false);

  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
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
    content: source,
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current({
        source: getInkySource(instance),
        text: instance.getText(),
        html: htmlRef.current,
      });
    },
  });

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
    if (sourceMode) {
      return;
    }
    const current = getInkySource(editor);

    if (source !== current) {
      editor.commands.setContent(source);
    }
  }, [editor, source, sourceMode]);

  // 源码是最终内容，编译结果只用于预览、保存和发送
  useEffect(() => {
    if (!source.trim()) {
      htmlRef.current = '';

      return;
    }
    let cancelled = false;

    const timer = setTimeout(() => {
      compileInky(source)
        .then(result => {
          if (cancelled) {
            return;
          }
          htmlRef.current = result.html;

          onChangeRef.current({
            source,
            text: result.text,
            html: result.html,
          });
        })
        .catch(() => {
          // 保留上一次可用的 HTML，源码仍然完整
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  useEffect(() => {
    if (!sourceMode && focusVisualRef.current) {
      focusVisualRef.current = false;
      editor.commands.focus();
    }
  }, [editor, sourceMode]);

  // 弹窗关闭后回到正文，取消和插入都走这里
  useEffect(() => {
    if (
      !linkDialog &&
      !tableDialog &&
      (linkReturnRef.current || tableReturnRef.current)
    ) {
      linkReturnRef.current = false;
      tableReturnRef.current = false;
      editor.commands.focus();
    }
  }, [editor, linkDialog, tableDialog]);

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
    }),
  });

  const toggleSource = () => {
    if (sourceMode) {
      focusVisualRef.current = true;
      editor.commands.setContent(source);
      setSourceMode(false);

      const normalized = getInkySource(editor);

      if (normalized !== source) {
        onChangeRef.current({
          source: normalized,
          text: editor.getText(),
          html: htmlRef.current,
        });
      }
      return;
    }

    const current = getInkySource(editor);

    if (current !== source) {
      onChangeRef.current({
        source: current,
        text: editor.getText(),
        html: htmlRef.current,
      });
    }
    setSourceMode(true);
  };

  const changeSource = (value: string) => {
    onChangeRef.current({
      source: value,
      text: '',
      html: htmlRef.current,
    });
  };

  const openTableDialog = () => {
    tableReturnRef.current = true;
    setTableDialog(true);
  };

  const insertTable = (rows: number, columns: number) => {
    const container = {
      type: 'inkyContainer',
      content: Array.from({ length: rows }, () => ({
        type: 'inkyRow',
        content: Array.from({ length: columns }, () => ({
          type: 'inkyColumn',
          content: [{ type: 'paragraph' }],
        })),
      })),
    };
    const { selection } = editor.state;
    const { $from } = selection;

    // 已有表格时插到当前表格之后，避免把新表格塞进单元格
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);

      if (node.type.name === 'inkyContainer') {
        editor
          .chain()
          .focus()
          .insertContentAt($from.before(depth) + node.nodeSize, container)
          .run();
        setTableDialog(false);

        return;
      }
    }

    editor.chain().focus().insertContentAt(selection.to, container).run();
    setTableDialog(false);
  };

  return (
    <div className="compose-editor">
      <div className="compose-toolbar">
        {sourceMode ? null : (
          <>
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
              onClick={() => editor.chain().focus().toggleUnderline().run()}
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
            <span className="compose-toolbar-divider" aria-hidden />
            <Button
              variant="icon"
              onClick={openTableDialog}
              aria-label={t('compose.insertTable')}
              title={t('compose.insertTable')}
            >
              <RiTableLine size={20} aria-hidden />
            </Button>
            <Button
              variant="icon"
              onClick={openLinkDialog}
              aria-label={t('compose.insertLink')}
              title={t('compose.insertLink')}
            >
              <RiLink size={20} aria-hidden />
            </Button>
          </>
        )}
        <div className="compose-toolbar-end">
          {sourceMode ? null : toolbarEnd}
          <Button
            variant="icon"
            data-active={sourceMode}
            onClick={toggleSource}
            aria-label="Inky"
            title="Inky"
          >
            <RiCodeLine size={20} aria-hidden />
          </Button>
        </div>
      </div>
      <div className="inky-frame" ref={canvasRef} hidden={sourceMode}>
        {canvasRoot
          ? createPortal(<EditorContent editor={editor} />, canvasRoot)
          : null}
      </div>
      {sourceMode ? (
        <InkySourceEditor value={source} onChange={changeSource} />
      ) : null}
      {linkDialog ? (
        <LinkDialog
          initialText={linkDialog.text}
          initialUrl={linkDialog.url}
          onSubmit={insertLink}
          onDismiss={() => setLinkDialog(null)}
        />
      ) : null}
      {tableDialog ? (
        <TableDialog
          onSubmit={insertTable}
          onDismiss={() => setTableDialog(false)}
        />
      ) : null}
    </div>
  );
}

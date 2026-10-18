import {
  RiBold,
  RiItalic,
  RiStrikethrough,
  RiUnderline,
} from '@remixicon/react';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useRef } from 'react';

import { readAsDataUrl } from '../../format';

import './style.css';

import { Button } from '../button';

export interface EditorProps {
  html: string;
  onChange: (html: string, text: string) => void;
  onUploadImage?: (file: File, html: string) => Promise<string>;
  toolbarEnd?: ReactNode;
}

/**
 * 正文编辑器：TipTap 富文本，工具栏在正文上方。写信与模板共用。
 */
export function Editor({
  html,
  onChange,
  onUploadImage,
  toolbarEnd,
}: EditorProps) {
  const onChangeRef = useRef(onChange);
  const onUploadImageRef = useRef(onUploadImage);

  onChangeRef.current = onChange;
  onUploadImageRef.current = onUploadImage;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      // 允许 data URL：粘贴与导入的图片先本地预览，上传/保存后替换为应用地址
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: '正文' }),
    ],
    content: html,
    editorProps: {
      // 剪切板粘贴的图片：先本地预览，再上传替换成应用地址
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter(
          file => file.type.startsWith('image/'),
        );

        if (images.length === 0) {
          return false;
        }
        event.preventDefault();

        // 粘贴的图片逐张先插本地预览再上传；这里不阻塞 handlePaste，所以单独起一个异步任务
        const insertImages = async () => {
          for (const file of images) {
            const localUrl = await readAsDataUrl(file);

            editor.chain().focus().setImage({ src: localUrl }).run();

            // 光标移到图片之后，避免下一次输入替换掉图片
            editor
              .chain()
              .focus()
              .setTextSelection(editor.state.selection.to)
              .run();

            const upload = onUploadImageRef.current;

            if (!upload) {
              continue;
            }

            try {
              const src = await upload(file, editor.getHTML());
              const { state, view } = editor;

              state.doc.descendants((node, pos) => {
                if (node.type.name === 'image' && node.attrs.src === localUrl) {
                  view.dispatch(
                    state.tr.setNodeMarkup(pos, undefined, {
                      ...node.attrs,
                      src,
                    }),
                  );

                  return false;
                }
                return true;
              });
            } catch {
              // 上传失败提示由调用方写入状态，本地预览保留可手动删除
            }
          }
        };

        insertImages().catch(() => {});

        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(instance.getHTML(), instance.getText());
    },
  });

  // 外部内容变化（载入草稿）时同步进编辑器，输入产生的内容不重复设置
  useEffect(() => {
    if (html !== editor.getHTML()) {
      editor.commands.setContent(html);
    }
  }, [editor, html]);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      underline: instance.isActive('underline'),
      strike: instance.isActive('strike'),
    }),
  });

  return (
    <div className="compose-editor">
      <div className="compose-toolbar">
        <Button
          variant="icon"
          data-active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label="加粗"
          title="加粗"
        >
          <RiBold size={20} aria-hidden />
        </Button>
        <Button
          variant="icon"
          data-active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label="斜体"
          title="斜体"
        >
          <RiItalic size={20} aria-hidden />
        </Button>
        <Button
          variant="icon"
          data-active={state.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          aria-label="下划线"
          title="下划线"
        >
          <RiUnderline size={20} aria-hidden />
        </Button>
        <Button
          variant="icon"
          data-active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label="删除线"
          title="删除线"
        >
          <RiStrikethrough size={20} aria-hidden />
        </Button>
        {toolbarEnd}
      </div>
      <EditorContent className="compose-body" editor={editor} />
    </div>
  );
}

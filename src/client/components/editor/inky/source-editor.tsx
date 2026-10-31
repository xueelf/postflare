import {
  type CompletionSource,
  acceptCompletion,
  autocompletion,
  completionStatus,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  snippetCompletion,
} from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

import { CODE_MIRROR_THEME } from '../codemirror-theme';

import { INKY_TAGS } from './tags';

export interface InkySourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  selection?: number | null;
  readOnly?: boolean;
}

const VOID_TAGS = new Set(['image', 'video']);
const SHORT_TAGS = new Set(['spacer']);

function snippetFor(tag: string): string {
  if (VOID_TAGS.has(tag)) {
    return `${tag} src="\${1}" alt="\${2}" width="\${3}" />`;
  }

  if (SHORT_TAGS.has(tag)) {
    return `${tag} height="\${1}"></${tag}>`;
  }

  if (tag === 'divider') {
    return `${tag}></${tag}>`;
  }

  return `${tag}>\n  \${0}\n</${tag}>`;
}

const inkyTagCompletion: CompletionSource = context => {
  const word = context.matchBefore(/<[A-Za-z-]*/);

  if (!word) {
    return null;
  }

  if (word.from === word.to && !context.explicit) {
    return null;
  }

  return {
    from: word.from + 1,
    options: INKY_TAGS.map(tag =>
      snippetCompletion(snippetFor(tag), {
        label: tag,
        detail: 'Inky component',
        type: 'keyword',
      }),
    ),
  };
};

const inkyTabKeymap = Prec.high(
  keymap.of([
    {
      key: 'Tab',
      run: view => {
        if (
          completionStatus(view.state) === 'active' &&
          acceptCompletion(view)
        ) {
          return true;
        }

        if (hasNextSnippetField(view.state)) {
          nextSnippetField(view);

          return true;
        }

        return indentMore(view);
      },
      shift: view => {
        if (hasPrevSnippetField(view.state)) {
          prevSnippetField(view);

          return true;
        }

        return indentLess(view);
      },
    },
  ]),
);

export function InkySourceEditor({
  value,
  onChange,
  selection,
  readOnly = false,
}: InkySourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialSelectionRef = useRef(selection);
  const readOnlyCompartmentRef = useRef(new Compartment());

  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        selection: {
          anchor: Math.max(
            0,
            Math.min(initialSelectionRef.current ?? 0, value.length),
          ),
        },
        extensions: [
          basicSetup,
          inkyTabKeymap,
          html(),
          autocompletion({ override: [inkyTagCompletion] }),
          CODE_MIRROR_THEME,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          readOnlyCompartmentRef.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          EditorView.contentAttributes.of({ 'aria-label': 'Inky' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 编辑器只创建一次，外部值由下面的 effect 同步
  }, []);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }
    const current = view.state.doc.toString();

    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return <div className="inky-source" ref={hostRef} />;
}

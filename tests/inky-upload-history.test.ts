import { expect, test } from 'bun:test';

import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import { Schema } from '@tiptap/pm/model';
import { type Transaction, EditorState } from '@tiptap/pm/state';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    image: {
      group: 'block',
      atom: true,
      attrs: {
        src: {},
        uploading: { default: false },
      },
      toDOM: node => ['img', { src: node.attrs.src }],
    },
    text: { group: 'inline' },
  },
});

function apply(state: EditorState, transaction: Transaction): EditorState {
  return state.apply(transaction);
}

test('上传完成后的地址更新不单独占用撤销步，Redo 恢复 R2 地址', () => {
  let state = EditorState.create({ schema, plugins: [history()] });

  state = apply(
    state,
    state.tr.insert(
      0,
      schema.nodes.image.create({
        src: 'blob:local',
        uploading: true,
      }),
    ),
  );

  state = apply(
    state,
    state.tr
      .setNodeMarkup(0, undefined, {
        src: 'https://r2/remote',
        uploading: false,
      })
      .setMeta('addToHistory', false),
  );

  expect(state.doc.firstChild?.attrs.src).toBe('https://r2/remote');

  expect(
    undo(state, transaction => {
      state = state.apply(transaction);
    }),
  ).toBe(true);
  expect(state.doc.firstChild?.type.name).toBe('paragraph');

  expect(
    redo(state, transaction => {
      state = state.apply(transaction);
    }),
  ).toBe(true);
  expect(state.doc.firstChild?.type.name).toBe('image');
  expect(state.doc.firstChild?.attrs.src).toBe('https://r2/remote');
  expect(state.doc.firstChild?.attrs.uploading).toBe(false);
});

test('普通属性更新会单独占用撤销步，所以上传地址更新必须排除历史', () => {
  let state = EditorState.create({ schema, plugins: [history()] });

  state = apply(
    state,
    state.tr.insert(
      0,
      schema.nodes.image.create({ src: 'blob:local', uploading: true }),
    ),
  );
  state = apply(state, closeHistory(state.tr));

  state = apply(
    state,
    state.tr.setNodeMarkup(0, undefined, {
      src: 'https://r2/remote',
      uploading: false,
    }),
  );

  undo(state, transaction => {
    state = state.apply(transaction);
  });

  expect(state.doc.firstChild?.type.name).toBe('image');
  expect(state.doc.firstChild?.attrs.src).toBe('blob:local');
});

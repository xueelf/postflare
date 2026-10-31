import { EditorView } from '@codemirror/view';

// 跟随主题变量，避免 CodeMirror 自带白底在暗色模式下突兀
export const CODE_MIRROR_THEME = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
  },
  '.cm-content': {
    padding: 'var(--compose-line-padding, 12px) 0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--faint)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--line)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text)',
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 36px 10px 12px',
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  '.cm-panels-bottom .cm-panel.cm-search': {
    borderTop: '1px solid var(--line)',
  },
  '.cm-panels-top .cm-panel.cm-search': {
    borderBottom: '1px solid var(--line)',
  },
  '.cm-panel.cm-search br': {
    display: 'none',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    margin: 0,
    padding: '5px 9px',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    font: 'inherit',
    lineHeight: '1.4',
  },
  '.cm-panel.cm-search input[type=text]': {
    flex: '1 1 180px',
    minWidth: '140px',
  },
  '.cm-panel.cm-search button': {
    flex: '0 0 auto',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search input:focus, .cm-panel.cm-search button:hover': {
    borderColor: 'var(--accent)',
    outline: 'none',
  },
  '.cm-panel.cm-search input[type=checkbox]': {
    margin: 0,
    padding: 0,
    border: 0,
    backgroundColor: 'transparent',
    accentColor: 'var(--accent)',
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: 0,
    color: 'var(--faint)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  '.cm-panel.cm-search [name=close]': {
    top: '8px',
    right: '8px',
    padding: '2px 6px',
    border: 0,
    backgroundColor: 'transparent',
    color: 'var(--faint)',
    fontSize: '16px',
    lineHeight: '1',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    color: 'var(--text)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  },
});

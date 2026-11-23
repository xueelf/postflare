import frameworkCss from './framework.css.txt';
import wasmUrl from './inky_bg.wasm' with { type: 'file' };
import init, { to_plain_text, transform_inline } from './inky.js';

export interface InkyCompileResult {
  html: string;
  text: string;
}

export const inkyFrameworkCss = frameworkCss;

let ready: Promise<unknown> | null = null;

function findTagOutsideComments(
  source: string,
  pattern: RegExp,
): { index: number; length: number } | null {
  let index = 0;

  while (index < source.length) {
    const commentStart = source.indexOf('<!--', index);
    const slice =
      commentStart === -1
        ? source.slice(index)
        : source.slice(index, commentStart);
    const match = pattern.exec(slice);

    if (match) {
      return { index: index + match.index, length: match[0].length };
    }

    if (commentStart === -1) {
      break;
    }
    const commentEnd = source.indexOf('-->', commentStart + 4);

    if (commentEnd === -1) {
      break;
    }
    index = commentEnd + 3;
  }

  return null;
}

/**
 * 将框架样式注入源码。完整文档放入 head 开头，避免插在 doctype 前破坏 html 和 body 属性。
 * 片段源码继续前置样式块。
 */
export function injectFrameworkCss(source: string): string {
  const styleTag = `<style>${frameworkCss}</style>`;
  const head = findTagOutsideComments(source, /<head(?:\s[^>]*)?>/i);

  if (head) {
    const position = head.index + head.length;

    return `${source.slice(0, position)}${styleTag}${source.slice(position)}`;
  }

  const html = findTagOutsideComments(source, /<html(?:\s[^>]*)?>/i);

  if (html) {
    const position = html.index + html.length;

    return `${source.slice(0, position)}<head>${styleTag}</head>${source.slice(position)}`;
  }

  const doctype = findTagOutsideComments(source, /<!doctype(?:\s[^>]*)?>/i);

  if (doctype) {
    const position = doctype.index + doctype.length;

    return `${source.slice(0, position)}${styleTag}${source.slice(position)}`;
  }

  return `${styleTag}${source}`;
}

/**
 * 浏览器端 Inky 编译入口。
 *
 * TODO: Inky 官方发布浏览器版 npm 包后，移除本地 pkg 和 framework.css，
 * 改为从 npm 依赖加载，并删除这里的 WASM 初始化。
 */
export async function compileInky(source: string): Promise<InkyCompileResult> {
  await (ready ??= init({ module_or_path: wasmUrl as unknown as string }));

  const html = transform_inline(injectFrameworkCss(source));

  return { html, text: to_plain_text(html) };
}

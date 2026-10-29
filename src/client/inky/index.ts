import frameworkCss from './framework.css.txt';
import wasmUrl from './inky_bg.wasm' with { type: 'file' };
import init, { to_plain_text, transform_inline } from './inky.js';

export interface InkyCompileResult {
  html: string;
  text: string;
}

export const inkyFrameworkCss = frameworkCss;

let ready: Promise<unknown> | null = null;

/**
 * Inky 2.0.0-beta.10 的 callout 把圆角和边框放在内层 th 上，外层 table 仍是
 * border-collapse: collapse，浏览器会把边框画成直角。统一改成 separate，
 * 让 callout 的圆角在所有模板中生效。
 */
function normalizeCallout(html: string): string {
  if (!/<table[^>]*class="[^"]*\bcallout\b/.test(html)) {
    return html;
  }
  const document = new DOMParser().parseFromString(html, 'text/html');

  for (const table of document.querySelectorAll<HTMLTableElement>(
    'table.callout',
  )) {
    table.style.setProperty('border-collapse', 'separate');
    table.style.setProperty('border-spacing', '0');
  }
  return document.documentElement.outerHTML;
}

/**
 * 浏览器端 Inky 编译入口。
 *
 * TODO: Inky 官方发布浏览器版 npm 包后，移除本地 pkg 和 framework.css，
 * 改为从 npm 依赖加载，并删除这里的 WASM 初始化。
 */
export async function compileInky(source: string): Promise<InkyCompileResult> {
  await (ready ??= init({ module_or_path: wasmUrl as unknown as string }));

  const html = normalizeCallout(
    transform_inline(`<style>${frameworkCss}</style>${source}`),
  );

  return { html, text: to_plain_text(html) };
}

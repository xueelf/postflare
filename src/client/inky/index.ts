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
 * 浏览器端 Inky 编译入口。
 *
 * TODO: Inky 官方发布浏览器版 npm 包后，移除本地 pkg 和 framework.css，
 * 改为从 npm 依赖加载，并删除这里的 WASM 初始化。
 */
export async function compileInky(source: string): Promise<InkyCompileResult> {
  await (ready ??= init({ module_or_path: wasmUrl as unknown as string }));

  const html = transform_inline(`<style>${frameworkCss}</style>${source}`);

  return { html, text: to_plain_text(html) };
}

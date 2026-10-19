import type { Locale } from '#/locales';

/**
 * 共享工具：显示格式化、内容转换与文件读取。
 */

/** 服务端时间（UTC 的 'YYYY-MM-DD HH:MM:SS'）转 Date */
function parseServerDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export function formatDate(value: string, locale: Locale): string {
  return parseServerDate(value).toLocaleString(locale);
}

export function formatListDate(value: string, locale: Locale): string {
  const date = parseServerDate(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return formatTime(date, locale);
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, {
      month: '2-digit',
      day: '2-digit',
    });
  }
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatTime(date: Date, locale: Locale): string {
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 把邮件时间转成 <time> 可用的 dateTime 值。
 */
export function dateTimeValue(value: string): string {
  return parseServerDate(value).toISOString();
}

/**
 * Date 转 datetime-local 输入框的本地时间值（'YYYY-MM-DDTHH:mm'）。
 */
export function dateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}

/**
 * 纯文本转成编辑器 HTML（兼容以纯文本保存的草稿与模板）。
 */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      paragraph =>
        `<p>${paragraph
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('\n', '<br>')}</p>`,
    )
    .join('');
}

/**
 * 模板正文：已是 HTML 的原样返回，纯文本保存的转成 HTML。
 */
export function templateHtml(body: string): string {
  return /<[a-z][\s\S]*>/i.test(body) ? body : textToHtml(body);
}

/**
 * 邮件正文 iframe 包装：在 head 起始处注入基础样式。
 * iframe 固定白底，链接颜色固定取浅色分支的 --accent-text（#2459c9）而不跟随应用主题，
 * 深色主题的浅蓝在白底上对比度不足。
 */
export function emailHtml(body: string): string {
  const style = '<style>a{color:#2459c9}a:visited{color:#2459c9}</style>';
  const head = body.match(/<head[^>]*>/i);

  return head ? body.replace(head[0], head[0] + style) : style + body;
}

/**
 * HTML 转纯文本（列表行摘要）。
 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 账号显示名：无名称时回退邮箱。
 */
export function displayName(user: { name: string; email: string }): string {
  return user.name.trim() || user.email;
}

/**
 * 文件或 Blob 转 data URL（图片本地预览）。
 */
export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('failed to read the file'));
    reader.readAsDataURL(blob);
  });
}

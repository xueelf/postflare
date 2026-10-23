import DOMPurify from 'dompurify';

const BASE_STYLE = `
html { color-scheme: light; }
a, a:visited { color: #2459c9; }
`;

const REMOTE_URL_RE = /^(?:https?:)?\/\//i;
const CSS_REMOTE_RE =
  /(?:url\(\s*['"]?|@import\s+(?:url\(\s*)?['"]?)(?:https?:)?\/\//i;

const FORBIDDEN_TAGS = [
  'base',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'option',
  'select',
  'textarea',
  'title',
  'button',
  'embed',
];

export interface EmailDocument {
  html: string;
  hasRemoteContent: boolean;
}

function contentSecurityPolicy(allowRemote: boolean): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    allowRemote
      ? 'img-src * data: blob: cid:'
      : "img-src 'self' data: blob: cid:",
    allowRemote
      ? "style-src 'unsafe-inline' http: https:"
      : "style-src 'unsafe-inline'",
    allowRemote ? 'font-src * data:' : "font-src 'self' data:",
    allowRemote ? 'media-src * data:' : "media-src 'self' data:",
  ].join('; ');
}

function sanitize(html: string): Document {
  const root = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ['ping'],
  }) as unknown as HTMLElement;
  const doc = root.ownerDocument;

  if (!doc) {
    throw new Error('email document unavailable');
  }
  return doc;
}

function isRemoteUrl(value: string | null): boolean {
  return value !== null && REMOTE_URL_RE.test(value.trim());
}

/**
 * 只在正文真的引用了远程资源时提示，避免每封 HTML 邮件都出现入口。
 */
function detectRemoteContent(doc: Document): boolean {
  for (const element of doc.querySelectorAll(
    '[src], [srcset], [poster], [background]',
  )) {
    if (
      isRemoteUrl(element.getAttribute('src')) ||
      isRemoteUrl(element.getAttribute('poster')) ||
      isRemoteUrl(element.getAttribute('background'))
    ) {
      return true;
    }

    const srcset = element.getAttribute('srcset');

    if (
      srcset?.split(',').some(candidate => {
        const url = candidate.trim().split(/\s+/)[0] ?? '';

        return isRemoteUrl(url);
      })
    ) {
      return true;
    }
  }

  for (const element of doc.querySelectorAll('[style]')) {
    if (CSS_REMOTE_RE.test(element.getAttribute('style') ?? '')) {
      return true;
    }
  }

  for (const element of doc.querySelectorAll('style')) {
    if (CSS_REMOTE_RE.test(element.textContent ?? '')) {
      return true;
    }
  }

  return false;
}

/**
 * 把来信 HTML 包成完整文档，注入 CSP、基础样式和外链策略。
 */
export function buildEmailDocument(
  html: string,
  allowRemote: boolean,
): EmailDocument {
  const doc = sanitize(html);
  const head = doc.head ?? doc.documentElement;

  doc.querySelectorAll('a[href], area[href]').forEach(node => {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  });

  // 与 Zero 一致：删除 1x1 和 0x0 追踪像素，避免允许远程内容后回传已读
  doc
    .querySelectorAll('img[width="1"][height="1"], img[width="0"][height="0"]')
    .forEach(node => node.remove());

  const hasRemoteContent = detectRemoteContent(doc);

  const csp = doc.createElement('meta');

  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', contentSecurityPolicy(allowRemote));
  head.insertBefore(csp, head.firstChild);

  const referrer = doc.createElement('meta');

  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  head.insertBefore(referrer, csp.nextSibling);

  const style = doc.createElement('style');

  style.textContent = BASE_STYLE;
  head.insertBefore(style, referrer.nextSibling);

  return {
    html: `<!doctype html>${doc.documentElement.outerHTML}`,
    hasRemoteContent,
  };
}

import { notFound } from './http';

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

// 正文里引用内联图片的应用地址
export const ATTACHMENT_URL_RE = /\/api\/attachments\/([\w-]+)/g;

export function extractAttachmentIds(html: string): string[] {
  const ids = new Set<string>();

  for (const match of html.matchAll(ATTACHMENT_URL_RE)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

export interface CidAttachment {
  id: string;
  content_id: string | null;
}

/** 去掉 Content-ID 头可能带上的尖括号 */
export function normalizeContentId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().replace(/^</, '').replace(/>$/, '').trim();

  return trimmed || null;
}

const CID_ATTR_RE = /(\s(?:src|background|href)\s*=\s*)(["'])cid:([^"']+)\2/gi;
const CID_UNQUOTED_ATTR_RE =
  /(\s(?:src|background|href)\s*=\s*)cid:([^\s"'>]+)/gi;
const CID_URL_RE = /url\(\s*(["']?)cid:([^"')]+)\1\s*\)/gi;

/**
 * 把正文里的 cid: 引用换成附件地址，收件后内联图片才能显示。
 */
export function replaceCidImages(
  html: string,
  attachments: CidAttachment[],
): string {
  if (!html || attachments.length === 0) {
    return html;
  }

  const byContentId = new Map<string, string>();

  for (const attachment of attachments) {
    const contentId = normalizeContentId(attachment.content_id);

    if (contentId) {
      byContentId.set(contentId, attachment.id);
    }
  }

  if (byContentId.size === 0) {
    return html;
  }

  const resolve = (raw: string): string => {
    let contentId = raw;

    try {
      contentId = decodeURIComponent(raw);
    } catch {
      // 保留原值，按未编码的 cid 匹配
    }

    const id = byContentId.get(normalizeContentId(contentId) ?? '');

    return id ? `/api/attachments/${id}` : `cid:${raw}`;
  };

  return html
    .replace(
      CID_ATTR_RE,
      (_match, prefix: string, quote: string, contentId: string) =>
        `${prefix}${quote}${resolve(contentId)}${quote}`,
    )
    .replace(
      CID_UNQUOTED_ATTR_RE,
      (_match, prefix: string, contentId: string) =>
        `${prefix}${resolve(contentId)}`,
    )
    .replace(
      CID_URL_RE,
      (_match, quote: string, contentId: string) =>
        `url(${quote}${resolve(contentId)}${quote})`,
    );
}

export async function getAttachment(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const attachment = await env.DB.prepare(
    `SELECT a.filename, a.content_type, a.storage_key
     FROM attachments a
     WHERE a.id = ?
       AND (
         EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id AND m.user_id = ?)
         OR EXISTS (SELECT 1 FROM templates t WHERE t.id = a.template_id AND t.user_id = ?)
       )`,
  )
    .bind(id, userId, userId)
    .first<{ filename: string; content_type: string; storage_key: string }>();

  if (!attachment) {
    return notFound();
  }

  const object = await env.ATTACHMENTS.get(attachment.storage_key);

  if (!object) {
    return notFound();
  }

  // 同 inbound，workers-types 与 DOM 库声明的 ReadableStream 类型不同，运行时一致
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'Content-Type': attachment.content_type,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    },
  });
}

import PostalMime from 'postal-mime';

import { INBOUND_MAX_BYTES } from '#/limits';

import type { AuthUser } from './auth';
import { badRequest } from './http';
import { sqlDate, storeMessage } from './mail-store';

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * 把 .eml 文件导入邮箱。发件人是当前账号时进入已发送，否则进入收件箱。
 * 导入的是普通邮件，不生成 Inky 源码。
 */
export async function importMessages(
  env: Env,
  user: AuthUser,
  request: Request,
): Promise<Response> {
  const form = await request.formData().catch(() => null);

  if (!form) {
    return badRequest('invalid form data');
  }
  const files = form
    .getAll('files')
    .filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return badRequest('no eml files');
  }
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.eml')) {
      result.failed += 1;
      result.errors.push({ file: file.name, error: 'unsupported file' });

      continue;
    }

    if (file.size > INBOUND_MAX_BYTES) {
      result.failed += 1;
      result.errors.push({ file: file.name, error: 'file too large' });

      continue;
    }

    let raw: ArrayBuffer;
    let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;

    try {
      raw = await file.arrayBuffer();
      parsed = await PostalMime.parse(raw);
    } catch {
      result.failed += 1;
      result.errors.push({ file: file.name, error: 'invalid message' });

      continue;
    }

    try {
      const from = parsed.from?.address ?? '';
      const sent = from.toLowerCase() === user.email.toLowerCase();
      const direction = sent ? 'outbound' : 'inbound';
      const mailbox = sent ? 'sent' : 'inbox';
      const to =
        parsed.to
          ?.map(address => address.address)
          .filter((address): address is string => Boolean(address))
          .join(', ') || (sent ? '' : user.email);

      const id = await storeMessage({
        env,
        userId: user.id,
        mailbox,
        direction,
        seen: 1,
        from,
        fromName: (parsed.from?.name ?? '').trim(),
        to,
        subject: parsed.subject ?? '',
        parsed,
        raw,
        createdAt: sqlDate(parsed.date),
      });

      if (id) {
        result.imported += 1;
      } else {
        result.skipped += 1;
      }
    } catch {
      result.failed += 1;
      result.errors.push({ file: file.name, error: 'storage failure' });
    }
  }

  return Response.json(result);
}

import { apiFetch } from '#/client/api';

export type AttachmentOwner = { messageId: string } | { templateId: string };

export interface AttachmentSnapshot {
  text: string;
  html: string;
  subject: string;
}

export class AttachmentUploadError extends Error {
  readonly tooLarge: boolean;

  constructor(message: string, tooLarge: boolean) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.tooLarge = tooLarge;
  }
}

export async function uploadAttachment(
  file: File,
  owner: AttachmentOwner,
  snapshot: AttachmentSnapshot,
  sourceIds: string[] = [],
): Promise<string> {
  const form = new FormData();

  form.append('file', file);
  form.append('text', snapshot.text);
  form.append('html', snapshot.html);
  form.append('subject', snapshot.subject);

  if ('messageId' in owner) {
    form.append('messageId', owner.messageId);
  } else {
    form.append('templateId', owner.templateId);
  }

  if (sourceIds.length > 0) {
    form.append('sourceIds', JSON.stringify(sourceIds));
  }

  let response: Response;

  try {
    response = await apiFetch('/api/attachments', {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new AttachmentUploadError('upload failed', false);
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    throw new AttachmentUploadError(
      data.error ?? 'upload failed',
      data.error === 'message too large',
    );
  }

  const data = (await response.json()) as { id: string };

  return `/api/attachments/${data.id}`;
}

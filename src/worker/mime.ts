import { createMimeMessage } from 'mimetext/browser';

export type MimeAttachment =
  | {
      disposition: 'inline';
      contentId: string;
      filename: string;
      type: string;
      content: ArrayBuffer;
    }
  | {
      disposition: 'attachment';
      contentId?: undefined;
      filename: string;
      type: string;
      content: ArrayBuffer;
    };

export type MimeAttachmentSize =
  | {
      disposition: 'inline';
      contentId: string;
      filename: string;
      type: string;
      sizeBytes: number;
    }
  | {
      disposition: 'attachment';
      contentId?: undefined;
      filename: string;
      type: string;
      sizeBytes: number;
    };

export interface RawMessage {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: MimeAttachment[];
  messageId?: string;
}

export interface RawMessageSizeInput {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: MimeAttachmentSize[];
  messageId?: string;
}

function wrapBase64(value: string): string {
  return value.replace(/.{76}(?=.)/g, '$&\r\n');
}

/**
 * 计算二进制内容按 76 字符折行后的 Base64 字节数，与 bytesToBase64 输出长度完全一致。
 */
export function wrappedBase64Bytes(byteLength: number): number {
  if (byteLength <= 0) {
    return 0;
  }
  const base64Length = Math.ceil(byteLength / 3) * 4;
  const lines = Math.ceil(base64Length / 76);

  return base64Length + (lines - 1) * 2;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  let binary = '';

  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return wrapBase64(btoa(binary));
}

const MAX_ENCODED_WORD_BYTES = 45;
const MAX_HEADER_LINE_LENGTH = 76;

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function splitUtf8(text: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];

  let current = '';
  let bytes = 0;

  for (const char of text) {
    const size = encoder.encode(char).length;

    if (current && bytes + size > MAX_ENCODED_WORD_BYTES) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function encodeHeaderWord(charset: string, text: string): string {
  const encoder = new TextEncoder();

  return splitUtf8(text)
    .map(chunk => `=?${charset}?B?${base64FromBytes(encoder.encode(chunk))}?=`)
    .join(' ');
}

/**
 * 按 RFC 5322 折叠超长邮件头。B 编码的 encoded-word 先解码到原文，
 * 按完整 UTF-8 字符和字节预算重新编码，再按空白折叠。
 */
function foldHeaderLine(line: string): string[] {
  const match = /^([^:]+):\s*(.*)$/.exec(line);

  if (!match) {
    return [line];
  }
  const [, name, rawValue = ''] = match;
  const value = rawValue.replace(
    /=\?([^?]+)\?B\?([^?]*)\?=/g,
    (encoded, charset: string, data: string) => {
      if (charset.toLowerCase() !== 'utf-8') {
        return encoded;
      }

      try {
        const binary = atob(data);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

        return encodeHeaderWord(charset, text);
      } catch {
        return encoded;
      }
    },
  );
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  let current = `${name}:`;

  for (const word of words) {
    if (current.length + 1 + word.length <= MAX_HEADER_LINE_LENGTH) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = ` ${word}`;
    }
  }
  lines.push(current);

  return lines;
}

function foldHeaders(raw: string): string {
  const split = raw.indexOf('\r\n\r\n');

  if (split < 0) {
    return raw;
  }
  const headers = raw.slice(0, split).split('\r\n').flatMap(foldHeaderLine);

  return `${headers.join('\r\n')}${raw.slice(split)}`;
}

function encodeBody(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value).buffer);
}

/**
 * 构造归档副本。实际投递走 Cloudflare 结构化 API，归档使用这份 MIME，
 * 两者共享正文、附件和收件人数据。附件与内联图片只在 cid 模式下出现，
 * 导出的 EML 可以独立于本应用打开。
 */
export function buildRawMessage(message: RawMessage): string {
  const mime = createMimeMessage();

  mime.setSender(
    message.fromName
      ? { name: message.fromName, addr: message.from }
      : message.from,
  );

  mime.setTo(
    message.to
      .split(',')
      .map(recipient => recipient.trim())
      .filter(Boolean),
  );
  mime.setSubject(message.subject);

  if (message.messageId) {
    mime.setHeader('Message-ID', message.messageId);
  }

  mime.addMessage({
    contentType: 'text/plain',
    data: encodeBody(message.text),
    encoding: 'base64',
  });

  mime.addMessage({
    contentType: 'text/html',
    data: encodeBody(message.html),
    encoding: 'base64',
  });

  for (const attachment of message.attachments) {
    mime.addAttachment({
      filename: attachment.filename,
      contentType: attachment.type,
      data: bytesToBase64(attachment.content),
      inline: attachment.disposition === 'inline',
      headers: attachment.contentId
        ? { 'Content-ID': attachment.contentId }
        : {},
    });
  }

  return foldHeaders(mime.asRaw());
}

/**
 * 按 D1 已存的附件字节数计算最终 MIME 大小，不重读 R2 历史附件对象。
 */
export function estimateRawMessageBytes(message: RawMessageSizeInput): number {
  const placeholder = 'QQ==';
  const mime = createMimeMessage();

  mime.setSender(
    message.fromName
      ? { name: message.fromName, addr: message.from }
      : message.from,
  );

  mime.setTo(
    message.to
      .split(',')
      .map(recipient => recipient.trim())
      .filter(Boolean),
  );
  mime.setSubject(message.subject);

  if (message.messageId) {
    mime.setHeader('Message-ID', message.messageId);
  }

  mime.addMessage({
    contentType: 'text/plain',
    data: encodeBody(message.text),
    encoding: 'base64',
  });

  mime.addMessage({
    contentType: 'text/html',
    data: encodeBody(message.html),
    encoding: 'base64',
  });

  let extraBytes = 0;

  for (const attachment of message.attachments) {
    mime.addAttachment({
      filename: attachment.filename,
      contentType: attachment.type,
      data: placeholder,
      inline: attachment.disposition === 'inline',
      headers: attachment.contentId
        ? { 'Content-ID': attachment.contentId }
        : {},
    });
    extraBytes += wrappedBase64Bytes(attachment.sizeBytes) - placeholder.length;
  }

  return (
    new TextEncoder().encode(foldHeaders(mime.asRaw())).length + extraBytes
  );
}

const ATTACHMENT_PATH_RE = /^\/api\/attachments\/([\w-]+)$/;
const ATTACHMENT_ATTRIBUTES = new Set(['src', 'background', 'href', 'poster']);

export interface ResourceRef {
  url: string;
  urlStart: number;
  urlEnd: number;
}

export interface CollectResourceOptions {
  /** 阅读器检测远程资源时排除普通链接的 href */
  includeHref?: boolean;
}

interface DecodedValue {
  value: string;
  rawStart: number[];
  rawEnd: number[];
}

interface Range {
  start: number;
  end: number;
}

type RangeMapper = (start: number, end: number) => Range;

// 常见 HTML 属性实体，覆盖 URL、引号和空白。数字实体单独解析
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  ast: '*',
  bsol: '\\',
  colon: ':',
  comma: ',',
  commat: '@',
  dollar: '$',
  equals: '=',
  excl: '!',
  gt: '>',
  hyphen: '-',
  lcub: '{',
  lowbar: '_',
  lpar: '(',
  lsqb: '[',
  lt: '<',
  nbsp: '\u00a0',
  NewLine: '\n',
  num: '#',
  percnt: '%',
  period: '.',
  plus: '+',
  quest: '?',
  quot: '"',
  rcub: '}',
  rpar: ')',
  rsqb: ']',
  semi: ';',
  sol: '/',
  Tab: '\t',
  tilde: '~',
  vert: '|',
};

const IDENTITY_RANGE: RangeMapper = (start, end) => ({ start, end });

function isWhitespace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  );
}

function isTagNameEnd(char: string): boolean {
  return isWhitespace(char) || char === '/' || char === '>';
}

function isAttributeNameEnd(char: string): boolean {
  return isTagNameEnd(char) || char === '=';
}

function readCharacterReference(
  value: string,
  start: number,
  end: number,
): { value: string; end: number } | null {
  const source = value.slice(start, end);
  const numeric = /^&#(?:[xX]([0-9A-Fa-f]+)|([0-9]+));?/.exec(source);

  if (numeric) {
    const code = numeric[1]
      ? Number.parseInt(numeric[1], 16)
      : Number.parseInt(numeric[2] ?? '', 10);

    if (
      !Number.isFinite(code) ||
      code === 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return null;
    }

    return {
      value: String.fromCodePoint(code),
      end: start + numeric[0].length,
    };
  }

  const named = /^&([A-Za-z][A-Za-z0-9]+);/.exec(source);

  if (!named) {
    return null;
  }
  const decoded = NAMED_ENTITIES[named[1] ?? ''];

  if (decoded === undefined) {
    return null;
  }

  return {
    value: decoded,
    end: start + named[0].length,
  };
}

/**
 * 按 HTML 属性语义解码实体，并保留每个解码字符对应的原始区间。
 */
function decodeAttribute(
  value: string,
  start: number,
  end: number,
): DecodedValue {
  const chars: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];

  let index = start;

  while (index < end) {
    const char = value.charAt(index);

    if (char !== '&') {
      chars.push(char);
      rawStart.push(index);
      rawEnd.push(index + 1);
      index += 1;

      continue;
    }

    const reference = readCharacterReference(value, index, end);

    if (!reference) {
      chars.push(char);
      rawStart.push(index);
      rawEnd.push(index + 1);
      index += 1;

      continue;
    }

    for (let offset = 0; offset < reference.value.length; offset += 1) {
      chars.push(reference.value.charAt(offset));
      rawStart.push(index);
      rawEnd.push(reference.end);
    }
    index = reference.end;
  }

  return { value: chars.join(''), rawStart, rawEnd };
}

function attributeRangeMapper(
  decoded: DecodedValue,
  fallbackStart: number,
  fallbackEnd: number,
): RangeMapper {
  return (start, end) => ({
    start: decoded.rawStart[start] ?? fallbackStart,
    end: decoded.rawEnd[end - 1] ?? fallbackEnd,
  });
}

function readCssEscape(
  value: string,
  start: number,
  end: number,
): { value: string; end: number } | null {
  let cursor = start + 1;

  if (cursor >= end) {
    return null;
  }

  const char = value.charAt(cursor);

  if (char === '\n' || char === '\f') {
    return { value: '', end: cursor + 1 };
  }

  if (char === '\r') {
    cursor += 1;

    if (value.charAt(cursor) === '\n') {
      cursor += 1;
    }

    return { value: '', end: cursor };
  }

  if (/[0-9A-Fa-f]/.test(char)) {
    let hex = '';

    while (
      cursor < end &&
      hex.length < 6 &&
      /[0-9A-Fa-f]/.test(value.charAt(cursor))
    ) {
      hex += value.charAt(cursor);
      cursor += 1;
    }

    if (cursor < end && isWhitespace(value.charAt(cursor))) {
      if (value.charAt(cursor) === '\r' && value.charAt(cursor + 1) === '\n') {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }

    const code = Number.parseInt(hex, 16);
    const decoded =
      code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(code);

    return { value: decoded, end: cursor };
  }

  const code = value.codePointAt(cursor) ?? 0;
  const charEnd = cursor + (code > 0xffff ? 2 : 1);

  return { value: value.slice(cursor, charEnd), end: charEnd };
}

/**
 * 按 CSS URL 语义解码转义，并保留每个解码字符对应的原始区间。
 */
function decodeCssEscapes(
  value: string,
  start: number,
  end: number,
): DecodedValue {
  const chars: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];

  let index = start;

  while (index < end) {
    const char = value.charAt(index);

    if (char !== '\\') {
      chars.push(char);
      rawStart.push(index);
      rawEnd.push(index + 1);
      index += 1;

      continue;
    }

    const escape = readCssEscape(value, index, end);

    if (!escape) {
      chars.push(char);
      rawStart.push(index);
      rawEnd.push(index + 1);
      index += 1;

      continue;
    }

    for (let offset = 0; offset < escape.value.length; offset += 1) {
      chars.push(escape.value.charAt(offset));
      rawStart.push(index);
      rawEnd.push(escape.end);
    }
    index = escape.end;
  }

  return { value: chars.join(''), rawStart, rawEnd };
}

function addResourceRef(
  value: string,
  start: number,
  end: number,
  refs: ResourceRef[],
  mapRange: RangeMapper,
): void {
  let urlStart = start;
  let urlEnd = end;

  while (urlStart < urlEnd && isWhitespace(value.charAt(urlStart))) {
    urlStart += 1;
  }

  while (urlEnd > urlStart && isWhitespace(value.charAt(urlEnd - 1))) {
    urlEnd -= 1;
  }

  if (urlStart >= urlEnd) {
    return;
  }
  const raw = mapRange(urlStart, urlEnd);

  refs.push({
    url: value.slice(urlStart, urlEnd),
    urlStart: raw.start,
    urlEnd: raw.end,
  });
}

function skipCssString(value: string, start: number, end: number): number {
  const quote = value.charAt(start);

  let index = start + 1;

  while (index < end) {
    const char = value.charAt(index);

    if (char === '\\') {
      const escape = readCssEscape(value, index, end);

      index = escape ? escape.end : index + 1;

      continue;
    }

    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }

  return end;
}

function isUrlFunction(value: string, index: number, end: number): boolean {
  const previous = value.charAt(index - 1);

  if (previous && /[A-Za-z0-9_-]/.test(previous)) {
    return false;
  }

  return (
    index + 3 < end &&
    value.charAt(index).toLowerCase() === 'u' &&
    value.charAt(index + 1).toLowerCase() === 'r' &&
    value.charAt(index + 2).toLowerCase() === 'l' &&
    value.charAt(index + 3) === '('
  );
}

/**
 * 按 srcset 候选列表解析 URL，保留描述符和原始区间。
 * URL 可以包含逗号（例如 data URL），不能直接按逗号切开。
 */
function parseSrcset(
  value: string,
  refs: ResourceRef[],
  mapRange: RangeMapper,
): void {
  let index = 0;

  while (index < value.length) {
    while (
      index < value.length &&
      (isWhitespace(value.charAt(index)) || value.charAt(index) === ',')
    ) {
      index += 1;
    }

    if (index >= value.length) {
      break;
    }
    const urlStart = index;

    while (index < value.length && !isWhitespace(value.charAt(index))) {
      index += 1;
    }

    let urlEnd = index;

    while (urlEnd > urlStart && value.charAt(urlEnd - 1) === ',') {
      urlEnd -= 1;
    }

    if (urlEnd > urlStart) {
      addResourceRef(value, urlStart, urlEnd, refs, mapRange);
    }

    if (urlEnd !== index) {
      continue;
    }

    while (index < value.length && isWhitespace(value.charAt(index))) {
      index += 1;
    }

    while (index < value.length && value.charAt(index) !== ',') {
      index += 1;
    }
  }
}

function parseCss(
  value: string,
  start: number,
  end: number,
  refs: ResourceRef[],
  mapRange: RangeMapper,
): void {
  let index = start;

  while (index < end) {
    const char = value.charAt(index);

    if (char === '/' && value.charAt(index + 1) === '*') {
      const close = value.indexOf('*/', index + 2);

      index = close === -1 || close + 2 > end ? end : close + 2;

      continue;
    }

    if (char === '"' || char === "'") {
      index = skipCssString(value, index, end);

      continue;
    }

    if (
      value.slice(index, index + 7).toLowerCase() === '@import' &&
      (index === 0 || !/[A-Za-z0-9_-]/.test(value.charAt(index - 1)))
    ) {
      let cursor = index + 7;

      while (cursor < end && isWhitespace(value.charAt(cursor))) {
        cursor += 1;
      }

      const quote = value.charAt(cursor);

      if (quote === '"' || quote === "'") {
        const contentStart = cursor + 1;

        let contentEnd = contentStart;
        let closed = false;

        cursor = contentStart;

        while (cursor < end) {
          const inner = value.charAt(cursor);

          if (inner === '\\') {
            const escape = readCssEscape(value, cursor, end);

            cursor = escape ? escape.end : cursor + 1;

            continue;
          }

          if (inner === quote) {
            contentEnd = cursor;
            closed = true;
            cursor += 1;

            break;
          }
          cursor += 1;
        }

        if (!closed) {
          contentEnd = end;
        }

        const decoded = decodeCssEscapes(value, contentStart, contentEnd);

        addResourceRef(
          decoded.value,
          0,
          decoded.value.length,
          refs,
          (refStart, refEnd) => {
            const attrStart = decoded.rawStart[refStart] ?? contentStart;
            const attrEnd = decoded.rawEnd[refEnd - 1] ?? contentEnd;

            return mapRange(attrStart, attrEnd);
          },
        );

        index = cursor;

        continue;
      }

      index = cursor;

      continue;
    }

    if (isUrlFunction(value, index, end)) {
      let cursor = index + 4;

      while (cursor < end && isWhitespace(value.charAt(cursor))) {
        cursor += 1;
      }

      const quote = value.charAt(cursor);

      let contentStart = cursor;
      let contentEnd = cursor;
      let closed = false;

      if (quote === '"' || quote === "'") {
        cursor += 1;
        contentStart = cursor;

        while (cursor < end) {
          const inner = value.charAt(cursor);

          if (inner === '\\') {
            const escape = readCssEscape(value, cursor, end);

            cursor = escape ? escape.end : cursor + 1;

            continue;
          }

          if (inner === quote) {
            contentEnd = cursor;
            closed = true;
            cursor += 1;

            break;
          }
          cursor += 1;
        }

        if (!closed) {
          contentEnd = end;
        }
      } else {
        contentStart = cursor;

        while (cursor < end) {
          const inner = value.charAt(cursor);

          if (inner === '\\') {
            const escape = readCssEscape(value, cursor, end);

            cursor = escape ? escape.end : cursor + 1;

            continue;
          }

          if (inner === ')' || isWhitespace(inner)) {
            break;
          }
          cursor += 1;
        }
        contentEnd = cursor;
      }

      let close = cursor;

      while (close < end && isWhitespace(value.charAt(close))) {
        close += 1;
      }

      if (value.charAt(close) !== ')') {
        close = -1;
      }

      const decoded = decodeCssEscapes(value, contentStart, contentEnd);

      addResourceRef(
        decoded.value,
        0,
        decoded.value.length,
        refs,
        (refStart, refEnd) => {
          const attrStart = decoded.rawStart[refStart] ?? contentStart;
          const attrEnd = decoded.rawEnd[refEnd - 1] ?? contentEnd;

          return mapRange(attrStart, attrEnd);
        },
      );

      index = close === -1 ? end : close + 1;

      continue;
    }
    index += 1;
  }
}

/**
 * 单次线性扫描 HTML，收集所有真实资源属性和 CSS url()，保留原始区间。
 */
export function collectResourceUrls(
  value: string,
  options: CollectResourceOptions = {},
): ResourceRef[] {
  const refs: ResourceRef[] = [];
  const lower = value.toLowerCase();

  let index = 0;

  while (index < value.length) {
    const open = value.indexOf('<', index);

    if (open === -1) {
      break;
    }

    if (value.startsWith('<!--', open)) {
      const close = value.indexOf('-->', open + 4);

      index = close === -1 ? value.length : close + 3;

      continue;
    }

    const next = value.charAt(open + 1);

    if (next === '!' || next === '?') {
      const close = value.indexOf('>', open + 2);

      index = close === -1 ? value.length : close + 1;

      continue;
    }

    if (next !== '/' && !/[A-Za-z]/.test(next)) {
      index = open + 1;

      continue;
    }

    let cursor = open + 1;

    if (value.charAt(cursor) === '/') {
      const close = value.indexOf('>', cursor + 1);

      index = close === -1 ? value.length : close + 1;

      continue;
    }

    const nameStart = cursor;

    while (cursor < value.length && !isTagNameEnd(value.charAt(cursor))) {
      cursor += 1;
    }
    const tagName = value.slice(nameStart, cursor).toLowerCase();

    let selfClosing = false;

    while (cursor < value.length) {
      while (cursor < value.length && isWhitespace(value.charAt(cursor))) {
        cursor += 1;
      }

      if (cursor >= value.length) {
        break;
      }

      if (value.charAt(cursor) === '>') {
        cursor += 1;

        break;
      }

      if (value.charAt(cursor) === '/') {
        selfClosing = true;
        cursor += 1;

        continue;
      }

      const attributeStart = cursor;

      while (
        cursor < value.length &&
        !isAttributeNameEnd(value.charAt(cursor))
      ) {
        cursor += 1;
      }

      if (cursor === attributeStart) {
        cursor += 1;

        continue;
      }
      const attributeName = value.slice(attributeStart, cursor).toLowerCase();

      while (cursor < value.length && isWhitespace(value.charAt(cursor))) {
        cursor += 1;
      }

      let valueStart = -1;
      let valueEnd = -1;

      if (value.charAt(cursor) === '=') {
        cursor += 1;

        while (cursor < value.length && isWhitespace(value.charAt(cursor))) {
          cursor += 1;
        }

        const quote = value.charAt(cursor);

        if (quote === '"' || quote === "'") {
          cursor += 1;
          valueStart = cursor;

          while (cursor < value.length && value.charAt(cursor) !== quote) {
            cursor += 1;
          }
          valueEnd = cursor;

          if (cursor < value.length) {
            cursor += 1;
          }
        } else {
          valueStart = cursor;

          while (
            cursor < value.length &&
            !isWhitespace(value.charAt(cursor)) &&
            value.charAt(cursor) !== '>'
          ) {
            cursor += 1;
          }
          valueEnd = cursor;
        }
      }

      if (valueStart >= 0) {
        if (attributeName === 'style') {
          const decoded = decodeAttribute(value, valueStart, valueEnd);

          parseCss(
            decoded.value,
            0,
            decoded.value.length,
            refs,
            attributeRangeMapper(decoded, valueStart, valueEnd),
          );
        } else if (attributeName === 'srcset') {
          const decoded = decodeAttribute(value, valueStart, valueEnd);

          parseSrcset(
            decoded.value,
            refs,
            attributeRangeMapper(decoded, valueStart, valueEnd),
          );
        } else if (
          ATTACHMENT_ATTRIBUTES.has(attributeName) &&
          !(attributeName === 'href' && options.includeHref === false)
        ) {
          const decoded = decodeAttribute(value, valueStart, valueEnd);

          addResourceRef(
            decoded.value,
            0,
            decoded.value.length,
            refs,
            attributeRangeMapper(decoded, valueStart, valueEnd),
          );
        }
      }
    }

    index = cursor;

    if (tagName === 'style' && !selfClosing) {
      const close = lower.indexOf('</style', cursor);

      if (close === -1) {
        parseCss(value, cursor, value.length, refs, IDENTITY_RANGE);

        break;
      }
      parseCss(value, cursor, close, refs, IDENTITY_RANGE);

      const tagEnd = value.indexOf('>', close);

      index = tagEnd === -1 ? value.length : tagEnd + 1;
    } else if (tagName === 'script' && !selfClosing) {
      const close = lower.indexOf('</script', cursor);
      const tagEnd = close === -1 ? -1 : value.indexOf('>', close);

      index = tagEnd === -1 ? value.length : tagEnd + 1;
    }
  }

  return refs;
}

/** 提取真实资源引用中的附件 id */
export function extractAttachmentIds(value: string): string[] {
  const ids = new Set<string>();

  for (const ref of collectResourceUrls(value)) {
    const match = ATTACHMENT_PATH_RE.exec(ref.url);

    if (match?.[1]) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

/** 替换真实资源 URL，返回 null 表示保留原地址 */
export function replaceResourceUrls(
  value: string,
  replacer: (url: string) => string | null,
): string {
  let output = '';
  let last = 0;

  for (const ref of collectResourceUrls(value)) {
    const next = replacer(ref.url);

    if (!next) {
      continue;
    }
    output += value.slice(last, ref.urlStart) + next;
    last = ref.urlEnd;
  }

  if (last === 0) {
    return value;
  }

  return output + value.slice(last);
}

/**
 * 只替换真实资源引用中的附件地址，返回 null 表示保留原地址。
 */
export function replaceAttachmentUrls(
  value: string,
  replacer: (id: string) => string | null,
): string {
  return replaceResourceUrls(value, url => {
    const match = ATTACHMENT_PATH_RE.exec(url);

    return match?.[1] ? replacer(match[1]) : null;
  });
}

/** 已知附件是否仍有未在源码中引用的对象 */
export function hasUnreferencedAttachments(
  source: string,
  known: readonly string[],
): boolean {
  const referenced = new Set(extractAttachmentIds(source));

  return known.some(id => !referenced.has(id));
}

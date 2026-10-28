import { D1_MAX_ROW_BYTES } from '#/limits';

const encoder = new TextEncoder();

function varintSize(value: number): number {
  let size = 1;

  while (value >= 0x80) {
    value = Math.floor(value / 128);
    size += 1;
  }
  return size;
}

// SQLite 整数 serial type 与存储字节数
function integerType(value: number): { serial: number; bytes: number } {
  if (value === 0) {
    return { serial: 8, bytes: 0 };
  }

  if (value === 1) {
    return { serial: 9, bytes: 0 };
  }

  if (value >= -128 && value <= 127) {
    return { serial: 1, bytes: 1 };
  }

  if (value >= -32768 && value <= 32767) {
    return { serial: 2, bytes: 2 };
  }

  if (value >= -8388608 && value <= 8388607) {
    return { serial: 3, bytes: 3 };
  }

  if (value >= -2147483648 && value <= 2147483647) {
    return { serial: 4, bytes: 4 };
  }

  if (value >= -140737488355328 && value <= 140737488355327) {
    return { serial: 5, bytes: 6 };
  }
  return { serial: 6, bytes: 8 };
}

/**
 * SQLite 记录 payload 的字节数：记录头加数据区，不含 rowid 与页级开销。
 * 文本列的 serial type 为 13 + 2 * 字节数，记录头长度本身也占一个 varint。
 */
export function sqliteRowBytes(values: Array<string | number | null>): number {
  let data = 0;
  let serialBytes = 0;

  for (const value of values) {
    if (value === null) {
      serialBytes += 1;

      continue;
    }

    if (typeof value === 'number') {
      const { serial, bytes } = integerType(value);

      serialBytes += varintSize(serial);
      data += bytes;

      continue;
    }

    const bytes = encoder.encode(value).length;

    data += bytes;
    serialBytes += varintSize(13 + 2 * bytes);
  }

  let header = serialBytes + 1;

  while (varintSize(header) + serialBytes !== header) {
    header = varintSize(header) + serialBytes;
  }

  return header + data;
}

export function rowTooLarge(values: Array<string | number | null>): boolean {
  return sqliteRowBytes(values) > D1_MAX_ROW_BYTES;
}

export function rowBudget(values: Array<string | number | null>): number {
  return Math.max(0, D1_MAX_ROW_BYTES - sqliteRowBytes(values));
}

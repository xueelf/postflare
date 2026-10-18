// D1 单条语句最多 100 个绑定参数，批量操作按此分块
export const DB_PARAM_LIMIT = 100;
export const R2_DELETE_CONCURRENCY = 50;

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }

  return out;
}

/**
 * 删除 R2 对象：分块并发，失败不抛出，避免留下指向空对象的数据库行。
 */
export async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  for (const batch of chunks(keys, R2_DELETE_CONCURRENCY)) {
    await Promise.allSettled(batch.map(key => env.ATTACHMENTS.delete(key)));
  }
}

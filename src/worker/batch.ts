// D1 单条语句最多 100 个绑定参数，批量操作按此分块
export const DB_PARAM_LIMIT = 100;
// R2 单次 delete 最多 1000 个 key
const R2_DELETE_BATCH_SIZE = 1000;

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }

  return out;
}

/**
 * 删除 R2 对象，使用原生批量 delete，每批最多 1000 个 key。
 * 删除失败直接抛出，调用方必须保留数据库元数据以便重试。
 */
export async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  for (const batch of chunks(keys, R2_DELETE_BATCH_SIZE)) {
    await env.ATTACHMENTS.delete(batch);
  }
}

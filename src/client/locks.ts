export function draftLockName(userId: string, draftId: string): string {
  return `postflare:draft:${userId}:${draftId}`;
}

export function templateLockName(userId: string, templateId: string): string {
  return `postflare:template:${userId}:${templateId}`;
}

/**
 * 在没有窗口持有资源锁时执行删除等独占操作。
 * 返回 null 表示资源正在被本标签页或其它标签页编辑。
 */
export async function withAvailableLock<T>(
  name: string,
  task: () => Promise<T>,
): Promise<T | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return task();
  }

  return navigator.locks.request(name, { ifAvailable: true }, async lock => {
    if (!lock) {
      return null;
    }

    return task();
  });
}

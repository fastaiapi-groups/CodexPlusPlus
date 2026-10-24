export type AccountGroup = { id: number; name: string; description?: string | null; rate_multiplier?: number };
// 每次登录独立缓存；合并并发请求，失败允许重试，退出后丢弃。
export function createGroupCache(load: () => Promise<AccountGroup[]>) {
  let pending: Promise<AccountGroup[]> | undefined;
  return () => pending ??= load().catch(error => { pending = undefined; throw error; });
}

// 概览重新挂载时复用上次的媒体连接状态；按平台和线路分开保存，登录和退出时清空。
type Entry<T> = { status: T; registered: boolean };
const entries = new Map<string, Entry<unknown>>();

export const mediaStatusCache = {
  get<T>(key: string): Entry<T> | undefined {
    return entries.get(key) as Entry<T> | undefined;
  },
  set<T>(key: string, entry: Entry<T>) {
    entries.set(key, entry);
  },
  clear() {
    entries.clear();
  },
};

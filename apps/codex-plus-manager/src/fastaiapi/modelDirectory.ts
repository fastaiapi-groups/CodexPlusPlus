import type { AccountGroup } from "./groupCache.ts";
import { keyGroup, type ModelGroupKey } from "./modelGroups.ts";

type ModelPrice = {model: string; time_pricing: boolean; pricing_note?: string; unit_price?: number | null; tiers: {label: string; input: number | null; output: number | null; cache: number | null}[]};
export type ModelPricing = {group: string; rate_multiplier?: number | null; currency?: string; model_ids?: string[]; pricing_warning?: string; models: ModelPrice[]};
export type GroupCatalogs = {groups: AccountGroup[]; catalogs: Record<string, ModelPricing>};
type Directory = {groups: AccountGroup[]; catalogs: Map<string, ModelPricing>; keys: ModelGroupKey[]; warning: string};
type Client = {
  catalog: () => Promise<GroupCatalogs>;
  keys: () => Promise<{items: ModelGroupKey[]}>;
  models: (keyId: number) => Promise<string[]>;
};

export async function loadModelDirectory(platform: string, client: Client): Promise<Directory> {
  const [directory, keyResult] = await Promise.allSettled([client.catalog(), client.keys()]);
  const keys = keyResult.status === "fulfilled" ? keyResult.value.items : [];
  if (directory.status === "rejected") {
    return {groups: [], catalogs: new Map(), keys, warning: String(directory.reason)};
  }
  const groups = directory.value.groups.filter(group => group.id);
  const catalogs = new Map(Object.entries(directory.value.catalogs));
  const unavailable = groups.filter(group => !catalogs.has(group.id));
  // 平台未提供目录时，只使用已有 Key 补充模型列表。
  await Promise.all(unavailable.map(async group => {
    const key = keys.find(key => key.status === "active" && keyGroup(key, platform) === group.id);
    if (!key) return;
    try {
      catalogs.set(group.id, {group: group.name, models: [], model_ids: await client.models(key.id)});
    } catch {
      // 保留未知状态，用户可刷新重试。
    }
  }));
  const warning = unavailable.some(group => !catalogs.has(group.id))
    ? "部分分组目录暂不可用，可刷新重试。" : "";
  return {groups, catalogs, keys, warning};
}

export function catalogModels(pricing: ModelPricing | undefined): string[] {
  return pricing?.model_ids ?? pricing?.models.map(price => price.model) ?? [];
}

export function createModelDirectory(load: () => Promise<Directory>) {
  let snapshot: {directory: Directory | null; loading: boolean} = {directory: null, loading: true};
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: (refresh = false) => {
      if (pending) return pending;
      if (snapshot.directory && !refresh) return Promise.resolve();
      pending = Promise.resolve().then(load).catch(error => ({
        groups: [], catalogs: new Map<string, ModelPricing>(), keys: [], warning: String(error),
      })).then(directory => {
        const previous = snapshot.directory;
        // 刷新失败时保留上次目录和价格，并显示失败原因。
        publish({directory: directory.warning && !directory.groups.length && previous?.groups.length
          ? {...previous, warning: directory.warning} : directory, loading: false});
      }).finally(() => { pending = undefined; });
      publish({...snapshot, loading: true});
      return pending;
    },
    rememberKey: (key: ModelGroupKey) => {
      const directory = snapshot.directory;
      if (!directory) return;
      const keys = directory.keys.filter(existing => existing.id !== key.id);
      publish({...snapshot, directory: {...directory, keys: [...keys, key]}});
    },
  };
}

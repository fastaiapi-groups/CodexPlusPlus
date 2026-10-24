type Key = {id: number; name: string; status: string};
type Client = {
  groups(): Promise<{id: number; name: string}[]>;
  createKey(groupId: number): Promise<Key>;
  models(keyId: number): Promise<string[]>;
  current(): Promise<{key_id?: number; model?: string}>;
  apply(keyId: number, model: string): Promise<unknown>;
};

// 与界面解耦，失败后可重试；优先复用专用 Key，保留用户已经选好的模型。
export async function configureAccount(keys: Key[], client: Client) {
  let key = keys.find(k => k.status === "active" && k.name === "Codex++ FastAiApi");
  if (!key) {
    const group = (await client.groups()).find(g => g.name.toLowerCase() === "gpt-pro");
    if (!group) throw new Error("未找到 gpt-pro 分组，请在概览中选择对话分组后创建专用 Key。");
    key = await client.createKey(group.id);
  }
  const models = await client.models(key.id);
  const current = await client.current();
  const model = (current.key_id === key.id && models.includes(current.model ?? "") ? current.model : undefined)
    ?? models.find(m => m === "gpt-5.6-sol") ?? models[0];
  if (!model) throw new Error("该 Key 没有可用对话模型，请选择其他分组。");
  await client.apply(key.id, model);
  return {id: key.id, models, model};
}

type Key = {id: number; name: string; status: string; group?: string};
type Client = {
  groups(): Promise<{id: string; name: string; recommended?: boolean}[]>;
  createKey(groupId: string): Promise<Key>;
  models(keyId: number): Promise<string[]>;
  current(): Promise<{key_id?: number; model?: string}>;
  apply(keyId: number, model: string): Promise<unknown>;
};

// 与界面解耦，失败后可重试；优先复用专用 Key，保留用户已经选好的模型。
export async function configureAccount(keys: Key[], client: Client) {
  let key = keys.find(k => k.status === "active" && k.name === "Codex++ FastAiApi")
    ?? keys.find(k => k.status === "active" && k.group === "default");
  if (!key) {
    const groups = await client.groups();
    const group = groups.find(g => g.id === "default" || g.name.toLowerCase() === "default") ?? groups.find(g => g.recommended || /openai|gpt|对话|文本/i.test(g.name)) ?? (groups.length === 1 ? groups[0] : undefined);
    if (!group) throw new Error("未找到可用对话分组，请在概览中选择分组后创建专用 Key。");
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

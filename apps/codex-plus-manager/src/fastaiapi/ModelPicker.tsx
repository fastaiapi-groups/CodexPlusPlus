import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { ModelDialog } from "./ModelDialog";
import { keyGroup, supportsModel, type ModelChoice } from "./modelGroups";
import { useModelDirectory } from "./ModelDirectoryContext";
import { useServiceRoutes } from "./ServiceRoutes";
import { catalogModelKinds, catalogModels } from "./modelDirectory";

export function ModelPicker({keyId, value, busy, onApply}: {
  keyId: number; value: string; busy: boolean;
  onApply: (choice: ModelChoice) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const {directory} = useModelDirectory();
  const {routes} = useServiceRoutes();
  const key = directory?.keys.find(key => key.id === keyId);
  const groupId = key && keyGroup(key, routes.platform);
  const group = directory?.groups.find(group => group.id === groupId);
  const kinds = catalogModelKinds(directory?.catalogs);
  const count = new Set(Array.from(directory?.catalogs.values() ?? []).flatMap(catalogModels)
    .filter(id => supportsModel(routes.platform, "text", id, kinds.get(id)))).size;
  return <>
    <article className="fast-media-choice">
      <header><MessageSquare size={18}/><strong>文字模型</strong><small>{count} 个可用</small></header>
      <span>默认模型{group && ` · ${group.name}`}</span>
      <b>{value || "未设置"}</b>
      <button type="button" disabled={busy} onClick={() => setOpen(true)}>切换文字模型 ▾</button>
    </article>
    {open && <ModelDialog keyId={keyId} models={value ? [value] : []} groupId={groupId} value={value} busy={busy} onApply={onApply} onClose={() => setOpen(false)}/>}
  </>;
}

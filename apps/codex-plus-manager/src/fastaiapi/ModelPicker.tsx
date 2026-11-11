import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { ModelDialog } from "./ModelDialog";

export function ModelPicker({keyId, models, value, busy, onApply, onReload}: {
  keyId: number; models: string[]; value: string; busy: boolean;
  onApply: (model: string) => Promise<void>; onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <article className="fast-media-choice">
      <header><MessageSquare size={18}/><strong>文字模型</strong><small>{models.length} 个可用</small></header>
      <span>默认模型</span>
      <b>{value || "使用已有配置"}</b>
      <button type="button" disabled={busy} onClick={() => setOpen(true)}>切换文字模型 ▾</button>
    </article>
    {open && <ModelDialog keyId={keyId} models={models} value={value} busy={busy} onApply={onApply} onReload={onReload} onClose={() => setOpen(false)}/>}
  </>;
}

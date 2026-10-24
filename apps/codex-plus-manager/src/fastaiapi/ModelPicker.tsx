import { useState } from "react";
import { ModelDialog } from "./ModelDialog";

export function ModelPicker({keyId, models, value, busy, onApply, onReload}: {
  keyId: number; models: string[]; value: string; busy: boolean;
  onApply: (model: string) => Promise<void>; onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="fast-models">
    <div className="fast-row"><span><small>默认模型</small><strong>{value || "使用已有配置"}</strong></span><button onClick={() => setOpen(true)}>切换模型 ▾</button></div>
    {open && <ModelDialog keyId={keyId} models={models} value={value} busy={busy} onApply={onApply} onReload={onReload} onClose={() => setOpen(false)}/>}
  </div>;
}

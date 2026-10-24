import { useState } from "react";

export function ModelPicker({models, value, busy, onApply, onReload}: {
  models: string[]; value: string; busy: boolean;
  onApply: (model: string) => void; onReload: () => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [selected, setSelected] = useState("");
  return <div className="fast-models">
    <div className="fast-row"><span><small>默认模型</small><strong>{value || "使用已有配置"}</strong></span><button onClick={() => { setSelected(value); setOpen(!open); }}>切换模型 ▾</button></div>
    {open && <fieldset disabled={busy}><legend>选择默认模型 · {models.length} 个</legend>
      <button onClick={onReload}>重新获取</button><button onClick={() => setOpen(false)}>收起</button>
      <input aria-label="搜索模型" placeholder="搜索模型名称，例如 deepseek、gemini" value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="fast-model-options">{models.filter(m => m.toLowerCase().includes(query.toLowerCase())).map(m => <label key={m}><input type="radio" name="fast-model" checked={selected === m} onChange={() => setSelected(m)}/>{m}{m === value && <small>当前默认</small>}</label>)}</div>
      <p>已选择：{selected || "请选择模型"}</p><button disabled={!models.includes(selected)} onClick={() => onApply(selected)}>应用默认模型</button>
    </fieldset>}
  </div>;
}

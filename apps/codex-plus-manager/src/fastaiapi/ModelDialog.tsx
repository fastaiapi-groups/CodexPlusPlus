import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, RefreshCw } from "lucide-react";
import "./recharge.css";
import "./responsive.css";
export function ModelDialog({models, value, busy, onApply, onReload, onClose}: {
  models: string[]; value: string; busy: boolean; onApply: (model: string) => Promise<void>; onReload: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(value);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => { const opener = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => {dialog.current?.close(); opener?.focus();}; }, []);
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog fast-key-dialog fast-model-dialog" aria-labelledby="fast-model-title" onCancel={e => {e.preventDefault(); if(!saving) onClose();}} onClick={e => {if(e.target === e.currentTarget && !saving) onClose();}}><div className="fast-dialog-content">
    <header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">FASTAIAPI · 模型服务</span><h2 id="fast-model-title">选择默认模型</h2></div><button className="fast-dialog-close" aria-label="关闭模型选择" disabled={saving} onClick={onClose}><X size={20}/></button></header>
    <p className="fast-model-current">当前默认 <strong>{value || "使用已有配置"}</strong></p>
    <label className="fast-group-search"><Search size={16}/><input aria-label="搜索模型" placeholder="搜索模型名称…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <div className="fast-group-caption"><span>可用模型 · {models.length} 个</span><button disabled={busy || saving} onClick={onReload}><RefreshCw size={13}/>{busy ? "正在获取…" : "刷新列表"}</button></div>
    <div className="fast-group-list" role="radiogroup" aria-label="可用模型">{models.filter(m => m.toLowerCase().includes(query.toLowerCase())).map(m => {
      const name = m.toLowerCase();
      const note = name.endsWith("-sol") ? "推理强" : name.endsWith("-luna") ? "性价比高" : "";
      const description = [note, m === value ? "当前默认" : ""].filter(Boolean).join(" · ");
      return <label key={m} className={selected === m ? "selected" : ""}><input type="radio" name="default-model" checked={selected === m} disabled={busy || saving} onChange={() => setSelected(m)}/><span>{m}{description && <small className={m === value ? "" : "fast-model-description"}>{description}</small>}</span>{selected === m && <Check size={17}/>}</label>;
    })}{!models.some(m => m.toLowerCase().includes(query.toLowerCase())) && <p>{busy ? "正在加载模型…" : "没有匹配的模型"}</p>}</div>
    {error && <p className="fast-payment-error" role="alert">{error}</p>}
    <p className="fast-model-hint">切换后重启 Codex 生效。</p>
    <button className="fast-pay-primary" disabled={busy || saving || !models.includes(selected)} onClick={async () => {setSaving(true); setError(""); try{await onApply(selected); onClose();}catch(e){setError(String(e));}finally{setSaving(false);}}}>{saving ? "正在应用…" : "确认切换模型"}</button>
  </div></dialog>, document.body);
}

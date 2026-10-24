import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Search, X, Check } from "lucide-react";
import { GroupDescription } from "./GroupDescription";
import type { AccountGroup } from "./groupCache";
import "./recharge.css";
import "./responsive.css";
export function KeyDialog({groups, loading, loadError, onRetry, onClose, onCreate}: {
  groups: AccountGroup[]; loading: boolean; loadError: string; onRetry: () => void;
  onClose: () => void; onCreate: (id: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<number | undefined>(groups[0]?.id);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setSelected(current => groups.some(g => g.id === current) ? current : groups[0]?.id); }, [groups]);
  useEffect(() => { const opener = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { dialog.current?.close(); opener?.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog fast-key-dialog" aria-labelledby="fast-key-title" onCancel={e => {e.preventDefault(); if (!busy) onClose();}} onClick={e => {if(e.target === e.currentTarget && !busy) onClose();}}>
    <div className="fast-dialog-content"><header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">FASTAIAPI · 模型服务</span><h2 id="fast-key-title">创建专用 API Key</h2></div><button className="fast-dialog-close" aria-label="关闭创建 Key" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="fast-key-intro"><KeyRound size={24}/><p>选择模型分组，为你的创作配置专用密钥。<small>创建后可在高级配置中选择使用。</small></p></div>
    <label className="fast-group-search"><Search size={16}/><input aria-label="搜索模型分组" placeholder="搜索模型分组…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <div className="fast-group-caption">可用分组 <span>{groups.length} 个</span></div><div className="fast-group-list" role="radiogroup" aria-label="可用分组">{loading ? <p role="status">正在加载分组…</p> : groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase())).map(g => <label key={g.id} className={selected === g.id ? "selected" : ""}><input type="radio" name="key-group" checked={selected === g.id} disabled={busy} onChange={() => setSelected(g.id)}/><span><span className="fast-group-name">{g.name}</span>{Number.isFinite(g.rate_multiplier) && <small className="fast-group-rate-badge">分组倍率 {g.rate_multiplier}×</small>}{g.description?.trim() && <small className="fast-group-preview">{Array.from(g.description.trim()).slice(0, 12).join("")}{Array.from(g.description.trim()).length > 12 ? "…" : ""}</small>}</span>{selected === g.id && <Check size={17}/> }<GroupDescription name={g.name} description={g.description}/></label>)}{!loading && !loadError && !groups.some(g => g.name.toLowerCase().includes(query.toLowerCase())) && <p>没有匹配的分组</p>}</div>
    {(error || loadError) && <p role="alert" className="fast-payment-error">{error || loadError}</p>}{loadError && <button disabled={loading} onClick={onRetry}>重新加载分组</button>}
    <button className="fast-pay-primary" disabled={busy || loading || selected === undefined} onClick={async () => { if(selected === undefined) return; setBusy(true); setError(""); try {await onCreate(selected); onClose();} catch(e){setError(String(e));} finally {setBusy(false);} }}>{busy ? "正在创建…" : "创建专用 Key"}</button>
    </div></dialog>, document.body);
}

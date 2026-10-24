import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./recharge.css";
import "./responsive.css";
type ModelPrice = {model: string; time_pricing: boolean; tiers: {label: string; input: number | null; output: number | null; cache: number | null}[]};
type ModelPricing = {group: string; rate_multiplier: number; models: ModelPrice[]};
const priceYuan = (price: number | null) => price !== null && Number.isFinite(price)
  ? `¥${price.toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 6})}` : "—";
export function ModelDialog({keyId, models, value, busy, onApply, onReload, onClose}: {
  keyId: number; models: string[]; value: string; busy: boolean; onApply: (model: string) => Promise<void>; onReload: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(value);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [pricing, setPricing] = useState<ModelPricing | null>(null), [priceError, setPriceError] = useState("");
  const [priceLoading, setPriceLoading] = useState(true), [priceRevision, setPriceRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPricing(null); setPriceError(""); setPriceLoading(true);
    invoke<ModelPricing>("fastaiapi_account", {action: "model_pricing", id: String(keyId)}).then(data => {
      if (!cancelled) setPricing(data);
    }).catch(e => {if (!cancelled) setPriceError(String(e));}).finally(() => {if (!cancelled) setPriceLoading(false);});
    return () => {cancelled = true;};
  }, [keyId, priceRevision]);
  useEffect(() => { const opener = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => {dialog.current?.close(); opener?.focus();}; }, []);
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog fast-key-dialog fast-model-dialog" aria-labelledby="fast-model-title" onCancel={e => {e.preventDefault(); if(!saving) onClose();}} onClick={e => {if(e.target === e.currentTarget && !saving) onClose();}}><div className="fast-dialog-content">
    <header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">FASTAIAPI · 模型服务</span><h2 id="fast-model-title">选择默认模型</h2></div><button className="fast-dialog-close" aria-label="关闭模型选择" disabled={saving} onClick={onClose}><X size={20}/></button></header>
    <p className="fast-model-current">当前默认 <strong>{value || "使用已有配置"}</strong></p>
    <label className="fast-group-search"><Search size={16}/><input aria-label="搜索模型" placeholder="搜索模型名称…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <div className="fast-group-caption"><span>可用模型 · {models.length} 个 · 人民币 / 百万 tokens</span><button disabled={busy || saving || priceLoading} onClick={() => {onReload(); setPriceRevision(n => n + 1);}}><RefreshCw size={13}/>{busy || priceLoading ? "正在获取…" : "刷新列表"}</button></div>
    {priceError && <p className="fast-model-hint" role="status">价格暂时无法获取，可刷新重试。{priceError}</p>}
    <div className="fast-group-list" role="radiogroup" aria-label="可用模型">{models.filter(m => m.toLowerCase().includes(query.toLowerCase())).map(m => {
      const name = m.toLowerCase();
      const note = name.endsWith("-sol") ? "推理强" : name.endsWith("-luna") ? "性价比高" : "";
      const price = pricing?.models.find(price => price.model === m);
      return <label key={m} className={selected === m ? "selected" : ""}><input type="radio" name="default-model" checked={selected === m} disabled={busy || saving} onChange={() => setSelected(m)}/><span className="fast-model-card-content"><span className="fast-model-card-name">{m}</span><span className="fast-model-card-tags">{note && <em>{note}</em>}{m === value && <em className="is-current">当前默认</em>}</span>
        {price?.tiers.length ? <span className="fast-model-price-table"><span className="fast-model-price-row is-heading"><span>上下文</span><span>输入</span><span>输出</span><span>缓存读取</span></span>{price.tiers.map((tier, i) => <span className="fast-model-price-row" key={i}><span>{tier.label}</span><b>{priceYuan(tier.input)}</b><b>{priceYuan(tier.output)}</b><b>{priceYuan(tier.cache)}</b></span>)}{price.time_pricing && <small>标准时段价格，其他时段按平台分时倍率计费</small>}</span> : <small className="fast-model-price-unavailable">{priceLoading ? "正在获取价格…" : "平台暂未公布价格"}</small>}
      </span>{selected === m && <Check className="fast-model-selected-check" size={17}/>}</label>;
    })}{!models.some(m => m.toLowerCase().includes(query.toLowerCase())) && <p>{busy ? "正在加载模型…" : "没有匹配的模型"}</p>}</div>
    {error && <p className="fast-payment-error" role="alert">{error}</p>}
    <p className="fast-model-hint">{pricing && <>价格来自 {pricing.group} 分组 <span className="fast-group-rate-badge">生效倍率 {pricing.rate_multiplier}×</span>，已计入价格。<br/></>}金额均为人民币，实际扣费以平台使用记录为准。切换后重启 Codex 生效。</p>
    <button className="fast-pay-primary" disabled={busy || saving || !models.includes(selected)} onClick={async () => {setSaving(true); setError(""); try{await onApply(selected); onClose();}catch(e){setError(String(e));}finally{setSaving(false);}}}>{saving ? "正在应用…" : "确认切换模型"}</button>
  </div></dialog>, document.body);
}

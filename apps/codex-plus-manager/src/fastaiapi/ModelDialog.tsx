import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, RefreshCw, ChevronRight } from "lucide-react";
import type { AccountGroup } from "./groupCache";
import { useModelDirectory } from "./ModelDirectoryContext";
import { catalogModels } from "./modelDirectory";
import { initialGroup, keyGroup, selectableGroupModels, type ModelChoice, type ModelGroupKey, type ModelKind } from "./modelGroups";

import "./recharge.css";
import "./responsive.css";
import "./model-dialog.css";

const legacyGroup = "";

const priceYuan = (price: number | null, currency = "USD") => price !== null && Number.isFinite(price)
  ? `${currency === "CNY" ? "¥" : "$"}${price.toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 6})}` : "—";

export function ModelDialog({keyId, models, value, groupId, busy, onApply, onClose, kind = "text"}: {
  kind?: ModelKind; keyId: number; models: string[]; value: string; groupId?: string | null; busy: boolean;
  onApply: (choice: ModelChoice) => Promise<void>; onClose: () => void;
}) {
  const invoke = usePlatformInvoke();
  const {routes, setLocked} = useServiceRoutes();
  const platform = routes.platform;
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""), [choice, setChoice] = useState<{group: string; model: string} | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const {directory: account, loading, refresh, rememberKey} = useModelDirectory();
  const [browsedGroup, setBrowsedGroup] = useState<string | null>(null);
  const groupError = account?.warning;

  const currentKey = account?.keys.find(key => key.id === keyId);
  const defaultGroup = groupId ?? (currentKey ? keyGroup(currentKey, platform) : null);
  const groups = account?.groups ?? [];
  const currentGroup = groups.find(group => group.id === defaultGroup);
  const modelsForGroup = (id: string) => {
    const pricing = account?.catalogs.get(id);
    return selectableGroupModels(platform, kind, catalogModels(pricing), !pricing && id === currentGroup?.id ? models : []);
  };
  const visibleGroups = groups.filter(group => modelsForGroup(group.id).length > 0);
  const priority = (group: AccountGroup) => group.id === defaultGroup ? 0 : group.name.toLowerCase() === "default" ? 1 : 2;
  const orderedGroups = [...visibleGroups].sort((left, right) => priority(left) - priority(right));
  const legacyModels = selectableGroupModels(platform, kind, models);
  const showLegacy = !currentGroup && legacyModels.length > 0 && (keyId > 0 || kind !== "text");
  const activeGroup = visibleGroups.some(group => group.id === browsedGroup) || (showLegacy && browsedGroup === legacyGroup)
    ? browsedGroup
    : initialGroup(visibleGroups, defaultGroup)?.id ?? (showLegacy ? legacyGroup : null);
  const isCurrent = activeGroup !== null && activeGroup === (currentGroup?.id ?? (showLegacy ? legacyGroup : null));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const modal = dialog.current;
    modal?.showModal();
    return () => {modal?.close(); opener?.focus();};
  }, []);

  const pricing = activeGroup ? account?.catalogs.get(activeGroup) : undefined;
  const list = activeGroup === legacyGroup ? legacyModels : activeGroup === null ? [] : modelsForGroup(activeGroup);
  const filtered = list.filter(model => model.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = choice?.group === activeGroup ? choice?.model : isCurrent && !choice ? value : "";
  const label = {text: "文字", image: "图片", video: "视频"}[kind];
  const apply = async () => {
    if (activeGroup === null || !selected || !list.includes(selected)) return;
    setSaving(true);
    setLocked(true);
    setError("");
    try {
      const groupId = activeGroup || defaultGroup;
      const result = await invoke<{key?: ModelGroupKey}>("fastaiapi_account", {
        action: "apply_model_binding", body: {kind, model: selected, group_id: groupId, key_id: keyId, route: routes.selected},
      });
      if (result.key) rememberKey(result.key);
      await onApply({model: selected, groupId, keyId: result.key?.id ?? keyId});
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
      setLocked(false);
    }
  };
  const browse = (group: string) => {
    setBrowsedGroup(group);
    setChoice(null);
    setQuery("");
    setError("");
  };
  const working = saving;
  const groupButton = (id: string, name: string, description?: string | null, rate?: number) =>
    <button type="button" key={id} className="fast-model-group" aria-pressed={activeGroup === id} disabled={busy || working}
      onClick={() => browse(id)} title={description || name}>
      <span><strong>{name}</strong>
        {(currentGroup?.id ?? (showLegacy ? legacyGroup : null)) === id
          ? <small className="fast-model-group-default">当前默认</small>
          : typeof rate === "number" && <small>{rate}×</small>}
      </span>
      <ChevronRight size={15} aria-hidden="true"/>
    </button>;
  return createPortal(
    <dialog ref={dialog} className="fast-payment-dialog fast-key-dialog fast-model-dialog" aria-labelledby="fast-model-title"
      onCancel={event => {event.preventDefault(); if (!working) onClose();}}
      onClick={event => {if (event.target === event.currentTarget && !working) onClose();}}>
      <div className="fast-dialog-content">
        <header className="fast-dialog-head">
          <div><h2 id="fast-model-title">选择默认{label}模型</h2>
            <p className="fast-model-current">当前默认 · {currentGroup?.name || (value ? "现有连接" : "未设置")}<strong>{value || "未设置"}</strong></p>
          </div>
          <button type="button" className="fast-dialog-close" aria-label="关闭模型选择" disabled={busy || working} onClick={onClose}><X size={20}/></button>
        </header>
        <div className="fast-model-columns">
          <aside className="fast-model-groups" aria-label="模型分组">
            <h3>模型分组</h3>
            <label className="fast-model-compact-group">
              <span>模型分组</span>
              <select value={activeGroup ?? ""} disabled={busy || working || !visibleGroups.length}
                onChange={event => browse(event.target.value)}>
                {!showLegacy && activeGroup == null && <option value="">暂无可用分组</option>}
                {showLegacy && <option value={legacyGroup}>现有连接{!currentGroup ? "（当前默认）" : ""}</option>}
                {orderedGroups.map(group => <option key={group.id} value={group.id}>
                  {group.name}{group.id === defaultGroup ? "（当前默认）" : ""}
                </option>)}
              </select>
            </label>
            <div className="fast-model-group-scroll">
              {showLegacy && groupButton(legacyGroup, "现有连接")}
              {orderedGroups.map(group => groupButton(group.id, group.name, group.description, group.rate_multiplier))}

              {!visibleGroups.length && !showLegacy && !groupError && <p>{account ? `暂无提供${label}模型的分组` : "正在加载分组…"}</p>}
            </div>
            {groupError && <p className="fast-model-hint" role="status">{groupError}</p>}
          </aside>
          <section className="fast-model-results" aria-label={`${label}模型`}>
            <div className="fast-group-caption">
              <span>{visibleGroups.find(group => group.id === activeGroup)?.name || (showLegacy ? "现有连接" : label + "模型")} · {list.length} 个
                {kind === "text" && pricing ? ` · ${pricing.currency === "CNY" ? "人民币" : "美元"} / 百万 tokens` : ""}</span>
              <button type="button" disabled={busy || working || loading} onClick={() => void refresh()}><RefreshCw size={13}/>刷新列表</button>
            </div>
            <label className="fast-group-search"><Search size={16}/><input aria-label="搜索模型" placeholder="搜索模型名称…" value={query} onChange={event => setQuery(event.target.value)}/></label>
            {pricing?.pricing_warning && <p className="fast-model-hint fast-model-warning" role="status">{pricing.pricing_warning}</p>}
            <div className="fast-group-list" role="radiogroup" aria-label="可用模型">
              {filtered.map(model => {
                const price = pricing?.models.find(row => row.model === model);
                const note = model.endsWith("-sol") ? "推理强" : model.endsWith("-luna") ? "性价比高" : "";
                return <label key={model} className={selected === model ? "selected" : ""}>
                  <input type="radio" name="default-model" checked={selected === model} disabled={busy || working}
                    onChange={() => activeGroup !== null && setChoice({group: activeGroup, model})}/>
                  <span className="fast-model-card-content">
                    <span className="fast-model-card-name">{model}</span>
                    {(note || (isCurrent && model === value)) && <span className="fast-model-card-tags">
                      {note && <em>{note}</em>}{isCurrent && model === value && <em className="is-current">当前默认</em>}
                    </span>}
                    {price?.unit_price != null ? <span className="fast-model-unit-price"><b>{priceYuan(price.unit_price, pricing?.currency)}</b><small>每次调用</small></span>
                      : price?.tiers.length ? <span className="fast-model-price-table">
                        <span className="fast-model-price-row is-heading"><span>上下文</span><span>输入</span><span>输出</span><span>缓存读取</span></span>
                        {price.tiers.map((tier, index) => <span className="fast-model-price-row" key={index}><span>{tier.label}</span><b>{priceYuan(tier.input, pricing?.currency)}</b><b>{priceYuan(tier.output, pricing?.currency)}</b><b>{priceYuan(tier.cache, pricing?.currency)}</b></span>)}
                        {price.time_pricing && <small>标准时段价格，其他时段按平台分时倍率计费</small>}
                      </span> : <small className="fast-model-price-unavailable">{price?.pricing_note || (loading ? "正在获取价格…" : "价格暂不可用")}</small>}
                  </span>
                  {selected === model && <Check className="fast-model-selected-check" size={17} aria-hidden="true"/>}
                </label>;
              })}
              {!filtered.length && <p role="status">{loading ? "正在加载模型…" : query ? "没有匹配的模型" : `此分组暂无可选${label}模型`}</p>}
            </div>
          </section>
        </div>
        <footer className="fast-model-footer">
          {error && <div className="fast-payment-error" role="alert">{error}</div>}
          <p className="fast-model-hint">{pricing?.rate_multiplier != null && <>价格已计入分组倍率 {pricing.rate_multiplier}×。 </>}
            {kind === "text" ? "切换后重启 Codex 生效。" : "默认分组与模型用于后续媒体任务。"}
          </p>
          <button type="button" className="fast-pay-primary" disabled={busy || working || loading || !selected || !list.includes(selected)}
            onClick={() => void apply()}>{saving ? "正在验证并绑定…" : "设为默认分组和模型"}</button>
        </footer>
      </div>
    </dialog>, document.body
  );
}

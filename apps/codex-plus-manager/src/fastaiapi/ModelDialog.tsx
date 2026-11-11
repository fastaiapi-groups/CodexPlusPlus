import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, RefreshCw, ChevronRight } from "lucide-react";
import type { AccountGroup } from "./groupCache";
import { initialGroup, keyGroup, supportsModel, type ModelChoice, type ModelGroupKey, type ModelKind } from "./modelGroups";

import "./recharge.css";
import "./responsive.css";
import "./model-dialog.css";

type ModelPrice = {model: string; time_pricing: boolean; pricing_note?: string; unit_price?: number | null; tiers: {label: string; input: number | null; output: number | null; cache: number | null}[]};
type ModelPricing = {group: string; rate_multiplier?: number | null; currency?: string; model_ids?: string[]; pricing_warning?: string; models: ModelPrice[]};
type AccountCatalog = { groups: AccountGroup[]; keys: ModelGroupKey[] };
type GroupCatalog = { group: string; models: string[]; pricing: ModelPricing | null; warning: string };
const legacyGroup = "";

const priceYuan = (price: number | null, currency = "USD") => price !== null && Number.isFinite(price)
  ? `${currency === "CNY" ? "¥" : "$"}${price.toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 6})}` : "—";

export function ModelDialog({keyId, models, value, groupId, busy, applyHint, onApply, onClose, kind = "text"}: {
  kind?: ModelKind; keyId: number; models: string[]; value: string; groupId?: string | null; busy: boolean; applyHint?: string;
  onApply: (choice: ModelChoice) => Promise<void>; onClose: () => void;
}) {
  const invoke = usePlatformInvoke();
  const {routes, setLocked} = useServiceRoutes();
  const platform = routes.platform;
  const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", {action, body, id});
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""), [choice, setChoice] = useState<{group: string; model: string} | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [account, setAccount] = useState<AccountCatalog | null>(null), [groupError, setGroupError] = useState("");
  const [browsedGroup, setBrowsedGroup] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GroupCatalog | null>(null), [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAccount(null);
    setGroupError("");
    void Promise.allSettled([api<AccountGroup[]>("groups"), api<{items: ModelGroupKey[]}>("keys")]).then(([groups, keys]) => {
      if (cancelled) return;
      if (groups.status === "rejected") setGroupError(String(groups.reason));
      setAccount({groups: groups.status === "fulfilled" ? groups.value.filter(group => group.id) : [],
        keys: keys.status === "fulfilled" ? keys.value.items : []});
    });
    return () => {cancelled = true;};
  }, [platform, routes.selected, revision]);

  const currentKey = account?.keys.find(key => key.id === keyId);
  const defaultGroup = groupId ?? (currentKey ? keyGroup(currentKey, platform) : null);
  const groups = account?.groups ?? [];
  const currentGroup = groups.find(group => group.id === defaultGroup);
  const priority = (group: AccountGroup) => group.id === defaultGroup ? 0 : group.name.toLowerCase() === "default" ? 1 : 2;
  const orderedGroups = [...groups].sort((left, right) => priority(left) - priority(right));
  const showLegacy = models.length > 0 && !currentGroup;
  const activeGroup = groups.some(group => group.id === browsedGroup) || (showLegacy && browsedGroup === legacyGroup)
    ? browsedGroup
    : currentGroup?.id ?? (showLegacy ? legacyGroup : initialGroup(groups, null)?.id ?? null);
  const isCurrent = activeGroup === (currentGroup?.id ?? (showLegacy ? legacyGroup : null));
  const activeKeys = account?.keys.filter(key => key.status === "active" && keyGroup(key, platform) === activeGroup) ?? [];

  useEffect(() => {
    setCatalog(null);
    if (activeGroup == null || activeGroup === legacyGroup) return;
    let cancelled = false;
    const load = async () => {
      let pricing: ModelPricing | null = null;
      let warning = "";
      try {
        pricing = await api<ModelPricing>("group_model_pricing", {group_id: activeGroup});
        warning = pricing.pricing_warning ?? "";
      } catch (error) {
        warning = `分组目录暂时无法获取。 ${String(error)}`;
      }
      let ids = pricing?.model_ids ?? pricing?.models.flatMap(price => typeof price.model === "string" ? [price.model] : []) ?? [];
      if (!ids.some(id => supportsModel(platform, kind, id)) && activeKeys.length) {
        const fallbackKey = activeKeys.find(key => key.id === keyId) ?? activeKeys[0];
        try {
          ids = await invoke<string[]>("fastaiapi_models", {keyId: fallbackKey.id});
        } catch (error) {
          if (!warning) warning = String(error);
        }
      }
      if (!cancelled) setCatalog({group: activeGroup, models: ids, pricing, warning});
    };
    void load();
    return () => {cancelled = true;};
  }, [activeGroup, account, keyId, kind, platform, routes.selected, revision]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const modal = dialog.current;
    modal?.showModal();
    return () => {modal?.close(); opener?.focus();};
  }, []);

  const groupCatalog = catalog?.group === activeGroup ? catalog : null;
  const pricing = groupCatalog?.pricing;
  const list = [...new Set([...(isCurrent ? models : []), ...(groupCatalog?.models ?? [])])]
    .filter(model => supportsModel(platform, kind, model));
  const filtered = list.filter(model => model.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = choice?.group === activeGroup ? choice?.model : isCurrent && !choice ? value : "";
  const loading = !account || (activeGroup != null && activeGroup !== legacyGroup && !groupCatalog);
  const label = {text: "文字", image: "图片", video: "视频"}[kind];
  const keyName = kind === "text" ? "Codex++ FastAiApi" : "Codex++ FastAiApi Media";
  const ensureKey = (group: string, dedicated = false) => api<ModelGroupKey>("ensure_group_key", {
    group_id: group, name: keyName, dedicated,
  });
  const apply = async () => {
    if (activeGroup === null || !selected || !list.includes(selected)) return;
    setSaving(true);
    setLocked(true);
    setError("");
    try {
      if (activeGroup === legacyGroup) {
        await onApply({model: selected, groupId: null, keyId});
      } else {
        const fresh = await api<{items: ModelGroupKey[]}>("keys");
        const candidates = fresh.items.filter(key => key.status === "active" && keyGroup(key, platform) === activeGroup);
        if (!candidates.length) candidates.push(await ensureKey(activeGroup));
        const preferred = candidates.find(key => key.id === keyId);
        const ordered = preferred ? [preferred, ...candidates.filter(key => key !== preferred)] : candidates;
        let key: ModelGroupKey | undefined;
        for (const candidate of ordered) {
          const permitted = await invoke<string[]>("fastaiapi_models", {keyId: candidate.id});
          if (permitted.includes(selected)) {
            key = candidate;
            break;
          }
        }
        if (!key && candidates.some(candidate => candidate.name === keyName)) {
          throw new Error("此分组的专用 Key 未开放所选模型，请在平台检查模型权限。");
        }
        key ??= await ensureKey(activeGroup, true);
        await onApply({model: selected, groupId: activeGroup, keyId: key.id});
      }
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
      setLocked(false);
    }
  };
  const browse = async (group: string) => {
    if (busy || saving || preparing) return;
    setBrowsedGroup(group);
    setChoice(null);
    setQuery("");
    setError("");
    setKeyError("");
    if (group === legacyGroup || account?.keys.some(key => key.status === "active" && keyGroup(key, platform) === group)) return;
    setPreparing(true);
    setLocked(true);
    try {
      const key = await ensureKey(group);
      setAccount(current => current && {
        ...current, keys: [...current.keys.filter(existing => existing.id !== key.id), key],
      });
    } catch (cause) {
      setKeyError(String(cause));
    } finally {
      setPreparing(false);
      setLocked(false);
    }
  };
  const working = saving || preparing;
  const groupButton = (id: string, name: string, description?: string | null, rate?: number) =>
    <button type="button" key={id} className="fast-model-group" aria-pressed={activeGroup === id} disabled={busy || working}
      onClick={() => void browse(id)} title={description || name}>
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
              <select value={activeGroup ?? ""} disabled={busy || working || !groups.length}
                onChange={event => void browse(event.target.value)}>
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

              {!groups.length && !showLegacy && !groupError && <p>{account ? "暂无可用分组" : "正在加载分组…"}</p>}
            </div>
            {groupError && <p className="fast-model-hint" role="status">{groupError}</p>}
          </aside>
          <section className="fast-model-results" aria-label={`${label}模型`}>
            <div className="fast-group-caption">
              <span>{groups.find(group => group.id === activeGroup)?.name || (showLegacy ? "现有连接" : label + "模型")} · {list.length} 个
                {kind === "text" && pricing ? ` · ${pricing.currency === "CNY" ? "人民币" : "美元"} / 百万 tokens` : ""}</span>
              {activeGroup && !activeKeys.length && !keyError && <button type="button" disabled={busy || working}
                onClick={() => void browse(activeGroup)}>准备 Key</button>}
              <button type="button" disabled={busy || working || !account} onClick={() => setRevision(n => n + 1)}><RefreshCw size={13}/>刷新列表</button>
            </div>
            <label className="fast-group-search"><Search size={16}/><input aria-label="搜索模型" placeholder="搜索模型名称…" value={query} onChange={event => setQuery(event.target.value)}/></label>
            {groupCatalog?.warning && <p className="fast-model-hint fast-model-warning" role="status">{groupCatalog.warning}</p>}
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
                    {price?.unit_price != null ? <span className="fast-model-unit-price">{priceYuan(price.unit_price, pricing?.currency)}<small>每次调用</small></span>
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
          {(error || keyError) && <div className="fast-payment-error" role="alert">
            {error || keyError}
            {keyError && activeGroup !== null && <button type="button" disabled={working}
              onClick={() => void browse(activeGroup)}>重试准备 Key</button>}
          </div>}
          {applyHint && <p className="fast-model-hint">{applyHint}</p>}
          <p className="fast-model-hint">{pricing?.rate_multiplier != null && <>价格已计入分组倍率 {pricing.rate_multiplier}×。 </>}
            {kind === "text" ? "切换后重启 Codex 生效。" : "默认分组与模型用于后续媒体任务。"}
          </p>
          <button type="button" className="fast-pay-primary" disabled={busy || working || Boolean(keyError) || !selected || !list.includes(selected)}
            onClick={() => void apply()}>{preparing ? "正在准备分组 Key…" : saving ? "正在应用…" : "设为默认分组和模型"}</button>
        </footer>
      </div>
    </dialog>, document.body
  );
}

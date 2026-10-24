import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
const logo = new URL("./logo.svg", import.meta.url).href;
import "./account.css";
import "./overview.css";
import { RefreshCw, Plus, ArrowUpRight, LogOut, Sparkles } from "lucide-react";
import { Recharge, type Package, type Order } from "./Recharge";
import "./gate.css";
import { ModelPicker } from "./ModelPicker";
import { KeyDialog } from "./KeyDialog";
import { KeySelector } from "./KeySelector";
import { createGroupCache, type AccountGroup } from "./groupCache";
import { configureAccount } from "./onboarding";

type User = { email: string; username?: string; balance: number; session_persistent?: boolean; password_remembered?: boolean };
type Key = { id: number; name: string; status: string };
const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", { action, body, id });

const AccountView = createContext<ReactNode>(null);
export default function Account() { return useContext(AccountView); }

// 根入口只包一层；登录状态和账户卡片共享生命周期，不修改上游 App 的路由。
export function FastAiApiGate({children}: {children: ReactNode}) {
  const [restoring, setRestoring] = useState(true);
  const [remember, setRemember] = useState(false);
  const restoreLogin = async () => {
    const saved = await api<{email?: string; password?: string}>("remembered_login");
    setRemember(Boolean(saved.email && saved.password));
    setEmail(saved.email ?? ""); setPassword(saved.password ?? "");
  };
  const [user, setUser] = useState<User | null>(null), [register, setRegister] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [code, setCode] = useState(""), [invitation, setInvitation] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [keys, setKeys] = useState<Key[]>([]), [keyId, setKeyId] = useState(0), [models, setModels] = useState<string[]>([]), [model, setModel] = useState("");
  const [groups, setGroups] = useState<AccountGroup[]>([]), [keyDialog, setKeyDialog] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false), [groupsError, setGroupsError] = useState("");
  const groupCache = useRef(createGroupCache(() => api<AccountGroup[]>("groups")));
  const loadGroups = async () => {
    const cache = groupCache.current;
    setGroupsLoading(true); setGroupsError("");
    try { const data = await cache(); if (cache === groupCache.current) setGroups(data); return data; }
    catch(e) { if(cache === groupCache.current) setGroupsError(String(e)); throw e; }
    finally { if(cache === groupCache.current) setGroupsLoading(false); }
  };
  const [recharge, setRecharge] = useState(false), [packages, setPackages] = useState<Package[]>([]), [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<{registration_enabled?: boolean; email_verify_enabled?: boolean; invitation_code_enabled?: boolean} | null>(null);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); } };
  const refresh = async () => setUser(await api<User>("me"));
  const loadKeys = async () => { const data = await api<{items: Key[]}>("keys"); setKeys(data.items ?? []); return data.items ?? []; };
  const configure = async (available: Key[]) => {
    const configured = await configureAccount(available, {
      groups: loadGroups,
      createKey: groupId => api("create_key", {name: "Codex++ FastAiApi", group_id: groupId}),
      models: keyId => invoke("fastaiapi_models", {keyId}),
      current: () => api("configuration"),
      apply: (keyId, model) => invoke("fastaiapi_configure", {keyId, model}),
    });
    setKeyId(configured.id); setModels(configured.models); setModel(configured.model);
    await loadKeys();
    setNotice("已自动配置模型服务，可以启动 Codex。");
  };
  useEffect(() => {
    void restoreLogin().catch(() => {});
    api<typeof settings>("settings").then(setSettings).catch(e => setError(String(e)));
    api<User>("me").then(async u => {
      setUser(u); setRestoring(false); void loadGroups().catch(() => {});
      const available = await loadKeys();
      const selected = available.find(k => k.status === "active" && k.name === "Codex++ FastAiApi");
      if (selected) {
        setKeyId(selected.id);
        const list = await invoke<string[]>("fastaiapi_models", {keyId: selected.id});
        setModels(list);
        const current = await api<{key_id?: number; model?: string}>("configuration");
        if (current.key_id === selected.id) setModel(current.model ?? "");
        // 恢复会话仅展示已有默认模型，不覆盖配置。
      }
    }).catch(() => {}).finally(() => setRestoring(false));
  }, []);
  const login = () => work(async () => {
    if (register && password !== confirm) throw new Error("两次密码不一致");
    const u = await api<User>(register ? "register" : "login", {email, password, remember_password: remember, verify_code: code, invitation_code: invitation || undefined});
    groupCache.current = createGroupCache(() => api<AccountGroup[]>("groups")); setGroups([]);
    setUser(u); setPassword(""); setConfirm(""); void loadGroups().catch(() => {});
    await configure(await loadKeys());
    if (remember && !u.password_remembered) setError("登录成功，但系统钥匙串未保存账号密码。请允许访问钥匙串后重新登录保存。");
    if (!u.session_persistent) setNotice("模型服务已配置。系统凭据库不可用，本次仅保持内存登录，重启后需重新登录。");
  });
  const selectKey = (id: number) => work(async () => {
    setKeyId(id); setModels([]); setModel(""); setNotice("");
    const list = await invoke<string[]>("fastaiapi_models", {keyId: id}); setModels(list);
    const current = await api<{key_id?: number; model?: string}>("configuration");
    if (current.key_id === id) setModel(current.model ?? "");
    if (!list.length) setNotice("该 Key 没有可用的对话模型，请选择对话分组 Key。");
  });
  const card = <section className={`fast-account${user ? " is-connected" : ""}`} aria-label="FastAiApi 账户">
    <header className="fast-account-head"><div className="fast-brand"><img src={logo} alt="FastAiApi"/><div><div className="fast-brand-title"><h2>FastAiApi</h2>{user && <span className="fast-connected"><i/>已连接</span>}</div><p>{user ? user.email : "登录账号，连接模型，开始工作。"}</p></div></div>{user && <div className="fast-wallet"><div><span className="fast-wallet-label">可用 API 额度 <button className="fast-icon-button" title="刷新余额" aria-label="刷新余额" disabled={busy} onClick={() => void work(refresh)}><RefreshCw size={14}/></button></span><strong>{Number.isFinite(user.balance) ? `$${user.balance.toFixed(2)}` : "暂不可用"}<small>USD</small></strong></div><button className="fast-primary" disabled={busy} onClick={() => void work(async () => { setPackages(await api<Package[]>("packages")); setOrders(await api<Order[]>("orders")); setRecharge(true); })}><Plus size={16}/>账户充值</button></div>}</header>
    {error && <p role="alert" className="fast-error">{error}</p>}{notice && <p role="status" className="fast-notice">{notice}</p>}
    {!user ? <form onSubmit={e => { e.preventDefault(); void login(); }}>
      <nav><button type="button" onClick={() => setRegister(false)} aria-pressed={!register}>登录</button><button type="button" onClick={() => setRegister(true)} aria-pressed={register}>注册账号</button></nav>
      <h2>{register ? "创建你的账号" : "欢迎回来"}</h2><p>{register ? "注册成功后自动完成 Codex 配置。" : "登录后自动连接模型服务。"}</p><div className="fast-fields"><label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label><label>密码<input type="password" minLength={8} autoComplete={register ? "new-password" : "current-password"} required value={password} onChange={e => setPassword(e.target.value)}/></label>
      {register && <><label>确认密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)}/></label>{settings?.email_verify_enabled && <label>邮箱验证码<div className="fast-row"><input required value={code} onChange={e => setCode(e.target.value)}/><button type="button" disabled={busy || !email} onClick={() => void work(async () => { await api("verify", {email}); setNotice("验证码已发送，请查收邮箱。"); })}>发送验证码</button></div></label>}{settings?.invitation_code_enabled && <label>邀请码<input value={invitation} onChange={e => setInvitation(e.target.value)}/></label>}</>}
      </div><label className="fast-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={e => { const checked = e.target.checked; if (checked) setRemember(true); else void work(async () => { await api("forget_login"); setRemember(false); setPassword(""); }); }}/>记住账号密码</label><button disabled={busy || (register && (!settings || !settings.registration_enabled))} type="submit">{busy ? "处理中…" : register ? "注册并自动配置" : "登录并自动配置"}</button>
      <p className="fast-muted">勾选后，账号密码仅保存在 macOS 系统钥匙串。取消勾选即可清除；未勾选不保存密码。</p>
    </form> : <>
      <div className="fast-service-grid"><div className="fast-endpoint"><span>模型服务</span><strong>fastaiapi.cloud<span>/v1</span></strong><small>已连接你的 FastAiApi 账户</small></div>
      <ModelPicker models={models} value={model} busy={busy || !keyId} onReload={() => void selectKey(keyId)} onApply={async next => { await invoke("fastaiapi_configure", {keyId, model: next}); setModel(next); setNotice("默认模型已更新，重启 Codex 生效。"); }}/>
      </div><details className="fast-advanced"><summary>高级配置 <span>API Key 与自动连接</span></summary><KeySelector keys={keys} value={keyId} busy={busy} onChange={id => void selectKey(id)}/>
      <div className="fast-row fast-key-actions"><button onClick={() => setKeyDialog(true)}><Plus size={15}/>创建专用 API Key</button><div className="fast-key-retry"><button disabled={busy} title="重新读取账户 Key，复用或创建专用 Key，并重新写入模型连接配置" onClick={() => void work(async () => configure(await loadKeys()))}><RefreshCw size={14}/>重试自动配置</button><small>连接配置失败时使用；会复用或创建专用 Key。</small></div></div></details>
      {keyDialog && <KeyDialog groups={groups} loading={groupsLoading} loadError={groupsError} onRetry={() => void loadGroups().catch(() => {})} onClose={() => setKeyDialog(false)} onCreate={async id => {await api("create_key", {name: "Codex++ FastAiApi", group_id: id}); await loadKeys(); setNotice("已创建专用 Key，请选择它并应用模型配置。");}}/>}
      <footer className="fast-account-footer"><span><Sparkles size={15}/>内置图片与视频创作技能</span><div><button onClick={() => void work(async () => { await invoke("open_external_url", {url: "https://fastaiapi.cloud"}); })}>平台网站<ArrowUpRight size={14}/></button><button disabled={busy} onClick={() => void work(async () => { await api("logout"); groupCache.current = createGroupCache(() => api<AccountGroup[]>("groups")); setGroups([]); setGroupsError(""); setGroupsLoading(false); setKeyDialog(false); await restoreLogin(); setUser(null); setKeys([]); setModels([]); setKeyId(0); setModel(""); setRecharge(false); setNotice("已退出登录。"); })}><LogOut size={14}/>退出登录</button></div></footer>
      {recharge && <Recharge packages={packages} orders={orders} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/>}
    </>}

  </section>;
  if (restoring) return <div className="fast-gate fast-loading" role="status">正在恢复 FastAiApi 登录状态…</div>;
  if (user) return <AccountView.Provider value={card}>{children}</AccountView.Provider>;
  return <main className="fast-gate"><div className="fast-intro"><small>CODEX · 开始工作</small><div className="fast-wordmark"><img src={logo} alt=""/><h1>FastAi<span>Api</span></h1></div><p>登录账号，连接模型，开始工作。</p><ol><li>登录或注册</li><li>自动配置密钥</li><li>启动 Codex</li></ol><small>默认模型 gpt-5.6-sol</small></div>{card}</main>;
}

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const logo = new URL("./logo.svg", import.meta.url).href;
import "./account.css";
import "./overview.css";
import { RefreshCw, Plus, ArrowUpRight, LogOut, Sparkles } from "lucide-react";
import { SubApiSubscriptions } from "./SubApiSubscriptions";
import { SubApiRecharge } from "./SubApiRecharge";
import { NewApiRecharge } from "./NewApiRecharge";
import { ServiceRouteProvider, RouteSelector, usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { MediaModels, modelKind } from "./MediaModels";
import "./gate.css";
import { ModelPicker } from "./ModelPicker";
import { KeyDialog } from "./KeyDialog";
import { KeySelector } from "./KeySelector";
import { createGroupCache, type AccountGroup } from "./groupCache";
import { configureAccount } from "./onboarding";

type User = { email: string; username?: string; balance: number; currency?: string; session_persistent?: boolean; password_remembered?: boolean; media_setup?: {warning?: string} };
type Key = { id: number; name: string; status: string; group?: string };


const AccountView = createContext<ReactNode>(null);
export default function Account() { return useContext(AccountView); }

// 根入口只包一层；登录状态和账户卡片共享生命周期，不修改上游 App 的路由。
export function FastAiApiGate({children}: {children: ReactNode}) {
  return <ServiceRouteProvider><PlatformGate>{children}</PlatformGate></ServiceRouteProvider>;
}
function PlatformGate({children}: {children: ReactNode}) {
  const {routes} = useServiceRoutes();
  const [register, setRegister] = useState(false);
  return <AccountGate key={routes.platform} register={register} setRegister={setRegister}>{children}</AccountGate>;
}
function AccountGate({children, register, setRegister}: {children: ReactNode; register: boolean; setRegister: (value: boolean)=>void}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", {action, body, id});
  const {routes, setLocked, setAuthenticated, warning: routeWarning} = useServiceRoutes();
  const platformName = routes.platforms.find(p=>p.id === routes.platform)!.name;
  const origin = routes.items.find(r => r.id === routes.selected)!.origin;
  const [restoring, setRestoring] = useState(true);
  const [remember, setRemember] = useState(false);
  const restoreLogin = async () => {
    const saved = await api<{email?: string; password?: string}>("remembered_login");
    setRemember(Boolean(saved.email && saved.password));
    setEmail(saved.email ?? ""); setPassword(saved.password ?? "");
  };
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [code, setCode] = useState(""), [invitation, setInvitation] = useState("");
  const [requires2fa, setRequires2fa] = useState(false), [totp, setTotp] = useState("");
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
  const [recharge, setRecharge] = useState(false);
  const [settings, setSettings] = useState<{registration_enabled?: boolean; email_verify_enabled?: boolean; invitation_code_enabled?: boolean; captcha_required?: boolean} | null>(null);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setLocked(true); setError(""); try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); setLocked(false); } };
  const refresh = async () => setUser(await api<User>("me"));
  const loadKeys = async () => { const data = await api<{items: Key[]}>("keys"); setKeys(data.items ?? []); return data.items ?? []; };
  const configure = async (available: Key[]) => {
    const configured = await configureAccount(available, {
      groups: loadGroups,
      createKey: groupId => api("create_key", {name: "Codex++ FastAiApi", group_id: groupId}),
      models: async keyId => (await invoke<string[]>("fastaiapi_models", {keyId})).filter(m => modelKind(m) === "text"),
      current: () => api("configuration"),
      apply: (keyId, model) => invoke("fastaiapi_configure", {keyId, model}),
    });
    setKeyId(configured.id); setModels(await invoke<string[]>("fastaiapi_models", {keyId: configured.id})); setModel(configured.model);
    await loadKeys();
    setNotice("已自动配置模型服务，可以启动 Codex。");
  };
  useEffect(() => {
    let disposed = false;
    setLocked(true);
    void restoreLogin().catch(() => {});
    api<User>("me").then(async u => {
      if (disposed) return;
      setUser(u); setAuthenticated(true); setRestoring(false); void loadGroups().catch(() => {});
      const available = await loadKeys();
      const current = await api<{key_id?: number; model?: string}>("configuration");
      const selected = available.find(k => k.status === "active" && k.id === current.key_id)
        ?? available.find(k => k.status === "active" && k.name === "Codex++ FastAiApi")
        ?? available.find(k => k.status === "active" && k.group === "default");
      if (selected) {
        setKeyId(selected.id);
        const list = await invoke<string[]>("fastaiapi_models", {keyId: selected.id});
        setModels(list);
        if (current.key_id === selected.id) setModel(current.model ?? "");
        // 恢复会话仅展示已有默认模型，不覆盖配置。
      }
    }).catch(e => {setError(/请先登录|登录已过期/.test(String(e)) ? "" : String(e));}).finally(() => {if(!disposed) {setRestoring(false); setLocked(false);}});
    return ()=>{disposed = true;};
  }, []);
  useEffect(() => {
    let cancelled=false;
    setSettings(null); setError("");
    api<typeof settings>("settings").then(value=>{if(!cancelled)setSettings(value);}).catch(e=>{if(!cancelled)setError(String(e));});
    return ()=>{cancelled=true;};
  }, [routes.selected]);
  const login = () => work(async () => {
    if (register && password !== confirm) throw new Error("两次密码不一致");
    const u = await api<User & {requires_2fa?: boolean; warning?: string}>(requires2fa ? "login_2fa" : register ? "register" : "login", requires2fa ? {totp_code: totp} : {email, password, remember_password: remember, verify_code: code, invitation_code: invitation || undefined});
    if (u.requires_2fa) {setRequires2fa(true); setPassword(""); setNotice("请输入身份验证器中的六位验证码。"); return;}
    setRequires2fa(false); setTotp("");
    groupCache.current = createGroupCache(() => api<AccountGroup[]>("groups")); setGroups([]);
    setUser(u); setAuthenticated(true); setPassword(""); setConfirm(""); void loadGroups().catch(() => {});
    await configure(await loadKeys());
    if (u.warning) setError(u.warning);
    if (u.media_setup?.warning) setError(`媒体环境配置需要处理：${u.media_setup.warning}`);
    if (remember && !u.password_remembered) setError("登录成功，但系统凭据库未保存账号密码。请允许访问系统凭据库后重新登录保存。");
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
    <header className="fast-account-head"><div className="fast-brand"><img src={logo} alt="FastAiApi"/><div><div className="fast-brand-title"><h2>FastAiApi <small className="fast-platform-badge">{platformName}</small></h2>{user && <span className="fast-connected"><i/>已连接</span>}</div><p>{user ? user.email : "登录账号，连接模型，开始工作。"}</p></div></div>{user && <div className="fast-wallet"><div><span className="fast-wallet-label">可用 API 额度 <button className="fast-icon-button" title="刷新余额" aria-label="刷新余额" disabled={busy} onClick={() => void work(refresh)}><RefreshCw size={14}/></button></span><strong>{Number.isFinite(user.balance) ? `${user.currency === "CNY" ? "¥" : user.currency === "USD" ? "$" : ""}${user.balance.toFixed(2)}` : "暂不可用"}<small>{user.currency === "CNY" ? "人民币" : user.currency === "USD" ? "美元" : user.currency}</small></strong></div><button className="fast-primary" disabled={busy} onClick={() => void work(async () => { setRecharge(true); })}><Plus size={16}/>账户充值</button></div>}</header>
    {(error || routeWarning) && <p role="alert" className="fast-error">{error || routeWarning}</p>}{notice && <p role="status" className="fast-notice">{notice}</p>}
    {!user ? <form onSubmit={e => { e.preventDefault(); void login(); }}>
      <nav><button type="button" disabled={busy} onClick={() => {setRegister(false); setRequires2fa(false);}} aria-pressed={!register}>登录</button><button type="button" disabled={busy} onClick={() => {setRegister(true); setRequires2fa(false);}} aria-pressed={register}>注册账号</button></nav>
      {!register && <><h2>欢迎回来</h2><p>登录后自动连接模型服务。</p></>}<div className="fast-fields">
      {requires2fa ? <label>身份验证器验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={totp} onChange={e=>setTotp(e.target.value)}/></label> : <><label>{register || routes.platform === "subapi" ? "邮箱" : "邮箱或用户名"}<input type={register || routes.platform === "subapi" ? "email" : "text"} autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
      {register && settings?.email_verify_enabled && <label>邮箱验证码<div className="fast-row"><input required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)}/><button type="button" disabled={busy || !email} onClick={() => void work(async () => {await api("verify", {email}); setNotice("验证码已发送，请查收邮箱。");})}>发送验证码</button></div></label>}
      <label>密码<input type="password" minLength={8} autoComplete={register ? "new-password" : "current-password"} required value={password} onChange={e => setPassword(e.target.value)}/></label>
      {register && <><label>确认密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)}/></label>{settings?.invitation_code_enabled && <label>邀请码（选填）<input value={invitation} onChange={e => setInvitation(e.target.value)}/></label>}</>}
      </>}</div>{settings?.captcha_required && <p className="fast-muted">当前平台可能要求人机验证。如无法登录，请前往平台网站完成验证。</p>}<label className="fast-remember"><input type="checkbox" checked={remember} disabled={busy || requires2fa} onChange={e => { const checked = e.target.checked; if (checked) setRemember(true); else void work(async () => { await api("forget_login"); setRemember(false); setPassword(""); }); }}/>记住账号密码</label><button disabled={busy || (register && (!settings || !settings.registration_enabled))} type="submit">{busy ? "处理中…" : requires2fa ? "验证并登录" : register ? "注册并自动配置" : "登录并自动配置"}</button>
      <p className="fast-muted">勾选后，账号密码仅保存在 macOS 系统钥匙串。取消勾选即可清除；未勾选不保存密码。</p>
    </form> : <>
      <div className="fast-service-grid"><div className="fast-endpoint"><span>模型服务</span><strong>{origin}<span>/v1</span></strong><small>已连接你的 {platformName} 账户</small></div>
      <ModelPicker keyId={keyId} models={models.filter(m => modelKind(m) === "text")} value={model} busy={busy || !keyId} onReload={() => void selectKey(keyId)} onApply={async next => { await invoke("fastaiapi_configure", {keyId, model: next}); setModel(next); setNotice("默认模型已更新，重启 Codex 生效。"); }}/>
      </div>{routes.platform === "subapi" && <SubApiSubscriptions/>}<MediaModels keyId={keyId} models={models}/><details className="fast-advanced"><summary>高级配置 <span>API Key 与自动连接</span></summary><KeySelector keys={keys} value={keyId} busy={busy} onChange={id => void selectKey(id)}/>
      <div className="fast-row fast-key-actions"><button onClick={() => setKeyDialog(true)}><Plus size={15}/>创建专用 API Key</button><div className="fast-key-retry"><button disabled={busy} title="重新读取账户 Key，复用或创建专用 Key，并重新写入模型连接配置" onClick={() => void work(async () => configure(await loadKeys()))}><RefreshCw size={14}/>重试自动配置</button><small>连接配置失败时使用；会复用或创建专用 Key。</small></div></div></details>
      {keyDialog && <KeyDialog groups={groups} loading={groupsLoading} loadError={groupsError} onRetry={() => void loadGroups().catch(() => {})} onClose={() => setKeyDialog(false)} onCreate={async id => {await api("create_key", {name: "Codex++ FastAiApi", group_id: id}); await loadKeys(); setNotice("已创建专用 Key，请选择它并应用模型配置。");}}/>}
      <footer className="fast-account-footer"><span><Sparkles size={15}/>内置图片、视频与音频技能</span><div><button onClick={() => void work(async () => { await invoke("open_external_url", {url: origin}); })}>平台网站<ArrowUpRight size={14}/></button><button disabled={busy} onClick={() => void work(async () => { const result = await api<{warning?: string}>("logout"); groupCache.current = createGroupCache(() => api<AccountGroup[]>("groups")); setGroups([]); setGroupsError(""); setGroupsLoading(false); setKeyDialog(false); setUser(null); setAuthenticated(false); await restoreLogin(); setKeys([]); setModels([]); setKeyId(0); setModel(""); setRecharge(false); setNotice(result.warning || "已退出登录。"); })}><LogOut size={14}/>退出登录</button></div></footer>
      {recharge && (routes.platform === "subapi" ? <SubApiRecharge origin={origin} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/> : <NewApiRecharge origin={origin} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/>)}
    </>}

  </section>;
  if (restoring) return <div className="fast-gate fast-loading" role="status">正在恢复 FastAiApi 登录状态…</div>;
  if (user) return <AccountView.Provider value={card}>{children}</AccountView.Provider>;
  return <main className="fast-gate"><RouteSelector login/><div className="fast-intro"><small>CODEX · 开始工作 · 高效神器</small><div className="fast-wordmark"><img src={logo} alt=""/><h1>FastAi<span>Api</span></h1></div><p>登录账号，连接模型，开始工作。</p><ol><li>登录或注册</li><li>自动配置密钥</li><li>启动 Codex</li></ol><small>文字 · 图片 · 视频</small></div>{card}</main>;
}

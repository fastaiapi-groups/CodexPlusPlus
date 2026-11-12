import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const logo = new URL("./logo.svg", import.meta.url).href;
import "./account.css";
import "./overview.css";
import { RefreshCw, Plus, ArrowUpRight, LogOut, Sparkles } from "lucide-react";
import { SubApiSubscriptions } from "./SubApiSubscriptions";
import { SubApiRecharge } from "./SubApiRecharge";
import { NewApiRecharge } from "./NewApiRecharge";
import { createNewApiRechargeData, createRechargeData, type NewApiOrder, type NewApiRechargeInfo, type SubApiOrder, type SubApiRechargeInfo } from "./rechargeData";
import { ServiceRouteProvider, RouteSelector, usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { MediaModels } from "./MediaModels";
import "./gate.css";
import { ModelPicker } from "./ModelPicker";
import { createModelDirectory, loadModelDirectory, type GroupCatalogs } from "./modelDirectory";
import { ModelDirectoryContext } from "./ModelDirectoryContext";
import type { ModelGroupKey } from "./modelGroups";

type User = { email: string; username?: string; balance: number; currency?: string; session_persistent?: boolean; password_remembered?: boolean };


const AccountView = createContext<((officialMode: boolean) => ReactNode) | null>(null);
export default function Account({officialMode = false}: {officialMode?: boolean}) { return useContext(AccountView)?.(officialMode) ?? null; }

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
  const walletOrigin = routes.platforms.find(p=>p.id === routes.platform)!.origin;
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
  const [configuration, setConfiguration] = useState<{key_id?: number; model?: string}>({});
  const account = user?.email;
  const rechargeData = useMemo(() => ({
    newapi: createNewApiRechargeData(
      () => api<NewApiRechargeInfo>("topup_info"),
      () => api<{items?: NewApiOrder[]}>("orders").then(result => result.items ?? []),
      amount => api<string>("quote", {amount}),
    ),
    subapi: createRechargeData(
      () => api<SubApiRechargeInfo>("checkout_info"),
      () => api<{items?: SubApiOrder[]}>("orders").then(result => result.items ?? []),
    ),
  }), [routes.platform, routes.selected, account]);
  useEffect(() => {
    if (account === undefined) return;
    const data = rechargeData[routes.platform];
    void data.info.load().catch(() => {});
    if (routes.platform === "newapi") void rechargeData.newapi.initialQuote.load().catch(() => {});
    void data.orders.load().catch(() => {});
  }, [rechargeData, routes.platform, account]);
  const directory = useMemo(() => createModelDirectory(() => loadModelDirectory(routes.platform, {
    catalog: () => api<GroupCatalogs>("group_model_catalogs"),
    keys: () => api<{items: ModelGroupKey[]}>("keys"),
    models: keyId => invoke<string[]>("fastaiapi_models", {keyId}),
  })), [routes.platform, routes.selected, account]);
  useEffect(() => {
    if (account !== undefined) void directory.load();
  }, [directory, account]);
  const [recharge, setRecharge] = useState(false);
  const [settings, setSettings] = useState<{registration_enabled?: boolean; email_verify_enabled?: boolean; invitation_code_enabled?: boolean; captcha_required?: boolean} | null>(null);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setLocked(true); setError(""); try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); setLocked(false); } };
  const refresh = async () => setUser(await api<User>("me"));
  useEffect(() => {
    let disposed = false;
    setLocked(true);
    void restoreLogin().catch(() => {});
    api<User>("me").then(async u => {
      if (disposed) return;
      setUser(u); setAuthenticated(true); setRestoring(false);
    }).catch(e => {setError(/请先登录|登录已过期/.test(String(e)) ? "" : String(e));}).finally(() => {if(!disposed) {setRestoring(false); setLocked(false);}});
    return ()=>{disposed = true;};
  }, []);
  useEffect(() => {
    let cancelled=false;
    setSettings(null); setError("");
    api<typeof settings>("settings").then(value=>{if(!cancelled)setSettings(value);}).catch(e=>{if(!cancelled)setError(String(e));});
    return ()=>{cancelled=true;};
  }, [routes.selected]);
  useEffect(() => {
    if (account === undefined) return;
    let disposed = false;
    void api<typeof configuration>("configuration").then(value => {
      if (!disposed) setConfiguration(value);
    }).catch(error => {if (!disposed) setError(String(error));});
    return () => {disposed = true;};
  }, [account, routes.selected]);

  const login = () => work(async () => {
    if (register && password !== confirm) throw new Error("两次密码不一致");
    const u = await api<User & {requires_2fa?: boolean; warning?: string}>(requires2fa ? "login_2fa" : register ? "register" : "login", requires2fa ? {totp_code: totp} : {email, password, remember_password: remember, verify_code: code, invitation_code: invitation || undefined});
    if (u.requires_2fa) {setRequires2fa(true); setPassword(""); setNotice("请输入身份验证器中的六位验证码。"); return;}
    setRequires2fa(false); setTotp("");
    setUser(u); setAuthenticated(true); setPassword(""); setConfirm("");
    if (u.warning) setError(u.warning);
    if (remember && !u.password_remembered) setError("登录成功，但系统凭据库未保存账号密码。请允许访问系统凭据库后重新登录保存。");
    if (!u.session_persistent) setNotice("系统凭据库不可用，本次仅保持内存登录，重启后需重新登录。");
  });
  const card = (officialMode = false) => <section className={`fast-account${user ? " is-connected" : ""}`} aria-label={`${platformName} 账户`}>
    <header className="fast-account-head"><div className="fast-brand"><img src={logo} alt=""/><div><div className="fast-brand-title"><h2>{platformName}</h2>{user && <span className="fast-connected"><i/>已连接</span>}</div><p>{user ? user.email : "登录账号，连接模型，开始工作。"}</p></div></div>{user && <div className="fast-wallet"><div><span className="fast-wallet-label">可用 API 额度 <button className="fast-icon-button" title="刷新余额" aria-label="刷新余额" disabled={busy} onClick={() => void work(refresh)}><RefreshCw size={14}/></button></span><strong>{Number.isFinite(user.balance) ? `${user.currency === "CNY" ? "¥" : user.currency === "USD" ? "$" : ""}${user.balance.toFixed(2)}` : "暂不可用"}<small>{user.currency === "CNY" ? "人民币" : user.currency === "USD" ? "美元" : user.currency}</small></strong></div><button className="fast-primary" disabled={busy} onClick={() => void work(async () => { setRecharge(true); })}><Plus size={16}/>账户充值</button></div>}</header>
    {(error || routeWarning) && <p role="alert" className="fast-error">{error || routeWarning}</p>}{notice && <p role="status" className="fast-notice">{notice}</p>}
    {!user ? <form onSubmit={e => { e.preventDefault(); void login(); }}>
      <nav><button type="button" disabled={busy} onClick={() => {setRegister(false); setRequires2fa(false);}} aria-pressed={!register}>登录</button><button type="button" disabled={busy} onClick={() => {setRegister(true); setRequires2fa(false);}} aria-pressed={register}>注册账号</button></nav>
      {!register && <><h2>欢迎回来</h2><p>登录后可选择默认分组和模型。</p></>}<div className="fast-fields">
      {requires2fa ? <label>身份验证器验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={totp} onChange={e=>setTotp(e.target.value)}/></label> : <><label>{register || routes.platform === "subapi" ? "邮箱" : "邮箱或用户名"}<input type={register || routes.platform === "subapi" ? "email" : "text"} autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
      {register && settings?.email_verify_enabled && <label>邮箱验证码<div className="fast-row"><input required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)}/><button type="button" disabled={busy || !email} onClick={() => void work(async () => {await api("verify", {email}); setNotice("验证码已发送，请查收邮箱。");})}>发送验证码</button></div></label>}
      <label>密码<input type="password" minLength={8} autoComplete={register ? "new-password" : "current-password"} required value={password} onChange={e => setPassword(e.target.value)}/></label>
      {register && <><label>确认密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)}/></label>{settings?.invitation_code_enabled && <label>邀请码（选填）<input value={invitation} onChange={e => setInvitation(e.target.value)}/></label>}</>}
      </>}</div>{settings?.captcha_required && <p className="fast-muted">当前平台可能要求人机验证。如无法登录，请前往平台网站完成验证。</p>}<label className="fast-remember"><input type="checkbox" checked={remember} disabled={busy || requires2fa} onChange={e => { const checked = e.target.checked; if (checked) setRemember(true); else void work(async () => { await api("forget_login"); setRemember(false); setPassword(""); }); }}/>记住账号密码</label><button disabled={busy || (register && (!settings || !settings.registration_enabled))} type="submit">{busy ? "处理中…" : requires2fa ? "验证并登录" : register ? "注册并登录" : "登录"}</button>
      <p className="fast-muted">勾选后，账号密码仅保存在 macOS 系统钥匙串。取消勾选即可清除；未勾选不保存密码。</p>
    </form> : <>
      <div className="fast-endpoint"><span>模型服务</span><strong>{origin}<span>/v1</span></strong><small>已连接你的 {platformName} 账户</small></div>
      {officialMode && <p className="fast-muted">当前 Codex 使用官方账号，下方保留你的 {platformName} 模型配置。</p>}
      {routes.platform === "subapi" && <SubApiSubscriptions/>}
      <MediaModels key={routes.selected} textModel={configuration.model} textPicker={
        <ModelPicker keyId={configuration.key_id ?? 0} value={configuration.model ?? ""}
          busy={busy || officialMode} onApply={async ({model, keyId}) => {
            setConfiguration({key_id: keyId, model});
            setNotice("默认分组和模型已更新，重启 Codex 生效。");
          }}/>
      }/>
      <footer className="fast-account-footer"><span><Sparkles size={15}/>内置图片与视频工具</span><div><button onClick={() => void work(async () => { await invoke("open_external_url", {url: origin}); })}>平台网站<ArrowUpRight size={14}/></button><button disabled={busy} onClick={() => void work(async () => { const result = await api<{warning?: string}>("logout"); setUser(null); setAuthenticated(false); setConfiguration({}); await restoreLogin(); setRecharge(false); setNotice(result.warning || "已退出登录。"); })}><LogOut size={14}/>退出登录</button></div></footer>
      {recharge && (routes.platform === "subapi" ? <SubApiRecharge origin={walletOrigin} currency={user.currency} data={rechargeData.subapi} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/> : <NewApiRecharge origin={origin} walletOrigin={walletOrigin} currency={user.currency} data={rechargeData.newapi} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/>)}
    </>}
    {!user && busy && <p className="fast-muted" role="status">正在登录平台，请留意系统凭据授权提示。</p>}
  </section>;
  if (restoring) return <div className="fast-gate fast-loading" role="status">正在恢复 {platformName} 登录状态…</div>;
  if (user) return <ModelDirectoryContext.Provider value={directory}><AccountView.Provider value={card}>{children}</AccountView.Provider></ModelDirectoryContext.Provider>;
  return <main className="fast-gate"><RouteSelector login/><div className="fast-intro"><small>CODEX · 开始工作 · 高效神器</small><div className="fast-wordmark"><img src={logo} alt=""/><h1>{platformName}</h1></div><p>登录账号，连接模型，开始工作。</p><ol><li>登录或注册</li><li>选择默认模型</li><li>启动 Codex</li></ol><small>文字 · 图片 · 视频</small></div>{card()}</main>;
}

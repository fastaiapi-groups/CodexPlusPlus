import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
const logo = new URL("./logo.svg", import.meta.url).href;
import "./account.css";
import "./gate.css";
import { ModelPicker } from "./ModelPicker";
import { configureAccount } from "./onboarding";

type User = { email: string; username?: string; balance: number; session_persistent?: boolean };
type Key = { id: number; name: string; status: string };
type Package = { id: string; name: string; amount_cents: number; credit: string };
type Order = { id: string; status: string; amount_cents: number; credit: string; gateway_status: string; payment_type: string; reversed_at?: string };
type Checkout = { order: Order; state: string; qr_code?: string; qr_kind?: string };
const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", { action, body, id });

const AccountView = createContext<ReactNode>(null);
export default function Account() { return useContext(AccountView); }

// 根入口只包一层；登录状态和账户卡片共享生命周期，不修改上游 App 的路由。
export function FastAiApiGate({children}: {children: ReactNode}) {
  const [restoring, setRestoring] = useState(true);
  const [user, setUser] = useState<User | null>(null), [register, setRegister] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [code, setCode] = useState(""), [invitation, setInvitation] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [keys, setKeys] = useState<Key[]>([]), [keyId, setKeyId] = useState(0), [models, setModels] = useState<string[]>([]), [model, setModel] = useState("");
  const [groups, setGroups] = useState<{id: number; name: string}[]>([]), [group, setGroup] = useState("");
  const [recharge, setRecharge] = useState(false), [packages, setPackages] = useState<Package[]>([]), [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<{registration_enabled?: boolean; email_verify_enabled?: boolean; invitation_code_enabled?: boolean} | null>(null);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); } };
  const refresh = async () => setUser(await api<User>("me"));
  const loadKeys = async () => { const data = await api<{items: Key[]}>("keys"); setKeys(data.items ?? []); return data.items ?? []; };
  const configure = async (available: Key[]) => {
    const configured = await configureAccount(available, {
      groups: () => api("groups"),
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
    api<typeof settings>("settings").then(setSettings).catch(e => setError(String(e)));
    api<User>("me").then(async u => {
      setUser(u);
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
    const u = await api<User>(register ? "register" : "login", {email, password, verify_code: code, invitation_code: invitation || undefined});
    setUser(u); setPassword(""); setConfirm("");
    await configure(await loadKeys());
    if (!u.session_persistent) setNotice("模型服务已配置。系统凭据库不可用，本次仅保持内存登录，重启后需重新登录。");
  });
  const selectKey = (id: number) => work(async () => {
    setKeyId(id); setModels([]); setModel(""); setNotice("");
    const list = await invoke<string[]>("fastaiapi_models", {keyId: id}); setModels(list);
    const current = await api<{key_id?: number; model?: string}>("configuration");
    if (current.key_id === id) setModel(current.model ?? "");
    if (!list.length) setNotice("该 Key 没有可用的对话模型，请选择对话分组 Key。");
  });
  const card = <section className="fast-account" aria-label="FastAiApi 账户">
    <header><img src={logo} alt="FastAiApi"/><div><h2>FastAiApi {user && <span className="fast-connected">已连接</span>}</h2><p>{user ? user.email : "登录账号，连接模型，开始工作。"}</p></div>{user && <div className="fast-balance"><small>API 余额（美元额度）</small><strong>{Number.isFinite(user.balance) ? `$${user.balance.toFixed(2)}` : "暂不可用"}</strong></div>}</header>
    {error && <p role="alert" className="fast-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!user ? <form onSubmit={e => { e.preventDefault(); void login(); }}>
      <nav><button type="button" onClick={() => setRegister(false)} aria-pressed={!register}>登录</button><button type="button" onClick={() => setRegister(true)} aria-pressed={register}>注册账号</button></nav>
      <h2>{register ? "创建你的账号" : "欢迎回来"}</h2><p>{register ? "注册成功后自动完成 Codex 配置。" : "登录后自动连接模型服务。"}</p><div className="fast-fields"><label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label><label>密码<input type="password" minLength={8} autoComplete={register ? "new-password" : "current-password"} required value={password} onChange={e => setPassword(e.target.value)}/></label>
      {register && <><label>确认密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)}/></label>{settings?.email_verify_enabled && <label>邮箱验证码<div className="fast-row"><input required value={code} onChange={e => setCode(e.target.value)}/><button type="button" disabled={busy || !email} onClick={() => void work(async () => { await api("verify", {email}); setNotice("验证码已发送，请查收邮箱。"); })}>发送验证码</button></div></label>}{settings?.invitation_code_enabled && <label>邀请码<input value={invitation} onChange={e => setInvitation(e.target.value)}/></label>}</>}
      </div><button disabled={busy || (register && (!settings || !settings.registration_enabled))} type="submit">{busy ? "处理中…" : register ? "注册并自动配置" : "登录并自动配置"}</button>
      <p className="fast-muted">密码不会保存在本机。macOS 登录状态保存在系统钥匙串，到期后需重新登录。</p>
    </form> : <>
      <div className="fast-row"><span>模型服务 https://fastaiapi.cloud/v1</span><button disabled={busy} onClick={() => void work(refresh)}>刷新余额</button><button disabled={busy} onClick={() => void work(async () => { setPackages(await api<Package[]>("packages")); setOrders(await api<Order[]>("orders")); setRecharge(true); })}>去充值</button><button onClick={() => void work(async () => { await invoke("open_external_url", {url: "https://fastaiapi.cloud"}); })}>平台网站 ↗</button><button disabled={busy} onClick={() => void work(async () => { await api("logout"); setUser(null); setKeys([]); setModels([]); setKeyId(0); setModel(""); setRecharge(false); setNotice("已退出账户；已配置的模型服务可在供应商配置中管理。"); })}>退出登录</button></div>
      <ModelPicker models={models} value={model} busy={busy} onReload={() => void selectKey(keyId)} onApply={next => void work(async () => { await invoke("fastaiapi_configure", {keyId, model: next}); setModel(next); setNotice("默认模型已更新，重启 Codex 生效。"); })}/>
      <details><summary>高级：API Key 与自动配置</summary><div className="fast-row"><label>对话 API Key<select value={keyId} disabled={busy} onChange={e => void selectKey(Number(e.target.value))}><option value={0} disabled>选择账户 Key</option>{keys.filter(k => k.status === "active").map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label><button disabled={busy} onClick={() => void work(async () => configure(await loadKeys()))}>重试自动配置</button></div></details>
      <details><summary>创建专用 API Key</summary><button disabled={busy} onClick={() => void work(async () => setGroups(await api("groups")))}>读取可用分组</button><select aria-label="模型分组" value={group} onChange={e => setGroup(e.target.value)}><option value="">选择对话模型分组</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><button disabled={busy || !group} onClick={() => void work(async () => { await api("create_key", {name: "Codex++ FastAiApi", group_id: Number(group)}); await loadKeys(); setNotice("已创建专用 Key，请选择它并应用模型配置。"); })}>创建 Key</button></details>
      {recharge && <Recharge packages={packages} orders={orders} onClose={() => setRecharge(false)} onPaid={() => void work(refresh)}/>}
    </>}
    <p className="fast-muted">内置图片 / Grok / H3 技能随应用提供。图片、Grok 和 H3 分别使用各自分组密钥；H3 使用 newapi.fastaiapi.cloud。</p>
  </section>;
  if (restoring) return <div className="fast-gate fast-loading" role="status">正在恢复 FastAiApi 登录状态…</div>;
  if (user) return <AccountView.Provider value={card}>{children}</AccountView.Provider>;
  return <main className="fast-gate"><div className="fast-intro"><small>CODEX · 开始工作</small><div className="fast-wordmark"><img src={logo} alt=""/><h1>FastAi<span>Api</span></h1></div><p>登录账号，连接模型，开始工作。</p><ol><li>登录或注册</li><li>自动配置密钥</li><li>启动 Codex</li></ol><small>默认模型 gpt-5.6-sol</small></div>{card}</main>;
}

function Recharge({packages, orders, onClose, onPaid}: {packages: Package[]; orders: Order[]; onClose: () => void; onPaid: () => void}) {
  const [packageId, setPackageId] = useState(packages[0]?.id ?? ""), [channel, setChannel] = useState("alipay");
  const [session, setSession] = useState<Checkout | null>(null), [qr, setQr] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const requestId = useRef(crypto.randomUUID()), disposed = useRef(false), paid = useRef(false);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; }; }, []);
  const apply = async (next: Checkout) => {
    if (disposed.current) return; setSession(next);
    if (next.order.status === "paid") { setQr(""); if (!paid.current) { paid.current = true; onPaid(); } return; }
    if (next.state === "expired" || next.order.gateway_status === "expired" || next.order.reversed_at) { setQr(""); return; }
    if (next.qr_code) {
      const image = next.qr_kind === "image" ? (/^data:image\/(png|jpeg|webp);base64,/.test(next.qr_code) ? next.qr_code : "") : await invoke<string>("fastaiapi_qr", {text: next.qr_code});
      if (!disposed.current) setQr(image);
    }
  };
  useEffect(() => {
    if (!session || session.order.status === "paid" || session.state === "expired" || session.order.gateway_status === "expired") return;
    let stopped = false, count = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { const next = await api<Checkout>("order", undefined, session.order.id); if (!stopped) await apply(next); } catch { if (!stopped) setError("暂时无法查询到账状态，已付款请勿重复扫码。"); } if (!stopped && ++count < 200) timer = setTimeout(tick, 3000); };
    timer = setTimeout(tick,3000); return () => { stopped = true; clearTimeout(timer); };
  }, [session?.order.id, session?.order.status, session?.state]);
  const checkout = async (existing?: Order) => {
    setBusy(true); setAttempted(true); setError(""); setQr(""); if (existing) paid.current = false;
    let order = existing ?? session?.order;
    try { order ??= (await api<{order: Order}>("create_order", {package_id: packageId, payment_type: channel, request_id: requestId.current})).order;
      if (!disposed.current) setSession({order, state: "pending"});
      await apply(await api<Checkout>("checkout", {}, order.id));
    } catch(e) {
      // 续付失败也重新读取状态，避免把过期/异常订单继续显示为可付款。
      if (order) { try { await apply(await api<Checkout>("order", undefined, order.id)); } catch { /* 保留原错误，等待手动查单 */ } }
      if (!disposed.current) setError(`${String(e)}。重试将沿用原订单，请勿重复付款。`);
    } finally { if (!disposed.current) setBusy(false); }
  };
  const selected = packages.find(p => p.id === packageId);
  const recheck = async () => {
    if (!session) return;
    setBusy(true); setError("");
    try {
      await api("recheck", {}, session.order.id);
      await apply(await api<Checkout>("order", undefined, session.order.id));
    } catch (e) { if (!disposed.current) setError(`${String(e)}。已付款请勿重复扫码，可稍后再次查询。`); }
    finally { if (!disposed.current) setBusy(false); }
  };
  return <div className="fast-payment" role="region" aria-label="在线充值"><h3>支付宝 / 微信充值</h3><button disabled={busy} onClick={onClose}>关闭充值</button>{error && <p role="alert">{error}</p>}
    {!session && <><label>充值套餐<select disabled={attempted} value={packageId} onChange={e => setPackageId(e.target.value)}>{packages.map(p => <option key={p.id} value={p.id}>{p.name} · ¥{(p.amount_cents / 100).toFixed(2)}</option>)}</select></label><label>支付方式<select disabled={attempted} value={channel} onChange={e => setChannel(e.target.value)}><option value="alipay">支付宝</option><option value="wxpay">微信支付</option></select></label><p>应付人民币 ¥{((selected?.amount_cents ?? 0)/100).toFixed(2)}，到账 API 额度 ${selected?.credit}。</p></>}
    {session && <p>订单 {session.order.id} · {session.order.payment_type === "wxpay" ? "微信支付" : "支付宝"} · {session.order.status === "paid" ? "已到账" : session.state === "expired" ? "已过期" : "待支付 / 确认中"} · ¥{(session.order.amount_cents/100).toFixed(2)}</p>}
    {qr && <img className="fast-qr" src={qr} alt="请使用所选支付方式扫码付款"/>}
    {session && session.order.status !== "paid" && !session.order.reversed_at && <button disabled={busy} onClick={() => void recheck()}>我已付款，查询到账</button>}
    {session?.order.status !== "paid" && session?.state !== "expired" && session?.order.gateway_status !== "expired" && !session?.order.reversed_at && <button disabled={busy || !packageId} onClick={() => void checkout()}>{busy ? "正在处理…" : session ? "继续原订单" : "确认并提交订单"}</button>}
    <p>请按订单金额付款，支付成功后自动刷新余额。关闭后可从下方订单继续。</p>
    <details><summary>最近充值订单</summary>{orders.map(o => <div key={o.id}>{o.id} · {o.status} · ¥{(o.amount_cents/100).toFixed(2)} {o.status !== "paid" && <button disabled={busy} onClick={() => void checkout(o)}>继续支付</button>}</div>)}</details>
  </div>;
}

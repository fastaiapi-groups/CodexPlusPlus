import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ShieldCheck, Check, Clock3, QrCode, ArrowRight, Copy, ExternalLink, RefreshCw } from "lucide-react";
import "./recharge.css";
import { paymentState } from "./paymentState";
import { fastAiPaymentChannels, paymentQrImage, type FastAiRechargeData, type FastAiRechargeOrder as Order } from "./rechargeData";
import { usePlatformInvoke } from "./ServiceRoutes";
type Checkout = { order: Order; state: string; qr_code?: string; qr_kind?: string };
const rmb = (cents: number) => `${(cents / 100).toFixed(2)} RMB`;
const channelLogo = {alipay: new URL("./icons/alipay.svg", import.meta.url).href, wxpay: new URL("./icons/wechat.svg", import.meta.url).href};
function ChannelIcon({channel}: {channel: string}) { return <span className={`fast-channel-icon ${channel}`}><img src={channelLogo[channel === "wxpay" ? "wxpay" : "alipay"]} alt=""/></span>; }

function SupportContact({channel, value}: {channel: "qq" | "wechat"; value: string}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {clearTimeout(timer.current);}, []);
  const name = channel === "qq" ? "QQ" : "微信";
  const logo = channel === "qq" ? new URL("./icons/qq.svg", import.meta.url).href : channelLogo.wxpay;
  return <div className="fast-support-contact-card">
    <span className={`fast-support-contact-logo ${channel}`}><img src={logo} alt=""/></span>
    <span className="fast-support-contact-value"><small>{name} 客服</small><strong>{value}</strong></span>
    <button type="button" className={`fast-support-copy ${status === "copied" ? "is-copied" : ""}`} aria-label={`复制${name}客服：${value}`} onClick={async () => {
      clearTimeout(timer.current);
      try {await navigator.clipboard.writeText(value); setStatus("copied");}
      catch {setStatus("failed");}
      timer.current = setTimeout(() => setStatus("idle"), 2500);
    }}>{status === "copied" ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}<span role="status">{status === "copied" ? "复制成功" : status === "failed" ? "复制失败" : "复制"}</span></button>
  </div>;
}

export function Recharge({origin, data, onClose, onPaid}: {origin: string; data: FastAiRechargeData; onClose: () => void; onPaid: () => void}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", {action, body, id});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  const [info, setInfo] = useState(() => data.info.current());
  const [orders, setOrders] = useState(() => data.orders.current() ?? []);
  const [packageId, setPackageId] = useState(""), [channel, setChannel] = useState("");
  const [session, setSession] = useState<Checkout | null>(null), [qr, setQr] = useState(""), [error, setError] = useState("");
  const [infoError, setInfoError] = useState(""), [ordersError, setOrdersError] = useState("");
  const [redeem, setRedeem] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const activeOrder = useRef("");
  const requestId = useRef(crypto.randomUUID()), disposed = useRef(false), paid = useRef(false);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; }; }, []);
  const loadInfo = async (refresh = false) => {
    setInfoError("");
    try {
      const next = await data.info.load(refresh);
      if (!disposed.current) setInfo(next);
    } catch (e) { if (!disposed.current) setInfoError(String(e)); }
  };
  const loadOrders = async (refresh = false) => {
    setOrdersError("");
    try {
      const next = await data.orders.load(refresh);
      if (!disposed.current) setOrders(next);
    } catch (e) { if (!disposed.current) setOrdersError(String(e)); }
  };
  useEffect(() => {
    void loadInfo();
    void loadOrders();
  }, [data]);
  const packages = info?.packages ?? [];
  const channels = info?.channels ?? [];
  const selected = packages.find(p => p.id === packageId) ?? packages[0];
  const activeSelection = channels.find(value => value === channel) ?? channels[0];
  const apply = async (next: Checkout) => {
    if (disposed.current || (activeOrder.current && activeOrder.current !== next.order.id)) return; setSession(next);
    if (paymentState(next.order, next.state) === "paid") { setQr(""); if (!paid.current) { paid.current = true; onPaid(); void loadOrders(true); } return; }
    if (paymentState(next.order, next.state) !== "pending") { setQr(""); return; }
    if (next.qr_code) {
      const image = next.qr_kind === "image" ? paymentQrImage(next.qr_code) : await invoke<string>("fastaiapi_qr", {text: next.qr_code});
      if (!disposed.current && activeOrder.current === next.order.id) setQr(image);
    }
  };
  useEffect(() => {
    if (!session || paymentState(session.order, session.state) !== "pending") return;
    let stopped = false, count = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { const next = await api<Checkout>("recharge_order", undefined, session.order.id); if (!stopped) await apply(next); } catch { if (!stopped) setError("暂时无法查询到账状态，已付款请勿重复扫码。"); } if (!stopped && ++count < 200) timer = setTimeout(tick, 3000); };
    timer = setTimeout(tick,3000); return () => { stopped = true; clearTimeout(timer); };
  }, [session?.order.id, session?.order.status, session?.state, session?.order.gateway_status, session?.order.reversed_at]);
  const checkout = async (existing?: Order) => {
    let order = existing ?? session?.order;
    if (!order && (!selected || !activeSelection)) return;
    setBusy(true); setAttempted(true); setError(""); setQr(""); if (existing) paid.current = false;
    try { order ??= (await api<{order: Order}>("recharge_create_order", {package_id: selected?.id, payment_type: activeSelection, request_id: requestId.current})).order;
      activeOrder.current = order.id;
      if (!disposed.current) setSession({order, state: "pending"});
      await apply(await api<Checkout>("recharge_checkout", {}, order.id));
      void loadOrders(true);
    } catch(e) {
      // 续付失败也重新读取状态，避免把过期/异常订单继续显示为可付款。
      if (order) { try { await apply(await api<Checkout>("recharge_order", undefined, order.id)); } catch { /* 保留原错误，等待手动查单 */ } }
      if (!disposed.current) setError(`${String(e)}。重试将沿用原订单，请勿重复付款。`);
    } finally { if (!disposed.current) setBusy(false); }
  };
  const recheck = async () => {
    if (!session) return;
    setBusy(true); setError("");
    try {
      await api("recharge_recheck", {}, session.order.id);
      await apply(await api<Checkout>("recharge_order", undefined, session.order.id));
    } catch (e) { if (!disposed.current) setError(`${String(e)}。已付款请勿重复扫码，可稍后再次查询。`); }
    finally { if (!disposed.current) setBusy(false); }
  };
  const state = paymentState(session?.order, session?.state);
  const paidOrder = state === "paid", expired = state === "expired", reversed = state === "reversed";
  const activeChannel = session?.order.payment_type ?? activeSelection;
  const channelName = activeChannel === "wxpay" ? "微信支付" : "支付宝";
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog fast-website-recharge" aria-labelledby="fast-payment-title" onCancel={e => {e.preventDefault(); if (!busy) onClose();}} onClick={e => {if (!busy && e.target === e.currentTarget) onClose();}}>
    <div className="fast-dialog-content"><header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">FastAiAPI · 账户充值</span><h2 id="fast-payment-title">{paidOrder ? "充值成功" : session ? "扫码完成支付" : "账户充值"}</h2></div><button className="fast-dialog-close" aria-label="关闭充值" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    {error && <p className="fast-payment-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!session ? <>
      {infoError && <p className="fast-payment-error" role="alert">{infoError}</p>}
      {!info && !infoError && <p role="status">正在读取充值套餐和支付方式…</p>}
      {info && <>
        <fieldset className="fast-package-picker" disabled={attempted || busy}><legend>选择充值套餐</legend><div>{packages.map(p => <label key={p.id} className={selected?.id === p.id ? "selected" : ""}><input type="radio" name="fast-package" checked={selected?.id === p.id} onChange={() => setPackageId(p.id)}/><strong>{rmb(p.amount_cents)}</strong><span>到账 {p.credit} USD 额度</span>{selected?.id === p.id && <Check size={14}/>}</label>)}</div></fieldset>
        {!packages.length && <p className="fast-payment-error">暂无可用充值套餐。</p>}
        <fieldset className="fast-channel-picker" disabled={attempted || busy}><legend>选择支付方式</legend><div>{fastAiPaymentChannels.map(c => <label key={c} className={activeSelection === c ? "selected" : ""}><input type="radio" name="fast-channel" disabled={!channels.includes(c)} checked={activeSelection === c} onChange={() => setChannel(c)}/><ChannelIcon channel={c}/><span>{c === "alipay" ? "支付宝" : "微信支付"}<small>{channels.includes(c) ? "打开手机扫码支付" : "暂不可用"}</small></span><i>{activeSelection === c && <Check size={12}/>}</i></label>)}</div></fieldset>
        {selected && <div className="fast-payment-total"><span>实际支付</span><strong>{rmb(selected.amount_cents)}</strong></div>}
        <button className="fast-pay-primary" disabled={busy || !selected || !activeSelection || Boolean(infoError)} onClick={() => void checkout()}>{busy ? "正在创建订单…" : attempted ? "重试原请求" : "确认金额，获取付款码"}<ArrowRight size={17}/></button>
      </>}
      {!attempted && (infoError || (info && (!packages.length || !channels.length))) && <button type="button" onClick={() => void loadInfo(true)}>刷新套餐和支付方式</button>}
    </> : <div className="fast-scan-view">
      <div className="fast-scan-channel"><ChannelIcon channel={activeChannel ?? ""}/><span>{channelName}</span></div><strong className="fast-scan-amount">{rmb(session.order.amount_cents)}</strong><p className="fast-scan-credit">到账 {session.order.credit} USD 额度</p>
      <div className={`fast-qr-frame ${paidOrder ? "is-paid" : ""}`}>{paidOrder ? <><Check size={44}/><strong>支付成功 · 余额已刷新</strong></> : expired || reversed ? <><Clock3 size={36}/><strong>{reversed ? "订单已退回" : "付款码已过期"}</strong><span>请关闭后查看订单状态</span></> : qr ? <img src={qr} alt={`${channelName}付款二维码`}/> : <><QrCode size={42}/><span>{busy ? "正在生成付款码…" : "暂无可用付款码，可继续原订单"}</span></>}</div>
      {!paidOrder && !expired && !reversed && <p className="fast-scan-tip">请使用{channelName}扫描二维码<br/><span>支付后自动查询到账，请勿重复付款</span></p>}
      <div className="fast-order-id"><span>订单号</span><code>{session.order.id}</code></div>
      {!paidOrder && !expired && !reversed && <div className="fast-scan-actions"><button className="fast-pay-primary" disabled={busy} onClick={() => void recheck()}>{busy ? "正在查询…" : "我已付款，查询到账"}</button>{!qr && <button disabled={busy} onClick={() => void checkout()}>继续原订单</button>}</div>}
      {paidOrder && <button className="fast-pay-primary" onClick={onClose}>完成</button>}
    </div>}
    <form className="fast-topup-redeem" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); setNotice("");
      try { await api("redeem", {key: redeem.trim()}); setRedeem(""); setNotice("兑换成功，正在刷新账户余额。"); onPaid(); }
      catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}><label>兑换码<input required autoComplete="off" value={redeem} onChange={e => setRedeem(e.target.value)}/></label><button type="submit" disabled={busy || !redeem.trim()}>兑换</button></form>
    <div className="fast-scan-actions"><button disabled={busy} onClick={() => { void loadOrders(true); onPaid(); }}><RefreshCw size={15}/>刷新订单和余额</button><button onClick={() => void invoke("open_external_url", {url: `${origin}/hub/home/recharge`})}>官网充值中心<ExternalLink size={15}/></button></div>
    <div className="fast-payment-support"><span>充值未到账？请联系客服</span><div className="fast-payment-support-contacts"><SupportContact channel="qq" value="172733456"/><SupportContact channel="wechat" value="selectthree"/></div><small>请提供订单号，方便核查到账情况。</small></div>
    <p className="fast-payment-security"><ShieldCheck size={14}/>由平台安全收款 · 支付结果以平台订单为准</p>
    <details className="fast-recent-orders"><summary>最近充值订单 <span>{orders.length} 笔</span></summary>{ordersError && <p role="alert">{ordersError}</p>}{orders.length ? orders.map(o => <div key={o.id}><ChannelIcon channel={o.payment_type}/><span><strong>{rmb(o.amount_cents)} <small>{paymentState(o) === "reversed" ? "已退回" : paymentState(o) === "paid" ? "已到账" : paymentState(o) === "expired" ? "已过期" : "待确认"}</small></strong><code>{o.id}</code></span>{paymentState(o) === "pending" && <button disabled={busy} onClick={() => void checkout(o)}>查看付款码</button>}</div>) : !ordersError && <p>暂无充值订单</p>}</details>
    </div></dialog>, document.body);
}

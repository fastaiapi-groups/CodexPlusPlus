import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { X, ShieldCheck, Check, Clock3, QrCode, ArrowRight } from "lucide-react";
import "./recharge.css";
import { paymentState } from "./paymentState";
export type Package = { id: string; name: string; amount_cents: number; credit: string };
export type Order = { id: string; status: string; amount_cents: number; credit: string; gateway_status: string; payment_type: string; reversed_at?: string };
type Checkout = { order: Order; state: string; qr_code?: string; qr_kind?: string };
const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", {action, body, id});
const channelLogo = {alipay: new URL("./icons/alipay.svg", import.meta.url).href, wxpay: new URL("./icons/wechat.svg", import.meta.url).href};
function ChannelIcon({channel}: {channel: string}) { return <span className={`fast-channel-icon ${channel}`}><img src={channelLogo[channel === "wxpay" ? "wxpay" : "alipay"]} alt=""/></span>; }

export function Recharge({packages, orders, onClose, onPaid}: {packages: Package[]; orders: Order[]; onClose: () => void; onPaid: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  const [packageId, setPackageId] = useState(packages[0]?.id ?? ""), [channel, setChannel] = useState("alipay");
  const [session, setSession] = useState<Checkout | null>(null), [qr, setQr] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const activeOrder = useRef("");
  const requestId = useRef(crypto.randomUUID()), disposed = useRef(false), paid = useRef(false);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; }; }, []);
  const apply = async (next: Checkout) => {
    if (disposed.current || (activeOrder.current && activeOrder.current !== next.order.id)) return; setSession(next);
    if (paymentState(next.order, next.state) === "paid") { setQr(""); if (!paid.current) { paid.current = true; onPaid(); } return; }
    if (paymentState(next.order, next.state) !== "pending") { setQr(""); return; }
    if (next.qr_code) {
      const image = next.qr_kind === "image" ? (/^data:image\/(png|jpeg|webp);base64,/.test(next.qr_code) ? next.qr_code : "") : await invoke<string>("fastaiapi_qr", {text: next.qr_code});
      if (!disposed.current && activeOrder.current === next.order.id) setQr(image);
    }
  };
  useEffect(() => {
    if (!session || paymentState(session.order, session.state) !== "pending") return;
    let stopped = false, count = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { const next = await api<Checkout>("order", undefined, session.order.id); if (!stopped) await apply(next); } catch { if (!stopped) setError("暂时无法查询到账状态，已付款请勿重复扫码。"); } if (!stopped && ++count < 200) timer = setTimeout(tick, 3000); };
    timer = setTimeout(tick,3000); return () => { stopped = true; clearTimeout(timer); };
  }, [session?.order.id, session?.order.status, session?.state, session?.order.gateway_status, session?.order.reversed_at]);
  const checkout = async (existing?: Order) => {
    setBusy(true); setAttempted(true); setError(""); setQr(""); if (existing) paid.current = false;
    let order = existing ?? session?.order;
    try { order ??= (await api<{order: Order}>("create_order", {package_id: packageId, payment_type: channel, request_id: requestId.current})).order;
      activeOrder.current = order.id;
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
  const state = paymentState(session?.order, session?.state);
  const paidOrder = state === "paid", expired = state === "expired", reversed = state === "reversed";
  const activeChannel = session?.order.payment_type ?? channel;
  const channelName = activeChannel === "wxpay" ? "微信支付" : "支付宝";
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog" aria-labelledby="fast-payment-title" onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {if (e.target === e.currentTarget) onClose();}}>
    <div className="fast-dialog-content"><header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">FASTAIAPI · 账户充值</span><h2 id="fast-payment-title">{paidOrder ? "充值成功" : session ? "扫码完成支付" : "为下一次创作充能"}</h2></div><button className="fast-dialog-close" aria-label="关闭充值" onClick={onClose}><X size={20}/></button></header>
    {error && <p className="fast-payment-error" role="alert">{error}</p>}
    {!session ? <>
      <fieldset className="fast-package-picker" disabled={attempted || busy}><legend>选择充值金额 <small>人民币支付 · 美元 API 额度</small></legend><div>{packages.map(p => <label key={p.id} className={packageId === p.id ? "selected" : ""}><input type="radio" name="fast-package" checked={packageId === p.id} onChange={() => setPackageId(p.id)}/><strong><small>¥</small>{(p.amount_cents / 100).toFixed(2)}</strong><span>到账 ${p.credit} API 额度</span>{packageId === p.id && <Check size={14}/>}</label>)}</div></fieldset>
      {!packages.length && <p className="fast-payment-error">暂无可用充值套餐，请稍后重试。</p>}
      <fieldset className="fast-channel-picker" disabled={attempted || busy}><legend>选择支付方式</legend><div>{(["alipay", "wxpay"] as const).map(c => <label key={c} className={channel === c ? "selected" : ""}><input type="radio" name="fast-channel" checked={channel === c} onChange={() => setChannel(c)}/><ChannelIcon channel={c}/><span>{c === "alipay" ? "支付宝" : "微信支付"}<small>打开手机扫码支付</small></span><i>{channel === c && <Check size={12}/>}</i></label>)}</div></fieldset>
      <div className="fast-payment-total"><span>实际支付</span><strong>¥{((selected?.amount_cents ?? 0) / 100).toFixed(2)}</strong></div>
      <button className="fast-pay-primary" disabled={busy || !packageId} onClick={() => void checkout()}>{busy ? "正在创建订单…" : "确认金额，获取付款码"}<ArrowRight size={17}/></button>
    </> : <div className="fast-scan-view">
      <div className="fast-scan-channel"><ChannelIcon channel={activeChannel}/><span>{channelName}</span></div><strong className="fast-scan-amount"><small>¥</small>{(session.order.amount_cents / 100).toFixed(2)}</strong><p className="fast-scan-credit">到账 ${session.order.credit} API 额度</p>
      <div className={`fast-qr-frame ${paidOrder ? "is-paid" : ""}`}>{paidOrder ? <><Check size={44}/><strong>支付成功 · 余额已刷新</strong></> : expired || reversed ? <><Clock3 size={36}/><strong>{reversed ? "订单已退回" : "付款码已过期"}</strong><span>请关闭后查看订单状态</span></> : qr ? <img src={qr} alt={`${channelName}付款二维码`}/> : <><QrCode size={42}/><span>{busy ? "正在生成付款码…" : "暂无可用付款码，可继续原订单"}</span></>}</div>
      {!paidOrder && !expired && !reversed && <p className="fast-scan-tip">请使用{channelName}扫描二维码<br/><span>支付后自动查询到账，请勿重复付款</span></p>}
      <div className="fast-order-id"><span>订单号</span><code>{session.order.id}</code></div>
      {!paidOrder && !expired && !reversed && <div className="fast-scan-actions"><button className="fast-pay-primary" disabled={busy} onClick={() => void recheck()}>{busy ? "正在查询…" : "我已付款，查询到账"}</button>{!qr && <button disabled={busy} onClick={() => void checkout()}>继续原订单</button>}</div>}
      {paidOrder && <button className="fast-pay-primary" onClick={onClose}>完成</button>}
    </div>}
    <p className="fast-payment-security"><ShieldCheck size={14}/>由平台安全收款 · 支付结果以平台订单为准</p>
    <details className="fast-recent-orders"><summary>最近充值订单 <span>{orders.length} 笔</span></summary>{orders.length ? orders.map(o => <div key={o.id}><ChannelIcon channel={o.payment_type}/><span><strong>¥{(o.amount_cents/100).toFixed(2)} <small>{paymentState(o) === "reversed" ? "已退回" : paymentState(o) === "paid" ? "已到账" : paymentState(o) === "expired" ? "已过期" : "待确认"}</small></strong><code>{o.id}</code></span>{paymentState(o) === "pending" && <button disabled={busy} onClick={() => void checkout(o)}>查看付款码</button>}</div>) : <p>暂无充值订单</p>}</details>
    </div></dialog>, document.body);
}

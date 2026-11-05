import { usePlatformInvoke } from "./ServiceRoutes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ExternalLink, RefreshCw, X } from "lucide-react";
import "./recharge.css";
type Info = {enable_online_topup?: boolean; enable_duocai_topup?: boolean; enable_redemption?: boolean; min_topup?: number; amount_options?: number[]; pay_methods?: {type: string; name: string}[]};
type Order = {trade_no: string; amount: number; money: number; status: string; payment_method: string; payment_provider?: string};
type Checkout = {trade_no: string; state: string; qr_code?: string; qr_kind?: string; money: string; credit_amount: number};
export function NewApiRecharge({origin, onClose, onPaid}: {origin: string; onClose: () => void; onPaid: () => void}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account", {action, body, id});
  const dialog = useRef<HTMLDialogElement>(null), requestId = useRef(crypto.randomUUID());
  const [info, setInfo] = useState<Info | null>(null), [orders, setOrders] = useState<Order[]>([]);
  const [amount, setAmount] = useState(10), [method, setMethod] = useState("");
  const [quote, setQuote] = useState(""), [checkout, setCheckout] = useState<Checkout | null>(null), [qr, setQr] = useState("");
  const [paymentUrl, setPaymentUrl] = useState(""), [redeem, setRedeem] = useState("");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const paid = useRef(false), disposed = useRef(false);
  const loadOrders = async () => {const data = await api<{items?: Order[]}>("orders"); if(!disposed.current) setOrders(data.items ?? []);};
  useEffect(() => {
    disposed.current = false;
    const element = dialog.current, opener = document.activeElement; element?.showModal();
    api<Info>("topup_info").then(data => {if(disposed.current) return; setInfo(data); setAmount(data.amount_options?.[0] ?? data.min_topup ?? 10); setMethod(data.pay_methods?.find(m => m.type === "alipay" || m.type === "wxpay")?.type ?? "");}).catch(e => {if(!disposed.current) setError(String(e));});
    void loadOrders().catch(e => {if(!disposed.current) setError(String(e));});
    return () => {disposed.current = true; element?.close(); if(opener instanceof HTMLElement && opener.isConnected) opener.focus();};
  }, []);
  useEffect(() => {
    let cancelled = false; setQuote("");
    if (!info?.enable_online_topup && !info?.enable_duocai_topup) return;
    if (!Number.isInteger(amount) || amount < (info.min_topup ?? 1)) return;
    const timer = setTimeout(() => {api<string>("quote", {amount}).then(value => {if(!cancelled) setQuote(String(value));}).catch(e => {if(!cancelled) setError(String(e));});}, 250);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [amount, info]);
  const applyCheckout = async (value: Checkout) => {
    if(disposed.current) return;
    setCheckout(value);
    if(value.state === "paid") {setQr(""); if(!paid.current) {paid.current = true; onPaid(); void loadOrders();} return;}
    if(value.qr_code && !["failed", "expired"].includes(value.state)) {
      const image = value.qr_kind === "image" ? (/^data:image\/(png|jpeg|webp);base64,/.test(value.qr_code) ? value.qr_code : "") : await invoke<string>("fastaiapi_qr", {text: value.qr_code});
      if(!disposed.current) setQr(image);
    }
  };
  useEffect(() => {
    if(!checkout || ["paid", "failed", "expired"].includes(checkout.state)) return;
    let cancelled = false, count = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {try {const value = await api<Checkout>("duocai_order", undefined, checkout.trade_no); if(!cancelled) await applyCheckout(value);} catch {if(!cancelled) setError("暂时无法查询订单，已付款请勿重复支付。");} if(!cancelled && ++count < 120) timer = setTimeout(tick, 5000);};
    timer = setTimeout(tick, 5000); return () => {cancelled = true; clearTimeout(timer);};
  }, [checkout?.trade_no, checkout?.state]);
  const work = async (fn: () => Promise<void>) => {setBusy(true); setError(""); try {await fn();} catch(e) {setError(String(e));} finally {setBusy(false);}};
  const pay = () => work(async () => {
    setAttempted(true);
    if(info?.enable_duocai_topup) await applyCheckout(await api<Checkout>(checkout ? "duocai_check" : "duocai_pay", checkout ? undefined : {amount, payment_method: method, request_id: requestId.current}, checkout?.trade_no));
    else {
      // 易支付没有已验证的客户端幂等协议；结果未知时只查订单，不重建。
      const result = await api<{url: string}>("pay", {amount, payment_method: method});
      setPaymentUrl(result.url); await invoke("open_external_url", {url: result.url}); await loadOrders();
    }
  });
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog" aria-labelledby="fast-topup-title" onCancel={e => {e.preventDefault(); if(!busy) onClose();}} onClick={e => {if(e.target === e.currentTarget && !busy) onClose();}}><div className="fast-dialog-content">
    <header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">NEW API · 账户充值</span><h2 id="fast-topup-title">账户充值</h2><small>{origin}</small></div><button className="fast-dialog-close" disabled={busy} aria-label="关闭充值" onClick={onClose}><X size={20}/></button></header>
    {error && <p className="fast-payment-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!info && !error && <p role="status">正在读取平台充值配置…</p>}
    {info && !checkout && <>
      {(info.enable_online_topup || info.enable_duocai_topup) && method ? <><fieldset className="fast-package-picker" disabled={busy || attempted}><legend>选择充值额度</legend><div>{info.amount_options?.map(value => <label key={value} className={amount === value ? "selected" : ""}><input type="radio" name="topup-amount" checked={amount === value} onChange={() => setAmount(value)}/><strong>{value}</strong><span>平台额度单位</span></label>)}</div><label>自定义额度<input type="number" min={info.min_topup ?? 1} step="1" value={amount} onChange={e => {setAmount(Number(e.target.value)); setError("");}}/></label></fieldset><fieldset className="fast-channel-picker" disabled={busy || attempted}><legend>支付方式</legend><div>{info.pay_methods?.filter(m => m.type === "alipay" || m.type === "wxpay").map(m => <label key={m.type} className={method === m.type ? "selected" : ""}><input type="radio" name="topup-method" checked={method === m.type} onChange={() => setMethod(m.type)}/><span>{m.name || m.type}</span></label>)}</div></fieldset><div className="fast-payment-total"><span>实际支付（人民币）</span><strong>{quote ? `¥${quote}` : "正在计价…"}</strong></div>
      {!paymentUrl && <button className="fast-pay-primary" disabled={busy || !quote || !Number.isInteger(amount) || amount < (info.min_topup ?? 1) || (attempted && !info.enable_duocai_topup)} onClick={() => void pay()}>{busy ? "正在处理…" : attempted ? "继续原订单" : info.enable_duocai_topup ? "获取付款码" : "打开平台收银台"}</button>}
      {paymentUrl && <button className="fast-pay-primary" disabled={busy} onClick={() => void invoke("open_external_url", {url: paymentUrl})}>继续原订单支付<ExternalLink size={16}/></button>}
      {attempted && !paymentUrl && !info.enable_duocai_topup && <p>请先刷新订单确认是否已创建，避免重复付款。</p>}
      </> : <p>当前站点未启用可在应用内使用的在线支付方式，可前往平台钱包充值。</p>}
    </>}
    {checkout && <div className="fast-scan-view"><strong className="fast-scan-amount">¥{checkout.money}</strong><p>订单：{checkout.trade_no}</p><div className="fast-qr-frame">{checkout.state === "paid" ? <strong>支付成功 · 余额已刷新</strong> : qr ? <img src={qr} alt="平台付款二维码"/> : <span>{checkout.state === "expired" ? "订单已过期" : checkout.state === "failed" ? "订单失败" : "付款状态待确认，请查询原订单"}</span>}</div>{!["paid", "expired", "failed"].includes(checkout.state) && <button className="fast-pay-primary" disabled={busy} onClick={() => void pay()}>查询原订单</button>}</div>}
    {info?.enable_redemption !== false && <form className="fast-topup-redeem" onSubmit={e => {e.preventDefault(); void work(async () => {await api("redeem", {key: redeem.trim()}); setRedeem(""); setNotice("兑换成功，余额已刷新。"); onPaid(); await loadOrders();});}}><label>兑换码<input value={redeem} onChange={e => setRedeem(e.target.value)} required autoComplete="off"/></label><button disabled={busy || !redeem.trim()} type="submit">兑换额度</button></form>}
    <div className="fast-scan-actions"><button disabled={busy} onClick={() => void work(async () => {await loadOrders(); onPaid();})}><RefreshCw size={15}/>刷新订单和余额</button><button onClick={() => void invoke("open_external_url", {url: `${origin}/console/topup`})}>平台钱包<ExternalLink size={15}/></button></div>
    <details className="fast-recent-orders" open><summary>最近充值订单 <span>{orders.length} 笔</span></summary>{orders.map(order => <div key={order.trade_no}><span><strong>¥{order.money} <small>{order.status === "success" ? "已到账" : order.status === "pending" ? "待支付" : order.status}</small></strong><code>{order.trade_no}</code></span>{info?.enable_duocai_topup && order.payment_provider === "epay" && order.status === "pending" && <button disabled={busy} onClick={() => void work(async () => {paid.current = false; setQr(""); await applyCheckout(await api<Checkout>("duocai_order", undefined, order.trade_no));})}>查询</button>}</div>)}{!orders.length && <p>暂无充值订单</p>}</details>
    <p className="fast-payment-security">金额与到账状态以当前 new-api 平台为准，请勿重复付款。</p>
  </div></dialog>, document.body);
}

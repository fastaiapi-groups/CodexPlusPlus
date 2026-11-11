import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ExternalLink, RefreshCw, X} from "lucide-react";
import {usePlatformInvoke} from "./ServiceRoutes";
import "./recharge.css";
import {PaymentChannelIcon} from "./PaymentChannelIcon";
type Method = {currency?: string; display_name?: string; available: boolean; single_min: number; single_max: number; fee_rate: number};
type Plan = {id: number; name: string; price: number; currency?: string; validity_days: number; group_name?: string};
type Info = {methods: Record<string,Method>; plans: Plan[]; balance_disabled: boolean; global_min: number; global_max: number; help_text?: string};
type Order = {id: number; out_trade_no: string; amount: number; pay_amount: number; currency?: string; status: string; order_type: string};
type Checkout = {order_id: number; pay_url?: string; qr_code?: string; currency?: string; pay_amount: number; result_type?: string};
const finalStates = ["COMPLETED","CANCELLED","FAILED","EXPIRED","REFUNDED"];
const money = (value: number, currency?: string) => `${Number.isFinite(value) ? value.toFixed(2) : "—"} ${currency || ""}`;
export function SubApiRecharge({origin,onClose,onPaid}: {origin: string; onClose: ()=>void; onPaid: ()=>void}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object, id?: string) => invoke<T>("fastaiapi_account",{action,body,id});
  const dialog=useRef<HTMLDialogElement>(null), disposed=useRef(false), paid=useRef(false);
  const [info,setInfo]=useState<Info|null>(null),[orders,setOrders]=useState<Order[]>([]);
  const [method,setMethod]=useState(""),[amount,setAmount]=useState(10),[planId,setPlanId]=useState(0);
  const [checkout,setCheckout]=useState<Checkout|null>(null),[order,setOrder]=useState<Order|null>(null),[qr,setQr]=useState("");
  const [busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[redeem,setRedeem]=useState("");
  const loadOrders=async()=>{const result=await api<{items:Order[]}>("orders");if(!disposed.current)setOrders(result.items);};
  useEffect(()=>{
    const opener=document.activeElement,element=dialog.current; disposed.current=false;element?.showModal();
    api<Info>("checkout_info").then(value=>{if(disposed.current)return;setInfo(value);setMethod(Object.keys(value.methods).find(k=>value.methods[k].available)||"");setAmount(Math.max(10,value.global_min));}).catch(e=>{if(!disposed.current)setError(String(e));});
    void loadOrders().catch(e=>{if(!disposed.current)setError(String(e));});
    return()=>{disposed.current=true;element?.close();if(opener instanceof HTMLElement && opener.isConnected)opener.focus();};
  },[]);
  const updateOrder=async(id: number)=>{
    const value=await api<Order>("order",undefined,String(id));if(disposed.current)return;
    setOrder(value);
    if(value.status==="COMPLETED"&&!paid.current){paid.current=true;onPaid();await loadOrders();}
  };
  useEffect(()=>{
    if(!checkout?.order_id || (order && finalStates.includes(order.status)))return;
    let cancelled=false,count=0,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{try{await updateOrder(checkout.order_id);}catch{if(!cancelled)setError("暂时无法查询订单，已付款请勿重复支付。");}if(!cancelled&&++count<120)timer=setTimeout(tick,5000);};
    timer=setTimeout(tick,5000);return()=>{cancelled=true;clearTimeout(timer);};
  },[checkout?.order_id,order?.status]);
  const work=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  const selected=info?.methods[method],plan=info?.plans.find(p=>p.id===planId);
  const pay=()=>work(async()=>{
    setAttempted(true);
    const result=await api<Checkout>("pay",{amount:plan?.price??amount,payment_type:method,order_type:plan?"subscription":"balance",plan_id:plan?.id});
    if(disposed.current)return;
    setCheckout(result);
    if(result.qr_code)setQr(await invoke<string>("fastaiapi_qr",{text:result.qr_code}));
    if(result.pay_url)await invoke("open_external_url",{url:result.pay_url});
    if(!result.pay_url&&!result.qr_code)setNotice("订单已创建，请前往平台钱包继续原订单支付。");
    await loadOrders();
  });
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog" aria-labelledby="subapi-topup-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><div className="fast-dialog-content">
    <header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">SUBAPI · 账户充值</span><h2 id="subapi-topup-title">充值与套餐</h2></div><button className="fast-dialog-close" disabled={busy} aria-label="关闭充值" onClick={onClose}><X size={20}/></button></header>
    {error&&<p role="alert" className="fast-payment-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!info&&!error&&<p role="status">正在读取 FastAiAPI 充值配置…</p>}
    {info&&!checkout&&<>
      <fieldset className="fast-channel-picker" disabled={busy||attempted}><legend>充值内容</legend><div>{!info.balance_disabled&&<label className={!planId?"selected":""}><input type="radio" checked={!planId} onChange={()=>setPlanId(0)}/>账户余额</label>}{info.plans.map(p=><label key={p.id} className={planId===p.id?"selected":""}><input type="radio" checked={planId===p.id} onChange={()=>setPlanId(p.id)}/>{p.name} · {money(p.price,p.currency)} · {p.validity_days} 天</label>)}</div></fieldset>
      {!plan&&<label>充值金额<input type="number" min={selected?.single_min||info.global_min||0.01} max={selected?.single_max||undefined} step="0.01" value={amount} disabled={busy||attempted||info.balance_disabled} onChange={e=>setAmount(Number(e.target.value))}/></label>}
      <fieldset className="fast-channel-picker" disabled={busy||attempted}><legend>支付方式</legend><div>{Object.entries(info.methods).filter(([,m])=>m.available).map(([id,m])=><label key={id} className={method===id?"selected":""}><input type="radio" checked={method===id} onChange={()=>setMethod(id)}/><PaymentChannelIcon channel={id}/><span>{m.display_name||id}<small>{m.currency}</small></span><i>{method===id&&<Check size={12}/>}</i></label>)}</div></fieldset>
      <p className="fast-model-hint">支付币种、手续费与到账额度以平台订单为准。</p>
      <button className="fast-pay-primary" disabled={busy||attempted||!method||(!plan&&(info.balance_disabled||!Number.isFinite(amount)||amount<=0||amount<(selected?.single_min||0)||(!!selected?.single_max&&amount>selected.single_max)))} onClick={()=>void pay()}>{busy?"正在处理…":attempted?"请查询原订单":"创建平台订单"}</button>
      {attempted&&!checkout&&<p>提交结果尚未确认，请刷新订单或前往平台钱包核对，避免重复付款。</p>}
    </>}
    {checkout&&<div className="fast-scan-view"><strong>{money(checkout.pay_amount,checkout.currency)}</strong><p>{order?.status||"等待支付"}</p>{qr&&order?.status!=="COMPLETED"&&<div className="fast-qr-frame"><img src={qr} alt="FastAiAPI 付款二维码"/></div>}{checkout.pay_url&&<button disabled={busy} onClick={()=>void invoke("open_external_url",{url:checkout.pay_url})}>继续原订单支付</button>}<button disabled={busy} onClick={()=>void work(()=>updateOrder(checkout.order_id))}>查询原订单</button></div>}
    <form className="fast-topup-redeem" onSubmit={e=>{e.preventDefault();void work(async()=>{await api("redeem",{key:redeem.trim()});setRedeem("");setNotice("兑换成功，账户已刷新。");onPaid();});}}><label>兑换码<input required autoComplete="off" value={redeem} onChange={e=>setRedeem(e.target.value)}/></label><button type="submit" disabled={busy||!redeem.trim()}>兑换</button></form>
    <div className="fast-scan-actions"><button disabled={busy} onClick={()=>void work(async()=>{await loadOrders();onPaid();})}><RefreshCw size={15}/>刷新订单和余额</button><button onClick={()=>void invoke("open_external_url",{url:`${origin}/purchase`})}>平台钱包<ExternalLink size={15}/></button></div>
    <details className="fast-recent-orders" open><summary>FastAiAPI 最近订单 · {orders.length} 笔</summary>{orders.map(value=><div key={value.id}><span><strong>{money(value.pay_amount,value.currency)} <small>{value.status}</small></strong><code>{value.out_trade_no}</code></span><button disabled={busy} onClick={()=>void work(async()=>{setCheckout({order_id:value.id,pay_amount:value.pay_amount,currency:value.currency});await updateOrder(value.id);})}>查询</button></div>)}{!orders.length&&<p>暂无充值订单</p>}</details>
  </div></dialog>,document.body);
}

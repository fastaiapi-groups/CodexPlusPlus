import {useEffect,useState} from "react";
import {usePlatformInvoke} from "./ServiceRoutes";
type Subscription = {id:number;status:string;expires_at:string|null;daily_usage_usd:number;group?:{name:string;daily_limit_usd:number|null}};
export function SubApiSubscriptions() {
  const invoke=usePlatformInvoke();
  const [items,setItems]=useState<Subscription[]>([]),[error,setError]=useState(""),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError("");
    invoke<Subscription[]>("fastaiapi_account",{action:"subscriptions"}).then(value=>{if(!cancelled)setItems(value);}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[revision]);
  return <details className="fast-advanced">
    <summary>我的套餐 <span>{loading?"正在读取…":`${items.filter(s=>s.status==="active").length} 个有效套餐`}</span></summary>
    {error&&<p className="fast-error" role="alert">{error}</p>}
    {!loading&&!items.length&&!error&&<p>当前 FastAiAPI 账号暂无套餐。</p>}
    {items.map(s=><p key={s.id}>
      <strong>{s.group?.name||`套餐 ${s.id}`}</strong> · {s.status==="active"?"有效":s.status} · {s.expires_at?`到期 ${new Date(s.expires_at).toLocaleDateString()}`:"长期有效"}
      {Number.isFinite(s.daily_usage_usd)&&<span> · 今日已用 ${s.daily_usage_usd.toFixed(2)}{s.group?.daily_limit_usd!=null&&<span> / ${s.group.daily_limit_usd.toFixed(2)}</span>}</span>}
    </p>)}
    <button disabled={loading} onClick={()=>setRevision(n=>n+1)}>刷新套餐</button>
  </details>;
}

import { useEffect, useState } from "react";

import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { Image, Video, Wrench, RefreshCw, KeyRound, FlaskConical } from "lucide-react";
export function modelKind(id: string): "text" | "image" | "video" | "other" {
  const name = id.toLowerCase();
  if (/video|sora|veo|kling|wan|seedance|minimax-h3|ltx|hunyuan|sd2\.5/.test(name)) return "video";
  if (/image|dall-e|flux|midjourney|stable-diffusion|sdxl|imagen|ideogram/.test(name)) return "image";
  if (/audio|tts|embedding|realtime|whisper|dubbing|transcribe|moderation|auto-review|reserve/.test(name)) return "other";
  return "text";
}
type Status = {state: string; message: string; default_video_available?: boolean; models?: string[]};

export function MediaModels({keyId, models}: {keyId: number; models: string[]}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object) => invoke<T>("fastaiapi_account", {action, body});
  const {routes, setLocked} = useServiceRoutes();
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState("");
  const [message, setMessage] = useState(""), [manual, setManual] = useState(false), [key, setKey] = useState("");
  const refresh = async () => setStatus(await api<Status>("media_status"));
  useEffect(() => {let disposed=false; const check=()=>{api<Status>("media_status").then(value=>{if(!disposed)setStatus(value);}).catch(e=>{if(!disposed)setMessage(String(e));});}; check(); const timer=setInterval(check,60000); return ()=>{disposed=true;clearInterval(timer);};}, [keyId, routes.selected]);
  const work = async (name: string, fn: () => Promise<void>) => {setBusy(name); setLocked(true); setMessage(""); try {await fn();} catch(e) {setMessage(String(e));} finally {setBusy("");setLocked(false);}};
  const available = status?.models ?? models;
  return <section className="fast-media-models" aria-label="媒体与系统环境变量"><header><div><h3>媒体创作与环境配置</h3><p>{routes.platform === "newapi" ? "登录后自动连接 default 分组 Key。" : "使用当前 SubAPI 账号的可用分组 Key。"}视频默认 minimax-h3，指定模型时按你的选择生成。</p></div><button disabled={Boolean(busy)} onClick={() => void work("refresh",refresh)}><RefreshCw size={14}/>检查连接</button></header>
    <div className={`fast-media-status ${status?.state === "ready" ? "is-ready" : "needs-repair"}`} role="status"><strong>{status?.state === "ready" ? "已连接" : "需要检查"}</strong><span>{status?.message || "正在检查系统环境变量…"}</span></div>
    {status?.state === "ready" && status.default_video_available === false && <p className="fast-error">当前 Key 未开放默认视频模型 minimax-h3，请联系平台开通，或生成时明确指定其他模型。</p>}
    <div className="fast-row"><button disabled={Boolean(busy)} onClick={() => void work("repair",async () => {const result=await api<{warning?:string}>("media_setup"); await refresh(); setMessage(result.warning || "当前平台 Key 与系统环境变量已修复。重启 Codex 或终端后生效。");})}><Wrench size={14}/>{busy === "repair" ? "正在修复…" : "一键配置／修复"}</button><button disabled={Boolean(busy)} onClick={() => setManual(value=>!value)}><KeyRound size={14}/>手动配置</button><button disabled={Boolean(busy)} onClick={() => void work("text",async () => {const result=await api<{message:string;model:string}>("media_test",{kind:"text"});setMessage(`${result.message} · ${result.model}`);})}><FlaskConical size={14}/>{busy === "text" ? "文本测试中…" : "文本测试"}</button><button disabled={Boolean(busy)} onClick={() => void work("image",async () => {const result=await api<{message:string;model:string}>("media_test",{kind:"image"});setMessage(`${result.message} · ${result.model}`);})}><Image size={14}/>{busy === "image" ? "图片测试中…" : "图片测试"}</button></div>
    <p>测试会真实调用当前站点并按平台计费。环境变量配置给新启动的应用使用；已运行的 Codex 或终端需重启。</p>
    {manual && <form className="fast-media-manual" onSubmit={event=>{event.preventDefault();void work("manual",async()=>{const result=await api<{warning?:string}>("media_manual",{api_key:key});setKey("");await refresh();setMessage(result.warning || "手动 Key 已保存并配置环境变量。");});}}><label>当前路线的 API Key<input type="password" autoComplete="off" required value={key} onChange={event=>setKey(event.target.value)} placeholder="输入完整 Key，不会显示或写入日志"/></label><button type="submit" disabled={Boolean(busy) || !key.trim()}>保存并配置</button></form>}
    <div className="fast-media-grid">{(["image", "video"] as const).map(kind => {
      const list = available.filter(m => modelKind(m) === kind);
      return <details key={kind}><summary>{kind === "image" ? <Image size={17}/> : <Video size={17}/>}<strong>{kind === "image" ? "图片模型" : "视频模型"}</strong><span>{list.length} 个</span></summary>{list.length ? <ul>{list.map(id => <li key={id}>{id}</li>)}</ul> : <p>当前 Key 暂无可用模型，请检查当前平台分组权限。</p>}</details>;
    })}</div>{message && <p role="status" className="fast-notice">{message}</p>}
  </section>;
}

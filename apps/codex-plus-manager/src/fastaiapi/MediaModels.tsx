import { useEffect, useState, type ReactNode } from "react";
import { MediaSetupGuideButton } from "./MediaSetupGuide";
import { ModelDialog } from "./ModelDialog";
import { MediaTestDialog } from "./MediaTestDialog";

import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { Image, Video, Wrench, RefreshCw, KeyRound, FlaskConical } from "lucide-react";
export function modelKind(id: string): "text" | "image" | "video" | "other" {
  const name = id.toLowerCase();
  if (/video|sora|veo|kling|wan|seedance|minimax-h3|ltx|hunyuan|sd2\.5/.test(name)) return "video";
  if (/image|dall-e|flux|midjourney|stable-diffusion|sdxl|imagen|ideogram/.test(name)) return "image";
  if (/audio|tts|embedding|realtime|whisper|dubbing|transcribe|moderation|auto-review|reserve/.test(name)) return "other";
  return "text";
}
type Status = {state: string; message: string; default_video_available?: boolean; models?: string[]; image_model?: string; video_model?: string};

export function MediaModels({keyId, models, textModel, textPicker}: {keyId: number; models: string[]; textModel?: string; textPicker: ReactNode}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object) => invoke<T>("fastaiapi_account", {action, body});
  const {routes, setLocked} = useServiceRoutes();
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState("");
  const [message, setMessage] = useState(""), [manual, setManual] = useState(false), [key, setKey] = useState("");
  const refresh = async () => setStatus(await api<Status>("media_status"));
  useEffect(() => {let disposed=false; const check=()=>{api<Status>("media_status").then(value=>{if(!disposed)setStatus(value);}).catch(e=>{if(!disposed)setMessage(String(e));});}; check(); const timer=setInterval(check,60000); return ()=>{disposed=true;clearInterval(timer);};}, [keyId, routes.selected]);
  const work = async (name: string, fn: () => Promise<void>) => {setBusy(name); setLocked(true); setMessage(""); try {await fn();} catch(e) {setMessage(String(e));} finally {setBusy("");setLocked(false);}};
  const [picker, setPicker] = useState<"image" | "video" | null>(null), [test, setTest] = useState<"text" | "image" | null>(null);
  const defaults = {image: status?.image_model || "gpt-image-2", video: status?.video_model || "minimax-h3"};
  const available = status?.models ?? models;
  return <section className="fast-media-models" aria-label="媒体与系统环境变量"><header><div><h3>媒体创作与环境配置</h3><p>{routes.platform === "newapi" ? "登录后自动连接 default 分组 Key。" : "使用当前 SubAPI 账号的可用分组 Key。"}视频初始默认 minimax-h3，可在下方选择或在对话中指定。</p></div><button disabled={Boolean(busy)} onClick={() => void work("refresh",refresh)}><RefreshCw size={14}/>检查连接</button></header>
    <div className={`fast-media-status ${status?.state === "ready" ? "is-ready" : "needs-repair"}`} role="status"><strong>{status?.state === "ready" ? "已连接" : status?.state === "environment_warning" ? "环境配置待修复" : "需要检查"}</strong><span>{status?.message || "正在检查系统环境变量…"}</span></div>
    {status?.default_video_available === false && <p className="fast-error">当前 Key 未开放默认视频模型 {defaults.video}，请联系平台开通，或生成时明确指定其他模型。</p>}
    <div className="fast-row"><button disabled={Boolean(busy)} onClick={() => void work("repair",async () => {const result=await api<{warning?:string}>("media_setup"); await refresh(); setMessage(result.warning || "当前平台 Key 与系统环境变量已修复。重启 Codex 或终端后生效。");})}><Wrench size={14}/>{busy === "repair" ? "正在修复…" : "一键配置／修复"}</button><button disabled={Boolean(busy)} onClick={() => setManual(value=>!value)}><KeyRound size={14}/>手动配置</button><button disabled={Boolean(busy)} onClick={() => setTest("text")}><FlaskConical size={14}/>文本测试</button><button disabled={Boolean(busy)} onClick={() => setTest("image")}><Image size={14}/>图片测试</button><MediaSetupGuideButton/></div>
    <p>测试会真实调用当前站点并按平台计费。环境变量配置给新启动的应用使用；已运行的 Codex 或终端需重启。</p>
    {manual && <form className="fast-media-manual" onSubmit={event=>{event.preventDefault();void work("manual",async()=>{const result=await api<{warning?:string}>("media_manual",{api_key:key});setKey("");await refresh();setMessage(result.warning || "手动 Key 已保存并配置环境变量。");});}}><label>当前路线的 API Key<input type="password" autoComplete="off" required value={key} onChange={event=>setKey(event.target.value)} placeholder="输入完整 Key，不会显示或写入日志"/></label><button type="submit" disabled={Boolean(busy) || !key.trim()}>保存并配置</button></form>}
    <div className="fast-media-grid" role="group" aria-label="默认模型">{textPicker}{(["image", "video"] as const).map(kind => {
      const list = available.filter(m => modelKind(m) === kind);
      return <article className="fast-media-choice" key={kind}><header>{kind === "image" ? <Image size={18}/> : <Video size={18}/>}<strong>{kind === "image" ? "图片模型" : "视频模型"}</strong><small>{list.length} 个可用</small></header><span>默认模型</span><b>{defaults[kind]}</b><button disabled={Boolean(busy) || !list.length} onClick={()=>setPicker(kind)}>切换{kind === "image" ? "图片" : "视频"}模型 ▾</button>{!list.length && <p>当前媒体 Key 暂无对应模型，请检查分组权限。</p>}</article>;
    })}</div>
    {picker && <ModelDialog kind={picker} keyId={keyId} models={available.filter(model=>modelKind(model) === picker)} value={defaults[picker]} busy={Boolean(busy)} onReload={()=>void work("refresh",refresh)} onClose={()=>setPicker(null)} onApply={async model=>{setBusy("model");setLocked(true);try {await api("media_select",{kind:picker,model});await refresh();setMessage("媒体默认模型已保存，后续任务会使用该选择。");}finally{setBusy("");setLocked(false);}}}/>}
    {test && <MediaTestDialog kind={test} models={available.filter(model=>modelKind(model) === test)} value={test === "image" ? defaults.image : textModel} onClose={()=>setTest(null)} onBusy={value=>{setBusy(value ? "test" : "");setLocked(value);}}/>}
    {message && <p role="status" className="fast-notice">{message}</p>}
  </section>;
}

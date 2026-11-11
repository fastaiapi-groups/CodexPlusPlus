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
  const [registered, setRegistered] = useState(false);
  const check = () => Promise.all([
    api<Status>("media_status"),
    invoke<{registered: boolean}>("fastaiapi_media_tool", {action: "status"}).catch(() => null),
  ]);
  const refresh = async () => {
    const [connection, tool] = await check();
    setStatus(connection);
    setRegistered(tool?.registered === true);
  };
  useEffect(() => {
    let disposed = false;
    const update = () => {
      void check().then(([connection, tool]) => {
        if (!disposed) { setStatus(connection); setRegistered(tool?.registered === true); }
      }).catch(error => { if (!disposed) setMessage(String(error)); });
    };
    update();
    const timer = setInterval(update, 60000);
    return () => { disposed = true; clearInterval(timer); };
  }, [keyId, routes.platform, routes.selected]);
  const work = async (name: string, fn: () => Promise<void>) => {setBusy(name); setLocked(true); setMessage(""); try {await fn();} catch(e) {setMessage(String(e));} finally {setBusy("");setLocked(false);}};
  const [picker, setPicker] = useState<"image" | "video" | null>(null), [test, setTest] = useState<"text" | "image" | null>(null);
  const defaults = {image: status?.image_model || "gpt-image-2", video: status?.video_model || "minimax-h3"};
  const available = status?.models ?? models;
  const connect = async (apiKey?: string) => {
    const result = await invoke<{registered: boolean; message: string}>("fastaiapi_media_tool", {action: "connect", apiKey});
    setRegistered(result.registered);
    setKey("");
    setManual(false);
    setMessage(result.message);
    await refresh();
  };
  return <section className="fast-media-models" aria-label="媒体创作与连接"><header><div><h3>媒体创作与连接</h3><p>连接后可在 Codex 对话中调用生图和视频工具。默认模型可在下方选择。</p></div><button disabled={Boolean(busy)} onClick={() => void work("refresh",refresh)}><RefreshCw size={14}/>检查连接</button></header>
    <div className={`fast-media-status ${status?.state === "ready" && registered ? "is-ready" : "needs-repair"}`} role="status">
      <strong>{registered ? status?.state === "ready" ? "工具已连接" : "连接待检查" : "工具未接入"}</strong>
      <span>{status?.message || "正在检查媒体凭据与路线…"}</span>
    </div>
    {status?.default_video_available === false && <p className="fast-error">当前 Key 未开放默认视频模型 {defaults.video}，请联系平台开通，或生成时明确指定其他模型。</p>}
    <div className="fast-row">
      <button disabled={Boolean(busy)} onClick={() => void work("connect", () => connect())}><Wrench size={14}/>{busy === "connect" ? "正在连接…" : registered ? "重新连接媒体工具" : "连接媒体工具"}</button>
      <button disabled={Boolean(busy)} onClick={() => setManual(value=>!value)}><KeyRound size={14}/>手动配置</button>
      <button disabled={Boolean(busy)} onClick={() => setTest("text")}><FlaskConical size={14}/>文本测试</button>
      <button disabled={Boolean(busy)} onClick={() => setTest("image")}><Image size={14}/>图片测试</button>
      <MediaSetupGuideButton/>
    </div>
    <p>Key 保存在系统凭据库。生成和测试使用当前 FastAiApi 路线并按平台计费。</p>
    {manual && <form className="fast-media-manual" onSubmit={event => { event.preventDefault(); void work("manual", () => connect(key)); }}>
      <label>当前路线的 API Key<input type="password" autoComplete="off" required value={key} onChange={event=>setKey(event.target.value)} placeholder="输入完整 Key"/></label>
      <button type="submit" disabled={Boolean(busy) || !key.trim()}>保存并连接</button>
    </form>}
    <div className="fast-media-grid" role="group" aria-label="默认模型">{textPicker}{(["image", "video"] as const).map(kind => {
      const list = available.filter(m => modelKind(m) === kind);
      return <article className="fast-media-choice" key={kind}><header>{kind === "image" ? <Image size={18}/> : <Video size={18}/>}<strong>{kind === "image" ? "图片模型" : "视频模型"}</strong><small>{list.length} 个可用</small></header><span>默认模型</span><b>{defaults[kind]}</b><button disabled={Boolean(busy) || !list.length} onClick={()=>setPicker(kind)}>切换{kind === "image" ? "图片" : "视频"}模型 ▾</button>{!list.length && <p>当前媒体 Key 暂无对应模型，请检查分组权限。</p>}</article>;
    })}</div>
    {picker && <ModelDialog kind={picker} keyId={keyId} models={available.filter(model=>modelKind(model) === picker)} value={defaults[picker]} busy={Boolean(busy)} onReload={()=>void work("refresh",refresh)} onClose={()=>setPicker(null)} onApply={async model=>{setBusy("model");setLocked(true);try {await api("media_select",{kind:picker,model});await refresh();setMessage("媒体默认模型已保存，后续任务会使用该选择。");}finally{setBusy("");setLocked(false);}}}/>}
    {test && <MediaTestDialog kind={test} models={available.filter(model=>modelKind(model) === test)} value={test === "image" ? defaults.image : textModel} onClose={()=>setTest(null)} onBusy={value=>{setBusy(value ? "test" : "");setLocked(value);}}/>}
    {message && <p role="status" className="fast-notice">{message}</p>}
  </section>;
}

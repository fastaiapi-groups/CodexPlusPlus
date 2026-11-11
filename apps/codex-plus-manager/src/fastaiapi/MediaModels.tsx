import { useEffect, useState, type ReactNode } from "react";
import { MediaSetupGuideButton } from "./MediaSetupGuide";
import { ModelDialog } from "./ModelDialog";
import { MediaTestDialog } from "./MediaTestDialog";

import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { Image, Video, Wrench, RefreshCw, KeyRound, FlaskConical } from "lucide-react";
import { supportsModel } from "./modelGroups";

type Status = {
  state: string; message: string; default_video_available?: boolean; models?: string[];
  image_model?: string; video_model?: string; fallback_key_id?: number | null;
  key_ids?: Partial<Record<"image" | "video", number | null>>;
  group_ids?: Partial<Record<"image" | "video", string | null>>;
  models_by_kind?: Partial<Record<"text" | "image" | "video", string[]>>;
};

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
  const modelsFor = (kind: "text" | "image" | "video") =>
    (status?.models_by_kind ? status.models_by_kind[kind] ?? [] : status?.models ?? models)
      .filter(model => supportsModel(routes.platform, kind, model));
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
      const list = modelsFor(kind);
      return <article className="fast-media-choice" key={kind}><header>{kind === "image" ? <Image size={18}/> : <Video size={18}/>}<strong>{kind === "image" ? "图片模型" : "视频模型"}</strong><small>{list.length} 个可用</small></header><span>默认模型</span><b>{defaults[kind]}</b><button disabled={Boolean(busy)} onClick={()=>setPicker(kind)}>切换{kind === "image" ? "图片" : "视频"}模型 ▾</button>{!list.length && <p>当前连接暂无对应模型。</p>}</article>;
    })}</div>
    {picker && <ModelDialog kind={picker} keyId={status?.key_ids?.[picker] ?? status?.fallback_key_id ?? 0} groupId={status?.group_ids?.[picker]}
      models={modelsFor(picker)} value={defaults[picker]} busy={Boolean(busy)} applyHint={registered ? undefined : "确认后会连接内置媒体工具，并保存默认分组。"} onClose={() => setPicker(null)}
      onApply={async ({model, groupId, keyId: selectedKey}) => {
        if (!registered) await connect();
        await api("media_select", {kind: picker, model, ...(groupId ? {group_id: groupId, key_id: selectedKey} : {})});
        await refresh().catch(() => {});
        setMessage("媒体默认分组和模型已保存。");
      }}/>}
    {test && <MediaTestDialog kind={test} models={modelsFor(test)} value={test === "image" ? defaults.image : textModel} onClose={()=>setTest(null)} onBusy={value=>{setBusy(value ? "test" : "");setLocked(value);}}/>}
    {message && <p role="status" className="fast-notice">{message}</p>}
  </section>;
}

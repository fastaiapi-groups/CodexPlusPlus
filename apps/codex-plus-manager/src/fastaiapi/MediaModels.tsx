import { useEffect, useState, type ReactNode } from "react";
import { ModelDialog } from "./ModelDialog";
import { MediaTestDialog } from "./MediaTestDialog";
import { VideoTestDialog } from "./VideoTestDialog";

import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { Image, Video, RefreshCw, FlaskConical } from "lucide-react";
import { keyGroup, supportsModel } from "./modelGroups";

import { useModelDirectory } from "./ModelDirectoryContext";
import { catalogModelKinds, catalogModels } from "./modelDirectory";

type Status = {
  state: string; message: string; default_video_available?: boolean; models?: string[];
  image_model?: string; video_model?: string; fallback_key_id?: number | null;
  key_ids?: Partial<Record<"image" | "video", number | null>>;
  group_ids?: Partial<Record<"image" | "video", string | null>>;
  models_by_kind?: Partial<Record<"text" | "image" | "video", string[]>>;
};

export function MediaModels({textModel, textPicker}: {textModel?: string; textPicker: ReactNode}) {
  const invoke = usePlatformInvoke();
  const api = <T,>(action: string, body?: object) => invoke<T>("fastaiapi_account", {action, body});
  const {routes, setLocked} = useServiceRoutes();
  const {directory} = useModelDirectory();
  const kinds = catalogModelKinds(directory?.catalogs);
  const platformName = routes.platforms.find(platform => platform.id === routes.platform)?.name;
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(true);
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
  const ensure = () => invoke<{registered: boolean; message?: string}>("fastaiapi_media_tool", {action: "ensure"});
  useEffect(() => {
    let disposed = false;
    const update = () => check().then(([connection, tool]) => {
      if (!disposed) {
        setStatus(connection);
        setRegistered(tool?.registered === true);
      }
    });
    setConnecting(true);
    setMessage("");
    void ensure().then(result => {
      if (!disposed && result.message) setMessage(result.message);
    }).catch(error => {
      if (!disposed) setMessage(String(error));
    }).then(update).catch(error => {
      if (!disposed) setMessage(String(error));
    }).finally(() => {if (!disposed) setConnecting(false);});
    return () => { disposed = true; };
  }, [routes.platform, routes.selected]);
  const work = async (name: string, fn: () => Promise<void>) => {setBusy(name); setLocked(true); setMessage(""); try {await fn();} catch(e) {setMessage(String(e));} finally {setBusy("");setLocked(false);}};
  const [picker, setPicker] = useState<"image" | "video" | null>(null), [test, setTest] = useState<"text" | "image" | "video" | null>(null);
  const defaults = {image: status?.image_model || "gpt-image-2", video: status?.video_model || "minimax-h3"};
  const modelsFor = (kind: "text" | "image" | "video") =>
    (status?.models_by_kind ? status.models_by_kind[kind] ?? [] : status?.models ?? [])
      .filter(model => supportsModel(routes.platform, kind, model, kinds.get(model)));
  const boundKey = (kind: "image" | "video") => status?.key_ids?.[kind] ?? status?.fallback_key_id ?? 0;
  const groupFor = (kind: "image" | "video") => {
    const key = directory?.keys.find(key => key.id === boundKey(kind));
    return status?.group_ids?.[kind] ?? (key ? keyGroup(key, routes.platform) : null);
  };
  const checkConnection = async () => {
    const result = await ensure();
    if (result.message) setMessage(result.message);
    await refresh();
  };
  const working = connecting || Boolean(busy);
  const setTestBusy = (value: boolean) => {setBusy(value ? "test" : "");setLocked(value);};
  return <section className="fast-media-models" aria-label="媒体创作与连接"><header><div><h3>媒体创作与连接</h3><p>在 Codex 对话中调用生图和视频工具。默认模型可在下方选择。</p></div><button disabled={working} onClick={() => void work("refresh",checkConnection)}><RefreshCw size={14}/>检查连接</button></header>
    <div className={`fast-media-status ${status?.state === "ready" && registered ? "is-ready" : "needs-repair"}`} role="status">
      <strong>{connecting ? "正在连接" : registered && status?.state === "ready" ? "工具已连接" : "连接待检查"}</strong>
      <span>{status?.message || "正在检查媒体凭据与路线…"}</span>
    </div>
    {status?.default_video_available === false && <p className="fast-error">当前 Key 未开放默认视频模型 {defaults.video}，请联系平台开通，或生成时明确指定其他模型。</p>}
    <div className="fast-row">
      <button disabled={working || !registered || !modelsFor("text").length} onClick={() => setTest("text")}><FlaskConical size={14}/>文本测试</button>
      <button disabled={working || !registered || !modelsFor("image").length} onClick={() => setTest("image")}><Image size={14}/>图片测试</button>
      <button disabled={working || !registered} onClick={() => setTest("video")}><Video size={14}/>视频测试</button>
    </div>
    <p>Key 保存在系统凭据库。生成和测试使用当前 {platformName} 路线并按平台计费。</p>
    <div className="fast-media-grid" role="group" aria-label="默认模型">{textPicker}{(["image", "video"] as const).map(kind => {
      const ids = new Set([...modelsFor(kind), ...Array.from(directory?.catalogs.values() ?? []).flatMap(catalogModels)]
        .filter(id => supportsModel(routes.platform, kind, id, kinds.get(id))));
      const group = directory?.groups.find(group => group.id === groupFor(kind));
      return <article className="fast-media-choice" key={kind}><header>{kind === "image" ? <Image size={18}/> : <Video size={18}/>}<strong>{kind === "image" ? "图片模型" : "视频模型"}</strong><small>{ids.size} 个可用</small></header><span>默认模型{group && ` · ${group.name}`}</span><b>{defaults[kind]}</b><button disabled={working} onClick={()=>setPicker(kind)}>切换{kind === "image" ? "图片" : "视频"}模型 ▾</button></article>;
    })}</div>
    {picker && <ModelDialog kind={picker} keyId={boundKey(picker)} groupId={groupFor(picker)}
      models={modelsFor(picker)} value={defaults[picker]} busy={working} onClose={() => setPicker(null)}
      onApply={async () => {
        await refresh().catch(() => {});
        setMessage("媒体默认分组和模型已保存。");
      }}/>}
    {test === "video" && <VideoTestDialog models={modelsFor("video")} value={defaults.video} onClose={() => setTest(null)} onBusy={setTestBusy}/>}
    {(test === "text" || test === "image") && <MediaTestDialog kind={test} models={modelsFor(test)} value={test === "image" ? defaults.image : textModel} onClose={()=>setTest(null)} onBusy={setTestBusy}/>}
    {message && <p role="status" className="fast-notice">{message}</p>}
  </section>;
}

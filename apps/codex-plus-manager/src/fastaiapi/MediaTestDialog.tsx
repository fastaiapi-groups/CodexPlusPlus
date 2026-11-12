import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, FlaskConical, Image, LoaderCircle, X } from "lucide-react";
import { useActiveServiceRoute, usePlatformInvoke } from "./ServiceRoutes";
import { AppSelect } from "../AppSelect";
import "./media-select.css";
import { mediaRouteUrls } from "./mediaRoutes";
import { MediaSetupGuideButton } from "./MediaSetupGuide";
import "./media-guide.css";

type Result = {message: string; model: string; text?: string; image?: string};
export function MediaTestDialog({kind, models, value, onClose, onBusy}: {
  kind: "text" | "image"; models: string[]; value?: string; onClose: ()=>void; onBusy: (value: boolean)=>void;
}) {
  const invoke = usePlatformInvoke(), dialog = useRef<HTMLDialogElement>(null);
  const [model,setModel] = useState(models.includes(value || "") ? value! : models[0] || "");
  const [prompt,setPrompt] = useState(kind === "text" ? "Reply with OK only." : "A small blue circle centered on a white background, simple flat icon.");
  const [running,setRunning] = useState(false), [error,setError] = useState("");
  const [result,setResult] = useState<Result | null>(null);
  const {route} = useActiveServiceRoute();
  const urls = mediaRouteUrls(route.origin);
  const label = kind === "text" ? "文本" : "图片";
  useEffect(()=>{const opener=document.activeElement,element=dialog.current;element?.showModal();return()=>{element?.close();if(opener instanceof HTMLElement && opener.isConnected)opener.focus();};},[]);
  return createPortal(<dialog ref={dialog} className="fast-setup-dialog fast-media-test-dialog" aria-labelledby="fast-media-test-title" onCancel={event=>{event.preventDefault();if(!running)onClose();}} onClick={event=>{if(event.target===event.currentTarget&&!running)onClose();}}>
    <header><div><small>当前媒体连接 · 真实调用</small><h2 id="fast-media-test-title">{label}生成测试</h2></div><button type="button" aria-label="关闭生成测试" disabled={running} onClick={onClose}><X size={20}/></button></header>
    <form onSubmit={async event=>{event.preventDefault();if(running)return;setRunning(true);onBusy(true);setError("");setResult(null);try{setResult(await invoke<Result>("fastaiapi_account",{action:"media_test",body:{kind,model,prompt}}));}catch(error){setError(String(error));}finally{setRunning(false);onBusy(false);}}}>
      <div className="fast-media-test-field">
        <label htmlFor="fast-media-test-model">测试模型</label>
        <AppSelect id="fast-media-test-model" ariaLabel="测试模型" className="fast-styled-select" value={model}
          options={models.map(model => ({value:model,label:model}))} placeholder="暂无可用模型" disabled={running || !models.length}
          onChange={model=>{setModel(model);setResult(null);setError("");}}/>
      </div>
      {!models.length && <p role="alert">当前媒体 Key 没有可用的{label}模型，请先检查连接和分组权限。</p>}
      <label>测试内容<textarea aria-label="测试内容" maxLength={4000} required rows={3} value={prompt} onChange={event=>{setPrompt(event.target.value);setResult(null);setError("");}} disabled={running}/></label>
      <p className="fast-media-test-endpoint"><code>POST {kind === "image" ? urls.generateImage : urls.testText}</code></p>
      <p className="fast-media-test-note">{kind === "image" ? "本次请求生成 1 张 1024×1024 图片，实际尺寸以平台返回为准。" : "本次进行一次简短文本生成。"}测试使用媒体 Key，按当前平台计费；不会改变默认模型。</p>
      {running && <p className="fast-media-test-progress" role="status"><LoaderCircle size={16}/>{label}生成中，请等待平台响应。请勿重复提交。</p>}
      {error && <div className="fast-media-test-error" role="alert"><strong>{result ? "结果预览需要检查" : "测试未完成"}</strong><p>{error}</p><small>权限或环境问题可查看下方图文指引。结果不确定时先核对平台使用记录，再决定是否重测。</small></div>}
      {result && <div className="fast-media-test-result" role="status"><strong><CheckCircle2 size={16}/>{result.message}</strong><small>{result.model}</small>{result.text && <pre>{result.text}</pre>}{result.image && <img src={result.image} alt="图片生成测试结果" onError={()=>setError("平台已返回图片，但预览加载失败。请核对原使用记录，避免重复生成。")}/>}</div>}
      <footer><MediaSetupGuideButton/><button type="submit" className="fast-media-test-submit" disabled={running || !model || !prompt.trim()}>{running ? <LoaderCircle size={15}/> : kind === "text" ? <FlaskConical size={15}/> : <Image size={15}/>} {running ? "正在测试…" : `开始${label}测试`}</button></footer>
    </form>
  </dialog>,document.body);
}

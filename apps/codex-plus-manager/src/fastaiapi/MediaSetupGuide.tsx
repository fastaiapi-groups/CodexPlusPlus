import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CheckCircle2, KeyRound, LockKeyhole, Monitor, Terminal, X } from "lucide-react";
import "./media-guide.css";
import { useActiveServiceRoute, usePlatformInvoke } from "./ServiceRoutes";
import { mediaRouteUrls } from "./mediaRoutes";

type System = "macos" | "windows" | "linux";
const systems: {id: System; label: string}[] = [{id:"macos",label:"macOS"},{id:"windows",label:"Windows"},{id:"linux",label:"Linux"}];
function currentSystem(): System {
  const platform = navigator.userAgent.toLowerCase();
  return platform.includes("win") ? "windows" : platform.includes("mac") ? "macos" : "linux";
}
function SetupIllustration({system, platformName}: {system: System; platformName: string}) {
  const label = system === "macos" ? "macOS 钥匙串" : "Windows 凭据管理器";
  return <figure className="fast-setup-figure">
    <div className="fast-setup-window" role="img" aria-label={`${label}保存媒体 Key 示意图`}>
      <div className="fast-setup-window-bar"><i/><i/><i/><span>{label}</span></div>
      <div className="fast-setup-keychain"><LockKeyhole size={34}/><strong>{platformName} 媒体凭据</strong><span>由本机 Codex++ 读取，按系统提示授权</span></div>
    </div>
    <figcaption>凭据保存示意，实际系统界面可能不同。</figcaption>
  </figure>;
}
export function MediaSetupGuide() {
  const {route, platformName} = useActiveServiceRoute();
  const invoke = usePlatformInvoke();
  const guide = mediaRouteUrls(route.origin).guide;
  const [system, setSystem] = useState<System>(currentSystem);
  return <section className="fast-setup-guide" aria-label="媒体配置图文指引">
    <div className="fast-setup-systems" role="group" aria-label="选择操作系统">{systems.map(item=><button key={item.id} type="button" aria-pressed={system === item.id} onClick={()=>setSystem(item.id)}>{item.id === "linux" ? <Terminal size={15}/> : <Monitor size={15}/>} {item.label}</button>)}</div>
    {system === "linux" ? <p>Linux 可按技能中的 references/setup.md 使用独立版媒体工具。</p> : <>
      <SetupIllustration system={system} platformName={platformName}/>
      <ol className="fast-setup-steps">
        <li><KeyRound size={18}/><div><h4>连接媒体工具</h4><p>登录平台并选择服务线路，在概览确认默认图片或视频模型，系统会自动绑定 Key。出现连接问题时，在概览点击「检查连接」。</p></div></li>
        <li><LockKeyhole size={18}/><div><h4>检查系统凭据</h4><p>{system === "macos"
          ? "若系统提示访问钥匙串，核对请求来自你正在使用的 Codex++。如果读取超时，检查登录钥匙串是否已解锁，再重新连接。"
          : "如果读取失败，在开始菜单打开「凭据管理器」，检查当前 Windows 用户的凭据访问权限，再重新连接。"} </p></div></li>
        <li><CheckCircle2 size={18}/><div><h4>在 Codex 对话里使用</h4><p>连接后重新打开 Codex 会话，在对话中指定生图或视频任务。MiniMax H3 需要参考图。生成会使用 {platformName} 的媒体额度。</p><p>出现 401／403 时检查 Key 与模型权限。视频中断后继续查询原任务。</p></div></li>
      </ol>
    </>}
    <button type="button" className="fast-guide-link" onClick={() => void invoke("open_external_url", {url: guide})}>{platformName} 图片 API 文档</button>
  </section>;
}
export function MediaSetupGuideButton() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={()=>setOpen(true)}><BookOpen size={14}/>配置图文指引</button>{open && <SetupGuideDialog onClose={()=>setOpen(false)}/>}</>;
}
function SetupGuideDialog({onClose}: {onClose: ()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{const opener=document.activeElement, element=dialog.current; element?.showModal(); return ()=>{element?.close();if(opener instanceof HTMLElement && opener.isConnected)opener.focus();};},[]);
  return createPortal(<dialog ref={dialog} className="fast-setup-dialog" aria-labelledby="fast-setup-title" onCancel={e=>{e.preventDefault();e.stopPropagation();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header><div><small>媒体连接与系统权限</small><h2 id="fast-setup-title">配置图文指引</h2></div><button type="button" aria-label="关闭配置图文指引" onClick={onClose}><X size={20}/></button></header><MediaSetupGuide/></dialog>,document.body);
}

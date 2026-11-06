import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CheckCircle2, KeyRound, LockKeyhole, Monitor, Terminal, X } from "lucide-react";
import "./media-guide.css";

type System = "macos" | "windows" | "linux";
const systems: {id: System; label: string}[] = [{id:"macos",label:"macOS"},{id:"windows",label:"Windows"},{id:"linux",label:"Linux"}];
const names = ["FASTAIAPI_API_KEY", "FASTAIAPI_GROK_API_KEY", "FASTAIAPI_H3_API_KEY", "FASTAIAPI_BASE_URL"];
function currentSystem(): System {
  const platform = navigator.userAgent.toLowerCase();
  return platform.includes("win") ? "windows" : platform.includes("mac") ? "macos" : "linux";
}
function SetupIllustration({system}: {system: System}) {
  return <figure className="fast-setup-figure"><div className="fast-setup-window" role="img" aria-label={system === "macos" ? "macOS 系统凭据授权示意图" : system === "windows" ? "Windows 用户环境变量编辑示意图" : "Linux 当前终端环境配置示意图"}>
    <div className="fast-setup-window-bar"><i/><i/><i/><span>{system === "macos" ? "系统凭据授权" : system === "windows" ? "用户变量" : "当前终端 · 配置示意"}</span></div>
    {system === "macos" ? <div className="fast-setup-keychain"><LockKeyhole size={34}/><strong>Codex++ 请求访问媒体凭据</strong><span>核对应用名称与路径，按系统提示授权</span><div><span>不允许</span><b>允许</b></div></div> : <div className="fast-setup-variable-list">{names.filter((_,index)=>system !== "linux" || index < 3).map((name,index)=><div key={name}><code>{name}</code><span>{index === 3 ? "当前路线的服务地址" : "••••••••••••"}</span></div>)}<small>{system === "windows" ? "填写用户变量，无需修改系统变量" : "由用户在本机交互输入，密钥不出现在命令历史中"}</small></div>}
  </div><figcaption>操作示意图，实际系统界面可能不同；图中的按钮不可点击。</figcaption></figure>;
}
export function MediaSetupGuide() {
  const [system, setSystem] = useState<System>(currentSystem);
  return <section className="fast-setup-guide" aria-label="媒体配置图文指引">
    <p className="fast-setup-intro">先看错误提示：命令超时通常需要检查系统响应；访问被拒绝需要处理对应权限；401／403 需要检查 Key 和模型权限。不会要求管理员提权。</p>
    <div className="fast-setup-systems" role="group" aria-label="选择操作系统">{systems.map(item=><button key={item.id} type="button" aria-pressed={system === item.id} onClick={()=>setSystem(item.id)}>{item.id === "linux" ? <Terminal size={15}/> : <Monitor size={15}/>} {item.label}</button>)}</div>
    <SetupIllustration system={system}/>
    <ol className="fast-setup-steps">
      <li><KeyRound size={18}/><div><h4>先在应用里配置</h4><p>打开「概览 → 媒体创作与环境配置」，点击「一键配置／修复」。New API 优先复用 default 分组 Key；SubAPI 使用当前账号可用分组。已有 Key 可点「手动配置」，粘贴后保存。</p></div></li>
      {system === "macos" ? <>
        <li><LockKeyhole size={18}/><div><h4>访问被拒绝：检查钥匙串与目录权限</h4><p>若出现钥匙串弹窗，核对请求应用是你正在使用的 Codex++ 或 Codex，按系统提示允许；系统密码由你本人输入。未看到弹窗时，可在「钥匙串访问」中确认“登录”钥匙串已解锁，再回应用重试。</p><p>若提示无法保存连接或登录恢复项，在 Finder 的「前往文件夹」检查 ~/.codex/skills/fastaiapi-media 和 ~/Library/LaunchAgents：选中文件夹 → 显示简介 → 共享与权限，确认当前用户可读写。受单位策略管理时联系管理员处理。</p></div></li>
        <li><Terminal size={18}/><div><h4>系统命令超时：等待系统响应后重试</h4><p>环境命令限时 3 秒，技能读取凭据限时 15 秒。先处理后台系统授权弹窗，确认电脑与用户会话正常，再点「一键配置／修复」。命令不可用或反复失败时保留错误提示并反馈。</p><p>环境写入失败会尝试回滚，技能可尝试当前连接的系统凭据库；界面仍会提示环境待修复。不要把其他账号的旧环境值当作配置成功。</p></div></li>
      </> : system === "windows" ? <>
        <li><LockKeyhole size={18}/><div><h4>访问被拒绝：检查当前用户权限</h4><p>在开始菜单搜索「凭据管理器」，确认 Windows 凭据管理器可用；用户环境变量在 HKEY_CURRENT_USER 的 Environment 项。若单位策略或安全软件阻止访问，请按本机策略恢复权限，随后重试。</p><p>提示文件无法写入时，在用户目录的 .codex/skills/fastaiapi-media 文件夹属性 → 安全中，检查当前用户的写入权限。不要修改不相关目录或扩大所有人的权限。</p></div></li>
        <li><Monitor size={18}/><div><h4>手动配置用户环境变量</h4><p>在开始菜单搜索「编辑账户的环境变量」，在上方“用户变量”中新建或编辑图示四项。前三项填写当前平台的同一枚有效媒体 Key；FASTAIAPI_BASE_URL 填写概览显示的当前服务地址。确认保存后重新打开终端和 Codex。</p><p>不要填入“系统变量”。若注册表写入、回滚或系统通知失败，应用会保留提示；处理权限后再执行一键修复。必要时重新登录 Windows。</p></div></li>
      </> : <>
        <li><Terminal size={18}/><div><h4>Linux 需要手动设置运行环境</h4><p>当前应用暂不支持 Linux 自动凭据保存及托管连接配置。请按媒体技能内的 references/setup.md 使用独立模式，为启动 Codex 的同一终端配置图示三项环境变量，或通过 configure 交互配置。独立模式中 main／grok 使用 fastaiapi.cloud 对应分组的 Key，h3 使用 newapi.fastaiapi.cloud 的 Key，不能混用。</p><p>让 Codex 使用交互输入或私密临时文件配置，避免将 Key 直接写进命令行、聊天、日志或版本库；关闭终端后，临时环境变量可能失效。托管连接报错时先修复连接，避免沿用其他账号的值。</p></div></li>
      </>}
      <li><CheckCircle2 size={18}/><div><h4>验证与失效修复</h4><p>回到概览点击「检查连接」，再分别做「文本测试」和「图片测试」（真实调用并按平台计费）。在 Codex 新对话中试用手册的生图、生视频案例；视频默认 minimax-h3，需要参考图。</p><p>401／403 表示 Key 可能失效或缺少权限，点「一键配置／修复」或换成有效 Key；网络错误先检查站点、代理和网络，文件写入被拒绝时把输出改到当前项目目录。测试仍失败时保留错误截图，反馈时不要附完整 Key。</p></div></li>
    </ol>
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

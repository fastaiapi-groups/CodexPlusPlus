import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Check, Globe, RefreshCw, Signal, X } from "lucide-react";
import "./routes.css";
type Route = {id: number; name: string; origin: string};
export type Platform = "newapi" | "subapi";
type Routes = {platform: Platform; platforms: {id: Platform; name: string}[]; selected: number; items: Route[]};
type Probe = {id: number; latency_ms: number | null; error: string | null};
const Context = createContext<{routes: Routes; locked: boolean; authenticated: boolean; setAuthenticated: (value: boolean) => void; warning: string; setLocked: (value: boolean) => void; selectPlatform: (id: Platform) => Promise<void>; select: (id: number) => Promise<void>} | null>(null);
export const useServiceRoutes = () => useContext(Context)!;
// 捕获本次渲染的平台，异步请求不依赖可变的全局选择。
export function usePlatformInvoke() {
  const {routes} = useServiceRoutes();
  return <T,>(command: string, args: Record<string, unknown> = {}) => invoke<T>(command, {...args, platform: routes.platform});
}
export function ServiceRouteProvider({children}: {children: ReactNode}) {
  const [routes, setRoutes] = useState<Routes | null>(null), [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [locked, setLocked] = useState(false), [warning, setWarning] = useState("");
  const load = () => {setError(""); invoke<Routes>("fastaiapi_account", {action: "routes"}).then(setRoutes).catch(e => setError(String(e)));};
  useEffect(load, []);
  if (!routes) return <div className="fast-gate fast-loading" role="status">{error || "正在读取服务路线…"}{error && <button onClick={load}>重试</button>}</div>;
  return <Context.Provider value={{routes, locked, authenticated, setAuthenticated, warning, setLocked, selectPlatform: async platform => {
    if (platform === routes.platform) return;
    if (authenticated) throw new Error("已登录当前平台，请退出登录后再选择平台。");
    setLocked(true);
    try {
      const next = await invoke<Routes>("fastaiapi_account", {action: "select_platform", platform: routes.platform, body: {platform}});
      setWarning(""); setRoutes(next);
    } finally {setLocked(false);}
  }, select: async id => {
    if (id === routes.selected) return;
    const result = await invoke<{configuration_warning?: string}>("fastaiapi_account", {action: "select_route", platform: routes.platform, body: {route: id}});
    setWarning(result.configuration_warning ?? "");
    setLocked(false); setRoutes({...routes, selected: id});
  }}}>{children}</Context.Provider>;
}
export function RouteSelector({login = false}: {login?: boolean}) {
  const {routes, locked, authenticated, select, selectPlatform} = useServiceRoutes();
  const [open, setOpen] = useState(false), [platformOpen, setPlatformOpen] = useState(false);
  const name = routes.platforms.find(p => p.id === routes.platform)?.name;
  return <><div className={`fast-service-selectors${login ? " is-login" : ""}`}>
    {authenticated ? <span className="fast-route-trigger fast-platform-fixed" aria-label={`当前平台：${name}`}><Globe size={16}/>{name}</span> : <button type="button" className="fast-route-trigger" aria-label={`选择平台：${name}`} disabled={locked} onClick={() => setPlatformOpen(true)}><Globe size={16}/>{name}<span>⌄</span></button>}
    <button type="button" className="fast-route-trigger" disabled={locked} onClick={() => setOpen(true)}><Globe size={16}/>{routes.items.find(r => r.id === routes.selected)?.name}<span>⌄</span></button>
    </div>{platformOpen && !authenticated && <PlatformDialog routes={routes} onSelect={selectPlatform} onClose={() => setPlatformOpen(false)}/>}{open && <RouteDialog routes={routes} onSelect={select} onClose={() => setOpen(false)}/>}</>;
}
function PlatformDialog({routes, onSelect, onClose}: {routes: Routes; onSelect: (id: Platform) => Promise<void>; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [switching, setSwitching] = useState(false), [error, setError] = useState("");
  useEffect(() => {const opener=document.activeElement,element=dialog.current;element?.showModal();return()=>{element?.close();if(opener instanceof HTMLElement && opener.isConnected)opener.focus();};},[]);
  return createPortal(<dialog ref={dialog} className="fast-route-dialog" aria-labelledby="fast-platform-title" onCancel={e=>{e.preventDefault();if(!switching)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!switching)onClose();}}>
    <header><h2 id="fast-platform-title">选择服务平台</h2><button aria-label="关闭平台选择" disabled={switching} onClick={onClose}><X/></button></header>
    <div className="fast-route-body"><div className="fast-route-list">{routes.platforms.map(item=><button key={item.id} type="button" aria-pressed={item.id===routes.platform} disabled={switching} className={item.id===routes.platform?"is-selected":""} onClick={async()=>{setSwitching(true);setError("");try{await onSelect(item.id);onClose();}catch(e){setError(String(e));}finally{setSwitching(false);}}}>
      <Globe size={27}/><span className="fast-route-name"><strong>{item.name}</strong></span><span className="fast-route-check" style={{marginLeft:"auto"}}>{item.id===routes.platform&&<Check size={25}/>}</span>
    </button>)}</div>{error&&<p role="alert">{error}</p>}</div>
  </dialog>,document.body);
}
function RouteDialog({routes, onSelect, onClose}: {routes: Routes; onSelect: (id: number) => Promise<void>; onClose: () => void}) {
  const invoke = usePlatformInvoke();
  const dialog = useRef<HTMLDialogElement>(null);
  const [probes, setProbes] = useState<Probe[]>([]), [testing, setTesting] = useState(false), [switching, setSwitching] = useState(false), [error, setError] = useState("");
  useEffect(() => {const opener = document.activeElement; const element = dialog.current; element?.showModal(); return () => {element?.close(); if(opener instanceof HTMLElement && opener.isConnected) opener.focus();};}, []);
  const test = async () => {setTesting(true); setError(""); try {setProbes(await invoke<Probe[]>("fastaiapi_account", {action: "test_routes"}));} catch(e) {setError(String(e));} finally {setTesting(false);}};
  useEffect(() => {void test();}, []);
  return createPortal(<dialog ref={dialog} className="fast-route-dialog" aria-labelledby="fast-route-title" onCancel={e => {e.preventDefault(); if(!switching) onClose();}} onClick={e => {if(e.target === e.currentTarget && !switching) onClose();}}><header><h2 id="fast-route-title">选择服务路线</h2><button aria-label="关闭路线选择" disabled={switching} onClick={onClose}><X/></button></header><div className="fast-route-body"><div className="fast-route-list">{routes.items.map(route => {
    const probe = probes.find(p => p.id === route.id), selected = route.id === routes.selected;
    return <button key={route.id} type="button" aria-pressed={selected} disabled={switching} className={selected ? "is-selected" : ""} onClick={async () => {setSwitching(true); setError(""); try {await onSelect(route.id); onClose();} catch(e) {setError(String(e));} finally {setSwitching(false);}}}><Globe size={27}/><span className="fast-route-name"><strong>{route.name}</strong></span><span className={`fast-route-latency${probe?.error ? " is-error" : ""}`}><Signal size={19}/>{testing ? "测试中…" : probe?.latency_ms != null ? `${probe.latency_ms} 毫秒` : probe?.error ? "暂不可用" : "待测试"}</span><span className="fast-route-check">{selected && <Check size={25}/>}</span></button>;
  })}</div>{error && <p role="alert">{error}</p>}<footer><button type="button" disabled={testing || switching} onClick={() => void test()}><RefreshCw size={17} className={testing ? "is-spinning" : ""}/>{testing ? "测试中…" : "测试"}</button></footer></div></dialog>, document.body);
}

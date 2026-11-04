import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Check, Globe, RefreshCw, Signal, X } from "lucide-react";
import "./routes.css";
type Route = {id: number; name: string; origin: string};
type Routes = {selected: number; items: Route[]};
type Probe = {id: number; latency_ms: number | null; error: string | null};
const Context = createContext<{routes: Routes; locked: boolean; warning: string; setLocked: (value: boolean) => void; select: (id: number) => Promise<void>} | null>(null);
export const useServiceRoutes = () => useContext(Context)!;
export function ServiceRouteProvider({children}: {children: ReactNode}) {
  const [routes, setRoutes] = useState<Routes | null>(null), [error, setError] = useState("");
  const [locked, setLocked] = useState(false), [warning, setWarning] = useState("");
  const load = () => {setError(""); invoke<Routes>("fastaiapi_account", {action: "routes"}).then(setRoutes).catch(e => setError(String(e)));};
  useEffect(load, []);
  if (!routes) return <div className="fast-gate fast-loading" role="status">{error || "正在读取服务路线…"}{error && <button onClick={load}>重试</button>}</div>;
  return <Context.Provider value={{routes, locked, warning, setLocked, select: async id => {
    if (id === routes.selected) return;
    const result = await invoke<{configuration_warning?: string}>("fastaiapi_account", {action: "select_route", body: {route: id}});
    setWarning(result.configuration_warning ?? "");
    setLocked(false); setRoutes({...routes, selected: id});
  }}}>{children}</Context.Provider>;
}
export function RouteSelector({login = false}: {login?: boolean}) {
  const {routes, locked, select} = useServiceRoutes();
  const [open, setOpen] = useState(false);
  return <><button type="button" className={`fast-route-trigger${login ? " is-login" : ""}`} disabled={locked} onClick={() => setOpen(true)}><Globe size={16}/>{routes.items.find(r => r.id === routes.selected)?.name}<span>⌄</span></button>{open && <RouteDialog routes={routes} onSelect={select} onClose={() => setOpen(false)}/>}</>;
}
function RouteDialog({routes, onSelect, onClose}: {routes: Routes; onSelect: (id: number) => Promise<void>; onClose: () => void}) {
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

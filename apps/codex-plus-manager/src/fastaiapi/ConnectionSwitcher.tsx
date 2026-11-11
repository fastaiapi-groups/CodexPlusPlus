import { useRef, useState } from "react";
import { NativeAuthControl } from "../NativeAuthControls";
import { usePlatformInvoke, useServiceRoutes } from "./ServiceRoutes";
import { type ConnectionMode } from "./connection-mode";
import "./connection-switcher.css";

export function ConnectionSwitcher({ mode, disabled, onSwitch }: {
  mode: ConnectionMode | null;
  disabled: boolean;
  onSwitch: (mode: ConnectionMode, platform: string, profileId?: string) => Promise<boolean>;
}) {
  const invoke = usePlatformInvoke();
  const { routes, locked, setLocked } = useServiceRoutes();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const select = async (next: ConnectionMode) => {
    if (pending.current || disabled || locked || next === mode) return;
    pending.current = true;
    setBusy(true);
    setLocked(true);
    setError("");
    setNotice("");
    try {
      const saved = next === "fastai"
        ? await invoke<{profile_id?: string}>("fastaiapi_account", {action: "configuration"})
        : undefined;
      if (await onSwitch(next, routes.platform, saved?.profile_id)) {
        setNotice("连接已切换，重启 Codex 后生效。");
      }
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
      setLocked(false);
    }
  };
  return <section className="fast-connection-switcher" aria-label="Codex 连接方式">
    <div className="fast-connection-heading">
      <div><h2>Codex 连接方式</h2><p>{mode === "official" ? "使用自己的 ChatGPT / Codex 账号额度" : mode === "fastai" ? "使用 FastAiApi 模型服务" : "当前使用其他供应商连接"}</p></div>
      <div className="fast-connection-options" role="group" aria-label="切换 Codex 连接方式">
        <button type="button" aria-pressed={mode === "fastai"} disabled={disabled || locked || busy} onClick={() => void select("fastai")}>FastAiApi</button>
        <button type="button" aria-pressed={mode === "official"} disabled={disabled || locked || busy} onClick={() => void select("official")}>ChatGPT / Codex 官方账号</button>
      </div>
    </div>
    {mode === "official" && <fieldset className="fast-official-login" disabled={disabled || busy || locked}><NativeAuthControl/><p>使用 Codex 已登录的账号。尚未登录时，请在 Codex 中选择使用 ChatGPT 登录。</p></fieldset>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

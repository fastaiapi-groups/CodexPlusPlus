import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import "./api-guide.css";

const guideUrl = "https://tumeiapi.com/hub/home/help/image-api/";
type Bounds = {x: number; y: number; width: number; height: number};

let guideCommands = Promise.resolve();
function updateGuide(args: {bounds?: Bounds | null; close?: boolean; refresh?: boolean}) {
  const next = guideCommands.then(() => invoke<void>("fastaiapi_guide", args));
  guideCommands = next.catch(() => {});
  return next;
}

function visibleBounds(viewport: HTMLElement): Bounds | null {
  if (document.hidden || document.querySelector("dialog[open], [role=dialog][aria-modal=true]")) return null;
  const view = viewport.getBoundingClientRect();
  const screen = viewport.closest(".screen")?.getBoundingClientRect();
  const x = Math.ceil(Math.max(0, view.left, screen?.left ?? 0));
  const y = Math.ceil(Math.max(0, view.top, screen?.top ?? 0));
  const width = Math.floor(Math.min(window.innerWidth, view.right, screen?.right ?? window.innerWidth)) - x;
  const height = Math.floor(Math.min(window.innerHeight, view.bottom, screen?.bottom ?? window.innerHeight)) - y;
  return width > 0 && height > 0 ? {x, y, width, height} : null;
}

export function ApiGuide({ onOpenExternal }: { onOpenExternal: (url: string) => Promise<void> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const refreshGuide = useRef<() => void>(() => {});
  const [error, setError] = useState("");

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    let previous = "";
    let disposed = false;
    const sync = (refresh = false) => {
      const bounds = visibleBounds(element);
      const signature = JSON.stringify(bounds);
      if (!refresh && previous === signature) return;
      previous = signature;
      void updateGuide({bounds, refresh}).then(() => {
        if (!disposed) setError("");
      }).catch(error => {
        if (!disposed) setError(String(error));
      });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const dialogs = new MutationObserver(schedule);
    dialogs.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal"]});
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    refreshGuide.current = () => sync(true);
    sync();
    return () => {
      disposed = true;
      refreshGuide.current = () => {};
      resize.disconnect();
      dialogs.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      window.cancelAnimationFrame(frame);
      void updateGuide({close: true}).catch(() => {});
    };
  }, []);

  return (
    <section className="fast-api-guide" aria-label="TuMeiAPI 使用教程">
      <header className="fast-api-guide-toolbar">
        <h2><BookOpen size={17} aria-hidden="true"/>TuMeiAPI 图片 API</h2>
        <div className="fast-api-guide-actions">
          <button type="button" onClick={() => refreshGuide.current()}><RefreshCw size={14} aria-hidden="true"/>刷新</button>
          <button type="button" onClick={() => void onOpenExternal(guideUrl)}><ExternalLink size={14} aria-hidden="true"/>浏览器打开</button>
        </div>
      </header>
      {error && <p className="fast-api-guide-error" role="alert">无法打开内嵌教程。{error}</p>}
      <div className="fast-api-guide-viewport" ref={viewport}/>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LoaderCircle, Plus, RefreshCw, Video, X } from "lucide-react";
import { AppSelect } from "../AppSelect";
import { mediaRouteUrls } from "./mediaRoutes";
import { useActiveServiceRoute } from "./ServiceRoutes";
import { MediaTestHistory, MediaTestTabs } from "./MediaTestHistory";
import { saveMediaTest } from "./mediaTestStore";
import "./video-test.css";

type Task = {workspace: string; request_id: string; createdAt?: number; model?: string};
type VideoMode = {id: "first-frame" | "reference" | null; seconds: number[]; default_seconds: number; max_images: number};
type Result = {
  model: string;
  state: string;
  job_id: string | null;
  progress: number | null;
  files: string[];
  message?: string;
};

const taskLabels: Record<string, string> = {
  downloaded: "视频已保存",
  failed: "平台任务失败",
  submission_unknown: "提交结果待核实",
  submitting: "等待确认提交结果",
};

function lastTask(key: string): Task | null {
  try {
    const value: Partial<Task> | null = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value.workspace === "string" && typeof value.request_id === "string"
      ? {workspace: value.workspace, request_id: value.request_id, createdAt: value.createdAt ?? Date.now(), model: value.model}
      : null;
  } catch {
    return null;
  }
}

export function VideoTestDialog({models, value, onClose, onBusy}: {
  models: string[]; value: string; onClose: () => void; onBusy: (busy: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const {route} = useActiveServiceRoute();
  const storageKey = `fastaiapi.video-test.${route.origin}`;
  const historyScope = `video:${route.origin}`;
  const [task, setTask] = useState(() => lastTask(storageKey));
  const [workspace, setWorkspace] = useState(task?.workspace ?? "");
  const [images, setImages] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, VideoMode[]> | null>(null);
  const [selectedModel, setModel] = useState("");
  const [selectedMode, setMode] = useState("");
  const [selectedSeconds, setSeconds] = useState("");
  const [prompt, setPrompt] = useState("A small red ball slowly rolls across a wooden table. Fixed camera.");
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState<"submit" | "query" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<"generate" | "history">("generate");
  const [historyError, setHistoryError] = useState(false);
  const available = models.filter(model => capabilities?.[model]?.length);
  const model = [selectedModel, "minimax-h3-x", value, ...available].find(model => available.includes(model)) ?? "";
  const modes = capabilities?.[model] ?? [];
  const mode = modes.find(mode => mode.id === selectedMode) ?? modes[0];
  const seconds = selectedSeconds || String(mode?.default_seconds ?? "");
  const maxImages = mode?.max_images ?? 0;
  const terminal = result?.state === "downloaded" || result?.state === "failed";
  const file = result?.state === "downloaded" ? result.files[0] : undefined;
  const canSubmit = Boolean(workspace && mode?.seconds.includes(Number(seconds)) && prompt.trim() && images.length <= maxImages);

  useEffect(() => {
    const opener = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void invoke<Record<string, VideoMode[]>>("fastaiapi_video_test", {action: "capabilities", body: {}})
      .then(value => {if (!disposed) setCapabilities(value);})
      .catch(error => {if (!disposed) setError(String(error));});
    return () => {disposed = true;};
  }, []);

  useEffect(() => {
    if (!task || !result?.job_id || terminal || busy || error || tab !== "generate") return;
    const timer = window.setTimeout(() => void query(task), 8000);
    return () => window.clearTimeout(timer);
  }, [task, result, terminal, busy, error, tab]);

  async function run(action: "submit_video" | "download_video", task: Task, fields = {}) {
    setBusy(action === "submit_video" ? "submit" : "query");
    onBusy(true);
    setError("");
    try {
      const next = await invoke<Result>("fastaiapi_video_test", {
        action, body: {workspace: task.workspace, request_id: task.request_id, ...fields},
      });
      setResult(next);
      await record(task, next.model, taskLabels[next.state] ?? "平台正在处理视频");
    } catch (error) {
      setError(String(error));
      if (action === "submit_video") await record(task, task.model ?? "", String(error));
    } finally {
      setBusy(null);
      onBusy(false);
    }
  }

  function record(task: Task, model: string, status: string) {
    return saveMediaTest(historyScope, {
      id: task.request_id, workspace: task.workspace, createdAt: task.createdAt ?? Date.now(), model, status,
    }).then(() => setHistoryError(false), () => setHistoryError(true));
  }

  const query = (task: Task) => run("download_video", task);
  const remember = (next: Task) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError("无法保存本次测试编号。请检查应用存储后再提交。");
      return false;
    }
    setTask(next);
    return true;
  };

  const submit = async () => {
    const next = {workspace, request_id: crypto.randomUUID(), createdAt: Date.now(), model};
    if (remember(next)) {
      await run("submit_video", next, {model, prompt, seconds: Number(seconds), images, mode: mode?.id});
    }
  };

  const resume = async () => {
    const request_id = resumeId.trim().toLowerCase();
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(request_id)) {
      setError("请输入有效的测试编号（UUID）。");
      return;
    }
    const next = {workspace, request_id, createdAt: Date.now()};
    if (remember(next)) await query(next);
  };

  const pick = async (directory: boolean) => {
    try {
      const selected = await open(directory ? {directory: true, defaultPath: workspace || undefined} : {
        defaultPath: workspace,
        filters: [{name: "参考图片", extensions: ["png", "jpg", "jpeg", "webp"]}],
      });
      if (typeof selected !== "string") return;
      if (directory) {setWorkspace(selected); setImages([]);}
      else setImages(previous => previous.includes(selected) || previous.length >= maxImages ? previous : [...previous, selected]);
      setError("");
    } catch (error) {
      setError(String(error));
    }
  };

  const startOver = () => {
    localStorage.removeItem(storageKey);
    setTask(null);
    setResult(null);
    setError("");
  };

  return createPortal(<dialog ref={dialog} className="fast-setup-dialog fast-media-test-dialog fast-video-test"
    aria-labelledby="fast-video-test-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}
    onClick={event => {if (event.target === event.currentTarget && !busy) onClose();}}>
    <header>
      <div><small>当前媒体连接 · 真实调用</small><h2 id="fast-video-test-title">视频生成测试</h2></div>
      <button type="button" aria-label="关闭视频测试" disabled={!!busy} onClick={onClose}><X size={20}/></button>
    </header>
    <MediaTestTabs id="fast-video-test" tab={tab} onChange={setTab} disabled={!!busy}/>
    {tab === "history" && <MediaTestHistory id="fast-video-test" scope={historyScope} onCleared={startOver}
      onResume={entry => {
        if (!entry.workspace) return;
        const next = {workspace: entry.workspace, request_id: entry.id, createdAt: entry.createdAt, model: entry.model};
        if (!remember(next)) return;
        setWorkspace(entry.workspace);
        setResult(null);
        setTab("generate");
        void query(next);
      }}/>}
    <form hidden={tab !== "generate"} role="tabpanel" id="fast-video-test-generate-panel" aria-labelledby="fast-video-test-generate-tab"
      onSubmit={event => {event.preventDefault(); if (!busy && !task && canSubmit) void submit();}}>
      {!task && <>
        <div className="fast-video-test-options">
          <div className="fast-media-test-field">
            <label htmlFor="fast-video-test-model">测试模型</label>
            <AppSelect id="fast-video-test-model" ariaLabel="测试模型" className="fast-styled-select"
              value={model} options={available.map(model => ({value: model, label: model}))}
              placeholder={capabilities ? "暂无已适配的测试模型" : "正在读取模型定义…"} disabled={!available.length}
              onChange={next => {setModel(next); setMode(""); setSeconds(""); setImages(previous => previous.slice(0, capabilities?.[next]?.[0]?.max_images ?? 0));}}/>
          </div>
          <div className="fast-media-test-field">
            <label htmlFor="fast-video-test-duration">时长（秒）</label>
            <AppSelect id="fast-video-test-duration" ariaLabel="时长（秒）" className="fast-styled-select"
              value={seconds} options={(mode?.seconds ?? []).map(value => ({value: String(value), label: `${value} 秒`}))}
              disabled={!mode} onChange={setSeconds}/>
          </div>
        </div>
        {modes.length > 1 && <div className="fast-media-test-field">
          <label htmlFor="fast-video-test-mode">生成模式</label>
          <AppSelect id="fast-video-test-mode" ariaLabel="生成模式" className="fast-styled-select" value={mode?.id ?? ""}
            options={modes.map(item => ({value: item.id!, label: item.id === "reference" ? "参考素材" : "文生 / 首帧"}))}
            onChange={next => {setMode(next); setSeconds(""); setImages(previous => previous.slice(0, modes.find(item => item.id === next)?.max_images ?? 0));}}/>
        </div>}
        <div className="fast-video-test-path">
          <button type="button" onClick={() => void pick(true)}><FolderOpen size={16}/>选择项目目录</button>
          <span title={workspace}>{workspace || "视频将保存到项目的 outputs 目录"}</span>
        </div>
        {maxImages > 0 && <div className="fast-video-test-references">
          <div className="fast-video-test-path">
            <span>参考图（选填） · {images.length}/{maxImages}</span>
            <button type="button" aria-label="添加一张参考图" disabled={!workspace || images.length >= maxImages}
              onClick={() => void pick(false)}><Plus size={16}/></button>
          </div>
          {images.length > 0 && <ol>{images.map(image => {
            const name = image.split(/[\\/]/).at(-1) ?? image;
            return <li key={image} className="fast-video-test-path">
              <span title={image}>{name}</span>
              <button type="button" aria-label={`移除参考图 ${name}`} onClick={() => setImages(previous => previous.filter(item => item !== image))}><X size={14}/></button>
            </li>;
          })}</ol>}
        </div>}
        <label>测试提示词<textarea required rows={3} maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)}/></label>
        <p className="fast-media-test-endpoint"><code>POST {mediaRouteUrls(route.origin).submitVideo}</code></p>
        <p className="fast-media-test-note">提交后按当前平台计费。页面会查询原任务并保存视频。</p>
        <details className="fast-video-test-resume">
          <summary>恢复已有任务</summary>
          <label>测试编号
            <input type="text" value={resumeId} onChange={event => setResumeId(event.target.value)} placeholder="原任务的 UUID"
              onKeyDown={event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (workspace && resumeId.trim()) void resume();
              }}/>
          </label>
          <button type="button" disabled={!workspace || !resumeId.trim()} onClick={() => void resume()}>查询并恢复</button>
        </details>
      </>}
      {task && <div className="fast-media-test-result" role="status">
        <strong><Video size={16}/>{busy === "submit" ? "正在提交视频任务" : busy === "query" ? "正在查询原任务" : taskLabels[result?.state ?? ""] ?? (result ? "平台正在处理视频" : "上次视频测试")}</strong>
        {result?.model && <small>{result.model}{result.progress != null ? ` · 进度 ${result.progress}%` : ""}</small>}
        {result?.job_id && <small>平台任务 ID · {result.job_id}</small>}
        <small>测试编号 · {task.request_id}</small>
        {result?.message && <p>{result.message}</p>}
        {file && <><video src={convertFileSrc(file)} controls preload="metadata" aria-label="视频测试结果"
          onError={() => setError("视频已保存，本地预览暂不可用。请通过下方路径打开。")}/><small>{file}</small></>}
      </div>}
      {error && <div className="fast-media-test-error" role="alert"><strong>视频测试需要检查</strong><p>{error}</p></div>}
      {historyError && <p role="alert">本次结果未能写入本地历史。</p>}
      <footer>
        {task ? <>
          {(!terminal || result?.state === "downloaded") && <button type="button" disabled={!!busy} onClick={() => void query(task)}>
            {busy ? <LoaderCircle size={16}/> : <RefreshCw size={16}/>}查询原任务
          </button>}
          {(terminal || error) && <button type="button" disabled={!!busy} onClick={startOver}>返回测试设置</button>}
        </> : <button type="submit" className="fast-media-test-submit" disabled={!canSubmit}><Video size={16}/>开始视频测试</button>}
      </footer>
    </form>
  </dialog>, document.body);
}

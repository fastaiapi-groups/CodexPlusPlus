import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Image, LoaderCircle, RefreshCw, Video, X } from "lucide-react";
import { AppSelect } from "../AppSelect";
import { mediaRouteUrls } from "./mediaRoutes";
import { useActiveServiceRoute } from "./ServiceRoutes";
import "./video-test.css";

type Task = {workspace: string; request_id: string};
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
      ? {workspace: value.workspace, request_id: value.request_id}
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
  const [task, setTask] = useState(() => lastTask(storageKey));
  const [workspace, setWorkspace] = useState(task?.workspace ?? "");
  const [image, setImage] = useState("");
  const [model, setModel] = useState(
    models.includes("minimax-h3-x") ? "minimax-h3-x" : models.includes(value) ? value : models[0] ?? "",
  );
  const [seconds, setSeconds] = useState(model === "grok-imagine-video-1.5" ? "6" : "3");
  const [prompt, setPrompt] = useState("Keep the reference composition. Add subtle motion and a slow camera push.");
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState<"submit" | "query" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const requiresImage = model.startsWith("minimax-h3");
  const grok = model === "grok-imagine-video-1.5";
  const terminal = result?.state === "downloaded" || result?.state === "failed";
  const file = result?.state === "downloaded" ? result.files[0] : undefined;
  const canSubmit = Boolean(workspace && model && prompt.trim() && (!requiresImage || image));

  useEffect(() => {
    const opener = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (!task || !result?.job_id || terminal || busy || error) return;
    const timer = window.setTimeout(() => void query(task), 8000);
    return () => window.clearTimeout(timer);
  }, [task, result, terminal, busy, error]);

  async function run(action: "submit_video" | "download_video", body: object) {
    setBusy(action === "submit_video" ? "submit" : "query");
    onBusy(true);
    setError("");
    try {
      setResult(await invoke<Result>("fastaiapi_video_test", {action, body}));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
      onBusy(false);
    }
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
    const next = {workspace, request_id: crypto.randomUUID()};
    if (remember(next)) {
      await run("submit_video", {...next, model, prompt, seconds: Number(seconds), images: image ? [image] : []});
    }
  };

  const resume = async () => {
    const request_id = resumeId.trim().toLowerCase();
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(request_id)) {
      setError("请输入有效的测试编号（UUID）。");
      return;
    }
    const next = {workspace, request_id};
    if (remember(next)) await query(next);
  };

  const pick = async (directory: boolean) => {
    try {
      const selected = await open(directory ? {directory: true, defaultPath: workspace || undefined} : {
        defaultPath: workspace,
        filters: [{name: "参考图片", extensions: ["png", "jpg", "jpeg", "webp"]}],
      });
      if (typeof selected !== "string") return;
      if (directory) {setWorkspace(selected); setImage("");}
      else setImage(selected);
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
    <form onSubmit={event => {event.preventDefault(); if (!busy && !task && canSubmit) void submit();}}>
      {!task && <>
        <div className="fast-video-test-options">
          <div className="fast-media-test-field">
            <label htmlFor="fast-video-test-model">测试模型</label>
            <AppSelect id="fast-video-test-model" ariaLabel="测试模型" className="fast-styled-select"
              value={model} options={models.map(model => ({value: model, label: model}))}
              placeholder="暂无可用模型" disabled={!models.length}
              onChange={next => {setModel(next); setSeconds(next === "grok-imagine-video-1.5" ? "6" : "3");}}/>
          </div>
          <label>时长（秒）
            {grok ? <AppSelect ariaLabel="时长（秒）" className="fast-styled-select" value={seconds}
              options={["6", "12", "18", "24", "30"].map(value => ({value, label: `${value} 秒`}))} onChange={setSeconds}/>
              : <input type="number" min={1} max={requiresImage ? 15 : 60} required value={seconds}
                onChange={event => setSeconds(event.target.value)}/>}
          </label>
        </div>
        <div className="fast-video-test-path">
          <button type="button" onClick={() => void pick(true)}><FolderOpen size={16}/>选择项目目录</button>
          <span title={workspace}>{workspace || "视频将保存到项目的 outputs 目录"}</span>
        </div>
        <div className="fast-video-test-path">
          <button type="button" disabled={!workspace} onClick={() => void pick(false)}><Image size={16}/>选择参考图</button>
          <span title={image}>{image || (requiresImage ? "从项目内选择一张图片（必填）" : "从项目内选择一张图片（可选）")}</span>
        </div>
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

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { clearMediaTests, mediaTestPage, type MediaTestEntry } from "./mediaTestStore";
import "./media-test-history.css";

export function MediaTestTabs({tab, onChange, disabled, id}: {
  tab: "generate" | "history"; onChange: (tab: "generate" | "history") => void; disabled: boolean; id: string;
}) {
  const tabs = [["generate", "生成"], ["history", "历史"]] as const;
  return <div className="fast-test-tabs" role="tablist" aria-label="测试页面">
    {tabs.map(([key, label]) => <button type="button" role="tab" key={key} id={`${id}-${key}-tab`}
      aria-selected={tab === key} aria-controls={`${id}-${key}-panel`} disabled={disabled}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "generate" : event.key === "End" ? "history" : key === "generate" ? "history" : "generate";
        onChange(next);
        document.getElementById(`${id}-${next}-tab`)?.focus();
      }}
      tabIndex={tab === key ? 0 : -1} onClick={() => onChange(key)}>{label}</button>)}
  </div>;
}

export function MediaTestHistory({scope, onOpen, onCleared, id, detail, refresh}: {
  scope: string; onOpen?: (entry: MediaTestEntry) => void; onCleared?: () => void; id: string;
  detail?: ReactNode; refresh?: number;
}) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Awaited<ReturnType<typeof mediaTestPage>> | null>(null);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    void mediaTestPage(scope, page).then(next => {
      if (disposed) return;
      if (page >= next.pages) setPage(next.pages - 1);
      else setData(next);
    }).catch(() => {if (!disposed) setError("无法读取本地测试历史。");});
    return () => {disposed = true;};
  }, [scope, page, revision, refresh]);

  const clear = async () => {
    setClearing(true);
    setError("");
    try {
      await clearMediaTests(scope);
      onCleared?.();
      setPage(0);
      setRevision(value => value + 1);
      setData(null);
      setConfirmClear(false);
    } catch {
      setError("无法清空本地测试历史。");
    } finally {
      setClearing(false);
    }
  };

  return <div className="fast-test-history" role="tabpanel" id={`${id}-history-panel`} aria-labelledby={`${id}-history-tab`}>
    {detail}
    <div hidden={!!detail}>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">正在读取测试历史…</p>}
    {data && <>
      <div className="fast-test-history-bar">
        <span>共 {data.total} 条</span>
        {data.total > 0 && <button type="button" onClick={() => setConfirmClear(true)} disabled={clearing || confirmClear}>清空历史</button>}
      </div>
      {confirmClear && <div className="fast-test-history-confirm" role="group" aria-label="确认清空">
        <span>清空当前线路的测试历史？项目中已保存的文件会保留。</span>
        <button type="button" disabled={clearing} onClick={() => setConfirmClear(false)}>取消</button>
        <button type="button" disabled={clearing} onClick={() => void clear()}>确认清空</button>
      </div>}
      {data.total === 0 && <p>暂无测试历史。</p>}
      <ul>{data.entries.map(entry => <li key={entry.id} className={onOpen && entry.workspace ? "fast-test-history-clickable" : undefined}>
        {onOpen && entry.workspace ? <button type="button" className="fast-test-history-row" onClick={() => onOpen(entry)}>
          <span><strong>{entry.model || "视频任务"}</strong><small>{entry.status}</small></span>
          <time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time>
          <ChevronRight size={16} aria-hidden="true"/>
        </button> : <>
        <div className="fast-test-history-bar">
          <strong>{entry.model || "视频任务"}</strong>
          <time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time>
        </div>
        <p>{entry.status}</p>
        {entry.image && <details><summary>查看图片</summary><img loading="lazy" src={entry.image} alt={`${entry.model} 测试结果`}/></details>}
        </>}
      </li>)}</ul>
      {data.pages > 1 && <nav aria-label="历史分页">
        <button type="button" disabled={page === 0 || clearing} onClick={() => setPage(page - 1)}>上一页</button>
        <span aria-live="polite">{page + 1} / {data.pages}</span>
        <button type="button" disabled={page + 1 >= data.pages || clearing} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>}
    </>}
    </div>
  </div>;
}

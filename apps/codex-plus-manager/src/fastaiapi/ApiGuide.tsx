import { useState } from "react";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";

import "./api-guide.css";

const GUIDE_URL = "https://fastaiapi.cloud/help/codex/";

export function ApiGuide({ onOpenExternal }: { onOpenExternal: (url: string) => Promise<void> }) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  return (
    <section className="fast-api-guide" aria-label="FastAiApi 帮助文档">
      <header className="fast-api-guide-toolbar">
        <div className="fast-api-guide-title">
          <BookOpen size={17} aria-hidden="true" />
          <span>FastAiApi 帮助文档</span>
        </div>
        <div className="fast-api-guide-actions">
          {loading && <span className="fast-api-guide-status" role="status">正在加载教程…</span>}
          <button type="button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>
            <RefreshCw size={14} />刷新
          </button>
          <button type="button" onClick={() => void onOpenExternal(GUIDE_URL)}>
            <ExternalLink size={14} />浏览器打开
          </button>
        </div>
      </header>
      <iframe
        key={revision}
        title="Codex 从零上手教程"
        src={GUIDE_URL}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={() => setLoading(false)}
      />
    </section>
  );
}

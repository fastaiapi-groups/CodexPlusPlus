import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

const GUIDE_URL = "https://ui.fastaiapi.cloud/help/codex/";

export function ApiGuide({ onOpenExternal }: { onOpenExternal: (url: string) => Promise<void> }) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  return (
    <div className="fast-api-guide">
      <div className="fast-api-guide-toolbar">
        <span role="status">{loading ? "正在加载教程…" : "内容与官网实时同步"}</span>
        <div>
          <button type="button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>
            <RefreshCw size={14} />刷新
          </button>
          <button type="button" onClick={() => void onOpenExternal(GUIDE_URL)}>
            <ExternalLink size={14} />浏览器打开
          </button>
        </div>
      </div>
      <iframe
        key={revision}
        title="Codex 从零上手教程"
        src={GUIDE_URL}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}

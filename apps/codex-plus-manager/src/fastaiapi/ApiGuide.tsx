import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import "./api-guide.css";

const guideUrl = "https://tumeiapi.com/hub/home/help/image-api/";

export function ApiGuide({ onOpenExternal }: { onOpenExternal: (url: string) => Promise<void> }) {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void onOpenExternal(guideUrl);
  }, [onOpenExternal]);

  return (
    <section className="fast-api-guide" aria-label="TuMeiAPI 使用教程">
      <h2>TuMeiAPI 使用教程</h2>
      <button type="button" onClick={() => void onOpenExternal(guideUrl)}>
        <ExternalLink size={15} aria-hidden="true"/> 在浏览器打开
      </button>
      <code>{guideUrl}</code>
    </section>
  );
}

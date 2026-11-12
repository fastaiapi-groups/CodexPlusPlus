import { BookOpen, ExternalLink } from "lucide-react";
import { useActiveServiceRoute } from "./ServiceRoutes";
import { mediaRouteUrls } from "./mediaRoutes";

import "./api-guide.css";

export function ApiGuide({ onOpenExternal }: { onOpenExternal: (url: string) => Promise<void> }) {
  const {route, platformName} = useActiveServiceRoute();
  const urls = mediaRouteUrls(route.origin);
  const endpoints = [
    ["文字生图", urls.generateImage], ["图片编辑", urls.editImage], ["视频提交", urls.submitVideo],
  ];

  return (
    <section className="fast-api-guide" aria-label={`${platformName} 图片 API 文档`}>
      <header className="fast-api-guide-toolbar">
        <div className="fast-api-guide-title">
          <BookOpen size={17} aria-hidden="true" />
          <span>{platformName} · 图片 API 文档</span>
        </div>
        <div className="fast-api-guide-actions">
          <button type="button" onClick={() => void onOpenExternal(urls.guide)}><ExternalLink size={14} />打开完整文档</button>
        </div>
      </header>
      <div className="fast-api-guide-body">
        <h2>{route.name}的请求地址</h2>
        <p>请求使用当前线路的 API Key。浏览器中的完整文档提供图片参数和调用示例。</p>
        <dl className="fast-api-guide-endpoints">
          {endpoints.map(([name, url]) => <div key={name}><dt>{name}</dt><dd><code>POST {url}</code></dd></div>)}
        </dl>
        {route.origin.startsWith("http://") && <p>当前线路使用未加密的 HTTP。</p>}
      </div>
    </section>
  );
}

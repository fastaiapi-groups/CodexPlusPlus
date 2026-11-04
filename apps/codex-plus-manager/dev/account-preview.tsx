import React from "react";
import {createRoot} from "react-dom/client";
import Account, {FastAiApiGate} from "../src/fastaiapi/Account";
import {RouteSelector} from "../src/fastaiapi/ServiceRoutes";

// 账户、Key、价格、环境修复与生成测试均调用原生联调桥；不在网页存储任何凭据。
(window as any).__TAURI_INTERNALS__ = {invoke: async (command: string, args: any) => {
  if (command === "fastaiapi_account" && args.action === "me" && new URLSearchParams(location.search).has("register")) throw new Error("请先登录当前路线");
  if (command === "fastaiapi_account" && args.action === "remembered_login") return {};
  const response = await fetch("http://127.0.0.1:1440/invoke", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command,args})});
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "原生联调失败");
  return result.data;
}};
window.addEventListener("error", event => {const error=document.createElement("pre");error.setAttribute("role","alert");error.textContent=event.message;document.body.append(error);});
createRoot(document.getElementById("root")!).render(<><div className="preview-label">本地网页联调 · 账户和生成使用真实后台 · 默认模型应用仅预览 · 充值写操作关闭</div><FastAiApiGate><main className="preview-main"><header className="preview-header"><div><h1>账户概览</h1><p>FastAiApi 模型服务</p></div><RouteSelector/></header><Account/></main></FastAiApiGate></>);

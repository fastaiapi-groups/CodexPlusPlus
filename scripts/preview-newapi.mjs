#!/usr/bin/env node
// 网页联调前端。先启动 serve_newapi_preview 示例；本脚本只编译/监听应用组件与静态文件。
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const app=path.join(root,"apps/codex-plus-manager");
const require=createRequire(path.join(app,"package.json"));
const esbuild=require("esbuild");
const output=await fs.mkdtemp(path.join(os.tmpdir(),"codex-newapi-preview-"));
const context=await esbuild.context({entryPoints:{app:path.join(app,"dev/account-preview.tsx")},outdir:output,bundle:true,format:"esm",jsx:"automatic",loader:{".svg":"file",".jpg":"file"}});
await context.rebuild();await context.watch();
await fs.copyFile(path.join(app,"src/fastaiapi/logo.svg"),path.join(output,"logo.svg"));
await fs.cp(path.join(app,"src/fastaiapi/icons"),path.join(output,"icons"),{recursive:true});
await fs.writeFile(path.join(output,"index.html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex++ 账户网页联调</title><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#10141e;color:#e7eeee;font-family:system-ui}.preview-label{position:fixed;left:12px;bottom:10px;z-index:2;color:#879499;font-size:11px;pointer-events:none}.preview-main{padding:24px;max-width:1180px;margin:auto}.preview-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.preview-header h1{font-size:23px;margin:0}.preview-header p{font-size:13px;color:#9daeb7}.fast-gate{min-height:100vh;height:auto}</style><div id="root"></div><script type="module" src="/app.js"></script></html>`);
http.createServer(async(req,res)=>{try{const url=new URL(req.url,"http://127.0.0.1");let relative=decodeURIComponent(url.pathname);if(relative==="/")relative="/index.html";const file=path.resolve(output,"."+relative);if(!file.startsWith(output+path.sep)){res.writeHead(403).end();return;}const bytes=await fs.readFile(file);res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".html")?"text/html; charset=utf-8":"application/octet-stream");res.setHeader("Cache-Control","no-store");res.end(bytes);}catch{res.writeHead(404).end("Not found");}}).listen(1439,"127.0.0.1",()=>console.log("网页联调：http://127.0.0.1:1439；注册布局：http://127.0.0.1:1439/?register"));

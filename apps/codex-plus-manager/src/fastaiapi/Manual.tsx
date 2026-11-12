import { useState } from "react";
import "./support.css";
import { ContactQr } from "./ContactQr";
import { Code2, Copy, ImagePlay, Check } from "lucide-react";
import { MediaSetupGuide } from "./MediaSetupGuide";
const qqGroup = new URL("./icons/qq-group.jpg", import.meta.url).href;
const wechatGroup = new URL("./icons/wechat-group.jpg", import.meta.url).href;
const guides = [
  {
    title: "如何用 Codex", icon: Code2,
    description: "把目标、素材和验收要求告诉 Codex，它会在你选定的项目中完成工作。",
    steps: ["在概览完成账号与模型配置，启动 Codex。", "在 Codex 中选择项目文件夹，描述想完成的任务；已有文件可直接附上。", "查看执行过程和修改结果，按需要补充要求，再让它测试。遇到权限请求时，核对具体操作后再授权。"],
    examples: [{label: "编程案例", text: "帮我在当前项目做一个待办清单页面，支持新增、完成和删除，手机上也能使用。请先查看项目结构，沿用现有技术栈，完成后运行相关检查，并告诉我如何打开预览。"}],
  },
  {
    title: "用 Codex 生图、生视频", icon: ImagePlay,
    description: "在 Codex 对话中调用内置媒体工具，用自然语言描述画面即可。",
    steps: ["先选择服务线路，在概览确认默认图片或视频模型，然后重新打开 Codex 会话。", "在 Codex 中输入下方案例。可在概览选择图片和视频默认模型，也可在对话中明确指定。生成参考图视频时，可上传图片或使用刚生成的图片。", "视频生成需要等待。让 Codex 查询原任务并下载结果。中断后可继续查询原任务。凭据读取失败时，检查系统授权后点击概览中的「检查连接」。"],
    examples: [
      {label: "生图案例", text: "使用 Codex++ 内置媒体工具，生成一张 1024×1024 的图片：一只青绿色陶瓷小机器人站在浅灰色摄影棚里，柔和光线，正面全身构图，画面中不要文字。只生成 1 张，保存到当前项目的 outputs 文件夹，并展示结果。"},
      {label: "参考图生视频案例", text: "使用 Codex++ 内置媒体工具，以我上传的这张小机器人图片为参考，生成 1 段 5 秒、16:9 的视频：保持机器人的外观和背景一致，固定镜头，小机器人缓慢抬起右手挥手一次，再放下。请先检查参考图并优化提示词，提交后保存任务 ID，持续查询原任务直到完成，下载到当前项目的 outputs 文件夹并展示结果。"},
    ],
  },
];

function PromptExample({label, text}: {label: string; text: string}) {
  const [state, setState] = useState("");
  return <div className="fast-manual-example"><div><strong>{label}</strong><button onClick={async () => {
    try {await navigator.clipboard.writeText(text); setState("copied");} catch {setState("failed");}
  }}>{state === "copied" ? <Check size={14}/> : <Copy size={14}/>} {state === "copied" ? "已复制" : "复制案例"}</button></div><p>{text}</p>{state === "failed" && <small role="status">无法访问剪贴板，请选中上方文字复制。</small>}</div>;
}
const faqs = [
  ["第一次使用怎样开始？", "登录平台账号，在概览确认默认文字模型与分组，再点击启动 Codex。请先安装配套的 Codex 桌面应用。"],
  ["切换默认模型后如何生效？", "在概览确认分组和模型后，系统自动绑定 Key。文字模型在重启 Codex 后生效，媒体默认模型用于后续任务。"],
  ["怎样重新绑定 API Key？", "在对应模型选择器中再次确认分组和模型。系统会验证分组权限，优先复用有效 Key，必要时自动创建专用 Key。"],
  ["收不到验证码怎么办？", "确认邮箱拼写，查看垃圾邮件，稍后重试。不要反复发送验证码；仍未收到时，请通过反馈页面留下邮箱和问题发生时间。"],
  ["如何充值，付款后余额没更新怎么办？", "在概览点击账户充值，按当前 new-api 站点配置选择额度和支付方式，完成扫码或收银台付款后刷新余额；也支持兑换码。以订单实际状态为准；若已付款仍未到账，请提供订单号，不要重复付款。"],
  ["余额和模型价格如何理解？", "概览显示平台返回的 API 额度。不同分组的计价方式和倍率可能不同，请点击分组问号查看说明，并以平台当前价格和使用记录为准。"],
  ["为什么模型列表为空或调用失败？", "检查 Key 是否有效、分组是否支持该模型，以及账户余额和网络。可刷新模型列表。反馈时提供模型名、时间和错误截图，不要发送完整 Key。"],
  ["图片和视频功能需要额外配置吗？", "打开概览会自动接入内置媒体工具，Key 保存在系统凭据库。连接后在 Codex 对话中调用，也可在概览测试文本和图片。默认视频模型可在概览选择，缺少模型权限时请在平台开通。"],
  ["记住账号密码安全吗？", "勾选后使用系统凭据库保存；macOS 可能要求允许钥匙串访问。取消勾选会清除已记住的登录信息。不要把密码或 Key 发到群里。"],
  ["窗口太小或弹窗内容太多怎么办？", "页面和弹窗支持滚动，列表过长时可在弹窗内滚动。分组问号打开详情，关闭详情后会回到原分组选择。"],
];
export function Manual() {
  const [query, setQuery] = useState(""), [copied, setCopied] = useState(false);
  const matches = faqs.filter(item => item.join(" ").toLowerCase().includes(query.toLowerCase()));
  return <section className="fast-support"><div className="fast-support-intro"><span>FASTAIAPI · 使用手册</span><h2>从开始使用，到解决问题</h2><p>操作指南、实用案例与社群支持。</p></div>
    <div className="fast-manual-guides">{guides.map(({title, icon: Icon, description, steps, examples}, index) => <article key={title} aria-label={title}>
      <header><span><Icon size={20}/></span><div><small>入门指南 0{index + 1}</small><h3>{title}</h3></div></header><p>{description}</p>
      <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>{examples.map(example => <PromptExample key={example.label} {...example}/>)}
      {index === 1 && <small>生成会真实调用当前平台并按平台计费。模型需由当前 Key 的分组开放；你在概览手动选择或在对话中明确指定的型号优先。</small>}
    </article>)}</div>
    <details className="fast-manual-permissions"><summary>媒体连接失败？查看凭据授权与配置图文指引</summary><MediaSetupGuide/></details>
    <input className="fast-manual-search" aria-label="搜索常见问题" placeholder="搜索登录、模型、充值…" value={query} onChange={e => setQuery(e.target.value)}/><div className="fast-faqs">{matches.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}{!matches.length && <p>没有找到相关问题，可在反馈页面联系我们。</p>}</div><div className="fast-support-contacts"><h3>加入交流群</h3><article><h4>QQ 群</h4><p>群号：48878665 · 扫码或搜索加入</p><ContactQr src={qqGroup} name="FastAiApi QQ 群" crop={{viewBox: "170 710 940 940", width: 1284, height: 2289}}/><button onClick={async () => {try {await navigator.clipboard.writeText("48878665"); setCopied(true);} catch {setCopied(false);}}}>{copied ? "已复制群号" : "复制群号"}</button></article><article><h4>微信群</h4><p>FastAiApi 中转图片视频交流群</p><ContactQr src={wechatGroup} name="FastAiApi 微信群" crop={{viewBox: "100 500 880 880", width: 1080, height: 1596}}/><small>二维码有效期至 2026 年 10 月 31 日；过期可通过 QQ 群获取新二维码。</small></article></div></section>;
}

import { useState } from "react";
import "./support.css";
import { ContactQr } from "./ContactQr";
const qqGroup = new URL("./icons/qq-group.jpg", import.meta.url).href;
const wechatGroup = new URL("./icons/wechat-group.jpg", import.meta.url).href;
const faqs = [
  ["第一次使用怎样开始？", "登录 FastAiApi 账号，等待自动配置完成，在概览中选择默认模型，再点击启动 Codex。请先安装配套的 Codex 桌面应用。"],
  ["切换模型或 API Key 后如何生效？", "在概览的高级配置中选择 Key，再通过切换模型弹窗确认默认模型，最后重启 Codex。不同分组可用的模型不同。"],
  ["重试自动配置是做什么的？", "登录后的自动配置失败时使用。系统重新读取账户 Key，优先复用 Codex++ FastAiApi 专用 Key；没有时创建 gpt-pro 专用 Key，再写入模型连接配置。"],
  ["收不到验证码怎么办？", "确认邮箱拼写，查看垃圾邮件，稍后重试。不要反复发送验证码；仍未收到时，请通过反馈页面留下邮箱和问题发生时间。"],
  ["如何充值，付款后余额没更新怎么办？", "在概览点击账户充值，选择金额及支付宝或微信，扫码完成支付后刷新余额。以订单实际状态为准；若已付款仍未到账，请提供订单号，不要重复付款。"],
  ["余额和模型价格如何理解？", "概览显示平台返回的 API 额度。不同分组的计价方式和倍率可能不同，请点击分组问号查看说明，并以平台当前价格和使用记录为准。"],
  ["为什么模型列表为空或调用失败？", "检查 Key 是否有效、分组是否支持该模型，以及账户余额和网络。可刷新模型列表。反馈时提供模型名、时间和错误截图，不要发送完整 Key。"],
  ["图片和视频功能需要额外配置吗？", "本应用已内置创作技能。图片、Grok、MiniMax H3 使用各自的分组密钥；对话 Key 不一定可用于媒体生成。按技能提示分别配置对应服务。"],
  ["记住账号密码安全吗？", "勾选后使用系统凭据库保存；macOS 可能要求允许钥匙串访问。取消勾选会清除已记住的登录信息。不要把密码或 Key 发到群里。"],
  ["窗口太小或弹窗内容太多怎么办？", "页面和弹窗支持滚动，列表过长时可在弹窗内滚动。分组问号打开详情，关闭详情后会回到原分组选择。"],
];
export function Manual() {
  const [query, setQuery] = useState(""), [copied, setCopied] = useState(false);
  const matches = faqs.filter(item => item.join(" ").toLowerCase().includes(query.toLowerCase()));
  return <section className="fast-support"><div className="fast-support-intro"><span>FASTAIAPI · 使用手册</span><h2>从开始使用，到解决问题</h2><p>常见问题与社群支持。</p></div><input className="fast-manual-search" aria-label="搜索常见问题" placeholder="搜索登录、模型、充值…" value={query} onChange={e => setQuery(e.target.value)}/><div className="fast-faqs">{matches.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}{!matches.length && <p>没有找到相关问题，可在反馈页面联系我们。</p>}</div><div className="fast-support-contacts"><h3>加入交流群</h3><article><h4>QQ 群</h4><p>群号：48878665 · 扫码或搜索加入</p><ContactQr src={qqGroup} name="FastAiApi QQ 群" crop={{viewBox: "170 710 940 940", width: 1284, height: 2289}}/><button onClick={async () => {try {await navigator.clipboard.writeText("48878665"); setCopied(true);} catch {setCopied(false);}}}>{copied ? "已复制群号" : "复制群号"}</button></article><article><h4>微信群</h4><p>FastAiApi 中转图片视频交流群</p><ContactQr src={wechatGroup} name="FastAiApi 微信群" crop={{viewBox: "100 500 880 880", width: 1080, height: 1596}}/><small>二维码有效期至 2026 年 10 月 31 日；过期可通过 QQ 群获取新二维码。</small></article></div></section>;
}

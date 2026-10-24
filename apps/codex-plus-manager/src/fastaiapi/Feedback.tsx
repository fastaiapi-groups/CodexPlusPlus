import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, CircleHelp, CreditCard, ImagePlus, Images, Lightbulb, MessageCircle, Send, UserRound, Waypoints, X } from "lucide-react";
import "./support.css";

type Screenshot = {name: string; data: string};
const feedbackCategories = [
  { label: "使用问题", icon: CircleHelp },
  { label: "登录与账号", icon: UserRound },
  { label: "模型与 API", icon: Waypoints },
  { label: "充值与余额", icon: CreditCard },
  { label: "图片与视频", icon: Images },
  { label: "功能建议", icon: Lightbulb },
  { label: "其他", icon: MessageCircle },
];
export function Feedback() {
  const [category, setCategory] = useState("使用问题"), [title, setTitle] = useState(""), [content, setContent] = useState(""), [contact, setContact] = useState("");
  const [images, setImages] = useState<Screenshot[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [receipt, setReceipt] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function addFiles(files: File[]) {
    setError("");
    if (files.length + images.length > 3) {setError("最多上传 3 张截图。"); return;}
    try {
      const next = await Promise.all(files.map(file => new Promise<Screenshot>((resolve, reject) => {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {reject(new Error("请上传 PNG、JPG 或 WebP 图片，每张不超过 1 MB。")); return;}
        const reader = new FileReader(); reader.onload = () => resolve({name: file.name, data: String(reader.result)}); reader.onerror = () => reject(new Error("截图读取失败，请重试。")); reader.readAsDataURL(file);
      })));
      setImages(current => [...current, ...next].slice(0, 3));
    } catch(e) {setError(String(e));}
  }
  return <section className="fast-support"><div className="fast-support-intro"><span>FASTAIAPI · 用户反馈</span><h2>告诉我们，哪里可以更好</h2><p>描述遇到的问题或想要的功能，我们会根据你留下的联系方式跟进。</p></div>
    {receipt ? <div className="fast-support-success" role="status"><h3>反馈已提交</h3><p>反馈编号：{receipt}</p><p>你的反馈已保存到后台。</p><button onClick={() => {setReceipt(""); setTitle(""); setContent(""); setImages([]); setRequestId(crypto.randomUUID());}}>继续反馈</button></div> : <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError("");
      try {const result = await invoke<{id: string}>("fastaiapi_account", {action:"feedback", body:{request_id:requestId, category, title:title.trim(), content:content.trim(), contact:contact.trim(), screenshots:images}}); setReceipt(result.id);}
      catch(e) {setError(String(e));} finally {setBusy(false);}
    }}><fieldset disabled={busy}>
      <div className="fast-feedback-category" role="group" aria-labelledby="fast-feedback-category-label">
        <span id="fast-feedback-category-label">问题类型</span>
        <div className="fast-feedback-category-grid">
          {feedbackCategories.map(({ label, icon: Icon }) => <label className="fast-feedback-category-option" key={label}>
            <input type="radio" name="feedback-category" value={label} checked={category === label} onChange={() => setCategory(label)}/>
            <span className="fast-feedback-category-card"><Icon size={18} aria-hidden="true"/><span>{label}</span><Check className="fast-feedback-category-check" size={15} aria-hidden="true"/></span>
          </label>)}
        </div>
      </div>
      <label>标题<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="用一句话描述问题"/></label>
      <label>内容<textarea required maxLength={5000} rows={6} value={content} onChange={e => setContent(e.target.value)} placeholder="请描述操作步骤、预期结果和实际情况…"/></label>
      <label>联系方式<input required maxLength={200} value={contact} onChange={e => setContact(e.target.value)} placeholder="邮箱、QQ 或微信，方便我们联系你"/></label>
      <div className="fast-feedback-images"><label className="fast-upload"><ImagePlus size={20}/>添加截图（选填）<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => {void addFiles(Array.from(e.target.files ?? [])); e.target.value="";}}/></label><small>最多 3 张，每张不超过 1 MB。请遮挡密码、API Key 和无关个人信息。</small><div className="fast-image-previews">{images.map((image, i) => <figure key={`${image.name}-${i}`}><img src={image.data} alt={`截图 ${i+1}`}/><figcaption>{image.name}</figcaption><button type="button" aria-label={`移除截图 ${i+1}`} onClick={() => setImages(images.filter((_, n) => n !== i))}><X size={15}/></button></figure>)}</div></div>
      {error && <p className="fast-support-error" role="alert">{error}</p>}<div className="fast-support-submit"><small>提交后，内容、截图和联系方式将保存到 FastAiApi 后台，并通知客服。</small><button type="submit" disabled={busy || !title.trim() || !content.trim() || !contact.trim()}><Send size={15}/>{busy ? "正在提交…" : "提交反馈"}</button></div>
    </fieldset></form>}
  </section>;
}

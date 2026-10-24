import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, CircleHelp, CreditCard, ImagePlus, Images, Lightbulb, Mail, MessageCircle, Plus, Send, UserRound, Waypoints, X } from "lucide-react";
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
const contactMethods = [
  { label: "邮箱", placeholder: "请输入你的邮箱地址", logo: "" },
  { label: "QQ", placeholder: "请输入你的 QQ 号", logo: new URL("./icons/qq.svg", import.meta.url).href },
  { label: "微信", placeholder: "请输入你的微信号", logo: new URL("./icons/wechat.svg", import.meta.url).href },
];
export function Feedback() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [contactMethod, setContactMethod] = useState("邮箱");
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
      try {const result = await invoke<{id: string}>("fastaiapi_account", {action:"feedback", body:{request_id:requestId, category, title:title.trim(), content:content.trim(), contact:`${contactMethod}：${contact.trim()}`, screenshots:images}}); setReceipt(result.id);}
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
      <div className="fast-feedback-contact" role="group" aria-labelledby="fast-feedback-contact-label">
        <span id="fast-feedback-contact-label">联系方式</span>
        <div className="fast-feedback-contact-methods">
          {contactMethods.map(method => <label className="fast-feedback-category-option" key={method.label}>
            <input type="radio" name="feedback-contact-method" value={method.label} checked={contactMethod === method.label} onChange={() => setContactMethod(method.label)}/>
            <span className="fast-feedback-category-card"><span className={`fast-contact-method-logo fast-contact-method-logo-${method.label === "QQ" ? "qq" : method.label === "微信" ? "wechat" : "mail"}`}>{method.logo ? <img src={method.logo} alt=""/> : <Mail size={20} aria-hidden="true"/>}</span><span>{method.label}</span><Check className="fast-feedback-category-check" size={15} aria-hidden="true"/></span>
          </label>)}
        </div>
        <input required maxLength={200} aria-label={`${contactMethod}联系方式`} value={contact} onChange={e => setContact(e.target.value)} placeholder={contactMethods.find(method => method.label === contactMethod)?.placeholder}/>
      </div>
      <div className="fast-feedback-images" role="group" aria-labelledby="fast-feedback-images-label">
        <div className="fast-feedback-images-heading"><span id="fast-feedback-images-label">添加截图 <small>（选填）</small></span><small aria-live="polite">{images.length} / 3</small></div>
        <input ref={fileInput} className="fast-feedback-file-input" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="选择截图" onChange={e => {void addFiles(Array.from(e.target.files ?? [])); e.target.value="";}}/>
        <div className="fast-feedback-tiles">
          {images.map((image, i) => <figure className="fast-feedback-image-tile" key={`${image.name}-${i}`}>
            <img src={image.data} alt={`截图 ${i+1}：${image.name}`}/>
            <figcaption title={image.name}>{image.name}</figcaption>
            <button className="fast-feedback-image-remove" type="button" aria-label={`移除截图 ${i+1}`} onClick={() => setImages(current => current.filter((_, n) => n !== i))}><X size={14} aria-hidden="true"/></button>
          </figure>)}
          {images.length < 3 && <button className="fast-feedback-add-tile" type="button" aria-label={images.length ? "继续添加截图" : "添加截图"} aria-describedby="fast-feedback-images-hint" onClick={() => fileInput.current?.click()}>
            {images.length ? <ImagePlus size={26} strokeWidth={1.5} aria-hidden="true"/> : <Plus size={28} strokeWidth={1.5} aria-hidden="true"/>}
            <span>{images.length ? "继续添加" : "添加截图"}</span>
          </button>}
        </div>
        <small id="fast-feedback-images-hint">最多 3 张，每张不超过 1 MB，支持 PNG、JPG、WebP。请遮挡密码、API Key 和无关个人信息。</small>
      </div>
      {error && <p className="fast-support-error" role="alert">{error}</p>}<div className="fast-support-submit"><small>提交后，内容、截图和联系方式将保存到 FastAiApi 后台，并通知客服。</small><button type="submit" disabled={busy || !title.trim() || !content.trim() || !contact.trim()}><Send size={15}/>{busy ? "正在提交…" : "提交反馈"}</button></div>
    </fieldset></form>}
  </section>;
}

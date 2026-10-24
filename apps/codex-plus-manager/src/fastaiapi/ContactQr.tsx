import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 缩略图保持社群卡片紧凑，弹窗保留二维码原图。 */
export function ContactQr({src, name}: {src: string; name: string}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {if (open) dialog.current?.showModal();}, [open]);
  return <><button className="fast-contact-preview" onClick={() => setOpen(true)} aria-label={`放大${name}二维码`}><img className="fast-contact-qr" src={src} alt={`${name}二维码`}/><small>点击放大二维码</small></button>{open && createPortal(<dialog ref={dialog} className="fast-contact-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}><header><strong>{name}</strong><button onClick={() => setOpen(false)} aria-label="关闭二维码">关闭</button></header><img src={src} alt={`${name}二维码原图`}/></dialog>, document.body)}</>;
}

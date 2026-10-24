import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScanLine } from "lucide-react";

/** 缩略图保持社群卡片紧凑，弹窗保留二维码原图。 */
export function ContactQr({src, name, crop}: {src: string; name: string; crop: {viewBox: string; width: number; height: number}}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {if (open) dialog.current?.showModal();}, [open]);
  return <><button type="button" className="fast-contact-preview" onClick={() => setOpen(true)} aria-label={`放大${name}二维码`}><span className="fast-contact-qr-frame"><svg viewBox={crop.viewBox} role="img" aria-label={`${name}二维码`}><image href={src} width={crop.width} height={crop.height}/></svg></span><span className="fast-contact-zoom-hint"><ScanLine size={14} aria-hidden="true"/>点击查看完整二维码</span></button>{open && createPortal(<dialog ref={dialog} className="fast-contact-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}><header><strong>{name}</strong><button onClick={() => setOpen(false)} aria-label="关闭二维码">关闭</button></header><img src={src} alt={`${name}二维码原图`}/></dialog>, document.body)}</>;
}

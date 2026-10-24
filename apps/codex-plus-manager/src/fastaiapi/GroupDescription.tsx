import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function GroupDescription({name, description}: {name: string; description?: string | null}) {
  const [open, setOpen] = useState(false);
  const text = description?.trim();
  if (!text) return null;
  return <><button type="button" className="fast-group-help" title="查看完整分组说明" aria-label={`查看 ${name} 分组详情`} onClick={event => {event.preventDefault(); event.stopPropagation(); setOpen(true);}}>?</button>
    {open && <GroupDetails name={name} text={text} onClose={() => setOpen(false)}/>}</>;
}
function GroupDetails({name, text, onClose}: {name: string; text: string; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {const opener = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => {dialog.current?.close(); opener?.focus();};}, []);
  return createPortal(<dialog ref={dialog} className="fast-payment-dialog fast-group-details" aria-labelledby="fast-group-details-title" onCancel={event => {event.preventDefault(); event.stopPropagation(); onClose();}} onClick={event => {event.stopPropagation(); if(event.target === event.currentTarget) onClose();}}>
    <div className="fast-dialog-content"><header className="fast-dialog-head"><div><span className="fast-dialog-eyebrow">分组详情</span><h2 id="fast-group-details-title">{name}</h2></div><button className="fast-dialog-close" aria-label="关闭分组详情" onClick={onClose}><X size={20}/></button></header><p className="fast-group-details-text">{text}</p></div>
  </dialog>, document.body);
}

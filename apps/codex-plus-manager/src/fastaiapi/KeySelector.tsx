import { Check } from "lucide-react";
import "./key-selector.css";

export function KeySelector({keys, value, busy, onChange}: {
  keys: {id: number; name: string; status: string}[];
  value: number;
  busy: boolean;
  onChange: (id: number) => void;
}) {
  const active = keys.filter(key => key.status === "active");
  return <fieldset className="fast-key-selector" disabled={busy}>
    <legend>对话 API Key</legend>
    <div className="fast-key-choices">
      {active.map(key => <label key={key.id} className={value === key.id ? "is-selected" : ""}>
        <input type="radio" name="fast-account-key" value={key.id} checked={value === key.id} onChange={() => onChange(key.id)}/>
        <span>{key.name}</span>{value === key.id && <Check size={15} aria-hidden="true"/>}
      </label>)}
      {!active.length && <p>暂无可用 Key，请先创建专用 API Key。</p>}
    </div>
  </fieldset>;
}

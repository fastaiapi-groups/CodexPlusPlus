export function GroupDescription({description}: {description?: string | null}) {
  const text = description?.trim();
  if (!text) return null;
  const chars = Array.from(text);
  return <small className="fast-group-description">
    <span>{chars.length > 12 ? `${chars.slice(0, 12).join("")}…` : text}</span>
    <span className="fast-group-help" tabIndex={0} title={text} aria-label={`分组说明：${text}`}>?</span>
  </small>;
}

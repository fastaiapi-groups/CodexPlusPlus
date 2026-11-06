const logos = {
  alipay: new URL("./icons/alipay.svg", import.meta.url).href,
  wxpay: new URL("./icons/wechat.svg", import.meta.url).href,
};

export function PaymentChannelIcon({channel}: {channel: string}) {
  const name = channel.toLowerCase();
  const type = name === "alipay" ? "alipay" : ["wxpay", "wechat", "wechat_pay"].includes(name) ? "wxpay" : null;
  if (!type) return null;
  return <span className={`fast-channel-icon ${type}`} aria-hidden="true"><img src={logos[type]} alt=""/></span>;
}

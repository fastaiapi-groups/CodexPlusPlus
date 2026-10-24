export function paymentState(order?: {status: string; gateway_status: string; reversed_at?: string}, checkoutState?: string) {
  if (!order) return "select";
  // 退款优先于历史 paid 字段，不能继续展示已到账或付款码。
  if (order.reversed_at) return "reversed";
  if (order.status === "paid") return "paid";
  if (checkoutState === "expired" || order.gateway_status === "expired" || order.status === "expired") return "expired";
  return "pending";
}

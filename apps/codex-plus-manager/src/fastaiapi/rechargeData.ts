export type NewApiRechargeInfo = {
  enable_online_topup?: boolean;
  enable_duocai_topup?: boolean;
  enable_redemption?: boolean;
  min_topup?: number;
  amount_options?: number[];
  pay_methods?: {type: string; name: string}[];
};
export type NewApiOrder = {
  trade_no: string; amount: number; money: number; status: string;
  payment_method: string; payment_provider?: string;
};
type SubApiMethod = {currency?: string; display_name?: string; available: boolean; single_min: number; single_max: number; fee_rate: number};
type SubApiPlan = {id: number; name: string; price: number; currency?: string; validity_days: number; group_name?: string};
export type SubApiRechargeInfo = {
  methods: Record<string, SubApiMethod>; plans: SubApiPlan[];
  balance_disabled: boolean; global_min: number; global_max: number; help_text?: string;
};
export type SubApiOrder = {id: number; out_trade_no: string; amount: number; pay_amount: number; currency?: string; status: string; order_type: string};

export type FastAiRechargePackage = {id: string; name: string; amount_cents: number; credit: string};
export type FastAiRechargeOrder = {id: string; status: string; amount_cents: number; credit: string; gateway_status: string; payment_type: string; reversed_at?: string};
type FastAiRechargeChannel = {payment_type: string; available: boolean};
export const fastAiPaymentChannels = ["alipay", "wxpay"] as const;

export function createFastAiRechargeData(
  loadPackages: () => Promise<FastAiRechargePackage[]>,
  loadChannels: () => Promise<FastAiRechargeChannel[]>,
  loadOrders: () => Promise<FastAiRechargeOrder[] | null>,
) {
  return createRechargeData(async () => {
    const [packages, channels] = await Promise.all([loadPackages(), loadChannels()]);
    return {
      packages,
      channels: fastAiPaymentChannels.filter(channel => channels.some(item => item.payment_type === channel && item.available)),
    };
  }, async () => await loadOrders() ?? []);
}

export type FastAiRechargeData = ReturnType<typeof createFastAiRechargeData>;

export function initialTopupAmount(info: NewApiRechargeInfo) {
  const minimum = info.min_topup ?? 1;
  return info.amount_options?.find(amount => Number.isInteger(amount) && amount >= minimum) ?? info.min_topup ?? 10;
}

export function newApiPaymentMethods(info: NewApiRechargeInfo) {
  return info.pay_methods?.filter(method => ["alipay", "wxpay"].includes(method.type)) ?? [];
}

export function canResumeDuocaiOrder(order: NewApiOrder) {
  return order.status === "pending" && order.payment_provider === "epay" && order.trade_no.startsWith("DC");
}

export function paymentQrImage(code: string) {
  return /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(code) ? code : "";
}

export function rechargeCurrency(currency?: string) {
  return currency?.toUpperCase() === "CNY" ? "RMB" : currency || "";
}

function cachedRequest<T>(fetch: () => Promise<T>) {
  let value: T | undefined;
  let pending: Promise<T> | undefined;
  return {
    current: () => value,
    load(refresh = false): Promise<T> {
      if (pending) return pending;
      if (!refresh && value !== undefined) return Promise.resolve(value);
      pending = Promise.resolve().then(fetch).then(next => {
        value = next;
        return next;
      }).finally(() => {pending = undefined;});
      return pending;
    },
  };
}

export function createRechargeData<Info, Order>(loadInfo: () => Promise<Info>, loadOrders: () => Promise<Order[]>) {
  const info = cachedRequest(loadInfo);
  const orders = cachedRequest(loadOrders);
  return {info, orders};
}

export function createNewApiRechargeData(
  loadInfo: () => Promise<NewApiRechargeInfo>, loadOrders: () => Promise<NewApiOrder[]>,
  loadQuote: (amount: number) => Promise<string>,
) {
  const data = createRechargeData(loadInfo, loadOrders);
  const initialQuote = cachedRequest(async () => {
    const info = await data.info.load();
    if ((!info.enable_online_topup && !info.enable_duocai_topup) || !newApiPaymentMethods(info).length) return null;
    const amount = initialTopupAmount(info);
    return {amount, value: String(await loadQuote(amount))};
  });
  return {...data, initialQuote};
}

export type NewApiRechargeData = ReturnType<typeof createNewApiRechargeData>;
export type SubApiRechargeData = ReturnType<typeof createRechargeData<SubApiRechargeInfo, SubApiOrder>>;

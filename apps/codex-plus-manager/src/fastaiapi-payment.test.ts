import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentState } from "./fastaiapi/paymentState.ts";
import { canResumeDuocaiOrder, createFastAiRechargeData, createNewApiRechargeData, paymentQrImage, rechargeCurrency, type NewApiOrder } from "./fastaiapi/rechargeData.ts";

test("FastAiAPI preloads website packages and only enables available payment channels", async () => {
  const calls: string[] = [];
  const packages = [{id: "1", name: "1 刀额度", amount_cents: 100, credit: "1"}];
  const data = createFastAiRechargeData(
    async () => { calls.push("packages"); return packages; },
    async () => {
      calls.push("channels");
      return [{payment_type: "alipay", available: false}, {payment_type: "wxpay", available: true}];
    },
    async () => { calls.push("orders"); return null; },
  );
  const preload = data.info.load();
  assert.equal(data.info.load(), preload);
  assert.deepEqual(await preload, {packages, channels: ["wxpay"]});
  assert.deepEqual(await data.info.load(), data.info.current());
  assert.deepEqual(await data.orders.load(), []);
  assert.deepEqual(calls, ["packages", "channels", "orders"]);
});

test("login preload and opening recharge share one configuration, order list, and initial quote", async () => {
  const calls: string[] = [];
  const data = createNewApiRechargeData(
    async () => {calls.push("info"); return {enable_duocai_topup: true, min_topup: 5, amount_options: [1, 10], pay_methods: [{type: "alipay", name: "支付宝"}]};},
    async () => {calls.push("orders"); return [];},
    async amount => {calls.push(`quote:${amount}`); return "10.00";},
  );
  await Promise.all([data.info.load(), data.orders.load(), data.initialQuote.load(), data.info.load(), data.initialQuote.load()]);
  assert.deepEqual(calls, ["info", "orders", "quote:10"]);
  assert.deepEqual(data.initialQuote.current(), {amount: 10, value: "10.00"});
  await data.orders.load(true);
  assert.deepEqual(calls, ["info", "orders", "quote:10", "orders"]);
});

test("a failed recharge preload can be retried on opening", async () => {
  let attempts = 0;
  const data = createNewApiRechargeData(
    async () => {
      if (++attempts === 1) throw new Error("offline");
      return {};
    }, async () => [], async () => {throw new Error("disabled payments must not request a quote");},
  );
  await assert.rejects(data.info.load(), /offline/);
  await data.info.load();
  assert.equal(await data.initialQuote.load(), null);
  assert.equal(attempts, 2);
});

test("only pending DuoCai orders can be resumed and gateway GIF codes are accepted", () => {
  const order: NewApiOrder = {trade_no: "DC1NOexample", status: "pending", payment_provider: "epay", payment_method: "alipay", amount: 10, money: 10};
  assert.ok(canResumeDuocaiOrder(order));
  assert.ok(!canResumeDuocaiOrder({...order, trade_no: "USR1NOexample"}));
  assert.ok(!canResumeDuocaiOrder({...order, status: "success"}));
  assert.equal(paymentQrImage("data:image/gif;base64,R0lGODlh"), "data:image/gif;base64,R0lGODlh");
  assert.equal(paymentQrImage("data:image/svg+xml;base64,PHN2Zz4="), "");
});

test("recharge currency labels use RMB for Chinese yuan and preserve other currencies", () => {
  assert.equal(rechargeCurrency("CNY"), "RMB");
  assert.equal(rechargeCurrency("USD"), "USD");
  assert.equal(rechargeCurrency(), "");
});

test("refunded paid orders never show successful payment or a QR", () => {
  assert.equal(paymentState({status: "paid", gateway_status: "success", reversed_at: "2026-10-24"}), "reversed");
});
test("expiration from either backend field stops payment polling", () => {
  assert.equal(paymentState({status: "pending", gateway_status: "expired"}), "expired");
  assert.equal(paymentState({status: "expired", gateway_status: "pending"}), "expired");
  assert.equal(paymentState({status: "pending", gateway_status: "pending"}, "expired"), "expired");
});
test("only an actual paid order displays success", () => {
  assert.equal(paymentState(), "select");
  assert.equal(paymentState({status: "pending", gateway_status: "pending"}), "pending");
  assert.equal(paymentState({status: "paid", gateway_status: "success"}), "paid");
});

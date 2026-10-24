import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentState } from "./fastaiapi/paymentState.ts";

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

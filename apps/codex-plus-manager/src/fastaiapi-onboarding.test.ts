import { test } from "node:test";
import assert from "node:assert/strict";
import { configureAccount } from "./fastaiapi/onboarding.ts";

const key = {id: 411, name: "Codex++ FastAiApi", status: "active"};
function fixture() {
  const calls: unknown[] = [];
  return {calls, client: {
    groups: async () => [{id: 7, name: "gpt-pro"}],
    createKey: async (group: number) => { calls.push(["create", group]); return key; },
    models: async () => ["gpt-6-sol", "gpt-5.6-sol"],
    current: async (): Promise<{key_id?: number; model?: string}> => ({}),
    apply: async (id: number, model: string) => { calls.push(["apply", id, model]); },
  }};
}
test("new account creates one gpt-pro key and configures preferred model", async () => {
  const {calls, client} = fixture();
  await configureAccount([], client);
  assert.deepEqual(calls, [["create", 7], ["apply", 411, "gpt-5.6-sol"]]);
});
test("login reuses key and preserves selected model", async () => {
  const {calls, client} = fixture();
  client.current = async () => ({key_id: 411, model: "gpt-6-sol"});
  await configureAccount([key], client);
  assert.deepEqual(calls, [["apply", 411, "gpt-6-sol"]]);
});
test("missing group and empty model catalog never apply invalid config", async () => {
  const {calls, client} = fixture();
  client.groups = async () => [];
  await assert.rejects(configureAccount([], client), /gpt-pro/);
  client.models = async () => [];
  await assert.rejects(configureAccount([key], client), /没有可用/);
  assert.deepEqual(calls, []);
});

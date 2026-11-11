import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionMode, connectionTarget, OFFICIAL_PROFILE_ID } from "./fastaiapi/connection-mode.ts";

const fastai = {
  id: "fastaiapi-newapi-17", relayMode: "pureApi", officialMixApiKey: false,
  model: "my-model", contextWindow: "1000000", configContents: "saved config", authContents: "saved auth",
};
const official = {
  ...fastai, id: OFFICIAL_PROFILE_ID, relayMode: "official", model: "official-model",
  configContents: "official config", authContents: "official auth",
};
const create = () => ({...official, model: "", configContents: "", authContents: ""});

test("official mode is distinct from mixed API and unrelated providers", () => {
  assert.equal(connectionMode(official), "official");
  assert.equal(connectionMode(fastai), "fastai");
  assert.equal(connectionMode({...official, officialMixApiKey: true}), null);
  assert.equal(connectionMode({...fastai, id: "third-party"}), null);
  assert.equal(connectionMode(undefined), null);
});

test("round-trip reuses both saved profiles without changing models or credentials", () => {
  const profiles = structuredClone([fastai, official]);
  const before = structuredClone(profiles);
  assert.strictEqual(connectionTarget(profiles, fastai.id, "official", "newapi", undefined, create), profiles[1]);
  assert.strictEqual(connectionTarget(profiles, official.id, "fastai", "newapi", fastai.id, create), profiles[0]);
  assert.deepEqual(profiles, before);
});

test("first official switch creates one independent profile and keeps the FastAiApi profile", () => {
  const profiles = [fastai];
  let created = 0;
  const target = connectionTarget(profiles, fastai.id, "official", "newapi", undefined, () => { created++; return create(); });
  assert.equal(created, 1);
  assert.equal(target.id, OFFICIAL_PROFILE_ID);
  assert.deepEqual(profiles, [fastai]);
  assert.strictEqual(connectionTarget([...profiles, target], fastai.id, "official", "newapi", undefined, () => { throw new Error("duplicate"); }), target);
});

test("an already active official account is kept instead of choosing a different saved account", () => {
  const current = {...official, id: "user-official"};
  assert.strictEqual(connectionTarget([fastai, official, current], current.id, "official", "newapi", undefined, create), current);
});

test("returning to FastAiApi follows the saved platform selection, not array order", () => {
  const otherKey = {...fastai, id: "fastaiapi-newapi-18"};
  const subapi = {...fastai, id: "fastaiapi-subapi-17"};
  assert.strictEqual(connectionTarget([fastai, otherKey, subapi], official.id, "fastai", "newapi", otherKey.id, create), otherKey);
  assert.throws(() => connectionTarget([fastai, subapi], official.id, "fastai", "newapi", subapi.id, create), /当前平台没有/);
  assert.throws(() => connectionTarget([fastai], official.id, "fastai", "newapi", undefined, create), /当前平台没有/);
  assert.throws(() => connectionTarget([fastai], official.id, "fastai", "newapi", "deleted", create), /当前平台没有/);
});

test("a reserved official profile changed into mixed API is never silently overwritten", () => {
  const mixed = {...official, officialMixApiKey: true};
  assert.throws(() => connectionTarget([fastai, mixed], fastai.id, "official", "newapi", undefined, create), /配置已改变/);
  assert.equal(mixed.officialMixApiKey, true);
});

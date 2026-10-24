import { test } from "node:test";
import assert from "node:assert/strict";
import { showAccountRoute, showAccountTool } from "./fastaiapi/navigation.ts";

test("reference navigation shows only Codex and hides extra entries", () => {
  assert.deepEqual(["codex", "claude", "grok"].filter(id => showAccountTool({id})), ["codex"]);
  for (const route of ["relay", "relayEnvironment", "requestLog", "multiLaunch", "computerUse", "recommendations", "agentCollaboration"]) assert.equal(showAccountRoute(route), false);
  for (const route of ["overview", "context", "skills", "sessions", "weixin", "enhance", "dreamSkin", "userScripts", "pluginMarket", "maintenance", "agentCache", "about", "settings"]) assert.equal(showAccountRoute(route), true);
});

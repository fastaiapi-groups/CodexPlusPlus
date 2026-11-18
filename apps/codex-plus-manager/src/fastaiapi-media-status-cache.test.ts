import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mediaStatusCache } from './fastaiapi/mediaStatusCache.ts';

test('media status cache keeps the last result per platform and route until cleared', () => {
  mediaStatusCache.clear();
  assert.equal(mediaStatusCache.get('subapi:0'), undefined);
  mediaStatusCache.set('subapi:0', {status: {image_model: 'a'}, registered: true});
  mediaStatusCache.set('newapi:1', {status: {image_model: 'b'}, registered: false});
  assert.deepEqual(mediaStatusCache.get('subapi:0'), {status: {image_model: 'a'}, registered: true});
  assert.deepEqual(mediaStatusCache.get('newapi:1'), {status: {image_model: 'b'}, registered: false});
  assert.equal(mediaStatusCache.get('subapi:1'), undefined);
  mediaStatusCache.clear();
  assert.equal(mediaStatusCache.get('subapi:0'), undefined);
});

test('overview cards show a placeholder until the media status has loaded', () => {
  const source = readFileSync(new URL('./fastaiapi/MediaModels.tsx', import.meta.url), 'utf8');
  assert.match(source, /status \? defaults\[kind\] : connecting \? "加载中…" : "暂不可用"/);
  assert.match(source, /useState\(!cached\)/);
});

test('account changes drop cached media status', () => {
  const source = readFileSync(new URL('./fastaiapi/Account.tsx', import.meta.url), 'utf8');
  // 登录、退出登录、会话过期三处都要清缓存。
  assert.equal(source.match(/mediaStatusCache\.clear\(\)/g)?.length, 3);
});

test('identifier inputs opt out of macOS autocorrect', () => {
  const off = 'spellCheck={false} autoCapitalize="off" autoCorrect="off"';
  for (const [file, label] of [
    ['./fastaiapi/ModelDialog.tsx', 'aria-label="搜索模型"'],
    ['./fastaiapi/Recharge.tsx', 'value={redeem}'],
    ['./fastaiapi/SubApiRecharge.tsx', 'value={redeem}'],
    ['./fastaiapi/NewApiRecharge.tsx', 'value={redeem}'],
  ] as const) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const input = source.split('<input ').find(part => part.includes(label) && part.indexOf(label) < part.indexOf('>'));
    assert.ok(input?.startsWith(off), `${file} ${label}`);
  }
});

test('text test uses the default text key instead of the media key', () => {
  const models = readFileSync(new URL('./fastaiapi/MediaModels.tsx', import.meta.url), 'utf8');
  assert.match(models, /disabled=\{working \|\| !textKeyId \|\| !textModels\.length\} onClick=\{\(\) => setTest\("text"\)\}/);
  assert.match(models, /keyId=\{test === "text" \? textKeyId : undefined\}/);
  const dialog = readFileSync(new URL('./fastaiapi/MediaTestDialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /body: \{kind, model, prompt, key_id: keyId\}/);
  const commands = readFileSync(new URL('../src-tauri/src/fastaiapi_commands.rs', import.meta.url), 'utf8');
  assert.match(commands, /action == "media_test"[\s\S]{0,200}options\["kind"\] == "text"[\s\S]{0,400}test_with_key/);
});

test('account page no longer lists SubAPI subscriptions', () => {
  const source = readFileSync(new URL('./fastaiapi/Account.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SubApiSubscriptions/);
});

test('ensure reconnects media to the current route after a platform or route switch', () => {
  const source = readFileSync(new URL('../src-tauri/src/fastaiapi_media_commands.rs', import.meta.url), 'utf8');
  const ensure = source.slice(source.indexOf('if action == "ensure"'), source.indexOf('} else {', source.indexOf('if action == "ensure"') + 600));
  assert.match(ensure, /restore_group_route[\s\S]*has_saved_route\(platform, origin\)[\s\S]*"media_setup"/);
});

test('an expired session returns the account page to the login form', () => {
  const core = readFileSync(new URL('../../../crates/codex-plus-core/src/fastaiapi.rs', import.meta.url), 'utf8');
  assert.match(core, /as_u16\(\) == 401\s+&& model_key\.is_none\(\)[\s\S]{0,200}登录已过期，请重新登录/);
  const routes = readFileSync(new URL('./fastaiapi/ServiceRoutes.tsx', import.meta.url), 'utf8');
  assert.match(routes, /登录已过期[\s\S]{0,80}dispatchEvent\(new Event\(SESSION_EXPIRED_EVENT\)\)/);
  const account = readFileSync(new URL('./fastaiapi/Account.tsx', import.meta.url), 'utf8');
  assert.match(account, /addEventListener\(SESSION_EXPIRED_EVENT, expired\)/);
  assert.match(account, /const expired = [\s\S]{0,120}setUser\(null\); setAuthenticated\(false\)/);
});

test('account page says when Codex text chat is on another connection', () => {
  const commands = readFileSync(new URL('../src-tauri/src/fastaiapi_commands.rs', import.meta.url), 'utf8');
  assert.match(commands, /"active": p\.id == settings\.active_relay_id/);
  const account = readFileSync(new URL('./fastaiapi/Account.tsx', import.meta.url), 'utf8');
  assert.match(account, /!officialMode && configuration\.active === false/);
});

test('auto key routing syncs each group key into the gateway and keeps Codex on it', () => {
  const gateway = readFileSync(new URL('../src-tauri/src/fastaiapi_gateway_commands.rs', import.meta.url), 'utf8');
  assert.match(gateway, /"ensure_group_key"[\s\S]*key_and_models[\s\S]*create_provider/);
  assert.match(gateway, /format!\("fastaiapi:\{\}:", platform\.id\(\)\)/);
  assert.match(gateway, /enable_binding\(&ctx, &ToolId::Codex, binding\)/);
  const commands = readFileSync(new URL('../src-tauri/src/fastaiapi_commands.rs', import.meta.url), 'utf8');
  assert.match(commands, /kind == "text" && super::fastaiapi_gateway_commands::enabled\(platform\)[\s\S]{0,200}set_default_model/);
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /fastaiapi_gateway_commands::fastaiapi_auto_key/);
  const account = readFileSync(new URL('./fastaiapi/Account.tsx', import.meta.url), 'utf8');
  assert.match(account, /invoke<[\s\S]{0,200}>\("fastaiapi_auto_key", \{action, model\}\)/);
  // 默认开启的开关：没关过就自动同步，但 Codex 用官方账号或其他供应商时不接管。
  assert.match(gateway, /map_or\(true, \|value\| value\.trim\(\) != "off"\)/);
  assert.match(account, /role="switch" aria-checked=\{autoKey\.wanted\}/);
  assert.match(account, /status\.wanted && \(status\.enabled \|\| value\.active\)\) void autoKeyAction\("enable", true, value\.model\)/);
  // 模型类型以平台目录为准，auto 分组排最前。
  assert.match(gateway, /"auto" if platform == Platform::NewApi => 0/);
  assert.match(gateway, /row\["kind"\]\.as_str\(\)/);
  // 每个分组用它自己的 Key：auto Key 调不了 auto 没覆盖的分组。
  assert.match(gateway, /"exact":true/);
  const core = readFileSync(new URL('../../../crates/codex-plus-core/src/fastaiapi.rs', import.meta.url), 'utf8');
  assert.match(core, /"group": if exact \{ group \} else \{ "auto" \}/);
});

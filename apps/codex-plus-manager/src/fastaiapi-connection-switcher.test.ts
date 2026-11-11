import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./fastaiapi/ConnectionSwitcher.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Element = { type: string; props: Record<string, any> };
function elements(node: any): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness() {
  const hooks: any[] = [];
  let cursor = 0;
  let locked = false;
  const locks: boolean[] = [];
  const commands: unknown[] = [];
  const switches: unknown[] = [];
  let apply = async () => true;
  let read = async () => ({profile_id: "fastaiapi-subapi-29"});
  const react = {
    useRef(value: unknown) { const index = cursor++; return hooks[index] ??= {current: value}; },
    useState(value: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = value; return [hooks[index], (next: unknown) => { hooks[index] = next; }]; },
  };
  const jsx = (type: string, props: any) => ({type, props});
  const exports: any = {};
  vm.runInNewContext(source, {exports, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return {jsx, jsxs: jsx};
    if (id === "../NativeAuthControls") return {NativeAuthControl: () => null};
    if (id === "./ServiceRoutes") return {
      usePlatformInvoke: () => async (...args: unknown[]) => { commands.push(args); return read(); },
      useServiceRoutes: () => ({routes: {platform: "subapi"}, locked, setLocked: (next: boolean) => { locked = next; locks.push(next); }}),
    };
    if (id.endsWith(".css")) return {};
    throw new Error(id);
  }});
  const render = () => {
    cursor = 0;
    return elements(exports.ConnectionSwitcher({mode: "official", disabled: false, onSwitch: async (...args: unknown[]) => { switches.push(args); return apply(); }}));
  };
  const click = () => render().find(node => node.type === "button" && node.props.children === "FastAiApi")!.props.onClick();
  return {render, click, locks, commands, switches, setApply: (next: typeof apply) => { apply = next; }, setRead: (next: typeof read) => { read = next; }};
}

test("rapid clicks make one switch with the saved profile for the current platform", async () => {
  const h = harness();
  let release!: (value: boolean) => void;
  h.setApply(() => new Promise(resolve => { release = resolve; }));
  h.click(); h.click();
  await flush();
  assert.equal(h.commands.length, 1);
  assert.deepEqual(h.switches, [["fastai", "subapi", "fastaiapi-subapi-29"]]);
  assert.deepEqual(h.locks, [true]);
  release(true);
  await flush();
  assert.deepEqual(h.locks, [true, false]);
  assert.ok(h.render().some(node => node.props.role === "status" && /重启 Codex/.test(node.props.children)));
});

test("a failed configuration read unlocks the UI and allows a successful retry", async () => {
  const h = harness();
  h.setRead(async () => { throw new Error("读取连接失败"); });
  h.click(); await flush();
  assert.equal(h.switches.length, 0);
  assert.ok(h.render().some(node => node.props.role === "alert" && /读取连接失败/.test(node.props.children)));
  assert.deepEqual(h.locks, [true, false]);
  h.setRead(async () => ({profile_id: "fastaiapi-subapi-29"}));
  h.click(); await flush();
  assert.equal(h.switches.length, 1);
});

test("cancelled or rejected profile switches never show a success notice", async () => {
  const h = harness();
  h.setApply(async () => false);
  h.click(); await flush();
  assert.ok(!h.render().some(node => node.props.role === "status"));
  assert.deepEqual(h.locks, [true, false]);
});

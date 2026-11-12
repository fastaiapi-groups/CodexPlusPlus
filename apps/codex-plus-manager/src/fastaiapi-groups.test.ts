import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountFixture } from '../dev/account-fixture.ts';
import { catalogModels, createModelDirectory, loadModelDirectory } from './fastaiapi/modelDirectory.ts';
import { createGroupCache } from './fastaiapi/groupCache.ts';
import { initialGroup, keyGroup, selectableGroupModels, supportsModel, type ModelGroupKey } from './fastaiapi/modelGroups.ts';
test('group cache coalesces requests and retains results for the login session', async () => {
  let calls = 0;
  const cached = createGroupCache(async () => { calls++; return [{id:'default',name:'default'}]; });
  await Promise.all([cached(), cached()]); await cached();
  assert.equal(calls, 1);
});
test('failed group loads can be retried', async () => {
  let calls = 0;
  const cached = createGroupCache(async () => { if (++calls === 1) throw new Error('offline'); return []; });
  await assert.rejects(cached()); assert.deepEqual(await cached(), []); assert.equal(calls, 2);
});

test('saved group takes precedence over the platform default', () => {
  const groups = [{id:'4',name:'Premium',recommended:true}, {id:'8',name:'default'}];
  assert.equal(initialGroup(groups, '4')?.id, '4');
  assert.equal(initialGroup(groups, 'removed')?.id, '8');
  assert.equal(initialGroup([], null), undefined);
});

test('New API uses group names and SubAPI uses stable numeric IDs', () => {
  const key = {id:3,name:'Fixture',status:'active',group:'default',group_id:42};
  assert.equal(keyGroup(key, 'newapi'), 'default');
  assert.equal(keyGroup(key, 'subapi'), '42');
});

test('a mixed group shows only the model type being selected', () => {
  const ids = ['gpt-5.6-sol', 'gpt-image-2', 'minimax-h3', 'veo-3', 'whisper-1'];
  assert.deepEqual(ids.filter(id => supportsModel('newapi', 'text', id)), ['gpt-5.6-sol']);
  assert.deepEqual(ids.filter(id => supportsModel('newapi', 'image', id)), ['gpt-image-2']);
  assert.deepEqual(ids.filter(id => supportsModel('newapi', 'video', id)), ['minimax-h3', 'veo-3']);
  assert.deepEqual(ids.filter(id => supportsModel('subapi', 'video', id)), ['minimax-h3']);
});

test('groups with no selectable models are empty for the chosen type', () => {
  const videoOnly = ['minimax-h3-x', 'veo-3'];
  assert.deepEqual(selectableGroupModels('newapi', 'image', videoOnly), []);
  assert.deepEqual(selectableGroupModels('newapi', 'video', videoOnly), videoOnly);
  assert.deepEqual(selectableGroupModels('subapi', 'video', videoOnly), []);
  assert.deepEqual(selectableGroupModels('newapi', 'image', ['gpt-image-2.5'], ['gpt-image-2.5', 'gpt-5.6-sol']), ['gpt-image-2.5']);
});

test('login preloads one shared model and price directory and refresh keeps data visible', async () => {
  let catalogs = 0, keys = 0, probes = 0;
  const group = {id:'default', name:'default'};
  const price = {model:'gpt-image-2.5', time_pricing:false, unit_price:0.2, tiers:[]};
  const client = {
    catalog: async () => {
      if (++catalogs === 2) throw new Error('offline');
      return {groups:[group], catalogs:{default:{group:group.name,models:[price]}}};
    },
    keys: async () => {keys++; return {items:[]};},
    models: async () => {probes++; return [];},
  };
  const store = createModelDirectory(() => loadModelDirectory('newapi', client));
  await Promise.all([store.load(), store.load(), store.load()]);
  assert.equal(catalogs, 1);
  assert.equal(keys, 1);
  assert.equal(probes, 0);
  const directory = store.snapshot().directory;
  assert.deepEqual(directory?.catalogs.get(group.id)?.models, [price]);
  const refresh = store.load(true);
  assert.equal(store.snapshot().directory, directory);
  await refresh;
  assert.deepEqual(store.snapshot().directory?.catalogs.get(group.id)?.models, [price]);
  assert.match(store.snapshot().directory?.warning ?? '', /offline/);
  const anotherRoute = createModelDirectory(() => loadModelDirectory('newapi', client));
  assert.equal(anotherRoute.snapshot().directory, null);
  await anotherRoute.load();
  assert.equal(catalogs, 3);
});

test('only confirmation provisions a group Key and repeating it reuses the same Key', async () => {
  const {invoke, calls} = createAccountFixture();
  const account = <T,>(action: string, body?: object) => invoke<T>('fastaiapi_account', {action,body});
  await account('login', {email:'fixture@example.test'});
  const store = createModelDirectory(() => loadModelDirectory('newapi', {
    catalog: () => account('group_model_catalogs'), keys: () => account('keys'), models: async () => [],
  }));
  await store.load();
  assert.deepEqual(store.snapshot().directory?.keys.map(key => key.id), [7]);
  for (const kind of ['text', 'image', 'video'] as const) {
    const snapshot = store.snapshot().directory!;
    assert.ok(catalogModels(snapshot.catalogs.get('default')).some(id => supportsModel('newapi', kind, id)));
  }
  assert.equal(calls.filter(call => call.action === 'group_model_catalogs').length, 1);
  assert.equal(calls.filter(call => call.action === 'apply_model_binding').length, 0);
  const body = {kind:'text', model:'gpt-newapi-test', group_id:'text-only', route:1};
  const first = await account<{key:ModelGroupKey}>('apply_model_binding', body);
  store.rememberKey(first.key);
  const second = await account<{key:ModelGroupKey}>('apply_model_binding', body);
  assert.equal(first.key.id, second.key.id);
  assert.deepEqual(store.snapshot().directory?.keys.map(key => key.id), [7, first.key.id]);
  assert.equal(calls.filter(call => call.action === 'group_model_catalogs').length, 1);
  await assert.rejects(account('apply_model_binding', {...body, route:2}), /路线已切换/);
  assert.deepEqual(await account('configuration'), {key_id:first.key.id, model:body.model});
});

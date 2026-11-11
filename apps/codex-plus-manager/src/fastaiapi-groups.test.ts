import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupCache } from './fastaiapi/groupCache.ts';
import { initialGroup, keyGroup, supportsModel } from './fastaiapi/modelGroups.ts';
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

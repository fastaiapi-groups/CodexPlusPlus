import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupCache } from './fastaiapi/groupCache.ts';
test('group cache coalesces requests and retains results for the login session', async () => {
  let calls = 0;
  const cached = createGroupCache(async () => { calls++; return [{id:1,name:'gpt-pro'}]; });
  await Promise.all([cached(), cached()]); await cached();
  assert.equal(calls, 1);
});
test('failed group loads can be retried', async () => {
  let calls = 0;
  const cached = createGroupCache(async () => { if (++calls === 1) throw new Error('offline'); return []; });
  await assert.rejects(cached()); assert.deepEqual(await cached(), []); assert.equal(calls, 2);
});

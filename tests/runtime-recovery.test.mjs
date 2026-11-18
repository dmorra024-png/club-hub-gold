import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverBindings, names} from '../scripts/recover-snoop-runtime.mjs';
const key = 'sb_publishable_synthetic';
const previous = Object.entries({
  SUPABASE_URL: 'https://bnwanxbmprbymbutoths.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: key,
  APP_URL: 'https://snoop-pilot.dmorra024.workers.dev',
  SNOOP_DEEPGRAM_PILOT_ENABLED: 'true',
  SNOOP_DEEPGRAM_PILOT_CLUB_ID: '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
}).map(([name, text]) => ({name, type: 'plain_text', text}));
const live = [
  ...['DEEPGRAM_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SNOOP_DEEPGRAM_PILOT_USER_ID']
    .map(name => ({name, type: 'secret_text'})),
  ...['AI_PERSONAL_DATA_PROCESSING_ENABLED', 'AI_DOCUMENT_PROCESSING_ENABLED']
    .map(name => ({name, type: 'plain_text', text: 'false'})),
  {name: 'SNOOP_AI', type: 'ai'}, {name: 'ASSETS', type: 'assets'},
];
test('restore exactly five original variables and inherit every existing binding without values', () => {
  const input = structuredClone(live);
  const p = recoverBindings(previous, input, key);
  assert.deepEqual(p.bindings.filter(b => b.type !== 'inherit'), previous);
  assert.deepEqual(p.bindings.filter(b => b.type === 'inherit'), live.map(b => ({name: b.name, type: 'inherit'})));
  assert.deepEqual(input, live);
  assert.equal(p.bindings.some(b => b.type === 'secret_text'), false);
});
test('existing variables are inherited, never overwritten', () => {
  const p = recoverBindings(previous, [...live, previous[0]], key);
  assert.equal(p.bindings.filter(b => b.type !== 'inherit').length, 4);
});
test('fail closed on conflicting existing values or types', () => {
  assert.throws(() => recoverBindings(previous, [...live, {...previous[0], text: 'https://other.invalid'}], key));
  assert.throws(() => recoverBindings(previous, [...live, {name: names[0], type: 'secret_text'}], key));
});
test('reject missing originals, wrong project, wrong GitHub public key, and REAL enabled', () => {
  assert.throws(() => recoverBindings(previous.slice(1), live, key));
  assert.throws(() => recoverBindings(previous.map(b => b.name === 'SUPABASE_URL' ? {...b, text: 'https://other.invalid'} : b), live, key));
  assert.throws(() => recoverBindings(previous, live, 'sb_publishable_other'));
  assert.throws(() => recoverBindings(previous, live.map(b => b.name === 'AI_PERSONAL_DATA_PROCESSING_ENABLED' ? {...b, text: 'true'} : b), key));
});

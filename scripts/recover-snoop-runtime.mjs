// Operational repair only. No Worker upload, secret writes or database access.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'APP_URL',
  'SNOOP_DEEPGRAM_PILOT_ENABLED', 'SNOOP_DEEPGRAM_PILOT_CLUB_ID'];
const account = '0cc8106f8820d22996af3aed9e081e93';
const worker = 'snoop-pilot';
const cutoff = Date.parse('2026-11-18T08:33:10Z');

export function recoverBindings(previous, live, publicKey) {
  assert.equal(new Set(live.map(b => b.name)).size, live.length);
  const restored = names.map(name => {
    const b = previous.find(b => b.name === name);
    assert.ok(b?.type === 'plain_text' && typeof b.text === 'string' && b.text.length,
      `ORIGINAL_VALUE_UNAVAILABLE:${name}`);
    return {name, type: 'plain_text', text: b.text};
  });
  const byName = Object.fromEntries(restored.map(b => [b.name, b.text]));
  assert.equal(byName.SUPABASE_URL, 'https://bnwanxbmprbymbutoths.supabase.co');
  assert.equal(byName.APP_URL, 'https://snoop-pilot.dmorra024.workers.dev');
  assert.match(publicKey ?? '', /^sb_publishable_[A-Za-z0-9_-]+$/);
  assert.equal(byName.SUPABASE_PUBLISHABLE_KEY, publicKey);
  assert.equal(byName.SNOOP_DEEPGRAM_PILOT_ENABLED, 'true');
  assert.equal(byName.SNOOP_DEEPGRAM_PILOT_CLUB_ID, '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc');
  for (const b of restored) {
    const existing = live.find(x => x.name === b.name);
    if (existing) assert.ok(existing.type === b.type && existing.text === b.text,
      'EXISTING_BINDING_CONFLICT');
  }
  for (const name of ['DEEPGRAM_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SNOOP_DEEPGRAM_PILOT_USER_ID']) {
    assert.equal(live.find(b => b.name === name)?.type, 'secret_text');
  }
  for (const name of ['AI_PERSONAL_DATA_PROCESSING_ENABLED', 'AI_DOCUMENT_PROCESSING_ENABLED']) {
    assert.equal(live.find(b => b.name === name)?.text, 'false');
  }
  // Every existing binding is inherited by NAME, including secret/resource bindings.
  // No current binding value is ever resubmitted, replaced or removed.
  return {bindings: [...live.map(b => ({name: b.name, type: 'inherit'})),
    ...restored.filter(b => !live.some(x => x.name === b.name))]};
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, 'dmorra024-png/club-hub-gold');
  assert.equal(process.env.GITHUB_REF_NAME, 'ops/snoop-runtime-recovery');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert.ok(token);
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function api(path, {method = 'GET', body, optional = false} = {}) {
    // All routes scoped to the pinned account. Never follow redirects with credentials.
    const r = await fetch(base + path, {method, body,
      headers: {Authorization: `Bearer ${token}`,
        ...(typeof body === 'string' ? {'Content-Type': 'application/json'} : {})}, redirect: 'error',
      signal: AbortSignal.timeout(30000)});
    const j = await r.json().catch(() => ({}));
    console.log(JSON.stringify({operation: path.includes('/builds/') ? 'build-configuration' : 'worker-configuration',
      method, http: r.status, error_codes: (j.errors ?? []).map(e => e.code).filter(n => typeof n === 'number')}));
    if (optional && !r.ok) return null;
    assert.ok(r.ok && j.success === true, 'CLOUDFLARE_OPERATION_FAILED');
    return j.result;
  }
  const root = `/workers/scripts/${worker}`;
  const initial = await api(root + '/settings');
  assert.ok(Array.isArray(initial.bindings));
  console.log(JSON.stringify({required: names.map(name => ({name,
    type: initial.bindings.find(b => b.name === name)?.type ?? 'MISSING'}))}));
  const versions = await api(root + '/versions?per_page=100');
  const items = versions.items ?? versions;
  assert.ok(Array.isArray(items));
  let source;
  const recoverable = new Set();
  for (const v of [...items].sort((a,b) => Date.parse(b.metadata?.created_on) - Date.parse(a.metadata?.created_on))) {
    if (!(Date.parse(v.metadata?.created_on) < cutoff)) continue;
    const detail = await api(root + '/versions/' + encodeURIComponent(v.id));
    const bs = detail.resources?.bindings;
    if (Array.isArray(bs)) for (const b of bs) {
      if (names.includes(b.name) && b.type === 'plain_text' && b.text) recoverable.add(b.name);
    }
    if (Array.isArray(bs) && names.every(n => bs.some(b => b.name === n && b.type === 'plain_text' && b.text))) {
      source = {id: v.id, bindings: bs}; break;
    }
  }
  if (!source) {
    console.log(JSON.stringify({missingOriginalValues: names.filter(n => !recoverable.has(n)),
      coherentOriginalSnapshotFound: false}));
    throw Error('ORIGINAL_CONFIGURATION_NOT_RECOVERABLE');
  }
  const patch = recoverBindings(source.bindings, initial.bindings, process.env.SNOOP_PUBLISHABLE_KEY);
  console.log(JSON.stringify({originalVersion: source.id, originalValuesRecovered: names,
    githubPublishableKeyMatches: true, secretValuesReadOrWritten: false}));

  // Discover ONLY this Worker's immutable tag. Do not inspect other Workers' configs.
  const scripts = await api('/workers/scripts');
  const target = scripts.find(s => s.id === worker);
  assert.ok(target?.tag && /^[a-f0-9]{32}$/.test(target.tag));
  const configPath = `/builds/workers/${target.tag}`;
  const triggersPath = configPath + '/triggers';
  const triggers = await api(triggersPath, {optional: true});
  if (!triggers) {
    console.log('AUTOMATIC_BUILDS_CONTROL_UNAVAILABLE:Workers Builds Configuration Edit');
  } else {
    assert.ok(Array.isArray(triggers));
    console.log(JSON.stringify({automaticBuildTriggers: triggers.length,
      deploymentPreservesBindings: triggers.every(t => /keep-vars/.test(t.deploy_command ?? ''))}));
    for (const t of triggers) {
      assert.equal(t.external_script_id, target.tag);
      assert.match(t.trigger_uuid ?? '', /^[a-f0-9-]{36}$/);
    }
    // Exclude every Git branch from automatic builds, retaining commands, repo
    // linkage, build tokens and all prior filters. No build or deployment started.
    for (const t of triggers) {
      // Builds API uses JSON rather than multipart.
      await api(`/builds/triggers/${t.trigger_uuid}`, {method: 'PATCH',
        body: JSON.stringify({branch_excludes: [...new Set([...(t.branch_excludes ?? []), '*'])]})});
    }
    const remaining = await api(triggersPath);
    assert.ok(Array.isArray(remaining) && remaining.length === triggers.length);
    for (const t of triggers) {
      const updated = remaining.find(x => x.trigger_uuid === t.trigger_uuid);
      assert.ok(updated?.branch_excludes?.includes('*'));
      for (const key of ['deploy_command', 'build_command', 'build_token_uuid', 'branch_includes',
        'root_directory', 'path_includes', 'path_excludes', 'repo_connection']) {
        assert.deepEqual(updated[key], t[key]);
      }
    }
    console.log('SNOOP_AUTOMATIC_BUILDS_DISABLED');
  }

  // Abort on concurrent changes. Do not upload code or replay a deployment.
  const before = await api(root + '/settings');
  assert.deepEqual(before.bindings, initial.bindings, 'CONCURRENT_CONFIGURATION_CHANGE');
  const additions = patch.bindings.filter(b => b.type !== 'inherit');
  if (additions.length) {
    // PATCH settings is official multipart config API. All current bindings inherited.
    const form = new FormData();
    const settings = {...patch};
    if (before.annotations) settings.annotations = before.annotations;
    form.set('settings', JSON.stringify(settings));
    await api(root + '/settings', {method: 'PATCH', body: form});
  }
  const after = await api(root + '/settings');
  for (const original of initial.bindings) {
    assert.deepEqual(after.bindings.find(b => b.name === original.name), original,
      'EXISTING_BINDING_WAS_CHANGED');
  }
  for (const added of additions) assert.deepEqual(after.bindings.find(b => b.name === added.name), added);
  assert.equal(after.bindings.length, initial.bindings.length + additions.length);
  console.log(JSON.stringify({restored: additions.map(b => b.name), allExistingBindingsPreserved: true,
    realModeActivated: false, codeUploaded: false, databaseAccessed: false,
    automaticBuildsVerifiedDisabled: triggers !== null}));
  if (!triggers) process.exitCode = 1; // Configuration restored; release remains BLOCKED.
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('SNOOP_RUNTIME_RECOVERY_STOPPED_NO_CREDENTIAL_VALUES_LOGGED'); process.exitCode = 1; });
}

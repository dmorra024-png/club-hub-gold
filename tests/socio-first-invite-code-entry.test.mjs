import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync('apps/socio/main.js','utf8');
test('first invitation CTA opens registration instead of authenticated card claim',()=>{
 assert.ok(s.includes('first-invite-code'));
 assert.ok(s.includes("case'first-invite-code':state.pendingRegistration=null;state.page='register'"));
 assert.ok(s.includes('Paso 2 de 2'));
 assert.ok(s.includes('Primera activación'));
});
test('new member activation still uses verified six-digit backend and no additional signup email',()=>{
 assert.ok(s.includes("api('/auth/activate'"));
 assert.ok(s.includes('if(!/^[0-9]{6}$/.test(code))'));
 assert.ok(!s.includes("api('/auth/signup'"));
});

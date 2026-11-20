import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync('apps/socio/main.js','utf8');
test('first invitation CTA opens registration instead of authenticated card claim',()=>{
 assert.match(s,/data-action=\\"first-invite-code\\"/);
 assert.match(s,/case'first-invite-code':state.pendingRegistration=null;state.page='register'/);
 assert.match(s,/Paso 2 de 2/);
 assert.match(s,/Primera activación/);
});
test('new member activation still uses verified six-digit backend and no additional signup email',()=>{
 assert.match(s,/api\\('\/auth\/activate'/);
 assert.match(s,/\/\\^\\[0-9\\]\\{6\\}\\$\\/\\.test\\(code\\)/);
 assert.doesNotMatch(s,/api\\('\/auth\/signup'/);
});

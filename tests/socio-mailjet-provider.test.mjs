import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const provider=readFileSync('src/lib/email-provider.server.ts','utf8');
const socio=readFileSync('src/lib/socio-invitation-email.functions.ts','utf8');
test('Mailjet only uses explicit service credentials and v3.1 endpoint',()=>{
 assert.match(provider,/sendMailjetEmail/);
 assert.match(provider,/https:\/\/api\.mailjet\.com\/v3\.1\/send/);
 assert.match(provider,/Authorization: "Basic " \+ credentials/);
 assert.match(provider,/redirect: "manual"/);
 assert.match(provider,/accepted\?\.Status !== "success"/);
});
test('The single six-digit invitation is unchanged for both providers',()=>{
 assert.match(socio,/const code = rawCode/);
 assert.match(socio,/socio_issue_member_claim_from_auth/);
 assert.match(socio,/mailjetSelected \? await sendMailjetEmail/);
 assert.match(socio,/!env\.MAILJET_SECRET_KEY/);
 assert.match(socio,/to: recipient, subject, html, text/);
 assert.match(socio,/sendProviderEmail/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const home=readFileSync('src/routes/_authenticated/index.tsx','utf8');
const styles=readFileSync('src/styles.css','utf8');
const layout=readFileSync('src/components/SnoopLayout.tsx','utf8');
test('cash summary uses real analytics trend icon, not SIM-signal bars',()=>{
 assert.ok(home.includes('snoop-approved-cash-trend'));
 assert.ok(home.includes('m15 43 12-11 9 6 15-19'));
 assert.ok(!home.includes('snoop-approved-cash-bars'));
});
test('assistant circle stays inside navigation optical center and glow is restrained',()=>{
 assert.ok(styles.includes('transform:translateY(10px)'));
 assert.ok(styles.includes('width:clamp(58px,16vw,70px)'));
 assert.ok(styles.includes('snoop-approved-assistant-mark'));
 assert.ok(!layout.includes('<span>JARVIS</span>'));
 assert.ok(layout.includes('snoop:voice-toggle'));
});
test('header and QR navigation unchanged',()=>{
 assert.ok(layout.includes('to="/soci/gestisci"'));
 assert.ok(layout.includes('to="/perfil"'));
});

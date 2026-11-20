import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const layout=readFileSync('src/components/SnoopLayout.tsx','utf8');
const dock=readFileSync('src/components/SnoopDockIcon.tsx','utf8');
const css=readFileSync('src/styles.css','utf8');
test('four functional navigation slots preserved, no JARVIS subtitle',()=>{
 assert.ok(layout.includes('to="/soci/gestisci"'));
 assert.ok(layout.includes('snoop:voice-toggle'));
 assert.ok(layout.includes('to="/perfil"'));
 assert.ok(!layout.includes('<span>JARVIS</span>'));
 assert.match(layout,/SnoopDockIcon kind="jarvis"/);
});
test('QR dock vector has defined metallic finder shapes',()=>{
 assert.ok(dock.includes('kind==="qr"'));
 assert.ok(dock.includes('M6 24V7h18'));
 assert.ok(dock.includes('M40 7h17v17'));
});
test('Home-centred brand and shared management form styles',()=>{
 assert.ok(css.includes('premium-header-brand') && css.includes('left:50%'));
 assert.ok(css.includes('max-width:calc(100vw - 146px)'));
 assert.ok(css.includes('premium-main:not(.snoop-approved-home)'));
 assert.ok(css.includes('snoop-approved-cash-bars'));
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./main.ts',import.meta.url),'utf8');
assert.match(code,/defineAgent/);
assert.match(code,/new voice\.AgentSession/);
assert.match(code,/deepgram\/nova-3/);
assert.match(code,/new inference\.LLM/);
assert.doesNotMatch(code,/supabase|service.role|process\.env\.SUPABASE|recordOrder|INSERT INTO/i);
console.log('Isolated voice agent has no SNOOP database access or actions.');

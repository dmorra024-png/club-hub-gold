import test from'node:test';import assert from'node:assert/strict';import{createSocioRolePolicy}from'./socio-role.mjs';
const id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const policy=data=>createSocioRolePolicy({url:'https://project.supabase.co',publishableKey:'sb_publishable_test',fetcher:async(url,opts)=>{assert.match(url,/user_roles\?select=role/);assert.equal(opts.headers.authorization,'Bearer jwt');return data instanceof Response?data:Response.json(data);}});
test('allow separate confirmed Socio identity with no staff role',async()=>{assert.equal(await policy([])(id,'jwt'),true)});
test('any admin/collaborator/superadmin role denied',async()=>{for(const role of ['admin','collaborator','super_admin'])assert.equal(await policy([{role}])(id,'jwt'),false)});
test('fail closed on RLS/provider error or malformed result',async()=>{assert.equal(await policy(Response.json({error:'denied'},{status:403}))(id,'jwt'),false);assert.equal(await policy({rows:[]})(id,'jwt'),false)});
test('no token cannot query roles',async()=>{assert.equal(await policy([])(id,null),false)});

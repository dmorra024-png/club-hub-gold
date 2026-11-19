import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSupabaseSocioAuth} from "./auth-supabase.mjs";
import {createSocioRolePolicy} from "./socio-role.mjs";
import {createSocioRlsRepository} from "./supabase-rls.mjs";

const origin = "https://snoop-socio-pilot.example.test";
const supabaseUrl = "https://example.supabase.co";
const uid="c319b1ed-9389-4c81-9e7f-42f808d95c34";
test("all outbound Supabase requests use Workers-supported redirect behavior", async () => {
  for (const path of ["auth-supabase.mjs","socio-role.mjs","supabase-rls.mjs"]) {
    assert.ok(!readFileSync(new URL("./"+path, import.meta.url),"utf8").includes("redirect:'error'"),path);
  }
  const calls=[];
  const cloudflareLikeFetch=async(url,init={})=>{
    if(init.redirect==="error")throw new TypeError("Workers does not support redirect error");
    assert.equal(init.redirect,"manual");
    calls.push(url);
    if(url.includes("grant_type=password"))return Response.json({error:"Invalid login credentials"},{status:400});
    if(url.includes("/user_roles?"))return Response.json([]);
    if(url.includes("/socio_member_cards?"))return Response.json([]);
    throw new Error("Unexpected provider route");
  };
  const auth=createSupabaseSocioAuth({
    url:supabaseUrl,publishableKey:"sb_publishable_synthetic",
    signupRedirectUrl:origin+"/",authorizeSocioUser:async()=>true,
    fetcher:cloudflareLikeFetch
  });
  const invalid=await auth.login({input:{email:"fake@example.invalid",password:"notvalidpassword"}});
  assert.equal(invalid.status,401,"Unknown login should NOT give 503 because of an unsupported redirect mode");
  const role=createSocioRolePolicy({url:supabaseUrl,publishableKey:"sb_publishable_synthetic",fetcher:cloudflareLikeFetch});
  assert.equal(await role(uid,"synthetic-jwt"),true);
  const rls=createSocioRlsRepository({url:supabaseUrl,publishableKey:"sb_publishable_synthetic",accessToken:"synthetic-jwt",actorId:uid,fetcher:cloudflareLikeFetch});
  assert.deepEqual(await rls.membershipsForUser(uid),[]);
  assert.equal(calls.length,3);
});
test("Auth signup does not report success on redirect responses",async()=>{
 const auth=createSupabaseSocioAuth({
  url:supabaseUrl,publishableKey:"sb_publishable_synthetic",signupRedirectUrl:origin+"/",
  authorizeSocioUser:async()=>true,
  fetcher:async(url,init)=>{assert.equal(init.redirect,"manual");return new Response("",{status:302,headers:{location:"https://other.example/"}})}
 });
 const r=await auth.signup({input:{email:"fake@example.invalid",password:"pass123456789"}});
 assert.equal(r.status,503);
});

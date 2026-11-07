import { test } from "node:test";
import assert from "node:assert/strict";
test("diagnostic makes exactly one SNOOP GET and prints only HTTP/error codes", async () => {
  const oldFetch=globalThis.fetch,oldLog=console.log;
  const oldAccount=process.env.CLOUDFLARE_ACCOUNT_ID,oldToken=process.env.CLOUDFLARE_API_TOKEN;
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID="a".repeat(32);process.env.CLOUDFLARE_API_TOKEN="synthetic-private-token";
    for(const status of [200,403]){
      let calls=0;const output=[];
      globalThis.fetch=async(url,init)=>{
        calls++;assert.equal(url,"https://api.cloudflare.com/client/v4/accounts/"+"a".repeat(32)+"/workers/scripts/snoop-pilot/settings");
        assert.equal(init.method,"GET");assert.equal(init.redirect,"error");
        return Response.json(status===200?{success:true,result:{bindings:[{name:"SECRET",type:"secret_text",text:"synthetic-private-value"}]}}:{success:false,errors:[{code:10000,message:"synthetic-private-token"}]},{status});
      };
      console.log=value=>output.push(JSON.parse(value));
      await import(new URL("../scripts/diagnose-snoop-access.mjs?single="+status,import.meta.url));
      assert.equal(calls,1);assert.deepEqual(output,[{http:status,error_codes:status===200?[]:[10000]}]);
    }
  } finally {
    globalThis.fetch=oldFetch;console.log=oldLog;
    if(oldAccount===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=oldAccount;
    if(oldToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=oldToken;
  }
});

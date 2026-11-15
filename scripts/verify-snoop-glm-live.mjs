/** Synthetic Cloudflare GLM structured-output probe. No account/member data sent or logged. */
const token = process.env.SNOOP_CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f0-9]{32}$/i.test(account ?? "")) {
  console.error("SNOOP_GLM_CHECK_CONFIG_UNAVAILABLE");
  process.exit(2);
}
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["intent","target","member","product","query","declined","question","asking"],
  properties: {
    intent: {type:"string",enum:["navigate","member","product","category","search","clarify","review","stop"]},
    target: {anyOf:[{type:"string",enum:["home","member_create","members","products","product_create","categories","stock","cash","cash_report","reports","activity"]},{type:"null"}]},
    member: {type:"object",additionalProperties:false,properties:Object.fromEntries(["first_name","last_name","birth_date","city","phone"].map(k=>[k,{type:"string"}]))},
    product: {type:"object",additionalProperties:false,properties:{name:{type:"string"},category:{type:"string"}}},
    query: {anyOf:[{type:"string"},{type:"null"}]},
    declined: {type:"array",items:{type:"string",enum:["phone"]},maxItems:1},
    question: {type:"string"},
    asking: {anyOf:[{type:"string",enum:["first_name","last_name","birth_date","city","phone","other"]},{type:"null"}]},
  },
};
const payload = {
  messages: [
    {role:"system",content:"You are SNOOP, an Italian and Spanish member-registration assistant. Respond only with the JSON schema. A user asks to prepare a fictional member registration. Extract only the given name and surname. All other fields omitted. No saving and no money."},
    {role:"user",content:'Crea un socio ficticio llamado Mario Rossi.'},
  ],
  temperature:0,
  stream:false,
  store:false,
  max_completion_tokens:700,
  chat_template_kwargs:{enable_thinking:false,clear_thinking:true},
  response_format:{type:"json_schema",json_schema:{name:"snoop_conversation",strict:true,schema}},
};
// A read-only Worker settings call tells a bad token from an AI REST permission issue.
let settingsStatus = 0;
try {
  const settings = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/snoop-pilot/settings`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000), redirect: "error",
  });
  settingsStatus = settings.status;
  console.log(settingsStatus === 200 ? "SNOOP_CLOUDFLARE_WORKER_TOKEN_VALID" : "SNOOP_CLOUDFLARE_WORKER_SETTINGS_HTTP_"+settingsStatus);
} catch { console.error("SNOOP_CLOUDFLARE_SETTINGS_CHECK_UNAVAILABLE"); }
let response;
try {
  response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/zai-org/glm-4.7-flash`,{
    method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(35000),redirect:"error",
  });
} catch { console.error("SNOOP_GLM_NETWORK_OR_TIMEOUT");process.exit(3); }
if(!response.ok){
  // Never print response bodies: they can contain account metadata.
  console.error("SNOOP_GLM_HTTP_"+response.status);
  process.exit(4);
}
let data;
try {data=await response.json();}catch{console.error("SNOOP_GLM_INVALID_JSON");process.exit(5)}
const raw=data.result??data;
const choice=raw.choices?.[0];
let value=choice?.message?.content??raw.response;
if(Array.isArray(value)&&value.length===1&&value[0].type==="text")value=value[0].text;
if(typeof value==="string")try{value=JSON.parse(value)}catch{console.error("SNOOP_GLM_NOT_STRUCTURED_JSON");process.exit(6)}
if(!value||typeof value!=="object"||Array.isArray(value)||value.intent!=="member"||value.target!=="member_create"){
 console.error("SNOOP_GLM_UNEXPECTED_PROPOSAL_SHAPE");process.exit(7);
}
const required=schema.required;
if(required.some(k=>!(k in value))||Object.keys(value).some(k=>!required.includes(k))){
 console.error("SNOOP_GLM_UNEXPECTED_KEYS");process.exit(8);
}
console.log("SNOOP_GLM_SYNTHETIC_STRUCTURED_RESPONSE_OK");

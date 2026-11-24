/** Isolated proof using the real application dispatcher; no providers, database or business writes. */
import assert from 'node:assert/strict';
import {applyDeepgramDraft} from '../../src/lib/deepgram-draft-actions.ts';
import {applicationPorts,voiceOwner} from '../../src/lib/voice/application-ports.ts';
const owner=voiceOwner('synthetic-user','synthetic-club');
const access={role:'admin',status:'active',clubId:'synthetic-club',clubName:'Synthetic',clubLogo:null,permissions:['manage_members']} as const;
let fields:Record<string,string>={first_name:'',last_name:'',city:''};let path='/soci/nuovo';
const remove=applicationPorts.register(owner,'member.form',{snapshot:()=>({...fields}),patch:values=>{fields={...fields,...values};}});
const last={};
const options={access:{...access,permissions:[...access.permissions]},owner,path:()=>path,current:()=>true,navigate:(to:string)=>{path=to},last};
const proposal=(member:Record<string,string>)=>({intent:'member',target:'member_create',member,product:{},query:null,declined:[],question:'',asking:null});
const start=performance.now();
try{
 await applyDeepgramDraft(proposal({first_name:'Ana',last_name:'Prueba'}),options);
 assert.equal(fields.first_name,'Ana');
 await applyDeepgramDraft(proposal({city:'Palma'}),options);
 fields.last_name='Manual';
 const correction=await applyDeepgramDraft(proposal({last_name:'Model',city:'Inca'}),options);
 assert.equal(fields.last_name,'Manual');assert.equal(fields.city,'Inca');assert(correction.skipped.includes('last_name'));
 const before={...fields};
 await assert.rejects(()=>applyDeepgramDraft(proposal({city:'Foreign'}),{...options,owner:voiceOwner('other','other-club'),current:()=>false}),/STALE/);
 await assert.rejects(()=>applyDeepgramDraft(proposal({city:'Denied'}),{...options,access:{...options.access,permissions:[]}}),/NOT_AUTHORIZED/);
 assert.deepEqual(fields,before);
 console.log(JSON.stringify({status:'PASS',realApplicationDispatcher:true,syntheticPort:true,liveAI:false,physicalAudio:false,persistenceTested:false,automaticWrites:0,localDispatchMs:performance.now()-start}));
}finally{remove()}

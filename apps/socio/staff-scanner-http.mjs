/**
 * Isolated Staff QR scanner adapter; NOT mounted in the management application.
 * Identity and permissions MUST be provided by a trusted server-side auth resolver.
 * On a live deployment, scanner.service.scan MUST use an atomic nonce store.
 */
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
 'x-content-type-options':'nosniff'
}});
const reject=(code,status=403)=>json({code},status);
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
export function createStaffScannerHttp({origin,authenticateStaff,scanner}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||
    typeof authenticateStaff!=='function'||!scanner||typeof scanner.scan!=='function')
  throw Error('SOCIO_SCANNER_NOT_CONFIGURED');
 return async request=>{
  try{
   const url=new URL(request.url);
   if(url.origin!==origin)return reject('SCANNER_ORIGIN_DENIED');
   if(url.pathname!=='/api/snoop-scan/verify')return reject('SCANNER_NOT_FOUND',404);
   if(request.method!=='POST')return reject('SCANNER_METHOD_DENIED',405);
   if(request.headers.get('origin')!==origin||
      !['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
     return reject('SCANNER_CSRF_DENIED');
   const staff=await authenticateStaff(request);
   if(!staff||staff.accountType!=='staff'||staff.verified!==true||
      !uuid(staff.userId)||!uuid(staff.clubId)||staff.canScan!==true)
     return reject('SCANNER_UNAUTHORIZED');
   const body=await request.text();
   if(body.length>1800)return reject('SCANNER_BODY_TOO_LARGE',400);
   let data;try{data=JSON.parse(body);}catch{return reject('SCANNER_JSON_INVALID',400);}
   if(!data||typeof data!=='object'||Array.isArray(data)||
      Object.keys(data).length!==1||typeof data.token!=='string'||data.token.length>1200||
      !/^ssc2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token))
     return reject('SCANNER_TOKEN_INVALID',400);
   const result=await scanner.scan(staff,data.token);
   if(result?.valid!==true||result.clubId!==staff.clubId||!uuid(result.memberId))
     return reject('SCANNER_RESULT_INVALID',503);
   return json({valid:true,clubId:result.clubId,memberId:result.memberId});
  }catch(e){
   const status=[400,401,403,404,409,503].includes(e?.status)?e.status:503;
   return reject(typeof e?.code==='string'?e.code:'SCANNER_UNAVAILABLE',status);
  }
 };
}

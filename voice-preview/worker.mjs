// Separate diagnostic Worker. No Supabase access, no club data, no retained audio.
// Requires VOICE_PREVIEW_KEY secret (>=24 chars) and SNOOP_AI binding.
// No public anonymous transcriptions.
const page = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>SNOOP Voice Lab</title><style>body{margin:0;background:#041321;color:#f3f0e9;font:16px system-ui;padding:24px;max-width:600px}h1{letter-spacing:.15em;color:#e9c47b}button,input,select{font:inherit;border:1px solid #d8b16e;border-radius:12px;background:#0c2639;color:white;padding:14px;margin:8px 0;width:100%;box-sizing:border-box}button{color:#e9c47b}button:disabled{opacity:.45}.status{padding:14px;border:1px solid #63838f;border-radius:12px;margin:12px 0}small{color:#adc3ce}#result{white-space:pre-wrap;overflow-wrap:anywhere;font-size:22px}</style><h1>SNOOP · VOICE LAB</h1><p>Prueba independiente con frases ficticias. No introduce datos en el club.</p><label>Clave de prueba<input id="key" type="password" autocomplete="off"></label><label>Idioma<select id="lang"><option value="es">Español</option><option value="it">Italiano</option></select></label><label><input id="context" type="checkbox" checked style="width:auto;margin-right:12px">Vocabolario prodotti (confronta acceso/spento)</label><button id="btn">Iniciar escucha</button><div class="status" id="status" role="status">Inactivo</div><p><strong>Transcripción literal</strong></p><div id="result">—</div><small id="latency"></small><p><small>Audio enviado a Cloudflare Whisper únicamente al finalizar la grabación. No se guarda. Mantén la pantalla abierta. No digas nombres reales, números de documento ni información privada.</small></p><script>
let stream,rec,chunks=[],timer,started=0;
const btn=document.getElementById('btn'),status=document.getElementById('status'),result=document.getElementById('result'),lat=document.getElementById('latency');
function stopTracks(){clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null}
btn.onclick=async()=>{if(rec?.state==='recording'){rec.stop();return}try{
const key=document.getElementById('key').value;
if(key.length<8)throw Error('Introduce la clave de prueba de 8 caracteres');
status.textContent='Solicitando permiso de micrófono';result.textContent='—';
stream=await navigator.mediaDevices.getUserMedia({audio:true});
const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported(x));
if(!mime)throw Error('Grabación no compatible');
rec=new MediaRecorder(stream,{mimeType:mime});chunks=[];started=performance.now();
rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
rec.onstop=async()=>{stopTracks();btn.disabled=true;btn.textContent='Transcribiendo…';status.textContent='Transcribiendo en Cloudflare';try{
const blob=new Blob(chunks,{type:mime});if(blob.size<100||blob.size>3500000)throw Error('Audio vacío o demasiado grande');
const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob)});
const response=await fetch('/transcribe',{method:'POST',headers:{'content-type':'application/json','x-preview-key':key},body:JSON.stringify({audioBase64:data,language:document.getElementById('lang').value,context:document.getElementById('context').checked})});
const out=await response.json();if(!response.ok)throw Error(out.error||'Error del servidor');
result.textContent=out.text;lat.textContent='Tiempo desde pulsar iniciar hasta resultado: '+((performance.now()-started)/1000).toFixed(2)+' s';status.textContent='Listo. Puedes repetir con otra frase.'}
catch(e){status.textContent=String(e.message||e)}finally{btn.disabled=false;btn.textContent='Iniciar escucha'}};
rec.start(250);btn.textContent='Terminar frase';status.textContent='Escuchando. Habla y pulsa Terminar frase';timer=setTimeout(()=>{if(rec?.state==='recording')rec.stop()},12000)
}catch(e){stopTracks();status.textContent=String(e.message||e);btn.textContent='Iniciar escucha'}};</script></html>`;
function same(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export default {async fetch(request,env){
const url=new URL(request.url);
if(request.method==="GET"&&url.pathname==="/")return new Response(page,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'none'; form-action 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff"}});
if(request.method!=="POST"||url.pathname!=="/transcribe")return new Response("Not found",{status:404});
if(!env.VOICE_PREVIEW_KEY||env.VOICE_PREVIEW_KEY.length<8||!same(request.headers.get("x-preview-key"),env.VOICE_PREVIEW_KEY))return Response.json({error:"No autorizado"},{status:401});
if(Number(request.headers.get("content-length")||0)>5000000)return Response.json({error:"Audio demasiado grande"},{status:413});
let input;try{input=await request.json()}catch{return Response.json({error:"Formato inválido"},{status:400})}
if(!["es","it"].includes(input.language)||typeof input.audioBase64!=="string"||input.audioBase64.length>4800000||!/^[a-zA-Z0-9+/]+={0,2}$/.test(input.audioBase64))return Response.json({error:"Audio inválido"},{status:400});
try{const output=await env.SNOOP_AI.run("@cf/openai/whisper-large-v3-turbo",{audio:input.audioBase64,language:input.language,task:"transcribe",vad_filter:true,condition_on_previous_text:false,...(input.context===true?{initial_prompt:"Contexto: nombres de productos y variedades de un catálogo. Palabras y nombres propios: Amnesia Haze, Haze, Super Silver Haze, Lemon Haze, Purple Haze, OG Kush, Critical, White Widow, Gelato. Transcribir literalmente los nombres, sin traducirlos; no inventar productos."}:{})});return Response.json({text:typeof output?.text==="string"?output.text:""},{headers:{"Cache-Control":"no-store"}})}catch{return Response.json({error:"Whisper no disponible"},{status:503})}
}};
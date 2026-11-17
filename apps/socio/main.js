// SNOOP Socio — isolated UI shell. All data must come from the future authenticated Socio API.
// No demo accounts, fabricated balances or operational QR tokens. No credentials in localStorage.
const app = document.getElementById('app');
const state = {page:'login',email:'',clubs:[],selected:null,menu:false,message:'',error:false,
  pending:false,me:null,wallet:null,movements:null,member:null,qrUrl:null,installPrompt:null,qrRefresh:null};
const endpoint = '/api/socio';
const enc = (v)=>encodeURIComponent(String(v));
const safe = (v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message,error=false){state.message=message;state.error=error;render();}
async function api(path,{method='GET',body}={}){
  const options={method,credentials:'include',cache:'no-store',headers:{'Accept':'application/json'}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(endpoint+path,options);
  let value=null;try{value=await response.json();}catch{}
  if(!response.ok)throw Error(response.status===404||response.status===503?'Servicio de socios aún no disponible.':(value?.message||'No se pudo completar la solicitud.'));
  return value;
}
function stopQr(){if(state.qrRefresh){clearInterval(state.qrRefresh);state.qrRefresh=null;}if(state.qrUrl){URL.revokeObjectURL(state.qrUrl);state.qrUrl=null;}}
function resetClub(){stopQr();state.selected=null;state.member=null;state.wallet=null;}
function brand(){return '<header class="brand"><div><div class="brand-word">SNOOP</div><div class="subbrand">PORTAL SOCIOS</div></div>'+
(state.me?'<div class="relative"><button class="menu-trigger" data-action="toggle-menu" aria-label="Menú" aria-expanded="'+state.menu+'">⋮</button>'+
(state.menu?'<nav class="menu" aria-label="Menú de socio"><button class="menu-item" data-action="clubs">Mis clubes</button><button class="menu-item" data-action="profile">Mi perfil</button><button class="menu-item" data-action="logout">Cerrar sesión</button></nav>':'')+'</div>':'')+'</header>';}
function shell(body){app.innerHTML='<main class="shell">'+brand()+(state.message?'<div class="status '+(state.error?'error':'')+'" role="status">'+safe(state.message)+'</div>':'')+body+'<div class="footer">SNOOP SOCIO · Acceso personal y privado</div></main>';}
function authPage(mode){const reg=mode==='register';shell('<section><div class="kicker">Tu carnet digital</div><h1 class="title">'+(reg?'Crea tu cuenta':'Bienvenido')+'</h1><p class="lede">Una cuenta para todos tus clubes SNOOP. Tus códigos son privados.</p></section>'+
'<section class="panel"><form id="auth-form" class="stack"><label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="254" value="'+safe(state.email)+'"/></label>'+
'<label class="field">Contraseña<input name="password" type="password" autocomplete="'+(reg?'new-password':'current-password')+'" minlength="10" required maxlength="128"/></label>'+
(reg?'<label class="field">Repite la contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" required maxlength="128"/></label>':'')+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>'+(state.pending?'Comprobando…':(reg?'Registrarme':'Iniciar sesión'))+'</button></form>'+
'<div class="divider"></div><button class="btn ghost" style="width:100%" data-action="'+(reg?'login':'register')+'">'+(reg?'Ya tengo cuenta':'Crear una cuenta')+'</button></section>'+
'<p class="muted align-center">La dirección debe coincidir con la facilitada al club. La vinculación se verificará antes de mostrar cualquier carnet.</p>'+
'<button class="btn small end" data-action="install">Instalar SNOOP Socio</button>');}
function verifyPage(){shell('<section><div class="kicker">Comprueba tu correo</div><h1 class="title">Confirma tu dirección</h1><p class="lede">Si el registro es válido, recibirás las instrucciones para confirmar el correo. Después podrás iniciar sesión y vincular tus clubes.</p></section><button class="btn primary" data-action="login">Ir al inicio de sesión</button>');}
function linkPage(){shell('<section><div class="kicker">Vinculación segura</div><h1 class="title">Vincula tu carnet</h1><p class="lede">Tu cuenta está lista. Para acceder a la tarjeta de un club necesitamos comprobar que eres realmente su socio. Pide al personal un código de vinculación temporal.</p></section>'+
'<section class="panel"><form id="link-form" class="stack"><label class="field">Código de vinculación<input name="code" autocomplete="off" spellcheck="false" minlength="6" maxlength="64" required placeholder="Código facilitado en el club"/></label><button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>Vincular mi carnet</button></form></section>'+
'<button class="btn ghost" data-action="reload-clubs">Actualizar mis clubes</button>');}
function clubsPage(){shell('<section><div class="kicker">Tu cuenta, tus clubes</div><h1 class="title">Mis clubes</h1><p class="lede">Cada club tiene su propio carnet, número de socio y saldo independiente.</p></section>'+
'<div class="list">'+state.clubs.map(c=>'<button class="club-option '+(c.id===state.selected?'selected':'')+'" data-action="select-club" data-id="'+safe(c.id)+'"><div><strong>'+safe(c.name)+'</strong><span>'+safe(c.status||'')+'</span></div><span>Ver carnet →</span></button>').join('')+'</div>'+
'<button class="btn ghost" data-action="link">Vincular otro club</button>');}
function carnetPage(){const c=state.clubs.find(c=>c.id===state.selected);if(!c){state.page='clubs';return render();}const unavailable='No disponible: conecta y verifica el carnet.';shell(
'<section><div class="kicker">Mi carnet digital</div><h1 class="club-heading">'+safe(c.name)+'</h1></section>'+
'<section class="carnet"><div class="kicker">SNOOP · Socio</div><div class="qr-frame">'+
(state.qrUrl?'<img alt="QR temporal de socio" src="'+state.qrUrl+'"/>':'<div class="qr-empty">'+unavailable+'</div>')+'</div>'+
'<div class="number">'+(state.member?.memberNumber?'Socio Nº '+safe(state.member.memberNumber):'Carnet pendiente')+'</div>'+
'<p class="muted">'+(state.qrUrl?'Muestra este código al personal':'El QR solo aparece con una vinculación válida y conexión activa.')+'</p>'+
'<button class="btn small ghost" data-action="refresh-qr" '+(state.pending?'disabled':'')+'>Actualizar QR</button></section>'+
(c.walletEnabled?'<section class="wallet"><div><div class="wallet-title">Saldo monedero</div><div class="wallet-amount">'+(state.wallet&&Number.isSafeInteger(state.wallet.balanceCents)?(state.wallet.balanceCents/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'No disponible')+'</div></div><button class="btn small ghost" data-action="movements">Movimientos</button></section>':'')+
'<button class="btn ghost end" data-action="clubs">Mis clubes</button>');}
function profilePage(){shell('<section><div class="kicker">Mi perfil</div><h1 class="title">Mi cuenta</h1><p class="lede">Correo verificado: '+safe(state.me?.email||'')+'</p></section><button class="btn ghost" data-action="clubs">Mis clubes</button><button class="btn" data-action="logout">Cerrar sesión</button>');}
function movementsPage(){
const rows=Array.isArray(state.movements)?state.movements:[];
const format=n=>(n/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const items=rows.map(r=>'<div class="club-option"><div><strong>'+safe(r.label||'Movimiento')+'</strong><span>'+safe(r.createdAt||'')+'</span></div><div><strong>'+safe(format(r.deltaCents))+'</strong><span>Saldo '+safe(format(r.balanceCents))+'</span></div></div>').join('');
shell('<section><div class="kicker">Monedero</div><h1 class="title">Movimientos</h1><p class="lede">Historial del club seleccionado. Los saldos de otros clubes no se mezclan.</p></section>'+
(state.movements===null?'<div class="status">Consultando movimientos…</div>':items?'<div class="list">'+items+'</div>':'<div class="status">No hay movimientos registrados.</div>')+
'<button class="btn end" data-action="home">Volver al carnet</button>');
}
function render(){switch(state.page){case'register':authPage('register');break;case'verify':verifyPage();break;case'link':linkPage();break;case'clubs':clubsPage();break;case'carnet':carnetPage();break;case'profile':profilePage();break;case'movements':movementsPage();break;default:authPage('login')}}
async function refreshClubs(){const data=await api('/clubs');state.clubs=Array.isArray(data?.clubs)?data.clubs.filter(c=>typeof c.id==='string'&&typeof c.name==='string'):[];const remembered=sessionStorage.getItem('snoop-socio-last-club');const next=state.clubs.find(c=>c.id===state.selected)||state.clubs.find(c=>c.id===remembered)||state.clubs[0];if(next){await selectClub(next.id);}else{resetClub();state.page='link';render();}}
async function selectClub(id){const c=state.clubs.find(c=>c.id===id);if(!c)return;stopQr();state.selected=c.id;state.member=null;state.wallet=null;state.page='carnet';state.menu=false;sessionStorage.setItem('snoop-socio-last-club',id);render();await Promise.all([refreshCarnet(),refreshWallet()]);}
async function refreshCarnet(){const id=state.selected;if(!id||document.hidden)return;try{const member=await api('/clubs/'+enc(id)+'/carnet');if(state.selected!==id)return;state.member=member;const r=await fetch(endpoint+'/clubs/'+enc(id)+'/carnet/qr',{credentials:'include',cache:'no-store',headers:{Accept:'image/png'}});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/png'))throw Error('No se puede generar el QR válido.');const blob=await r.blob();if(!blob.size||blob.size>500000)throw Error('QR inválido.');const uri=URL.createObjectURL(blob);if(state.selected!==id){URL.revokeObjectURL(uri);return;}if(state.qrUrl)URL.revokeObjectURL(state.qrUrl);state.qrUrl=uri;state.message='';state.error=false;render();if(!state.qrRefresh)state.qrRefresh=setInterval(()=>{if(!document.hidden&&state.page==='carnet'&&!state.pending)refreshCarnet();},20000);}catch(e){if(state.selected!==id)return;stopQr();notify(e.message||'Carnet no disponible.',true);}}
async function refreshWallet(){const id=state.selected;const c=state.clubs.find(c=>c.id===id);if(!c?.walletEnabled)return;try{const wallet=await api('/clubs/'+enc(id)+'/wallet');if(state.selected===id){state.wallet=wallet;render();}}catch{if(state.selected===id){state.wallet=null;render();}}}
async function refreshMovements(){
 const id=state.selected;if(!id)return;
 try{const result=await api('/clubs/'+enc(id)+'/wallet/movements');
 if(state.selected!==id||state.page!=='movements')return;
 state.movements=Array.isArray(result?.items)?result.items.filter(r=>Number.isSafeInteger(r.deltaCents)&&Number.isSafeInteger(r.balanceCents)&&r.balanceCents>=0&&typeof r.createdAt==='string').slice(0,100):[];
 state.message='';state.error=false;render();
 }catch(e){if(state.selected===id&&state.page==='movements'){state.movements=[];notify(e.message||'No se pudo consultar el historial.',true);}}
}
async function authenticate(){try{state.me=await api('/me');if(!state.me?.authenticated){state.me=null;state.page='login';render();return;}if(state.me.emailVerified===true){try{await api('/memberships/sync',{method:'POST',body:{}});}catch{/* Backend not yet available: show secure manual-link fallback. */}}await refreshClubs();}catch{state.me=null;state.page='login';render();}}
async function submitAuth(form){const values=new FormData(form);const email=String(values.get('email')||'').trim().toLowerCase();const password=String(values.get('password')||'');const reg=state.page==='register';if(reg&&password!==values.get('confirm'))return notify('Las contraseñas no coinciden.',true);state.email=email;state.pending=true;render();try{const result=await api('/auth/'+(reg?'signup':'login'),{method:'POST',body:{email,password}});state.pending=false;state.message='';if(reg){state.page='verify';render();}else{await authenticate();}}catch(e){state.pending=false;notify(e.message||'Error de acceso.',true);}}
async function submitLink(form){state.pending=true;render();try{await api('/link/claim',{method:'POST',body:{code:String(new FormData(form).get('code')||'').trim()}});state.pending=false;state.message='';await refreshClubs();}catch(e){state.pending=false;notify(e.message||'No se pudo vincular el carnet.',true);}}
document.addEventListener('submit',e=>{if(e.target.id==='auth-form'){e.preventDefault();void submitAuth(e.target);}if(e.target.id==='link-form'){e.preventDefault();void submitLink(e.target);}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action;state.message='';state.menu=false;
switch(a){case'login':state.page='login';break;case'register':state.page='register';break;case'toggle-menu':state.menu=!document.querySelector('.menu');break;case'clubs':state.page='clubs';stopQr();break;case'profile':state.page='profile';stopQr();break;case'link':state.page='link';stopQr();break;case'home':state.page='carnet';void refreshCarnet();break;case'movements':state.page='movements';state.movements=null;stopQr();void refreshMovements();break;case'select-club':void selectClub(el.dataset.id);break;case'refresh-qr':void refreshCarnet();break;case'reload-clubs':void refreshClubs().catch(err=>notify(err.message,true));break;case'logout':try{await api('/auth/logout',{method:'POST',body:{}});stopQr();state.me=null;state.clubs=[];state.page='login';sessionStorage.removeItem('snoop-socio-last-club');}catch(e){state.message='No se pudo cerrar sesión. Comprueba la conexión e inténtalo de nuevo.';state.error=true;}break;case'install':if(state.installPrompt){state.installPrompt.prompt();}else{state.message='Android: menú del navegador → Instalar. iPhone: Safari → Compartir → Añadir a pantalla de inicio.';}break;}render();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopQr();else if(state.page==='carnet')void refreshCarnet();});
window.addEventListener('pagehide',stopQr);
if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
render();void authenticate();

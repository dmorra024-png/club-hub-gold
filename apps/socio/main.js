// SNOOP Socio — isolated UI shell. All data must come from the future authenticated Socio API.
// No demo accounts, fabricated balances or operational QR tokens. No credentials in localStorage.
const app = document.getElementById('app');
const state = {page:'login',email:'',clubs:[],selected:null,menu:false,message:'',error:false,
  pending:false,pendingRegistration:null,me:null,wallet:null,movements:null,member:null,qrUrl:null,qrClub:null,qrRequest:0,installPrompt:null,qrRefresh:null,sessionEpoch:0};
const endpoint = '/api/socio';
const themeIds=['navy-gold','graphite-copper','aubergine-amethyst','petrol-titanium','ivory-champagne','ruby-gold','emerald-gold'];
const themes={
 'navy-gold':['#050C17','#0B1827','#13263B','#E5BC78','#F3F4F7','#A7B3C2','#41516A','#091321'],
 'graphite-copper':['#101114','#1B1E23','#292D34','#C98A5D','#F7F5F3','#B0B4BC','#5A5353','#151113'],
 'aubergine-amethyst':['#160B20','#261433','#39204D','#C292F0','#F8F2FC','#C4B4D0','#644878','#190E21'],
 'petrol-titanium':['#041C20','#0B3035','#13434B','#71D5D2','#F1F9FA','#B1C8CB','#37696D','#041F24'],
 'ivory-champagne':['#F7F2EA','#FFFCF8','#E9DED0','#93612D','#30251F','#675D57','#CDBDA8','#FFFFFF'],
 'ruby-gold':['#30050E','#4A0C1B','#720D20','#D4AF67','#FFF5EE','#D3B5B6','#9A5960','#310610'],
 'emerald-gold':['#03261F','#08392E','#10513F','#D4AF77','#F4F8F1','#B9CDBF','#477A65','#08271C']
};
function applySocioTheme(id){
 const theme=themeIds.includes(id)?id:'navy-gold';
 const [canvas,panel,elevated,accent,foreground,muted,border,ink]=themes[theme];
 const style=document.documentElement.style;
 Object.entries({'--navy':canvas,'--navy2':elevated,'--panel':panel,'--gold':accent,
  '--white':foreground,'--muted':muted,'--border':border,
  '--snoop-accent-ink':ink}).forEach(([key,value])=>style.setProperty(key,value));
 document.documentElement.dataset.snoopTheme=theme;
 document.documentElement.style.colorScheme=theme==='ivory-champagne'?'light':'dark';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',canvas);
}
const enc = (v)=>encodeURIComponent(String(v));
const safe = (v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message,error=false){state.message=message;state.error=error;render();}
async function api(path,{method='GET',body}={}){
  const options={method,credentials:'include',cache:'no-store',headers:{'Accept':'application/json'}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(endpoint+path,options);}
  catch{const error=Error('Sin conexión con SNOOP Socio. Comprueba internet y vuelve a intentarlo.');error.status=503;throw error;}
  // Refresh session exactly once on stale authentication; credentials remain in HttpOnly cookies.
  if(response.status===401&&!path.startsWith('/auth/')){
    const refreshed=await fetch(endpoint+'/auth/refresh',{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'});
    if(refreshed.ok)response=await fetch(endpoint+path,options);
  }
  let value=null;try{value=await response.json();}catch{}
  if(!response.ok){
    const err=Error(response.status===404||response.status===503?'Servicio de socios aún no disponible.':(value?.message||'No se pudo completar la solicitud.'));
    err.status=response.status;
    throw err;
  }
  return value;
}
function stopQr(){state.qrRequest++;if(state.qrRefresh){clearInterval(state.qrRefresh);state.qrRefresh=null;}if(state.qrUrl){URL.revokeObjectURL(state.qrUrl);state.qrUrl=null;}state.qrClub=null;}
function resetClub(){applySocioTheme('navy-gold');state.sessionEpoch++;stopQr();state.selected=null;state.member=null;state.wallet=null;state.movements=null;state.menu=false;}

const uiIcon=(name)=>{
 const paths={
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  person:'<circle cx="12" cy="8" r="3.5"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  wallet:'<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a3 3 0 0 1-3-3"/><path d="M22 12h-6a2 2 0 0 0 0 4h6"/>',
  history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  qr:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v4h-3m3 3h-6m-2-9v4"/>',
  location:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>'
 };
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||'')+'</svg>';
};
function brand(){
 const menu=state.me?'<div class="relative"><button type="button" class="menu-trigger" data-action="toggle-menu" aria-label="Menú" aria-expanded="'+state.menu+'">'+uiIcon('menu')+'</button>'+
 (state.menu?'<nav class="menu" aria-label="Menú de socio"><button class="menu-item" data-action="clubs">Mis clubes</button><button class="menu-item" data-action="profile">Mi perfil</button><button class="menu-item" data-action="logout">Cerrar sesión</button></nav>':'')+'</div>':'<span class="brand-spacer"></span>';
 return '<header class="brand approved-brand">'+menu+
 '<div class="brand-center"><span class="approved-wordmark" role="img" aria-label="SNOOP"></span><span class="subbrand">S O C I O</span></div>'+
 (state.me?'<button class="header-profile" type="button" data-action="profile" aria-label="Mi perfil">'+uiIcon('person')+'</button>':'<span class="brand-spacer"></span>')+'</header>';
}
function shell(body){
 const activeClub=state.clubs.find(c=>c.id===state.selected);
 const enabled=activeClub?.walletEnabled===true;
 const nav=state.me?.authenticated?'<nav class="socio-dock approved-dock" aria-label="Navegación del socio">'+
 '<button type="button" data-action="home" aria-current="'+(state.page==='carnet')+'" '+(!state.selected?'disabled':'')+'><span class="dock-icon">'+uiIcon('home')+'</span><span>Inicio</span></button>'+
 '<button type="button" data-action="wallet" aria-current="'+(state.page==='wallet')+'" '+(!enabled?'disabled':'')+'><span class="dock-icon">'+uiIcon('wallet')+'</span><span>Monedero</span></button>'+
 '<button class="dock-qr" type="button" data-action="qr" aria-label="Mostrar QR de socio" '+(!state.selected?'disabled':'')+'><span class="dock-icon">'+uiIcon('qr')+'</span></button>'+
 '<button type="button" data-action="movements" aria-current="'+(state.page==='movements')+'" '+(!enabled?'disabled':'')+'><span class="dock-icon">'+uiIcon('history')+'</span><span>Historial</span></button>'+
 '<button type="button" data-action="profile" aria-current="'+(state.page==='profile')+'"><span class="dock-icon">'+uiIcon('person')+'</span><span>Perfil</span></button></nav>':'';
 app.innerHTML='<main class="shell approved-shell">'+brand()+
 (state.message?'<div class="status '+(state.error?'error':'')+'" role="status">'+safe(state.message)+'</div>':'')+
 body+'<div class="footer">SNOOP SOCIO · Acceso personal y privado</div>'+nav+'</main>';
}
function authPage(mode){const reg=mode==='register';shell('<section><div class="kicker">Tu carnet digital</div><h1 class="title">'+(reg?'Crea tu cuenta':'Bienvenido')+'</h1><p class="lede">Una cuenta para todos tus clubes SNOOP. Tus códigos son privados.</p></section>'+
'<section class="panel">'+(reg?'<p class="muted">Primera activación: escribe el correo al que llegó la invitación y elige tu contraseña. En el siguiente paso introducirás el código de 6 cifras.</p>':'')+'<form id="auth-form" class="stack"><label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="254" value="'+safe(state.email)+'"/></label>'+
'<label class="field">Contraseña<input name="password" type="password" autocomplete="'+(reg?'new-password':'current-password')+'" minlength="10" required maxlength="128"/></label>'+
(reg?'<label class="field">Repite la contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" required maxlength="128"/></label>':'')+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>'+(state.pending?'Comprobando…':(reg?'Registrarme':'Iniciar sesión'))+'</button></form>'+
'<div class="divider"></div><button class="btn ghost" style="width:100%" data-action="'+(reg?'login':'register')+'">'+(reg?'Ya tengo cuenta':'Crear una cuenta')+'</button>'+(!reg?'<button class="btn ghost" style="width:100%" data-action="first-invite-code">Tengo un código de invitación · Activar mi cuenta</button>':'')+'</section>'+
'<p class="muted align-center">La dirección debe coincidir con la facilitada al club. La vinculación se verificará antes de mostrar cualquier carnet.</p>'+
'<button class="btn small end" data-action="install">Instalar SNOOP Socio</button>');}
function activatePage(){shell('<section><div class="kicker">Activación de carnet</div><h1 class="title">Introduce tus 6 números</h1><p class="lede">Paso 2 de 2. Introduce el código recibido en el correo de invitación del club. El código verifica tu email y activa tu carnet; no necesitas otra confirmación.</p></section>'+
'<section class="panel"><form id="activation-form" class="stack"><label class="field">Código recibido por email<input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="one-time-code" required placeholder="000000"/></label><button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>'+(state.pending?'Activando…':'Activar cuenta y carnet')+'</button></form></section>'+
'<button class="btn ghost" data-action="register">Volver al paso 1: correo y contraseña</button>');}
function linkPage(){shell('<section><div class="kicker">Activación de carnet</div><h1 class="title">Introduce tu código</h1><p class="lede">El club ha enviado a tu correo un código de 6 números. Escríbelo aquí una sola vez para vincular tu carnet.</p></section>'+
'<section class="panel"><form id="claim-form" class="stack"><label class="field">Código de socio<input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="one-time-code" required placeholder="000000"/></label><button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>'+(state.pending?'Verificando…':'Activar mi carnet')+'</button></form></section>'+
'<button class="btn ghost" data-action="reload-clubs">Ya he activado mi carnet</button>');}
function clubsPage(){shell('<section><div class="kicker">Tu cuenta, tus clubes</div><h1 class="title">Mis clubes</h1><p class="lede">Cada club tiene su propio carnet, número de socio y saldo independiente.</p></section>'+
'<div class="list">'+state.clubs.map(c=>'<button class="club-option '+(c.id===state.selected?'selected':'')+'" data-action="select-club" data-id="'+safe(c.id)+'"><div><strong>'+safe(c.name)+'</strong><span>'+safe(c.status||'')+'</span></div><span>Ver carnet →</span></button>').join('')+'</div>'+
'<button class="btn ghost" data-action="link">Vincular otro club</button>');}

const money=n=>Number.isSafeInteger(n)?(n/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'No disponible';
function activityList(limit){
 const rows=Array.isArray(state.movements)?state.movements.slice(0,limit):[];
 if(state.movements===null)return '<div class="activity-empty">Cargando actividades…</div>';
 if(!rows.length)return '<div class="activity-empty">No hay actividades registradas.</div>';
 return rows.map(r=>'<div class="activity-row"><div class="activity-mark">'+uiIcon('history')+'</div>'+
 '<div class="activity-copy"><strong>'+safe(r.label||'Movimiento')+'</strong><span>'+safe(r.createdAt||'')+'</span></div>'+
 '<strong class="activity-value '+(r.deltaCents>=0?'positive':'')+'">'+(r.deltaCents>0?'+ ':'')+safe(money(r.deltaCents))+'</strong></div>').join('');
}
function carnetPage(){
 const c=state.clubs.find(c=>c.id===state.selected);
 if(!c){state.page='clubs';return render();}
 const num=state.member?.memberNumber;
 const card='<section class="approved-member-card" id="approved-card" aria-label="Tarjeta digital de socio">'+
 '<div class="card-gold-stripe" aria-hidden="true"></div>'+
 '<div class="card-info"><div class="card-snoop">SNOOP</div><div class="card-label">TARJETA DE SOCIO</div>'+
 '<div class="card-number-label">Nº de socio</div><div class="card-number">'+(num?safe(num):'—')+'</div>'+
 '<div class="card-rule"></div><div class="card-status-label">Estado</div><div class="card-status"><span class="card-green-dot"></span>Socio activo</div></div>'+
 '<div class="card-qr">'+(state.qrUrl?'<img alt="QR permanente de socio" src="'+state.qrUrl+'"/>':'<span>Preparando carnet…</span>')+'</div></section>';
 const wallet=c.walletEnabled?'<button type="button" data-action="wallet" class="approved-wallet">'+
 '<span class="wallet-glyph">'+uiIcon('wallet')+'</span><span class="wallet-copy"><strong>Monedero</strong><small>Saldo disponible</small></span>'+
 '<strong class="wallet-amount">'+money(state.wallet?.balanceCents)+'</strong><span class="wallet-chevron">'+uiIcon('arrow')+'</span></button>':'';
 const activity='<section class="approved-activities"><div class="activity-heading"><h2>Últimas actividades</h2>'+
 (c.walletEnabled?'<button type="button" data-action="movements">Ver todo '+uiIcon('arrow')+'</button>':'')+'</div>'+
 '<div class="activity-box">'+(c.walletEnabled?activityList(3):'<div class="activity-empty">El monedero no está activado para este club.</div>')+'</div></section>';
 shell('<section class="approved-welcome"><h1>Bienvenido</h1><p>'+uiIcon('location')+' '+safe(c.name)+'</p></section>'+card+wallet+activity);
}
function walletPage(){
 const c=state.clubs.find(c=>c.id===state.selected);
 if(!c?.walletEnabled){state.page='carnet';return render();}
 shell('<section class="approved-welcome"><h1>Monedero</h1><p>'+safe(c.name)+'</p></section>'+
 '<section class="wallet-detail"><div>Saldo disponible</div><strong>'+money(state.wallet?.balanceCents)+'</strong>'+
 '<button class="btn ghost" data-action="movements">Ver movimientos</button></section>');
}
function profilePage(){shell('<section><div class="kicker">Mi perfil</div><h1 class="title">Mi cuenta</h1><p class="lede">Correo verificado: '+safe(state.me?.email||'')+'</p></section><button class="btn ghost" data-action="clubs">Mis clubes</button><button class="btn" data-action="logout">Cerrar sesión</button>');}
function movementsPage(){
const rows=Array.isArray(state.movements)?state.movements:[];
const format=n=>(n/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const items=rows.map(r=>'<div class="club-option"><div><strong>'+safe(r.label||'Movimiento')+'</strong><span>'+safe(r.createdAt||'')+'</span></div><div><strong>'+safe(format(r.deltaCents))+'</strong><span>Saldo '+safe(format(r.balanceCents))+'</span></div></div>').join('');
shell('<section><div class="kicker">Monedero</div><h1 class="title">Movimientos</h1><p class="lede">Historial del club seleccionado. Los saldos de otros clubes no se mezclan.</p></section>'+
(state.movements===null?'<div class="status">Consultando movimientos…</div>':items?'<div class="list">'+items+'</div>':'<div class="status">No hay movimientos registrados.</div>')+
'<button class="btn end" data-action="home">Volver al carnet</button>');
}
function render(){switch(state.page){case'register':authPage('register');break;case'activate':activatePage();break;case'link':linkPage();break;case'clubs':clubsPage();break;case'carnet':carnetPage();break;case'wallet':walletPage();break;case'profile':profilePage();break;case'movements':movementsPage();break;default:authPage('login')}}
async function refreshClubs(){const data=await api('/clubs');state.clubs=Array.isArray(data?.clubs)?data.clubs.filter(c=>typeof c.id==='string'&&typeof c.name==='string'):[];const remembered=sessionStorage.getItem('snoop-socio-last-club');const next=state.clubs.find(c=>c.id===state.selected)||state.clubs.find(c=>c.id===remembered)||state.clubs[0];if(next){await selectClub(next.id);}else{resetClub();state.page='link';render();}}
async function selectClub(id){const c=state.clubs.find(c=>c.id===id);if(!c)return;const changed=state.selected!==c.id;state.sessionEpoch++;if(changed)stopQr();state.selected=c.id;applySocioTheme(c.themeId);if(changed)state.member=null;state.wallet=null;if(changed)state.movements=null;state.page='carnet';state.menu=false;sessionStorage.setItem('snoop-socio-last-club',id);render();await Promise.all([refreshCarnet(),refreshWallet(),...(c.walletEnabled?[refreshRecentActivity()]:[])]);}
async function refreshCarnet(){
 const id=state.selected;
 if(!id||document.hidden||state.page!=='carnet')return;
 // The permanent member card is not a time-limited transaction QR.
 if(state.qrUrl&&state.qrClub===id&&state.member){render();return;}
 const requestId=++state.qrRequest;
 const current=()=>state.selected===id&&state.page==='carnet'&&!document.hidden&&state.qrRequest===requestId;
 try{
  const member=await api('/clubs/'+enc(id)+'/carnet');
  if(!current())return;
  state.member=member;
  const r=await fetch(endpoint+'/clubs/'+enc(id)+'/carnet/qr',{credentials:'include',cache:'no-store',headers:{Accept:'image/png'}});
  if(!current())return;
  const qrContentType=r.headers.get('content-type')||'';
  if(!r.ok||!(qrContentType.startsWith('image/png')||qrContentType.startsWith('image/svg+xml')))throw Error('No se puede generar el QR válido.');
  const blob=await r.blob();
  if(!blob.size||blob.size>500000)throw Error('QR inválido.');
  if(!current())return;
  const uri=URL.createObjectURL(blob);
  if(!current()){URL.revokeObjectURL(uri);return;}
  if(state.qrUrl)URL.revokeObjectURL(state.qrUrl);
  state.qrUrl=uri;state.qrClub=id;state.message='';state.error=false;render();
 }catch(e){
  if(!current())return;
  stopQr();notify(e.message||'Carnet no disponible.',true);
 }
}
async function refreshWallet(){
 const id=state.selected,epoch=state.sessionEpoch;
 const c=state.clubs.find(c=>c.id===id);
 if(!c?.walletEnabled)return;
 const current=()=>state.sessionEpoch===epoch&&state.selected===id&&state.me?.authenticated===true;
 try{
  const wallet=await api('/clubs/'+enc(id)+'/wallet');
  if(current()){state.wallet=wallet;render();}
 }catch{if(current()){state.wallet=null;render();}}
}

async function refreshRecentActivity(){
 const id=state.selected,epoch=state.sessionEpoch;
 const c=state.clubs.find(c=>c.id===id);
 if(!id||!c?.walletEnabled)return;
 try{
  const result=await api('/clubs/'+enc(id)+'/wallet/movements');
  if(state.selected!==id||state.sessionEpoch!==epoch||!state.me?.authenticated)return;
  state.movements=Array.isArray(result?.items)?result.items.filter(r=>
   Number.isSafeInteger(r.deltaCents)&&Number.isSafeInteger(r.balanceCents)&&
   typeof r.createdAt==='string').slice(0,100):[];
  if(state.page==='carnet'||state.page==='wallet')render();
 }catch{
  if(state.selected===id&&state.sessionEpoch===epoch){state.movements=[];if(state.page==='carnet'||state.page==='wallet')render();}
 }
}
async function refreshMovements(){
 const id=state.selected,epoch=state.sessionEpoch;if(!id)return;
 const current=()=>state.sessionEpoch===epoch&&state.selected===id&&state.page==='movements'&&state.me?.authenticated===true;
 try{const result=await api('/clubs/'+enc(id)+'/wallet/movements');
 if(!current())return;
 state.movements=Array.isArray(result?.items)?result.items.filter(r=>Number.isSafeInteger(r.deltaCents)&&Number.isSafeInteger(r.balanceCents)&&r.balanceCents>=0&&typeof r.createdAt==='string').slice(0,100):[];
 state.message='';state.error=false;render();
 }catch(e){if(current()){state.movements=[];notify(e.message||'No se pudo consultar el historial.',true);}}
}
async function authenticate(){
 try{
  state.me=await api('/me');
  if(!state.me?.authenticated){resetClub();state.me=null;state.clubs=[];state.page='login';render();return;}
  // Linking requires the six-digit email code; never auto-link by matching email.
  await refreshClubs();
 }catch(e){
  resetClub();state.me=null;state.clubs=[];state.page='login';
  state.message=e?.status===401?'':(e?.message||'No se puede conectar con el servicio de socios.');
  state.error=Boolean(state.message);
  render();
 }
}
async function submitAuth(form){
 const values=new FormData(form),email=String(values.get('email')||'').trim().toLowerCase(),password=String(values.get('password')||'');
 const reg=state.page==='register';
 if(reg&&password!==values.get('confirm'))return notify('Las contraseñas no coinciden.',true);
 state.email=email;
 if(reg){
  // Only keep password in memory while entering the club's existing email code.
  // No Supabase signup and no second confirmation email at this stage.
  state.pendingRegistration={email,password};state.page='activate';state.message='';state.error=false;render();return;
 }
 state.pending=true;render();
 try{await api('/auth/login',{method:'POST',body:{email,password}});state.pending=false;state.message='';await authenticate();}
 catch(e){state.pending=false;notify(e.message||'Error de acceso.',true);}
}
async function submitActivation(form){
 const pending=state.pendingRegistration;
 if(!pending){state.page='register';return notify('Introduce tu correo y una contraseña.',true);}
 const code=String(new FormData(form).get('code')||'').trim();
 if(!/^[0-9]{6}$/.test(code))return notify('Introduce los 6 números recibidos por email.',true);
 state.pending=true;render();
 try{
  await api('/auth/activate',{method:'POST',body:{email:pending.email,password:pending.password,code}});
  state.pendingRegistration=null;state.pending=false;state.message='';state.error=false;
  await authenticate();
 }catch(e){state.pending=false;state.page='activate';notify(e.message||'No se pudo activar la cuenta.',true);}
}
async function submitClaim(form){
 const code=String(new FormData(form).get('code')||'').trim();
 if(!/^\d{6}$/.test(code))return notify('Introduce los 6 números del correo.',true);
 state.pending=true;render();
 try{
  await api('/link/claim',{method:'POST',body:{code}});
  state.pending=false;state.message='Carnet activado correctamente.';state.error=false;
  await refreshClubs();
 }catch(e){state.pending=false;state.page='link';notify(e.message||'Código inválido o caducado.',true);}
}
document.addEventListener('submit',e=>{
 if(e.target.id==='auth-form'){e.preventDefault();void submitAuth(e.target);}
 if(e.target.id==='claim-form'){e.preventDefault();void submitClaim(e.target);}
 if(e.target.id==='activation-form'){e.preventDefault();void submitActivation(e.target);}
});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action;state.message='';state.menu=false;
switch(a){case'login':state.pendingRegistration=null;state.page='login';break;case'register':case'first-invite-code':state.pendingRegistration=null;state.page='register';break;case'toggle-menu':state.menu=!document.querySelector('.menu');break;case'clubs':state.page='clubs';break;case'profile':state.page='profile';break;case'link':state.page='link';break;case'home':state.page='carnet';if(!state.qrUrl||!state.member)void refreshCarnet();break;case'qr':state.page='carnet';if(!state.qrUrl||!state.member)void refreshCarnet();break;case'wallet':if(state.clubs.find(c=>c.id===state.selected)?.walletEnabled){state.page='wallet';if(!state.wallet)void refreshWallet();}break;case'movements':state.page='movements';state.movements=null;void refreshMovements();break;case'select-club':void selectClub(el.dataset.id);break;case'refresh-qr':void refreshCarnet();break;case'reload-clubs':void refreshClubs().catch(err=>notify(err.message,true));break;case'logout':try{await api('/auth/logout',{method:'POST',body:{}});resetClub();state.me=null;state.clubs=[];state.email='';state.page='login';sessionStorage.removeItem('snoop-socio-last-club');}catch(e){state.message='No se pudo cerrar sesión. Comprueba la conexión e inténtalo de nuevo.';state.error=true;}break;case'install':if(state.installPrompt){state.installPrompt.prompt();}else{state.message='Android: menú del navegador → Instalar. iPhone: Safari → Compartir → Añadir a pantalla de inicio.';}break;}render();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.page==='carnet'&&!state.qrUrl)void refreshCarnet();});
// The browser reclaims object URLs at document unload; navigation does not revoke a valid permanent card.
if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
render();void authenticate();

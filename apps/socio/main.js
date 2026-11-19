// SNOOP Socio — isolated UI shell. All data must come from the future authenticated Socio API.
// No demo accounts, fabricated balances or operational QR tokens. No credentials in localStorage.
const app = document.getElementById('app');
const state = {page:'login',email:'',clubs:[],selected:null,menu:false,message:'',error:false,
  pending:false,me:null,wallet:null,movements:null,member:null,qrUrl:null,qrRequest:0,installPrompt:null,qrRefresh:null,sessionEpoch:0,recoveryToken:null,verification:'signup'};
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
function stopQr(){state.qrRequest++;if(state.qrRefresh){clearInterval(state.qrRefresh);state.qrRefresh=null;}if(state.qrUrl){URL.revokeObjectURL(state.qrUrl);state.qrUrl=null;}}
function resetClub(){applySocioTheme('navy-gold');state.sessionEpoch++;stopQr();state.selected=null;state.member=null;state.wallet=null;state.movements=null;state.menu=false;}
function brand(){
 if(!state.me?.authenticated)return '<header class="brand"><div class="brand-identity"><img class="brand-wordmark" src="./snoop-wordmark.svg" alt="SNOOP" width="172" height="24"/><div class="subbrand">SOCIO · CARNET DIGITAL</div></div></header>';
 return '<header class="socio-app-header">'+
  '<button type="button" class="socio-header-menu" data-action="toggle-menu" aria-label="Abrir menú de clubes" aria-expanded="'+state.menu+'">☰</button>'+
  '<div class="socio-app-wordmark"><img src="./snoop-wordmark.svg" alt="SNOOP"/><span>S O C I O</span></div>'+
  '<span class="socio-header-indicator" aria-hidden="true">◇</span>'+
  '</header>'+
  (state.menu?'<nav class="socio-app-menu" aria-label="Menú de socio"><button class="menu-item" data-action="clubs">Mis clubes</button><button class="menu-item" data-action="profile">Mi perfil</button><button class="menu-item" data-action="logout">Cerrar sesión</button></nav>':'');
}
function shell(body){
 const activeClub=state.clubs.find(c=>c.id===state.selected);
 const active=Boolean(state.me?.authenticated&&state.selected);
 const wallet=active&&activeClub?.walletEnabled===true;
 const nav=state.me?.authenticated?'<nav class="socio-dock socio-premium-dock" aria-label="Navegación del socio">'+
  '<button type="button" data-action="home" '+(!active?'disabled':'')+' aria-current="'+(state.page==='carnet')+'"><span class="dock-icon">⌂</span><span>Inicio</span></button>'+
  '<button type="button" data-action="movements" '+(!wallet?'disabled':'')+' aria-current="'+(state.page==='movements')+'"><span class="dock-icon">▱</span><span>Monedero</span></button>'+
  '<button type="button" class="socio-central-qr" data-action="home" '+(!active?'disabled':'')+' aria-label="Actualizar código QR"><span class="dock-icon">▦</span><span>QR</span></button>'+
  '<button type="button" data-action="movements" '+(!wallet?'disabled':'')+' aria-label="Historial del monedero"><span class="dock-icon">◷</span><span>Historial</span></button>'+
  '<button type="button" data-action="profile" aria-current="'+(state.page==='profile')+'"><span class="dock-icon">♙</span><span>Perfil</span></button>'+
  '</nav>':'';
 app.innerHTML='<main class="shell '+(state.me?.authenticated?'socio-authenticated':'socio-login-shell')+'">'+brand()+
  (state.message?'<div class="status '+(state.error?'error':'')+'" role="status">'+safe(state.message)+'</div>':'')+
  body+'<div class="footer">SNOOP SOCIO · Acceso personal y privado</div>'+nav+'</main>';
}
function authPage(mode){const reg=mode==='register';shell('<section><div class="kicker">Tu carnet digital</div><h1 class="title">'+(reg?'Crea tu cuenta':'Bienvenido')+'</h1><p class="lede">Una cuenta para todos tus clubes SNOOP. Tus códigos son privados.</p></section>'+
'<section class="panel"><form id="auth-form" class="stack"><label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="254" value="'+safe(state.email)+'"/></label>'+
'<label class="field">Contraseña<input name="password" type="password" autocomplete="'+(reg?'new-password':'current-password')+'" minlength="10" required maxlength="128"/></label>'+
(reg?'<label class="field">Repite la contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" required maxlength="128"/></label>':'')+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>'+(state.pending?'Comprobando…':(reg?'Registrarme':'Iniciar sesión'))+'</button></form>'+
'<div class="divider"></div><button class="btn ghost" style="width:100%" data-action="'+(reg?'login':'register')+'">'+(reg?'Ya tengo cuenta':'Crear una cuenta')+'</button></section>'+
'<p class="muted align-center">La dirección debe coincidir con la facilitada al club. La vinculación se verificará antes de mostrar cualquier carnet.</p>'+
'<div class="auth-extras"><button class="btn small ghost" data-action="forgot">¿Olvidaste tu contraseña?</button><button class="btn small ghost" data-action="install">Instalar SNOOP Socio</button></div>');}
function verifyPage(){
 const signup=state.verification==='signup';
 shell('<section><div class="kicker">Comprueba tu correo</div><h1 class="title">'+(signup?'Confirma tu dirección':'Recuperar acceso')+'</h1>'+
 '<p class="lede">'+(signup?'Si el registro es válido, recibirás instrucciones para confirmar el correo. Después podrás iniciar sesión y vincular tus clubes.':
 'Si existe una cuenta con ese correo, recibirás un enlace para crear una nueva contraseña.')+'</p></section>'+
 (signup?'<button class="btn ghost" data-action="resend-verification" '+(state.pending?'disabled':'')+'>Reenviar correo de confirmación</button>':'')+
 '<button class="btn primary" data-action="login">Ir al inicio de sesión</button>');
}
function linkPage(){shell('<section><div class="kicker">Vinculación segura</div><h1 class="title">Vincula tu carnet</h1><p class="lede">Tu cuenta está lista. Para acceder a la tarjeta de un club necesitamos comprobar que eres realmente su socio. Pide al personal un código de vinculación temporal.</p></section>'+
'<section class="panel"><form id="link-form" class="stack"><label class="field">Código de vinculación<input name="code" autocomplete="off" spellcheck="false" minlength="6" maxlength="64" required placeholder="Código facilitado en el club"/></label><button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>Vincular mi carnet</button></form></section>'+
'<button class="btn ghost" data-action="reload-clubs">Actualizar mis clubes</button>');}
function clubsPage(){shell('<section><div class="kicker">Tu cuenta, tus clubes</div><h1 class="title">Mis clubes</h1><p class="lede">Cada club tiene su propio carnet, número de socio y saldo independiente.</p></section>'+
'<div class="list">'+state.clubs.map(c=>'<button class="club-option '+(c.id===state.selected?'selected':'')+'" data-action="select-club" data-id="'+safe(c.id)+'"><div><strong>'+safe(c.name)+'</strong><span>'+safe(c.status||'')+'</span></div><span>Ver carnet →</span></button>').join('')+'</div>'+
'<button class="btn ghost" data-action="link">Vincular otro club</button>');}
function carnetPage(){
 const club=state.clubs.find(c=>c.id===state.selected);
 if(!club){state.page='clubs';return render();}
 const number=state.member?.memberNumber?String(state.member.memberNumber):'—';
 const actualQr=state.qrUrl?'<img alt="QR temporal de socio" src="'+state.qrUrl+'"/>':'<div class="qr-empty">QR pendiente de conexión</div>';
 const active=Boolean(state.member?.active===true);
 const amount=state.wallet&&Number.isSafeInteger(state.wallet.balanceCents)?
  (state.wallet.balanceCents/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'No disponible';
 const moves=Array.isArray(state.movements)?state.movements.slice(0,3):[];
 const recent=moves.length?moves.map(r=>{
  const euros=(r.deltaCents/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
  return '<div class="socio-activity"><span class="socio-activity-icon" aria-hidden="true">◈</span><div class="socio-activity-detail"><strong>'+safe(r.label||'Movimiento')+'</strong><small>'+safe(r.createdAt||'')+'</small></div><strong class="socio-activity-value">'+safe(euros)+'</strong></div>';
 }).join(''):'<p class="socio-empty-activity">No hay movimientos disponibles para mostrar.</p>';
 shell(
 '<section class="socio-hello"><div><h1>Bienvenido</h1><p>⌖ <span>'+safe(club.name)+'</span></p></div><button type="button" class="socio-account-action" data-action="profile" aria-label="Mi perfil">♙</button></section>'+
 '<section class="member-premium-card" aria-label="Tarjeta de socio SNOOP"><div class="member-premium-info">'+
 '<img class="member-premium-wordmark" src="./snoop-wordmark.svg" alt="SNOOP"/><p class="member-premium-subtitle">TARJETA DE SOCIO</p>'+
 '<div class="member-premium-number"><span>Nº de socio</span><strong>'+safe(number)+'</strong></div>'+
 '<div class="member-premium-state"><span>Estado</span><strong>'+(active?'<i aria-hidden="true"></i> Socio activo':'Pendiente de verificación')+'</strong></div>'+
 '</div><div class="member-premium-qr"><div class="member-premium-qr-inner">'+actualQr+'</div></div></section>'+
 (club.walletEnabled?
 '<button type="button" class="socio-premium-wallet" data-action="movements" aria-label="Saldo monedero y movimientos"><span class="wallet-sign" aria-hidden="true">▣</span><span class="wallet-copy"><strong>Monedero</strong><small>Saldo disponible</small></span><strong class="wallet-balance">'+safe(amount)+'</strong><span aria-hidden="true">›</span></button>':'')+
 '<section class="socio-premium-history"><div class="socio-history-heading"><h2>Últimas actividades</h2>'+(club.walletEnabled?'<button type="button" data-action="movements">Ver todo ›</button>':'')+'</div>'+
 (club.walletEnabled?'<div class="socio-activity-list">'+recent+'</div>':'<p class="socio-empty-activity">El monedero no está activado para este club.</p>')+'</section>');
}
function profilePage(){shell('<section><div class="kicker">Mi perfil</div><h1 class="title">Mi cuenta</h1><p class="lede">Correo verificado: '+safe(state.me?.email||'')+'</p></section>'+
'<section class="panel"><h2 class="section-heading">Cambiar contraseña</h2><form id="password-form" class="stack">'+
'<label class="field">Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"/></label>'+
'<label class="field">Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required/></label>'+
'<label class="field">Repetir nueva contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required/></label>'+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>Cambiar contraseña</button></form></section>'+
'<button class="btn ghost" data-action="clubs">Mis clubes</button><button class="btn" data-action="logout">Cerrar sesión</button>');}
function forgotPage(){shell('<section><div class="kicker">Recuperar acceso</div><h1 class="title">Restablecer contraseña</h1>'+
'<p class="lede">Recibirás un enlace de recuperación si tienes una cuenta verificada.</p></section>'+
'<section class="panel"><form id="forgot-form" class="stack">'+
'<label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" value="'+safe(state.email)+'" required maxlength="254"/></label>'+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>Enviar enlace</button></form></section>'+
'<button class="btn ghost" data-action="login">Volver al inicio</button>');}
function recoveryPage(){shell('<section><div class="kicker">Acceso seguro</div><h1 class="title">Nueva contraseña</h1>'+
'<p class="lede">Elige una contraseña nueva para tu cuenta SNOOP Socio.</p></section>'+
'<section class="panel"><form id="recovery-form" class="stack">'+
'<label class="field">Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required/></label>'+
'<label class="field">Repetir contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required/></label>'+
'<button class="btn primary" type="submit" '+(state.pending?'disabled':'')+'>Guardar nueva contraseña</button></form></section>');}
function movementsPage(){
const rows=Array.isArray(state.movements)?state.movements:[];
const format=n=>(n/100).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const items=rows.map(r=>'<div class="club-option"><div><strong>'+safe(r.label||'Movimiento')+'</strong><span>'+safe(r.createdAt||'')+'</span></div><div><strong>'+safe(format(r.deltaCents))+'</strong><span>Saldo '+safe(format(r.balanceCents))+'</span></div></div>').join('');
shell('<section><div class="kicker">Monedero</div><h1 class="title">Movimientos</h1><p class="lede">Historial del club seleccionado. Los saldos de otros clubes no se mezclan.</p></section>'+
(state.movements===null?'<div class="status">Consultando movimientos…</div>':items?'<div class="list">'+items+'</div>':'<div class="status">No hay movimientos registrados.</div>')+
'<button class="btn end" data-action="home">Volver al carnet</button>');
}
function render(){switch(state.page){case'register':authPage('register');break;case'verify':verifyPage();break;case'link':linkPage();break;case'clubs':clubsPage();break;case'carnet':carnetPage();break;case'profile':profilePage();break;case'forgot':forgotPage();break;case'recovery':recoveryPage();break;case'movements':movementsPage();break;default:authPage('login')}}
async function refreshClubs(){const data=await api('/clubs');state.clubs=Array.isArray(data?.clubs)?data.clubs.filter(c=>typeof c.id==='string'&&typeof c.name==='string'):[];const remembered=sessionStorage.getItem('snoop-socio-last-club');const next=state.clubs.find(c=>c.id===state.selected)||state.clubs.find(c=>c.id===remembered)||state.clubs[0];if(next){await selectClub(next.id);}else{resetClub();state.page='link';render();}}
async function selectClub(id){const c=state.clubs.find(c=>c.id===id);if(!c)return;state.sessionEpoch++;stopQr();state.selected=c.id;applySocioTheme(c.themeId);state.member=null;state.wallet=null;state.movements=null;state.page='carnet';state.menu=false;sessionStorage.setItem('snoop-socio-last-club',id);render();await Promise.all([refreshCarnet(),refreshWallet(),refreshRecentMovements()]);}
async function refreshCarnet(){
 const id=state.selected;
 if(!id||document.hidden||state.page!=='carnet')return;
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
  state.qrUrl=uri;state.message='';state.error=false;render();
  if(!state.qrRefresh)state.qrRefresh=setInterval(()=>{if(!document.hidden&&state.page==='carnet'&&!state.pending)void refreshCarnet();},20000);
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
async function refreshRecentMovements(){
 const id=state.selected,epoch=state.sessionEpoch;
 const club=state.clubs.find(c=>c.id===id);
 if(!club?.walletEnabled)return;
 try{
  const result=await api('/clubs/'+enc(id)+'/wallet/movements');
  if(state.sessionEpoch!==epoch||state.selected!==id||state.page!=='carnet')return;
  state.movements=Array.isArray(result?.items)?result.items.filter(r=>
   Number.isSafeInteger(r.deltaCents)&&typeof r.createdAt==='string'&&
   Number.isSafeInteger(r.balanceCents)).slice(0,3):[];
  render();
 }catch{ /* No synthetic history or balances when service is unavailable. */ }
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
  if(state.me.emailVerified===true){
   try{await api('/memberships/sync',{method:'POST',body:{}});}
   catch{/* Manual one-use staff link is the secure fallback when auto-link is unavailable. */}
  }
  await refreshClubs();
 }catch(e){
  resetClub();state.me=null;state.clubs=[];state.page='login';
  state.message=e?.status===401?'':(e?.message||'No se puede conectar con el servicio de socios.');
  state.error=Boolean(state.message);
  render();
 }
}
async function submitAuth(form){const values=new FormData(form);const email=String(values.get('email')||'').trim().toLowerCase();const password=String(values.get('password')||'');const reg=state.page==='register';if(reg&&password!==values.get('confirm'))return notify('Las contraseñas no coinciden.',true);state.email=email;state.pending=true;render();try{const result=await api('/auth/'+(reg?'signup':'login'),{method:'POST',body:{email,password}});state.pending=false;state.message='';if(reg){state.verification='signup';state.page='verify';render();}else{await authenticate();}}catch(e){state.pending=false;notify(e.message||'Error de acceso.',true);}}
async function submitPassword(form){
 const fd=new FormData(form),old=String(fd.get('currentPassword')||''),password=String(fd.get('newPassword')||'');
 if(password!==fd.get('confirm'))return notify('Las contraseñas no coinciden.',true);
 state.pending=true;render();try{
 const changed=await api('/auth/change-password',{method:'POST',body:{currentPassword:old,newPassword:password}});
 if(changed?.updated!==true)throw Error('El servidor no confirmó el cambio.');
 resetClub();sessionStorage.removeItem('snoop-socio-last-club');state.me=null;state.clubs=[];state.email='';state.pending=false;state.page='login';
 notify('Contraseña actualizada. Inicia sesión de nuevo.');
 }catch(e){state.pending=false;notify(e?.status===401?'Contraseña actual incorrecta o sesión caducada.':e.message||'No se ha podido cambiar la contraseña.',true);}
}
async function submitForgot(form){const email=String(new FormData(form).get('email')||'').trim().toLowerCase();state.email=email;state.pending=true;render();
 try{const result=await api('/auth/recover',{method:'POST',body:{email}});if(result?.accepted!==true)throw Error('La solicitud no fue confirmada.');state.pending=false;state.verification='recover';state.page='verify';notify('Si existe una cuenta, recibirás un correo para recuperar el acceso.');}
 catch(e){state.pending=false;notify(e.message||'No se ha podido solicitar el enlace.',true);}
}
async function submitRecovery(form){const password=String(new FormData(form).get('newPassword')||'');const confirm=String(new FormData(form).get('confirm')||'');
 if(password!==confirm)return notify('Las contraseñas no coinciden.',true);
 const token=state.recoveryToken;if(!token)return notify('El enlace ha caducado. Solicita otro.',true);
 state.pending=true;render();try{
 const recovered=await api('/auth/complete-recovery',{method:'POST',body:{accessToken:token,password}});
 if(recovered?.updated!==true)throw Error('El servidor no confirmó el cambio.');
 state.recoveryToken=null;resetClub();sessionStorage.removeItem('snoop-socio-last-club');state.me=null;state.clubs=[];state.email='';state.pending=false;state.page='login';notify('Contraseña restablecida. Inicia sesión.');
 }catch(e){state.pending=false;notify(e.message||'No se pudo recuperar el acceso.',true);}
}
async function resendVerification(){
 if(!state.email||state.pending)return notify('Introduce primero tu correo de registro.',true);
 state.pending=true;render();try{
  const response=await api('/auth/resend',{method:'POST',body:{email:state.email}});
  if(response?.accepted!==true)throw Error('El servidor no confirmó el reenvío.');
  state.pending=false;notify('Si la cuenta está pendiente, recibirás un nuevo enlace.');
 }catch(e){state.pending=false;notify(e.message||'No se pudo reenviar el correo.',true);}
}
async function submitLink(form){
 const code=String(new FormData(form).get('code')||'').trim().toLowerCase().replace(/\s+/g,'');
 if(!/^[a-f0-9]{48}$/.test(code))
  return notify('El código debe contener 48 caracteres. Puedes pegarlo directamente.',true);
 state.pending=true;render();
 try{
  const linked=await api('/link/claim',{method:'POST',body:{code}});
  if(linked?.linked!==true)throw Error('El servidor no confirmó la vinculación.');
  state.pending=false;state.message='';await refreshClubs();
 }catch(e){
  state.pending=false;
  notify(e?.status===403?'Código caducado, ya utilizado o no autorizado. Solicita uno nuevo.':
   e.message||'No se pudo vincular el carnet.',true);
 }
}
document.addEventListener('submit',e=>{if(e.target.id==='auth-form'){e.preventDefault();void submitAuth(e.target);}if(e.target.id==='link-form'){e.preventDefault();void submitLink(e.target);}if(e.target.id==='password-form'){e.preventDefault();void submitPassword(e.target);}if(e.target.id==='forgot-form'){e.preventDefault();void submitForgot(e.target);}if(e.target.id==='recovery-form'){e.preventDefault();void submitRecovery(e.target);}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action;state.message='';state.menu=false;
switch(a){case'login':state.page='login';break;case'register':state.page='register';break;case'forgot':state.page='forgot';break;case'resend-verification':void resendVerification();break;case'toggle-menu':state.menu=!document.querySelector('.socio-app-menu');break;case'clubs':state.page='clubs';stopQr();break;case'profile':state.page='profile';stopQr();break;case'link':state.page='link';stopQr();break;case'home':state.page='carnet';void refreshCarnet();break;case'movements':state.page='movements';state.movements=null;stopQr();void refreshMovements();break;case'select-club':void selectClub(el.dataset.id);break;case'refresh-qr':void refreshCarnet();break;case'reload-clubs':void refreshClubs().catch(err=>notify(err.message,true));break;case'logout':try{await api('/auth/logout',{method:'POST',body:{}});resetClub();state.me=null;state.clubs=[];state.email='';state.page='login';sessionStorage.removeItem('snoop-socio-last-club');}catch(e){state.message='No se pudo cerrar sesión. Comprueba la conexión e inténtalo de nuevo.';state.error=true;}break;case'install':if(state.installPrompt){state.installPrompt.prompt();}else{state.message='Android: menú del navegador → Instalar. iPhone: Safari → Compartir → Añadir a pantalla de inicio.';}break;}render();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopQr();else if(state.page==='carnet')void refreshCarnet();});
window.addEventListener('pagehide',stopQr);
if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
// GoTrue recovery tokens are returned in the URL fragment (never sent to the server).
// Remove them immediately before loading external assets or issuing any API request.
try{
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.get('type')==='recovery'&&typeof hash.get('access_token')==='string'&&
    hash.get('access_token').split('.').length===3){
  state.recoveryToken=hash.get('access_token');
  state.page='recovery';
 }
 if(location.hash||location.search)history.replaceState(null,'',location.pathname);
}catch{state.recoveryToken=null;}
render();if(!state.recoveryToken)void authenticate();

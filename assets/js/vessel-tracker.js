// ===== STATE =====
var ws=null,on=false,mc=0;
var TV=[],GF=[],V=Object.create(null),HI=Object.create(null),AL=[],AP=Object.create(null),PS=Object.create(null),DB=[],STATES=Object.create(null),ANCH=Object.create(null);
var S={aw:false,snd:true,rec:true,notif:false,eGeo:true,eSpd:false,eSt:true,eAn:false,eDb:false};
var EJ={pub:'',svc:'',tpl:'',to:''};
var EMAIL_LOG={last:{},dayCount:0,dayStart:0};
var map,markers={},trails={},gfCircles=[];
var CC=['#22d3ee','#10b981','#f59e0b','#a78bfa','#ef4444','#f472b6','#fb923c','#34d399','#818cf8','#fbbf24','#38bdf8','#e879f9','#4ade80','#facc15','#2dd4bf','#c084fc','#fb7185','#a3e635','#67e8f9','#fca5a5'];
var NS={0:'Navegando',1:'Fondeado',2:'Sin gobierno',3:'Restringido',5:'Amarrado',7:'Faenando',8:'A vela',15:'—'};
var DB_INTERVAL=4*60*60*1000; // 4 hours
var EMAIL_MIN_INTERVAL=5*60*1000; // 5 min between same-key emails
var EMAIL_DAILY_CAP=50;
var ANCHOR_DRIFT_NM=0.1;
var SPD_DELTA_KN=3;
var lastDbSnap={};

// ===== AUDIO =====
var actx;
function beep(f,d){if(!S.snd)return;try{if(!actx)actx=new(window.AudioContext||window.webkitAudioContext)();var o=actx.createOscillator(),g=actx.createGain();o.connect(g);g.connect(actx.destination);o.frequency.value=f;g.gain.setValueAtTime(.12,actx.currentTime);g.gain.exponentialRampToValueAtTime(.001,actx.currentTime+d);o.start();o.stop(actx.currentTime+d);}catch(e){}}

// ===== MAP =====
map=L.map('map',{zoomControl:false}).setView([41.3,2.15],6);
L.control.zoom({position:'topright'}).addTo(map);
var dark=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd'});
var light=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19});
var sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19});
dark.addTo(map);
L.control.layers({'🌙 Oscuro':dark,'☀️ Claro':light,'🛰 Satélite':sat},null,{position:'topright',collapsed:true}).addTo(map);

function vIcon(h,c){var r=h||0;return L.divIcon({html:'<svg width="22" height="22" viewBox="0 0 24 24"><g transform="rotate('+r+' 12 12)"><polygon points="12,1 20,22 12,17 4,22" fill="'+c+'" stroke="#fff" stroke-width=".7" opacity=".9"/></g></svg>',iconSize:[22,22],iconAnchor:[11,11],className:''});}

function updMarker(v){
  var mm=v.mm;if(!mm||!v.lat)return;
  var i=TV.findIndex(function(t){return t.m===mm}),col=CC[(i>=0?i:0)%20];
  if(markers[mm]){markers[mm].setLatLng([v.lat,v.lon]);markers[mm].setIcon(vIcon(v.hdg||v.cog,col));}
  else markers[mm]=L.marker([v.lat,v.lon],{icon:vIcon(v.hdg||v.cog,col)}).addTo(map);
  markers[mm].off('click').on('click',function(){zoomTo(mm);});

  // Permanent name label
  if(markers[mm].getTooltip())markers[mm].unbindTooltip();
  markers[mm].bindTooltip('<b style="color:'+col+'">'+esc(v.name||mm)+'</b><br><span style="color:#94a3b8;font-size:10px">'+(v.sog||0)+' kn</span>',{permanent:true,direction:'right',offset:[12,0],className:'vessel-tooltip'});

  // Full info popup on click
  var status=NS[v.st]||v.st||'—';
  var age=v.up?Math.floor((Date.now()-v.up)/1000):null;
  var ageStr=age!==null?(age<60?age+'s':age<3600?Math.floor(age/60)+'m':Math.floor(age/3600)+'h')+' ago':'';
  var p='<div style="font-family:-apple-system,sans-serif;min-width:200px">'
    +'<div style="font-size:14px;font-weight:700;color:'+col+';margin-bottom:4px">'+esc(v.name||mm)+'</div>'
    +'<table style="font-size:11px;color:#e2e8f0;border-collapse:collapse;width:100%">'
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">MMSI</td><td>'+esc(mm)+'</td></tr>'
    +(v.imo?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">IMO</td><td>'+esc(v.imo)+'</td></tr>':'')
    +(v.cs?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Call Sign</td><td>'+esc(v.cs)+'</td></tr>':'')
    +(v.type?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Tipo</td><td>'+esc(v.type)+'</td></tr>':'')
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Posición</td><td>'+fmtLL(v.lat,v.lon,5)+'</td></tr>'
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">SOG</td><td><b>'+(v.sog||0)+' kn</b></td></tr>'
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">COG</td><td>'+(v.cog||0)+'°</td></tr>'
    +(v.hdg?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Heading</td><td>'+v.hdg+'°</td></tr>':'')
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Estado</td><td>'+esc(status)+'</td></tr>'
    +(v.dest?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Destino</td><td><b style="color:#f59e0b">'+esc(v.dest)+'</b></td></tr>':'')
    +(v.eta?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">ETA</td><td><b style="color:#22d3ee">'+esc(v.eta)+'</b></td></tr>':'')
    +'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Fuente</td><td>'+(v.src==='ais'?'🔴 AIS live':'📍 Manual')+'</td></tr>'
    +(ageStr?'<tr><td style="color:#64748b;padding:2px 8px 2px 0">Actualizado</td><td>'+ageStr+'</td></tr>':'')
    +'</table></div>';
  markers[mm].bindPopup(p,{maxWidth:280});

  if(!HI[mm])HI[mm]=[];
  var ll=HI[mm].map(function(p){return[p.lat,p.lon]});
  if(ll.length>1){if(trails[mm])trails[mm].setLatLngs(ll);else trails[mm]=L.polyline(ll,{color:col,weight:2,opacity:.4,dashArray:'4 4'}).addTo(map);}
}

function zoomTo(mm){var v=V[mm];if(v&&v.lat)map.flyTo([v.lat,v.lon],13,{duration:1});}
function fitAll(){var pts=Object.values(V).filter(function(v){return v.lat}).map(function(v){return[v.lat,v.lon]});if(pts.length===1)map.flyTo(pts[0],10);else if(pts.length>1)map.fitBounds(pts,{padding:[60,60],maxZoom:12});}

// ===== HAVERSINE =====
function dNM(a,b,c,d){var R=3440.065,x=Math.PI/180,dl=(c-a)*x,dn=(d-b)*x;var s=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(a*x)*Math.cos(c*x)*Math.sin(dn/2)*Math.sin(dn/2);return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}

// ===== FORMATTERS =====
function fmtLat(lat,p){p=p==null?4:p;return Math.abs(lat).toFixed(p)+'°'+(lat>=0?'N':'S');}
function fmtLon(lon,p){p=p==null?4:p;return Math.abs(lon).toFixed(p)+'°'+(lon>=0?'E':'W');}
function fmtLL(lat,lon,p){return fmtLat(lat,p)+' '+fmtLon(lon,p);}
function safeKey(k){k=String(k==null?'':k);return/^[a-zA-Z0-9:_-]{1,64}$/.test(k)?k:null;}
function sanitizeText(v,max){
  var s=(v==null?'':String(v)).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,' ').trim();
  if(max&&s.length>max)s=s.slice(0,max);
  return s;
}
function esc(v){
  return sanitizeText(v,140).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);});
}
function csvf(v){
  var s=sanitizeText(v,250);
  if(/^[=+\-@]/.test(s))s='_'+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function csvRow(a){return a.map(csvf).join(',')+'\n';}

// ===== PERSISTENCE =====
function load(){try{
  var d=localStorage.getItem('vt6');if(d){var o=JSON.parse(d);TV=o.tv||[];GF=o.gf||[];S=Object.assign(S,o.s||{});EJ=Object.assign(EJ,o.ej||{});V=Object.assign(Object.create(null),o.v||{});HI=Object.assign(Object.create(null),o.hi||{});DB=o.db||[];STATES=Object.assign(Object.create(null),o.st||{});lastDbSnap=Object.assign(Object.create(null),o.lds||{});ANCH=Object.assign(Object.create(null),o.anch||{});}
}catch(e){}}
var _saveTimer=null;
function _doSave(){try{localStorage.setItem('vt6',JSON.stringify({tv:TV,gf:GF,s:S,ej:EJ,v:V,hi:HI,db:DB,st:STATES,lds:lastDbSnap,anch:ANCH}));}catch(e){}}
function saveCfg(){clearTimeout(_saveTimer);_saveTimer=setTimeout(_doSave,500);}
function saveAll(){saveCfg();}
window.addEventListener('beforeunload',function(){clearTimeout(_saveTimer);_doSave();});

// ===== SYNC TOGGLES =====
function syncT(){
  var ids={tAW:'aw',tSnd:'snd',tRec:'rec',tNtf:'notif',tEGeo:'eGeo',tESpd:'eSpd',tESt:'eSt',tEAn:'eAn',tEDb:'eDb'};
  Object.keys(ids).forEach(function(id){var el=document.getElementById(id);if(el)el.className='toggle'+(S[ids[id]]?' on':'');});
  var ns=document.getElementById('ntfSt');
  if(ns){
    if(!('Notification' in window))ns.textContent='no soportado';
    else if(Notification.permission==='denied')ns.textContent='bloqueadas';
    else if(Notification.permission!=='granted')ns.textContent='sin permiso';
    else ns.textContent='';
  }
}

// ===== VESSELS =====
function addV(){
  var m=sanitizeText(document.getElementById('mmsiIn').value,20),n=sanitizeText(document.getElementById('nameIn').value,60);
  if(!/^[0-9]{6,9}$/.test(m))return;
  if(!m||TV.find(function(x){return x.m===m})||TV.length>=20)return;
  TV.push({m:m,n:n||m});
  document.getElementById('mmsiIn').value='';document.getElementById('nameIn').value='';
  saveCfg();rVL();updMS();
}
function rmV(m){
  TV=TV.filter(function(x){return x.m!==m});
  if(markers[m]){map.removeLayer(markers[m]);delete markers[m];}
  if(trails[m]){map.removeLayer(trails[m]);delete trails[m];}
  delete V[m];delete HI[m];delete STATES[m];delete lastDbSnap[m];delete PS[m];delete ANCH[m];
  Object.keys(AP).forEach(function(k){if(k.indexOf(m+'_')===0)delete AP[k];});
  saveCfg();rVL();updMS();
}
function rVL(){
  var e=document.getElementById('vList');document.getElementById('vc').textContent=TV.length;
  if(!TV.length){e.innerHTML='';return;}
  e.innerHTML=TV.map(function(v,i){
    var vd=V[v.m],hasPos=vd&&vd.lat;
    return '<div class="vi" onclick="zoomTo(\''+v.m+'\')"><div><div class="vn" style="color:'+CC[i%20]+'">'+esc(vd?vd.name:v.n)+'</div><div class="vm">'+esc(v.m)+(hasPos?(vd.src==='ais'?' 🔴':' 📍'):'')+'</div></div><button class="vr" onclick="event.stopPropagation();rmV(\''+v.m+'\')">✕</button></div>';
  }).join('');
}
function updMS(){
  var s=document.getElementById('manMmsi');if(!s)return;
  s.innerHTML=TV.map(function(v){return'<option value="'+v.m+'">'+esc(V[v.m]?V[v.m].name:v.n)+'</option>'}).join('');
}

// ===== MANUAL POSITION =====
function manPos(){
  var mm=document.getElementById('manMmsi').value;
  var lat=parseFloat(document.getElementById('manLat').value),lon=parseFloat(document.getElementById('manLon').value);
  if(!mm||isNaN(lat)||isNaN(lon))return;
  var sog=parseFloat(document.getElementById('manSog').value)||0,cog=parseFloat(document.getElementById('manCog').value)||0;
  var name=V[mm]?V[mm].name:(TV.find(function(t){return t.m===mm})||{}).n||mm;
  processUpdate(mm,name,lat,lon,sog,cog,null,null,'manual');
  ['manLat','manLon','manSog','manCog'].forEach(function(id){document.getElementById(id).value='';});
  log('📍 Manual: '+name,'o');
}

// ===== GEOFENCE =====
function addGF(){
  var lat=parseFloat(document.getElementById('gfLa').value),lon=parseFloat(document.getElementById('gfLo').value);
  var rad=parseFloat(document.getElementById('gfR').value),nm=sanitizeText(document.getElementById('gfN').value,60)||'Zona';
  if(isNaN(lat)||isNaN(lon)||isNaN(rad)||rad<=0)return;
  GF.push({lat:lat,lon:lon,rad:rad,name:nm,id:Date.now()});
  ['gfLa','gfLo','gfR','gfN'].forEach(function(id){document.getElementById(id).value='';});
  saveCfg();rGF();drawGF();
}
function rmGF(id){GF=GF.filter(function(g){return g.id!==id});saveCfg();rGF();drawGF();}
function rGF(){var e=document.getElementById('gfList');e.innerHTML=GF.map(function(g){return'<div class="vi"><div><div class="vn" style="color:var(--amber)">'+esc(g.name)+'</div><div class="vm">'+g.rad+'NM</div></div><button class="vr" onclick="event.stopPropagation();rmGF('+g.id+')">✕</button></div>'}).join('');}
function drawGF(){gfCircles.forEach(function(c){map.removeLayer(c)});gfCircles=[];GF.forEach(function(g){var c=L.circle([g.lat,g.lon],{radius:g.rad*1852,color:'#f59e0b',fillColor:'#f59e0b',fillOpacity:.06,weight:1.5,dashArray:'6 4'}).addTo(map);c.bindTooltip(esc(g.name),{permanent:true,direction:'center'});gfCircles.push(c);});}

// ===== CENTRAL UPDATE PROCESSOR =====
function processUpdate(mm,name,lat,lon,sog,cog,hdg,st,src){
  mm=safeKey(mm);if(!mm)return;
  // Checks
  checkGeo(mm,lat,lon,name);
  checkAnch(mm,lat,lon,name,st);
  checkSpd(mm,sog,name);
  checkStatus(mm,name,st);

  V[mm]=Object.assign(V[mm]||{},{mm:mm,name:name,lat:lat,lon:lon,sog:sog,cog:cog,hdg:hdg,st:st,src:src,up:Date.now()});
  if(!HI[mm])HI[mm]=[];
  HI[mm].push({lat:lat,lon:lon,sog:sog,cog:cog,ts:Date.now()});
  if(HI[mm].length>300)HI[mm]=HI[mm].slice(-300);
  updMarker(V[mm]);

  // DB snapshot every 4h if navigating
  dbSnapshot(mm,name,lat,lon,sog,cog,st);
}

// ===== STATUS TRACKING =====
function checkStatus(mm,name,newSt){
  var prev=STATES[mm];
  var isMoving=newSt!==1&&newSt!==5&&newSt!==null;
  var wasMoving=prev&&prev.moving;

  if(prev===undefined){STATES[mm]={moving:isMoving,since:Date.now()};return;}

  if(isMoving&&!wasMoving){
    // Was moored/anchored, now navigating
    var dur=Date.now()-prev.since;
    var hrs=Math.round(dur/3600000*10)/10;
    dbRecord(mm,name,'STATUS','Fondeo/amarre fin ('+hrs+'h)');
    if(S.eSt)sendEmail('🚢 '+name+' zarpó ('+hrs+'h en fondeo/amarre)');
    aa('info','🚢',name+' zarpó');
    STATES[mm]={moving:true,since:Date.now()};
  }else if(!isMoving&&wasMoving){
    // Was navigating, now moored/anchored
    dbRecord(mm,name,'STATUS','Inicio fondeo/amarre');
    if(S.eSt)sendEmail('⚓ '+name+' fondeó/amarró');
    aa('info','⚓',name+' fondeó/amarró');
    STATES[mm]={moving:false,since:Date.now()};
  }
}

// ===== DB SNAPSHOTS =====
function dbSnapshot(mm,name,lat,lon,sog,cog,st){
  var isMoving=st!==1&&st!==5;
  if(!isMoving)return; // Only snapshot when navigating
  var now=Date.now();
  var last=lastDbSnap[mm]||0;
  if(now-last<DB_INTERVAL)return;
  lastDbSnap[mm]=now;
  dbRecord(mm,name,'NAV',fmtLL(lat,lon)+' '+sog+'kn '+(cog||0)+'°'+(V[mm]&&V[mm].dest?' → '+V[mm].dest:''));
  if(S.eDb)sendEmail('📊 '+name+' pos: '+fmtLL(lat,lon)+' '+sog+'kn','db_'+mm);
}
function dbRecord(mm,name,type,detail){
  var v=V[mm]||{};
  DB.push({ts:Date.now(),mm:mm,name:name,type:type,lat:v.lat||0,lon:v.lon||0,sog:v.sog||0,cog:v.cog||0,dest:v.dest||'',detail:detail});
  if(DB.length>2000)DB=DB.slice(-2000);
  saveAll();rDb();
}

// ===== CHECKS =====
function checkGeo(mm,lat,lon,name){GF.forEach(function(g){var d=dNM(lat,lon,g.lat,g.lon),k=mm+'_'+g.id,was=AP[k],is=d<=g.rad;if(is&&!was){aa('geo','🟡',name+' ENTRÓ '+g.name);if(S.eGeo)sendEmail('🟡 '+name+' entró en '+g.name,'geo_'+k);}if(!is&&was){aa('geo','🔴',name+' SALIÓ '+g.name);if(S.eGeo)sendEmail('🔴 '+name+' salió de '+g.name,'geo_'+k);}AP[k]=is;});}
function checkAnch(mm,lat,lon,name,st){
  if(!S.aw){if(ANCH[mm])delete ANCH[mm];return;}
  if(st!==1){if(ANCH[mm])delete ANCH[mm];return;}
  if(!ANCH[mm]){ANCH[mm]={lat:lat,lon:lon,ts:Date.now()};return;}
  var d=dNM(ANCH[mm].lat,ANCH[mm].lon,lat,lon);
  if(d>ANCHOR_DRIFT_NM){
    aa('anchor','⚓',name+' DERIVA '+d.toFixed(2)+'NM');
    if(S.eAn)sendEmail('⚓ '+name+' deriva en fondeo: '+d.toFixed(2)+' NM','anch_'+mm);
  }
}
function checkSpd(mm,sog,name){
  var ps=PS[mm];
  if(!ps||typeof ps==='number'){PS[mm]={stable:sog,count:0};return;}
  if(Math.abs(sog-ps.stable)>SPD_DELTA_KN){
    ps.count++;
    if(ps.count>=2){
      aa('speed','⚡',name+': '+ps.stable.toFixed(1)+'→'+sog.toFixed(1)+'kn');
      if(S.eSpd)sendEmail('⚡ '+name+' velocidad: '+ps.stable.toFixed(1)+'→'+sog.toFixed(1)+' kn','spd_'+mm);
      ps.stable=sog;ps.count=0;
    }
  }else{
    ps.count=0;
  }
}

// ===== EMAIL =====
function sendEmail(msg,key){
  if(!EJ.pub||!EJ.svc||!EJ.tpl||!EJ.to)return;
  var now=Date.now();
  if(now-EMAIL_LOG.dayStart>86400000){EMAIL_LOG.dayStart=now;EMAIL_LOG.dayCount=0;}
  if(EMAIL_LOG.dayCount>=EMAIL_DAILY_CAP){log('⚠ Límite diario email ('+EMAIL_DAILY_CAP+') alcanzado','w');return;}
  key=key||msg;
  if(EMAIL_LOG.last[key]&&now-EMAIL_LOG.last[key]<EMAIL_MIN_INTERVAL){log('⏱ Email throttled: '+key,'g');return;}
  EMAIL_LOG.last[key]=now;EMAIL_LOG.dayCount++;
  try{
    emailjs.send(EJ.svc,EJ.tpl,{to_email:EJ.to,subject:'VesselTracker Alert',message:msg,time:new Date().toLocaleString('es-ES')},{publicKey:EJ.pub});
    log('📧 Email ('+EMAIL_LOG.dayCount+'/'+EMAIL_DAILY_CAP+' hoy): '+msg.substring(0,60),'o');
  }catch(e){log('📧 Error email: '+e.message,'e');}
}
function testEmail(){
  saveEmailCfg();
  sendEmail('🧪 Test — Vessel Tracker funcionando correctamente a las '+new Date().toLocaleString('es-ES'),'test_'+Date.now());
}
function saveEmailCfg(){
  EJ.pub=document.getElementById('ejPub').value.trim();
  EJ.svc=document.getElementById('ejSvc').value.trim();
  EJ.tpl=document.getElementById('ejTpl').value.trim();
  EJ.to=document.getElementById('ejTo').value.trim();
  saveCfg();
}

// ===== NOTIFICATIONS =====
var _swReg=null,_deferredInst=null;
function notify(title,body,tag){
  if(!S.notif)return;
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  try{
    if(_swReg&&_swReg.active){_swReg.active.postMessage({type:'notify',title:title,body:body,tag:tag||'vt'});}
    else{new Notification(title,{body:body,tag:tag||'vt',icon:'./icon.svg'});}
  }catch(e){log('Notif error: '+e.message,'e');}
}
function toggleNotif(){
  if(!('Notification' in window)){log('Notificaciones no soportadas','w');return;}
  if(S.notif){S.notif=false;syncT();saveCfg();return;}
  if(Notification.permission==='granted'){S.notif=true;syncT();saveCfg();return;}
  if(Notification.permission==='denied'){log('Permiso de notificaciones denegado en el navegador','w');syncT();return;}
  Notification.requestPermission().then(function(p){S.notif=(p==='granted');syncT();saveCfg();if(p==='granted')notify('Vessel Tracker','Notificaciones activas','init');});
}
function doInstall(){
  if(!_deferredInst)return;
  _deferredInst.prompt();
  _deferredInst.userChoice.then(function(){_deferredInst=null;var c=document.getElementById('instCard');if(c)c.style.display='none';});
}
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./sw.js').then(function(r){_swReg=r;}).catch(function(){});
  });
}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();_deferredInst=e;var c=document.getElementById('instCard');if(c)c.style.display='block';});
window.addEventListener('appinstalled',function(){_deferredInst=null;var c=document.getElementById('instCard');if(c)c.style.display='none';});

// ===== ALERTS =====
function aa(t,i,m){AL.unshift({t:t,i:i,m:m,ts:Date.now()});if(AL.length>200)AL.length=200;if(t!=='info'){beep(880,.15);setTimeout(function(){beep(1100,.15)},180);if(navigator.vibrate)navigator.vibrate(200);notify('⚓ Vessel Tracker',i+' '+m,'vt_'+t);}rAL();}
function rAL(){var e=document.getElementById('alC');if(!e)return;if(!AL.length){e.innerHTML='<div class="empty">Sin alertas</div>';return;}e.innerHTML=AL.slice(0,40).map(function(a){var c=a.t==='geo'?'var(--amber)':a.t==='speed'?'var(--cyan)':a.t==='anchor'?'var(--red)':'var(--dim)';return'<div class="ai"><span class="dot" style="background:'+c+'"></span>'+esc(a.i)+' '+esc(a.m)+'<div class="at">'+new Date(a.ts).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</div></div>'}).join('');}

// ===== LOG =====
function log(m,c){var b=document.getElementById('logBox');if(!b)return;var l=document.createElement('div');l.className=c||'g';l.textContent=new Date().toLocaleTimeString('es-ES')+' '+m;b.appendChild(l);b.scrollTop=b.scrollHeight;while(b.children.length>200)b.removeChild(b.firstChild);}

// ===== DB RENDER =====
function rDb(){
  var e=document.getElementById('dbTable');if(!e)return;
  document.getElementById('dbCount').textContent=DB.length+' registros';
  if(!DB.length){e.innerHTML='<div class="empty">Sin registros</div>';return;}
  var h='<table class="db-table"><thead><tr><th>Fecha</th><th>Buque</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>';
  DB.slice(-50).reverse().forEach(function(r){
    h+='<tr><td>'+new Date(r.ts).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.type)+'</td><td>'+esc(r.detail)+'</td></tr>';
  });
  h+='</tbody></table>';e.innerHTML=h;
}
function exportDb(){
  var s=csvRow(['Timestamp','MMSI','Name','Type','Lat','Lon','SOG','COG','Destination','Detail']);
  DB.forEach(function(r){s+=csvRow([new Date(r.ts).toISOString(),r.mm,r.name,r.type,r.lat,r.lon,r.sog,r.cog,r.dest,r.detail]);});
  dl('vessel_db.csv',s);
}
function exportCSV(){
  var s=csvRow(['MMSI','Name','Timestamp','Lat','Lon','SOG','COG','Source']);
  for(var mm in HI){var nm=V[mm]?V[mm].name:mm;var src=V[mm]?V[mm].src:'?';HI[mm].forEach(function(p){s+=csvRow([mm,nm,new Date(p.ts).toISOString(),p.lat.toFixed(6),p.lon.toFixed(6),p.sog||'',p.cog||'',src]);});}
  dl('vessel_positions.csv',s);
}
function dl(n,c){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:'text/csv'}));a.download=n;a.click();}

// ===== AIS CONNECT =====
function conn(){
  var key=document.getElementById('apikey').value.trim();
  if(!key){log('⚠ API key','w');return;}
  if(!TV.length){log('⚠ Añade buques','w');return;}
  saveCfg();disc();
  try{ws=new WebSocket('wss://stream.aisstream.io/v0/stream');}catch(e){log('Error: '+e.message,'e');return;}
  ws.onopen=function(){
    ws.send(JSON.stringify({Apikey:key,BoundingBoxes:[[[25,-15],[65,45]]],FilterMessageTypes:['PositionReport','ShipStaticData']}));
    on=true;ui();log('✓ Conectado — buscando '+TV.length+' buques: '+TV.map(function(t){return t.m}).join(', '),'o');
  };
  ws.onmessage=function(ev){mc++;if(mc===1)log('Primer msg recibido','o');if(mc%500===0)ui();if(ev.data instanceof Blob){var r=new FileReader();r.onload=function(){proc(r.result)};r.readAsText(ev.data);}else proc(ev.data);};
  ws.onerror=function(){log('✕ Error WS','e');};
  ws.onclose=function(e){var was=on;on=false;ui();log('WS cerrado ('+e.code+')','e');if(S.rec&&was)setTimeout(function(){if(!on)conn()},5000);};
}
function disc(){if(ws){ws.close();ws=null;}on=false;ui();}

function proc(raw){
  try{
    var d=JSON.parse(raw);if(d.ERROR){log('⚠ '+JSON.stringify(d),'e');return;}
    var tp=d.MessageType,mt=d.MetaData,mm=safeKey(String(mt&&mt.MMSI||''));
    if(!mm)return;
    if(!TV.find(function(t){return t.m===mm})){
      if(mc%2000===0)log('📊 '+mc+' msgs, buscando tus '+TV.length+' buques (último MMSI: '+mm+')','g');
      return;
    }
    log('🎯 ¡ENCONTRADO '+((mt.ShipName||'').trim()||mm)+'!','o');
    if(tp==='PositionReport'){
      var p=d.Message.PositionReport;if(!p)return;
      var nm=(mt.ShipName||'').trim()||mm;
      processUpdate(mm,nm,p.Latitude,p.Longitude,p.Sog,p.Cog,p.TrueHeading===511?null:p.TrueHeading,p.NavigationalStatus,'ais');
      if(mc%30===0){saveAll();rVL();rFleet();}
      log('📡 '+nm+' '+fmtLL(p.Latitude,p.Longitude)+' '+p.Sog.toFixed(1)+'kn','d');
    }else if(tp==='ShipStaticData'){
      var sd=d.Message.ShipStaticData;if(!sd)return;
      var eta=null;
      if(sd.Eta&&(sd.Eta.Month||sd.Eta.Day)){
        var now=new Date();
        var mo=sd.Eta.Month||1,da=sd.Eta.Day||1,hr=sd.Eta.Hour||0,mi=sd.Eta.Minute||0;
        var y=now.getUTCFullYear();
        var etaDate=new Date(Date.UTC(y,mo-1,da,hr,mi));
        if(etaDate.getTime()<now.getTime()-86400000)etaDate=new Date(Date.UTC(y+1,mo-1,da,hr,mi));
        eta=etaDate.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      }
      V[mm]=Object.assign(V[mm]||{},{mm:mm,name:(mt.ShipName||'').trim()||mm,imo:sd.ImoNumber,cs:sd.CallSign,dest:sd.Destination,eta:eta,type:sd.Type,src:'ais'});
      if(V[mm].lat)updMarker(V[mm]);
      rVL();rFleet();
    }
  }catch(e){}
}

// ===== UI =====
function ui(){
  ['sM','sD'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent=on?'LIVE — '+mc+' msg':'OFF';});
  ['sBM','sBD'].forEach(function(id){var e=document.getElementById(id);if(e){e.textContent=on?'LIVE':'OFF';e.style.background=on?'#065f46':'#7f1d1d';e.style.color=on?'var(--green)':'var(--red)';}});
  var go=document.getElementById('goBtn'),st=document.getElementById('stopBtn');
  if(go)go.style.display=on?'none':'block';
  if(st)st.style.display=on?'block':'none';
}

// ===== FLEET TAB =====
function rFleet(){
  var e=document.getElementById('tFleet');if(!e)return;
  if(!TV.length){e.innerHTML='<div class="empty">Añade buques</div>';return;}
  e.innerHTML=TV.map(function(t,i){
    var v=V[t.m]||{},col=CC[i%20];
    var h='<div class="card" style="border-left:3px solid '+col+';cursor:pointer" onclick="zoomTo(\''+t.m+'\')">';
    h+='<div style="display:flex;justify-content:space-between"><div><div style="font-size:13px;font-weight:700;color:'+col+'">'+esc(v.name||t.n)+'</div>';
    h+='<div class="vm">'+esc(t.m)+(v.imo?' · '+esc(v.imo):'')+(v.src==='ais'?' 🔴':v.lat?' 📍':'')+'</div></div>';
    if(v.up){var a=Math.floor((Date.now()-v.up)/1000);h+='<div style="font-size:9px;color:var(--dim)">'+(a<60?a+'s':a<3600?Math.floor(a/60)+'m':Math.floor(a/3600)+'h')+' ago</div>';}
    h+='</div>';
    if(v.lat){
      h+='<div class="dg">';
      h+='<div><div class="dl">Posición</div><div class="dv">'+fmtLL(v.lat,v.lon)+'</div></div>';
      h+='<div><div class="dl">SOG/COG</div><div class="dv" style="color:'+col+'">'+(v.sog||0)+' kn '+(v.cog||0)+'°</div></div>';
      h+='</div>';
      if(v.dest)h+='<div style="font-size:10px;color:var(--dim);margin-top:3px">Destino: <b style="color:var(--amber)">'+esc(v.dest)+'</b>'+(v.eta?' · ETA: <b style="color:var(--cyan)">'+esc(v.eta)+'</b>':'')+'</div>';
      if(GF.length){h+='<div style="margin-top:3px">';GF.forEach(function(g){var d=dNM(v.lat,v.lon,g.lat,g.lon);h+='<span class="chip" style="background:'+(d<=g.rad?'#065f46':'var(--border)')+';color:'+(d<=g.rad?'var(--green)':'var(--dim)')+'">'+esc(g.name)+'</span>'});h+='</div>';}
    }else h+='<div class="empty" style="text-align:left;font-size:10px">Sin datos</div>';
    h+='</div>';return h;
  }).join('');
}

// ===== TABS =====
function sTab(t){
  document.querySelectorAll('#mainTabs .tab').forEach(function(el,i){el.className='tab'+(['cfg','fleet','db','email','log'][i]===t?' on':'');});
  ['tCfg','tFleet','tDb','tEmail','tLog'].forEach(function(id,i){var e=document.getElementById(id);if(e)e.style.display=['cfg','fleet','db','email','log'][i]===t?'block':'none';});
  if(t==='fleet')rFleet();if(t==='db')rDb();
}

// ===== PANEL =====
var pMin=true;
function togglePanel(){pMin=!pMin;document.getElementById('panel').className='panel'+(pMin?' min':'');document.getElementById('pChev').textContent=pMin?'▾':'▴';}

// ===== RESPONSIVE: Clone content to both containers =====
function initUI(){
  var tpl=document.getElementById('contentTpl').content.cloneNode(true);
  var isDesktop=window.innerWidth>=768;
  var target=isDesktop?document.getElementById('sbContent'):document.getElementById('mobileContent');
  target.appendChild(tpl);

  // Restore saved values
  var apiEl=document.getElementById('apikey');if(apiEl)apiEl.value=localStorage.getItem('vt6_k')||'';
  apiEl.addEventListener('input',function(){localStorage.setItem('vt6_k',this.value);});

  // Email fields
  var ejP=document.getElementById('ejPub');if(ejP)ejP.value=EJ.pub;
  var ejS=document.getElementById('ejSvc');if(ejS)ejS.value=EJ.svc;
  var ejT=document.getElementById('ejTpl');if(ejT)ejT.value=EJ.tpl;
  var ejTo=document.getElementById('ejTo');if(ejTo)ejTo.value=EJ.to;
  [ejP,ejS,ejT,ejTo].forEach(function(el){if(el)el.addEventListener('input',saveEmailCfg);});
}

// ===== VISIBILITY =====
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!on&&S.rec&&TV.length)setTimeout(conn,1000);});

// ===== PERIODIC =====
setInterval(function(){rFleet();ui();},10000);

// ===== INIT =====
load();
localStorage.setItem('vt6_k',localStorage.getItem('vt6_k')||'');
initUI();
Object.keys(V).forEach(function(mm){if(V[mm].lat)updMarker(V[mm]);});
rVL();rGF();drawGF();syncT();ui();rAL();rFleet();updMS();fitAll();rDb();
log('Vessel Tracker Pro v6 listo','o');

/* ================================================================
   GROUPAGE · app.js
   Motor GRASP + Extreme Points + viewer Three.js
   ================================================================ */

const TRUCKS = {
  mega:     {name:'Mega trailer',  L:1360, A:248, H:300, maxKg:24000, wheelbase:750},
  standard: {name:'Lona estándar', L:1360, A:245, H:270, maxKg:24000, wheelbase:750},
  short:    {name:'Semi corto',    L:1200, A:245, H:270, maxKg:24000, wheelbase:700}
};
const OPT_LEVELS = {
  fast:     {iters:1,   localSearch:false, perturbation:0},
  balanced: {iters:20,  localSearch:false, perturbation:0.2},
  deep:     {iters:80,  localSearch:true,  perturbation:0.3, lsIters:30},
  max:      {iters:200, localSearch:true,  perturbation:0.4, lsIters:100}
};
const PALETTE = ['#ff6b1a','#4ee1c4','#a78bfa','#c5f24b','#ff4d5e','#5aa9e6','#ffb347','#5dd889'];

const state = {
  truck: 'standard',
  origin: 'Almacén Consolidador Central',
  destinations: [
    {name:'MADRID',    color:'#ff6b1a'},
    {name:'BARCELONA', color:'#4ee1c4'}
  ],
  items: [],
  placed: [],
  unloaded: [],
  selectedItem: null,
  exploded: false,
  transparent: false,
  optMeta: null,
  optLevel: 'deep',
  boxStyle: 'solid',
  loadingMethod: 'lifo',          // 'lifo' | 'fifo' | 'weight' | 'manual'
  separation: {dest: 5, adr: 40}, // cm: entre destinos / entre ADR incompatibles
  showCoG: true,
  cogEnvelope: {xMin:0.2, xMax:0.7, zHalf:0.35}, // fracciones de truck.L y truck.A/2
  showLashing: false,
  lashing: {mu:0.5, cFwd:0.8, cLat:0.5, LC:2500, STF:400, angle:80}  // EN 12195-1
};
// Deceleración normativa (fuerzas de inercia relativas): 0.8g frontal, 0.5g lateral/trasero
const LASH_GRAVITY = 9.81;

function computeLashing(placed, params){
  const p = Object.assign({}, state.lashing, params||{});
  const byDest={};
  for(const it of placed) (byDest[it.destination||'—']=byDest[it.destination||'—']||[]).push(it);
  const groups=[];
  const sin=Math.sin(p.angle*Math.PI/180);
  for(const [dest, items] of Object.entries(byDest)){
    const m = items.reduce((s,x)=>s+x.weight, 0);
    const W = m*LASH_GRAVITY; // N
    const Fx = Math.max(0, W*(p.cFwd - p.mu));   // N, forward
    const Fy = Math.max(0, W*(p.cLat - p.mu));   // N, lateral
    const FxDaN = Fx/10, FyDaN = Fy/10;
    const denom = 2*p.mu*p.STF*sin;   // friction lashing capacity per strap (daN)
    const nFric = denom>0?Math.ceil(Math.max(FxDaN, FyDaN)/denom):0;
    const nDirect = p.LC>0?Math.ceil(FxDaN/(p.LC*Math.cos(30*Math.PI/180))):0;
    const hasFragile = items.some(i=>i.fragile);
    const hasAdr = items.some(i=>i.adr);
    groups.push({dest, items:items.length, mass:m, FxDaN, FyDaN, nFric:Math.max(0,nFric), nDirect:Math.max(0,nDirect), hasFragile, hasAdr});
  }
  const total = placed.reduce((s,x)=>s+x.weight,0);
  const TotalW=total*LASH_GRAVITY;
  return {
    groups,
    mass: total,
    FxDaN: total>0?(TotalW*(p.cFwd-p.mu))/10:0,
    FyDaN: total>0?(TotalW*(p.cLat-p.mu))/10:0,
    params: p
  };
}

// ===== ADR (ADR 2023 · matriz simplificada de segregación) =====
// Mapea clase -> clases incompatibles. Solo casos mas comunes en transporte por carretera.
const ADR_CLASSES = {
  '1':{label:'Explosivos',        color:'#ef4444'},
  '2':{label:'Gases',             color:'#f59e0b'},
  '3':{label:'Liq. inflamables',  color:'#fb923c'},
  '4':{label:'Sol. inflamables',  color:'#fbbf24'},
  '5':{label:'Comburentes',       color:'#facc15'},
  '6':{label:'Tóxicos',           color:'#a78bfa'},
  '7':{label:'Radiactivos',       color:'#22d3ee'},
  '8':{label:'Corrosivos',        color:'#10b981'},
  '9':{label:'Misceláneos',       color:'#64748b'}
};
const ADR_INCOMPATIBLE = {
  '1':['1','2','3','4','5','6','7','8','9'],
  '2':['1','3','5'],
  '3':['1','5','6','8'],
  '4':['1','5','8'],
  '5':['1','2','3','4','6','8'],
  '6':['1','3','5','9'],
  '7':['1','2','3','4','5','6','8','9'],
  '8':['1','3','4','5'],
  '9':['1','6','7']
};
function adrConflict(a,b){
  if(!a||!b||a===b) return false;
  return (ADR_INCOMPATIBLE[a]||[]).includes(String(b));
}

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ============================================================
// PARSING
// ============================================================
function parseBoolean(v){
  if(v==null||v==='') return null;
  const s=String(v).trim().toLowerCase();
  if(['si','sí','s','yes','y','true','1','x','remontable','apilable'].includes(s)) return true;
  if(['no','n','false','0','-','no-remontable','no remontable'].includes(s)) return false;
  return null;
}
function parseNum(v){
  if(v==null||v==='') return null;
  const n=parseFloat(String(v).replace(',','.').replace(/[^\d.-]/g,''));
  return isNaN(n)?null:n;
}
function normalizeType(t){
  const s=(t||'').toString().toLowerCase();
  if(s.includes('eur')) return 'palet_eur';
  if(s.includes('americ')||s.includes('us')) return 'palet_us';
  if(s.includes('palet')||s.includes('pallet')) return 'palet_eur';
  if(s.includes('bobin')||s.includes('coil')) return 'bobina';
  if(s.includes('jaula')||s.includes('cage')) return 'jaula';
  if(s.includes('big')||s.includes('bag')||s.includes('saco')) return 'bigbag';
  return 'caja';
}
function makeItem({ref,type,L,A,H,weight,destination,stackable,fragile,maxTop,adr,noStackTop}){
  if(type==='palet_eur' && (L<100||A<70)){L=120;A=80;}
  if(type==='palet_us' && (L<100||A<80)){L=120;A=100;}
  let a = adr==null?null:String(adr).trim();
  if(a && !ADR_CLASSES[a]) a=null;
  return {
    id: Math.random().toString(36).slice(2,10),
    ref: ref||'', type: type||'caja',
    L:+L, A:+A, H:+H, weight:+weight||0,
    destination: (destination||'').toUpperCase(),
    stackable: stackable!==false,
    fragile: fragile===true,
    maxTop: +maxTop||0,
    noStackTop: noStackTop===true,   // usuario forzó "no puede llevar nada encima"
    adr: a,
    volume: (L*A*H)/1e6
  };
}
function parseTable(rows){
  if(!rows||rows.length<2) return [];
  const headers = rows[0].map(h=>String(h||'').toLowerCase().trim());
  const findCol = (...c)=>{for(const x of c){const i=headers.findIndex(h=>h.includes(x));if(i>=0)return i;}return -1;};
  const iRef=findCol('ref','referen','codigo','código','sku');
  const iType=findCol('tipo','type','unidad');
  const iQty=findCol('cant','qty','quantity','unidades','bultos','palets');
  const iL=findCol('largo','length','l (','long');
  const iA=findCol('ancho','width','a (');
  const iH=findCol('alto','height','h (');
  const iW=findCol('peso','weight','kg');
  const iDest=findCol('destino','dest','delivery','ciudad');
  const iStk=findCol('remontable','stack');
  const iFrag=findCol('fragil','frágil','fragile');
  const iMaxTop=findCol('peso_max','maxtop','max encima');
  const iDims=findCol('dimensiones','medidas');
  const iAdr=findCol('adr','imdg','clase peligr','peligro');
  const out=[];
  for(let r=1;r<rows.length;r++){
    const row=rows[r]; if(!row||row.every(c=>!c&&c!==0)) continue;
    let L=iL>=0?parseNum(row[iL]):null, A=iA>=0?parseNum(row[iA]):null, H=iH>=0?parseNum(row[iH]):null;
    if((!L||!A||!H)&&iDims>=0){
      const m=String(row[iDims]||'').match(/(\d+[,.]?\d*)\s*[x×*]\s*(\d+[,.]?\d*)\s*[x×*]\s*(\d+[,.]?\d*)/i);
      if(m){L=parseFloat(m[1].replace(',','.'));A=parseFloat(m[2].replace(',','.'));H=parseFloat(m[3].replace(',','.'));}
    }
    if(!L||!A||!H) continue;
    const ref=iRef>=0?(row[iRef]||`ITEM-${r}`):`ITEM-${r}`;
    const type=iType>=0?String(row[iType]||'caja').toLowerCase().trim():'caja';
    const qty=iQty>=0?(parseNum(row[iQty])||1):1;
    const w=iW>=0?parseNum(row[iW])||100:100;
    const dest=iDest>=0?String(row[iDest]||'').toUpperCase().trim():'';
    const stk=iStk>=0?parseBoolean(row[iStk]):true;
    const frag=iFrag>=0?parseBoolean(row[iFrag]):false;
    const maxTop=iMaxTop>=0?(parseNum(row[iMaxTop])||0):0;
    let adr=null;
    if(iAdr>=0){
      const v=String(row[iAdr]||'').trim();
      const m=v.match(/([1-9])/); if(m) adr=m[1];
    }
    for(let q=0;q<qty;q++){
      out.push(makeItem({ref:qty>1?`${ref}/${q+1}`:String(ref),type:normalizeType(type),L,A,H,weight:w,destination:dest,stackable:stk!==false,fragile:frag===true,maxTop,adr}));
    }
  }
  return out;
}
function parseFreeText(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const destNames=state.destinations.map(d=>d.name.toUpperCase());
  const out=[];
  for(const line of lines){
    const u=line.toUpperCase();
    const dim=line.match(/(\d+[,.]?\d*)\s*[x×*]\s*(\d+[,.]?\d*)\s*[x×*]\s*(\d+[,.]?\d*)/i);
    if(!dim) continue;
    const L=parseFloat(dim[1].replace(',','.')), A=parseFloat(dim[2].replace(',','.')), H=parseFloat(dim[3].replace(',','.'));
    const wm=line.match(/(\d+[,.]?\d*)\s*kg/i);
    const w=wm?parseFloat(wm[1].replace(',','.')):100;
    let qty=1; const qm=line.match(/(?:^|\s)(\d+)\s*(?:x|palets|cajas|bultos|uds|×)/i); if(qm) qty=parseInt(qm[1]);
    let type='caja';
    if(/palet\s*eur/i.test(line)) type='palet_eur';
    else if(/palet\s*(americ|us)/i.test(line)) type='palet_us';
    else if(/palet|pallet/i.test(line)) type='palet_eur';
    else if(/bobina|coil/i.test(line)) type='bobina';
    else if(/jaula|cage/i.test(line)) type='jaula';
    else if(/big.?bag|saco/i.test(line)) type='bigbag';
    let destination=''; for(const d of destNames){if(u.includes(d)){destination=d;break;}}
    if(!destination){const caps=line.match(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g); if(caps&&caps.length) destination=caps[caps.length-1];}
    const stackable=!/no.?remont|no.?apilab|no.?stack/i.test(u);
    const fragile=/frág|fragi|fragile/i.test(u);
    let adr=null;
    const adrM=line.match(/\bADR\s*(?:clase\s*)?([1-9])\b/i) || line.match(/\bclase\s*([1-9])\s*ADR\b/i);
    if(adrM) adr=adrM[1];
    const ref=line.split(/[\s·,;|]+/)[0];
    for(let q=0;q<qty;q++){
      out.push(makeItem({ref:qty>1?`${ref}/${q+1}`:ref,type,L,A,H,weight:w,destination,stackable,fragile,maxTop:0,adr}));
    }
  }
  return out;
}
function parseCSV(txt){
  const rows=[]; const lines=txt.split(/\r?\n/);
  const sep=(lines[0]||'').split(';').length>(lines[0]||'').split(',').length?';':',';
  for(const line of lines){
    if(!line.trim()) continue;
    const row=[]; let cur='',inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){inQ=!inQ;continue;}
      if(c===sep && !inQ){row.push(cur);cur='';continue;}
      cur+=c;
    }
    row.push(cur); rows.push(row);
  }
  return rows;
}

// ============================================================
// GRASP OPTIMIZER
// ============================================================
function getOrientations(it){
  const fullRot = (it.type==='caja');
  const L=it.L, A=it.A, H=it.H;
  if(fullRot){
    return [
      {dx:L,dy:H,dz:A,label:'0'},{dx:A,dy:H,dz:L,label:'90z'},
      {dx:L,dy:A,dz:H,label:'90x'},{dx:H,dy:A,dz:L,label:'90x90z'},
      {dx:A,dy:L,dz:H,label:'90y'},{dx:H,dy:L,dz:A,label:'90y90z'}
    ];
  }
  return [{dx:L,dy:H,dz:A,label:'0'},{dx:A,dy:H,dz:L,label:'90z'}];
}
function fitsInTruck(b,t){
  return b.x>=-1e-6 && b.z>=-1e-6 && b.y>=-1e-6 &&
    b.x+b.L<=t.L+1e-6 && b.z+b.A<=t.A+1e-6 && b.y+b.H<=t.H+1e-6;
}
function overlaps(a,b){
  return !(a.x+a.L<=b.x+1e-6||b.x+b.L<=a.x+1e-6||a.z+a.A<=b.z+1e-6||b.z+b.A<=a.z+1e-6||a.y+a.H<=b.y+1e-6||b.y+b.H<=a.y+1e-6);
}
function computeSupport(box, placed){
  const baseArea = box.L * box.A;
  if(Math.abs(box.y)<1e-6) return {supported:true,reason:'floor',supporters:[]};
  const supporters=[]; let supportedArea=0;
  for(const p of placed){
    if(Math.abs((p.y+p.H)-box.y)>1e-3) continue;
    const ox=Math.max(0,Math.min(p.x+p.L,box.x+box.L)-Math.max(p.x,box.x));
    const oz=Math.max(0,Math.min(p.z+p.A,box.z+box.A)-Math.max(p.z,box.z));
    if(ox<=0||oz<=0) continue;
    supporters.push(p); supportedArea+=ox*oz;
  }
  if(supportedArea/baseArea<0.7) return {supported:false};
  for(const s of supporters){
    if(!s.stackable||s.fragile) return {supported:false};
    if(s.noStackTop) return {supported:false};
    if(s.maxTop>0 && box.weight>s.maxTop) return {supported:false};
    if(box.adr && s.adr && adrConflict(box.adr,s.adr)) return {supported:false};
  }
  return {supported:true,supporters};
}
function projectY(p,placed){
  let yMin=0;
  for(const b of placed){
    if(p.x>=b.x-1e-6 && p.x<b.x+b.L-1e-6 && p.z>=b.z-1e-6 && p.z<b.z+b.A-1e-6){
      const top=b.y+b.H; if(top>yMin) yMin=top;
    }
  }
  return yMin;
}
function computeExtremePoints(placed, xStart){
  const eps=[{x:xStart,y:0,z:0}];
  for(const p of placed){
    const cs=[{x:p.x+p.L,y:p.y,z:p.z},{x:p.x,y:p.y,z:p.z+p.A},{x:p.x,y:p.y+p.H,z:p.z}];
    for(const c of cs){c.y=projectY(c,placed); c.x=Math.max(xStart,c.x); eps.push(c);}
  }
  const seen=new Set();
  return eps.filter(e=>{const k=`${Math.round(e.x*10)}|${Math.round(e.y*10)}|${Math.round(e.z*10)}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function mulberry32(seed){let a=seed|0;return function(){a=(a+0x6D2B79F5)|0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}

function packGroupGRASP(group, truck, startX, destName, opts, randSeed){
  const placed=[], unloaded=[];
  const rng=mulberry32(randSeed);
  const items=[...group].sort((a,b)=>{if(Math.abs(b.volume-a.volume)>0.01)return b.volume-a.volume;return b.weight-a.weight;});
  for(const it of items){
    const eps=computeExtremePoints(placed,startX);
    const orientations=getOrientations(it);
    const candidates=[];
    for(const ep of eps){
      for(const ori of orientations){
        const box={x:ep.x,y:ep.y,z:ep.z,L:ori.dx,A:ori.dz,H:ori.dy,weight:it.weight,stackable:it.stackable,fragile:it.fragile,maxTop:it.maxTop,noStackTop:it.noStackTop,adr:it.adr,orientation:ori.label};
        if(!fitsInTruck(box,truck)) continue;
        let ok=true; for(const p of placed){if(overlaps(box,p)){ok=false;break;}} if(!ok) continue;
        const sup=computeSupport(box,placed); if(!sup.supported) continue;
        const score=box.y*1000+(box.x-startX)*10+box.z;
        candidates.push({box,score,sup});
      }
    }
    if(!candidates.length){unloaded.push(it); continue;}
    candidates.sort((a,b)=>a.score-b.score);
    const alpha=opts.perturbation||0;
    let pick;
    if(alpha<=0) pick=candidates[0];
    else{
      const best=candidates[0].score, worst=candidates[candidates.length-1].score;
      const thr=best+alpha*(worst-best);
      const rcl=candidates.filter(c=>c.score<=thr);
      pick=rcl[Math.floor(rng()*rcl.length)];
    }
    const b=pick.box;
    placed.push({...it,x:b.x,y:b.y,z:b.z,L:b.L,A:b.A,H:b.H,rotated:b.orientation!=='0',orientation:b.orientation,destination:destName,supporters:(pick.sup.supporters||[]).map(s=>s.id),stackedOn:(pick.sup.supporters||[]).map(s=>s.id).join(',')||null});
  }
  let nextX=startX; for(const p of placed) if(p.x+p.L>nextX) nextX=p.x+p.L;
  return {placed,unloaded,nextX};
}

function groupAdrClasses(group){
  const s=new Set(); for(const it of (group||[])) if(it.adr) s.add(it.adr); return [...s];
}
function groupsConflict(a,b){
  const ca=groupAdrClasses(a), cb=groupAdrClasses(b);
  for(const x of ca) for(const y of cb) if(adrConflict(x,y)) return true;
  return false;
}

async function optimize(items, truck, destinations, levelKey, progressCb){
  const opts=OPT_LEVELS[levelKey];
  const destOrder=destinations.map(d=>d.name.toUpperCase());
  const byDest={}; const unknown=[];
  for(const it of items){
    const d=(it.destination||'').toUpperCase();
    if(destOrder.includes(d)){(byDest[d]=byDest[d]||[]).push(it);}else{unknown.push(it);}
  }
  if(unknown.length) byDest['_UNKNOWN_']=unknown;

  // Orden de carga segun metodo. x=0 es el FONDO (primera posicion cargada);
  // LIFO -> el destino que se entrega primero debe cargarse el ULTIMO
  // (queda cerca de la puerta, es decir, con mayor x, entra al final).
  let loadOrder;
  const method=state.loadingMethod||'lifo';
  if(method==='lifo')      loadOrder=[...destOrder].reverse();
  else if(method==='fifo') loadOrder=[...destOrder];
  else if(method==='manual') loadOrder=[...destOrder]; // el usuario re-ordena en UI
  else if(method==='weight'){
    // Destinos con mas kg primero (al fondo, para lastre bajo)
    const kg={}; for(const d of destOrder) kg[d]=(byDest[d]||[]).reduce((s,it)=>s+it.weight,0);
    loadOrder=[...destOrder].sort((a,b)=>kg[b]-kg[a]);
  } else loadOrder=[...destOrder];
  if(byDest['_UNKNOWN_']) loadOrder.unshift('_UNKNOWN_');

  const sepDest=Math.max(0,+state.separation.dest||0);
  const sepAdr =Math.max(0,+state.separation.adr ||0);

  let best=null, bestScore=-Infinity;
  for(let iter=0;iter<opts.iters;iter++){
    const allPlaced=[], allUnloaded=[]; let cursorX=0;
    let prevGroup=null;
    for(const destName of loadOrder){
      const group=byDest[destName]; if(!group||!group.length) continue;
      // Gap entre grupos: separacion destino o mayor si hay incompatibilidad ADR
      if(prevGroup){
        const gap = groupsConflict(prevGroup,group) ? Math.max(sepDest,sepAdr) : sepDest;
        cursorX += gap;
      }
      if(method==='weight'){
        // Dentro del grupo, forzar pesado-primero (fondo/abajo)
        group.sort((a,b)=>b.weight-a.weight);
      }
      const seed=Math.floor(Math.random()*1e9)+iter*7919;
      const r=packGroupGRASP(group,truck,cursorX,destName,opts,seed);
      allPlaced.push(...r.placed); allUnloaded.push(...r.unloaded); cursorX=r.nextX;
      prevGroup=group;
    }
    let totalW=allPlaced.reduce((s,p)=>s+p.weight,0);
    if(totalW>truck.maxKg){
      allPlaced.sort((a,b)=>{if(Math.abs(b.x-a.x)>1e-3)return b.x-a.x; return b.y-a.y;});
      while(allPlaced.length && allPlaced.reduce((s,p)=>s+p.weight,0)>truck.maxKg) allUnloaded.push(allPlaced.pop());
    }
    const volPlaced=allPlaced.reduce((s,p)=>s+(p.L*p.A*p.H),0);
    let spanX=0; for(const p of allPlaced) if(p.x+p.L>spanX) spanX=p.x+p.L;
    const score=volPlaced-spanX*100-allUnloaded.length*1e7;
    if(score>bestScore){bestScore=score; best={placed:allPlaced,unloaded:allUnloaded,spanX,iter};}
    if(progressCb && (iter%Math.max(1,Math.floor(opts.iters/50))===0||iter===opts.iters-1)){
      const pct=((iter+1)/opts.iters)*100;
      progressCb(pct*(opts.localSearch?0.7:1), `Iteración ${iter+1}/${opts.iters} · mejor: ${best.placed.length}/${items.length}`);
      await sleep(0);
    }
  }

  if(opts.localSearch && best){
    const lsIters=opts.lsIters||50;
    for(let i=0;i<lsIters;i++){
      let improved=false;
      best.placed.sort((a,b)=>a.y-b.y||a.x-b.x||a.z-b.z);
      for(const p of best.placed){
        const newY=projectY({x:p.x+p.L/2,z:p.z+p.A/2},best.placed.filter(q=>q!==p && q.y<p.y));
        if(newY<p.y-0.1){
          const test={...p,y:newY};
          const sup=computeSupport(test,best.placed.filter(q=>q!==p));
          if(sup.supported){
            let coll=false; for(const q of best.placed){if(q===p)continue;if(overlaps(test,q)){coll=true;break;}}
            if(!coll){p.y=newY; improved=true;}
          }
        }
      }
      if(best.unloaded.length){
        const toTry=best.unloaded.slice();
        for(const ul of toTry){
          const eps=computeExtremePoints(best.placed,0);
          const orientations=getOrientations(ul);
          let bestCand=null, bestSc=Infinity;
          for(const ep of eps) for(const ori of orientations){
            const box={x:ep.x,y:ep.y,z:ep.z,L:ori.dx,A:ori.dz,H:ori.dy,weight:ul.weight,stackable:ul.stackable,fragile:ul.fragile,maxTop:ul.maxTop,noStackTop:ul.noStackTop,adr:ul.adr,orientation:ori.label};
            if(!fitsInTruck(box,truck)) continue;
            let coll=false; for(const p of best.placed){if(overlaps(box,p)){coll=true;break;}} if(coll) continue;
            const sup=computeSupport(box,best.placed); if(!sup.supported) continue;
            const sc=box.y*1000+box.x*10+box.z;
            if(sc<bestSc){bestSc=sc; bestCand={box,sup};}
          }
          if(bestCand){
            const newP={...ul,x:bestCand.box.x,y:bestCand.box.y,z:bestCand.box.z,L:bestCand.box.L,A:bestCand.box.A,H:bestCand.box.H,rotated:bestCand.box.orientation!=='0',orientation:bestCand.box.orientation,supporters:(bestCand.sup.supporters||[]).map(s=>s.id)};
            const newW=best.placed.reduce((s,p)=>s+p.weight,0)+ul.weight;
            if(newW<=truck.maxKg){
              best.placed.push(newP);
              best.unloaded=best.unloaded.filter(x=>x.id!==ul.id);
              improved=true;
            }
          }
        }
      }
      if(!improved) break;
      if(progressCb && i%Math.max(1,Math.floor(lsIters/20))===0){
        progressCb(70+((i+1)/lsIters)*30, `Refinamiento local ${i+1}/${lsIters}`); await sleep(0);
      }
    }
  }

  best.placed.sort((a,b)=>{if(Math.abs(b.x-a.x)>1e-3)return b.x-a.x; if(Math.abs(a.z-b.z)>1e-3)return a.z-b.z; return a.y-b.y;});
  best.placed.forEach((p,i)=>p.loadSeq=i+1);
  return {placed:best.placed, unloaded:best.unloaded, meta:{iterations:opts.iters,bestIter:best.iter,level:levelKey,timestamp:new Date().toISOString()}};
}

// ============================================================
// METRICS
// ============================================================
function computeMetrics(placed, truck){
  const totalVol=placed.reduce((s,p)=>s+(p.L*p.A*p.H)/1e6,0);
  const totalW=placed.reduce((s,p)=>s+p.weight,0);
  const truckVol=(truck.L*truck.A*truck.H)/1e6;
  let lmMax=0; for(const p of placed) if(p.x+p.L>lmMax) lmMax=p.x+p.L;
  const lm=lmMax/100;
  let momentX=0, momentY=0, momentZ=0;
  for(const p of placed){
    momentX+=p.weight*(p.x+p.L/2);
    momentY+=p.weight*(p.y+p.H/2);
    momentZ+=p.weight*(p.z+p.A/2 - truck.A/2);
  }
  const cogX=totalW>0?momentX/totalW:truck.L/2;
  const cogY=totalW>0?momentY/totalW:truck.H/3;
  const cogZ=totalW>0?momentZ/totalW:0; // centrado en 0 (eje central lateral)
  const frontRatio=1-Math.max(0,Math.min(1,cogX/truck.L));
  // Envolvente admisible de CoG X
  const env=state.cogEnvelope||{xMin:0.2,xMax:0.7,zHalf:0.35};
  const cogXFrac=cogX/truck.L;
  const cogZFrac=cogZ/(truck.A/2);
  const cogOk=(cogXFrac>=env.xMin && cogXFrac<=env.xMax && Math.abs(cogZFrac)<=env.zHalf && cogY<=truck.H*0.55);
  return {totalVol,truckVol,volPct:truckVol>0?totalVol/truckVol*100:0,totalW,weightPct:totalW/truck.maxKg*100,lm,lmPct:lm/(truck.L/100)*100,cogX,cogY,cogZ,cogXFrac,cogZFrac,cogOk,frontKg:totalW*frontRatio,rearKg:totalW*(1-frontRatio),itemsPlaced:placed.length};
}

// ============================================================
// THREE.JS VIEWER
// ============================================================
let scene, camera, renderer, truckMesh, itemMeshes=[];
let controls = {x:-30,y:-25,zoom:1,targetX:-30,targetY:-25,targetZoom:1,panX:0,panY:0,targetPanX:0,targetPanY:0};
let isDragging=false, lastMouse={x:0,y:0};

function initThree(){
  const canvas=$('canvas');
  const rect=canvas.parentElement.getBoundingClientRect();
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(rect.width,rect.height);
  renderer.setClearColor(0x000000,0);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(35, rect.width/rect.height, 0.1, 1000);
  scene.add(new THREE.AmbientLight(0xffffff,0.55));
  const d1=new THREE.DirectionalLight(0xffffff,0.7); d1.position.set(5,10,7); scene.add(d1);
  const d2=new THREE.DirectionalLight(0xff6b1a,0.2); d2.position.set(-8,3,-5); scene.add(d2);

  const grid=new THREE.GridHelper(40,80,0x3a3a3a,0x252525);
  grid.position.y=-0.01; scene.add(grid);

  let pressPos=null, pressTime=0;
  canvas.addEventListener('mousedown',e=>{isDragging=true; lastMouse={x:e.clientX,y:e.clientY}; pressPos={x:e.clientX,y:e.clientY}; pressTime=Date.now();});
  window.addEventListener('mouseup',e=>{
    if(pressPos){
      const mv=Math.hypot(e.clientX-pressPos.x, e.clientY-pressPos.y);
      if(mv<5 && Date.now()-pressTime<400) handleCanvasTap(e.clientX, e.clientY);
    }
    pressPos=null; isDragging=false;
  });
  canvas.addEventListener('mousemove',e=>{
    if(!isDragging) return;
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    if(e.shiftKey){controls.targetPanX+=dx*0.02; controls.targetPanY+=dy*0.02;}
    else{controls.targetX+=dx*0.5; controls.targetY+=dy*0.5; controls.targetY=Math.max(-89,Math.min(89,controls.targetY));}
    lastMouse={x:e.clientX,y:e.clientY};
  });
  canvas.addEventListener('wheel',e=>{e.preventDefault(); controls.targetZoom*=(1-e.deltaY*0.001); controls.targetZoom=Math.max(0.2,Math.min(5,controls.targetZoom));});
  // Touch: drag + tap + pinch-zoom
  let tPressPos=null, tPressTime=0, tActive=false, lastTouch=null;
  let pinchDist=0;
  canvas.addEventListener('touchstart',e=>{
    if(e.touches.length===2){
      const a=e.touches[0], b=e.touches[1];
      pinchDist=Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
      tActive=false; tPressPos=null;
    } else if(e.touches.length===1){
      const t=e.touches[0]; tActive=true; lastTouch={x:t.clientX,y:t.clientY};
      tPressPos={x:t.clientX,y:t.clientY}; tPressTime=Date.now();
    }
  },{passive:true});
  canvas.addEventListener('touchmove',e=>{
    if(e.touches.length===2){
      e.preventDefault();
      const a=e.touches[0], b=e.touches[1];
      const d=Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
      if(pinchDist>0){
        const ratio=d/pinchDist;
        controls.targetZoom*=ratio;
        controls.targetZoom=Math.max(0.2, Math.min(5, controls.targetZoom));
      }
      pinchDist=d;
    } else if(tActive && e.touches.length===1){
      const t=e.touches[0];
      const dx=t.clientX-lastTouch.x, dy=t.clientY-lastTouch.y;
      controls.targetX+=dx*0.5; controls.targetY+=dy*0.5; controls.targetY=Math.max(-89,Math.min(89,controls.targetY));
      lastTouch={x:t.clientX,y:t.clientY};
    }
  },{passive:false});
  canvas.addEventListener('touchend',e=>{
    if(e.touches.length<2) pinchDist=0;
    if(tPressPos){
      const ct=(e.changedTouches&&e.changedTouches[0])||null;
      if(ct){
        const mv=Math.hypot(ct.clientX-tPressPos.x, ct.clientY-tPressPos.y);
        if(mv<8 && Date.now()-tPressTime<400 && e.touches.length===0) handleCanvasTap(ct.clientX, ct.clientY);
      }
    }
    if(e.touches.length===0){tActive=false; tPressPos=null;}
  });
  window.addEventListener('resize',()=>{const r=canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width,r.height); camera.aspect=r.width/r.height; camera.updateProjectionMatrix();});

  buildTruckMesh();
  animate();
}

function animate(){
  requestAnimationFrame(animate);
  controls.x+=(controls.targetX-controls.x)*0.08;
  controls.y+=(controls.targetY-controls.y)*0.08;
  controls.zoom+=(controls.targetZoom-controls.zoom)*0.08;
  controls.panX+=(controls.targetPanX-controls.panX)*0.1;
  controls.panY+=(controls.targetPanY-controls.panY)*0.1;
  const truck=TRUCKS[state.truck];
  const lmCam=truck.L/100;
  const radius=Math.max(12,lmCam*1.4)/controls.zoom;
  const yaw=controls.x*Math.PI/180, pitch=controls.y*Math.PI/180;
  const tX=lmCam/2+controls.panX, tY=truck.H/200+controls.panY, tZ=0;
  camera.position.x=radius*Math.cos(pitch)*Math.sin(yaw)+tX;
  camera.position.y=-radius*Math.sin(pitch)+tY;
  camera.position.z=radius*Math.cos(pitch)*Math.cos(yaw)+tZ;
  camera.lookAt(tX,tY,tZ);
  renderer.render(scene,camera);
}

function clearItemMeshes(){
  for(const m of itemMeshes){scene.remove(m); m.traverse(o=>{if(o.geometry)o.geometry.dispose(); if(o.material){if(Array.isArray(o.material))o.material.forEach(mm=>mm.dispose()); else o.material.dispose();}});}
  itemMeshes=[];
}

function buildTruckMesh(){
  if(truckMesh){scene.remove(truckMesh);}
  truckMesh=new THREE.Group();
  const t=TRUCKS[state.truck];
  const L=t.L/100, A=t.A/100, H=t.H/100;
  const accent=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#ff6b1a';
  const accCol=new THREE.Color(accent);
  const box=new THREE.BoxGeometry(L,H,A);
  const edges=new THREE.EdgesGeometry(box);
  const lines=new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color:accCol,transparent:true,opacity:0.65}));
  lines.position.set(L/2,H/2,0);
  truckMesh.add(lines);

  const floor=new THREE.Mesh(new THREE.PlaneGeometry(L,A), new THREE.MeshBasicMaterial({color:0x1a1a1a,transparent:true,opacity:0.35,side:THREE.DoubleSide}));
  floor.rotation.x=-Math.PI/2; floor.position.set(L/2,0.001,0);
  truckMesh.add(floor);

  const cab=new THREE.Mesh(new THREE.BoxGeometry(0.1,H*0.7,A*0.9), new THREE.MeshBasicMaterial({color:accCol,transparent:true,opacity:0.12}));
  cab.position.set(-0.05,H*0.35,0);
  truckMesh.add(cab);

  scene.add(truckMesh);
}

function buildItemMeshes(placed){
  clearItemMeshes();
  const t=TRUCKS[state.truck]; const A=t.A/100;
  for(let i=0;i<placed.length;i++){
    const it=placed[i];
    const dx=it.L/100, dy=it.H/100, dz=it.A/100;
    const col=new THREE.Color(destColorFor(it.destination));
    let mat;
    const opacity = state.transparent?0.35:(it.fragile?0.65:(state.boxStyle==='glass'?0.55:0.88));
    if(state.boxStyle==='wire'){
      mat=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.15});
    } else {
      mat=new THREE.MeshLambertMaterial({color:col,transparent:true,opacity});
    }
    const geo=new THREE.BoxGeometry(dx,dy,dz);
    const mesh=new THREE.Mesh(geo,mat);
    const explOff = state.exploded?i*0.04:0;
    mesh.position.set(it.x/100+dx/2, it.y/100+dy/2+explOff, it.z/100-A/2+dz/2);
    const isSel = state.selectedItem && state.selectedItem.id===it.id;
    // Bordes: seleccionado blanco; ADR color de clase; noStackTop rojo; resto por defecto
    let edgeCol=isSel?0xffffff:(state.boxStyle==='wire'?0xffffff:0x0a0a0a);
    let edgeOp =isSel?1:(state.boxStyle==='wire'?0.85:0.5);
    let edgeW=1;
    if(it.noStackTop){edgeCol=0xff4d5e; edgeOp=0.95; edgeW=2;}
    else if(it.adr && ADR_CLASSES[it.adr]){edgeCol=new THREE.Color(ADR_CLASSES[it.adr].color).getHex(); edgeOp=0.9; edgeW=2;}
    const edgesLine=new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:edgeCol,transparent:true,opacity:edgeOp,linewidth:edgeW}));
    mesh.add(edgesLine);
    if(isSel){
      // Halo amarillo bajo el bulto para resaltar en móvil donde linewidth no aplica
      const halo=new THREE.Mesh(new THREE.PlaneGeometry(dx+0.25,dz+0.25), new THREE.MeshBasicMaterial({color:0xfbbf24,transparent:true,opacity:0.35,side:THREE.DoubleSide}));
      halo.rotation.x=-Math.PI/2; halo.position.set(0,-dy/2+0.005,0); mesh.add(halo);
    }
    if(it.fragile){
      const warn=new THREE.Mesh(new THREE.SphereGeometry(0.09,12,12), new THREE.MeshBasicMaterial({color:0xff4d5e}));
      warn.position.set(0,dy/2+0.08,0); mesh.add(warn);
    }
    if(it.adr && ADR_CLASSES[it.adr]){
      // Rombo ADR grande sobre el bulto
      const chip=makeAdrLabel(it.adr);
      chip.position.set(0,dy/2+0.35,0); mesh.add(chip);
    }
    if(it.noStackTop){
      // Aspa roja grande sobre el techo
      const x=makeNoStackMark();
      x.position.set(0,dy/2+0.015,0); mesh.add(x);
    }
    if(placed.length<=120){
      const label=makeSmallLabel(`${it.loadSeq}`);
      label.position.set(0,dy/2+(it.adr?0.62:0.18),0); mesh.add(label);
    }
    mesh.userData={item:it};
    scene.add(mesh); itemMeshes.push(mesh);
  }
  buildCoGMarker();
  buildLashingViz();
}

function makeAdrLabel(cls){
  const info=ADR_CLASSES[cls]||{label:'ADR',color:'#ef4444'};
  const c=document.createElement('canvas'); c.width=256; c.height=256;
  const ctx=c.getContext('2d');
  // Romboide ADR grande, bien contrastado
  ctx.save();
  ctx.translate(128,128); ctx.rotate(Math.PI/4);
  ctx.fillStyle=info.color; ctx.fillRect(-92,-92,184,184);
  ctx.strokeStyle='#0a0a0a'; ctx.lineWidth=12; ctx.strokeRect(-92,-92,184,184);
  // Borde blanco interior
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=4; ctx.strokeRect(-80,-80,160,160);
  ctx.restore();
  // Numero grande
  ctx.fillStyle='#0a0a0a'; ctx.font='bold 96px "JetBrains Mono",monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(cls,128,150);
  // Etiqueta "ADR"
  ctx.font='bold 28px "Space Grotesk",sans-serif';
  ctx.fillText('ADR',128,72);
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.renderOrder=999;
  sp.scale.set(0.55,0.55,1);
  return sp;
}

function makeNoStackMark(){
  const c=document.createElement('canvas'); c.width=128; c.height=128;
  const ctx=c.getContext('2d');
  // Circulo rojo con aspa
  ctx.fillStyle='rgba(255,77,94,0.88)'; ctx.beginPath(); ctx.arc(64,64,52,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=10; ctx.stroke();
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=12; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(36,36); ctx.lineTo(92,92); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(92,36); ctx.lineTo(36,92); ctx.stroke();
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.renderOrder=998;
  sp.scale.set(0.4,0.4,1);
  return sp;
}

let cogGroup=null;
function clearCoGMarker(){
  if(cogGroup){
    scene.remove(cogGroup);
    cogGroup.traverse(o=>{if(o.geometry)o.geometry.dispose(); if(o.material){if(Array.isArray(o.material))o.material.forEach(mm=>mm.dispose()); else o.material.dispose();}});
    cogGroup=null;
  }
}
function buildCoGMarker(){
  clearCoGMarker();
  if(!state.showCoG||!state.placed.length) return;
  const t=TRUCKS[state.truck];
  const m=computeMetrics(state.placed,t);
  const L=t.L/100, H=t.H/100, A=t.A/100;
  cogGroup=new THREE.Group();
  // Envolvente admisible: plano translucido relleno + borde
  const env=state.cogEnvelope;
  const envL=L*(env.xMax-env.xMin);
  const envA=A*2*env.zHalf;
  const envCx=L*(env.xMin+env.xMax)/2;
  const envPlane=new THREE.Mesh(new THREE.PlaneGeometry(envL, envA), new THREE.MeshBasicMaterial({color:0x10b981,transparent:true,opacity:0.18,side:THREE.DoubleSide,depthWrite:false}));
  envPlane.rotation.x=-Math.PI/2; envPlane.position.set(envCx, 0.012, 0);
  cogGroup.add(envPlane);
  const envEdge=new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(envL, envA)),
    new THREE.LineBasicMaterial({color:0x10b981,transparent:true,opacity:0.9})
  );
  envEdge.rotation.x=-Math.PI/2; envEdge.position.set(envCx, 0.014, 0);
  cogGroup.add(envEdge);
  // Cruz en planta ancha
  const cogCol=m.cogOk?0x10b981:0xff4d5e;
  const cx=m.cogX/100, cz=m.cogZ/100, cy=m.cogY/100;
  const crossLen=Math.min(1.2, L*0.12);
  const crossMat=new THREE.LineBasicMaterial({color:cogCol,transparent:true,opacity:0.95});
  const crossGeo1=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx-crossLen,0.03,cz),new THREE.Vector3(cx+crossLen,0.03,cz)]);
  const crossGeo2=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx,0.03,cz-crossLen),new THREE.Vector3(cx,0.03,cz+crossLen)]);
  cogGroup.add(new THREE.Line(crossGeo1,crossMat));
  cogGroup.add(new THREE.Line(crossGeo2,crossMat));
  // Anillo en la base bajo el CoG para resaltar
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.18,0.24,32), new THREE.MeshBasicMaterial({color:cogCol,transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2; ring.position.set(cx,0.022,cz); cogGroup.add(ring);
  // Esfera en el CoG real (altura)
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(0.16,16,16), new THREE.MeshBasicMaterial({color:cogCol,transparent:true,opacity:0.95,depthTest:false}));
  sphere.renderOrder=997;
  sphere.position.set(cx,cy,cz); cogGroup.add(sphere);
  // Vertical plomada
  const plumb=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx,0.03,cz),new THREE.Vector3(cx,cy,cz)]);
  cogGroup.add(new THREE.Line(plumb, new THREE.LineBasicMaterial({color:cogCol,transparent:true,opacity:0.6})));
  // Etiqueta "CdG"
  const label=makeCoGLabel(m.cogOk);
  label.position.set(cx,cy+0.35,cz); cogGroup.add(label);
  scene.add(cogGroup);
}

function makeCoGLabel(ok){
  const c=document.createElement('canvas'); c.width=160; c.height=80;
  const ctx=c.getContext('2d');
  ctx.fillStyle=ok?'rgba(16,185,129,0.95)':'rgba(255,77,94,0.95)';
  ctx.fillRect(4,4,152,72);
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=3; ctx.strokeRect(4,4,152,72);
  ctx.fillStyle='#0a0a0a'; ctx.font='bold 38px "Space Grotesk",sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('CdG',80,40);
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.renderOrder=1000;
  sp.scale.set(0.7,0.35,1);
  return sp;
}

function makeSmallLabel(text){
  const c=document.createElement('canvas'); c.width=128;c.height=64;
  const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(255,255,255,0.95)';
  const w=Math.max(40, 14*String(text).length+24);
  ctx.fillRect((128-w)/2,14,w,36);
  ctx.strokeStyle='#0a0a0a'; ctx.lineWidth=2; ctx.strokeRect((128-w)/2,14,w,36);
  ctx.fillStyle='#0a0a0a'; ctx.font='bold 32px "Space Grotesk",sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,64,33);
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.renderOrder=996;
  sp.scale.set(0.44,0.22,1);
  return sp;
}

function destColorFor(name){
  const dn=(name||'').toUpperCase();
  const d=state.destinations.find(x=>x.name.toUpperCase()===dn);
  return d?d.color:'#666666';
}

// ===== Raycast selección =====
const _raycaster=new THREE.Raycaster();
const _ndc=new THREE.Vector2();
function handleCanvasTap(clientX, clientY){
  if(!itemMeshes.length) return;
  const canvas=$('canvas'); const rect=canvas.getBoundingClientRect();
  _ndc.x=((clientX-rect.left)/rect.width)*2-1;
  _ndc.y=-((clientY-rect.top)/rect.height)*2+1;
  _raycaster.setFromCamera(_ndc, camera);
  const hits=_raycaster.intersectObjects(itemMeshes, false);
  if(hits.length){
    const it=hits[0].object.userData.item;
    state.selectedItem=(state.selectedItem && state.selectedItem.id===it.id) ? null : it;
    buildItemMeshes(state.placed); renderSequenceTable();
    if(state.selectedItem) openItemDetails(state.selectedItem); else closeItemDetails();
  } else {
    state.selectedItem=null; buildItemMeshes(state.placed); renderSequenceTable(); closeItemDetails();
  }
}

function selectItemById(id){
  const it=state.placed.find(p=>p.id===id); if(!it) return;
  state.selectedItem=it; buildItemMeshes(state.placed); renderSequenceTable(); openItemDetails(it);
}

// ===== Item detail panel =====
function closeItemDetails(){ const el=$('itemDetail'); if(el) el.style.display='none'; }
function openItemDetails(it){
  const el=$('itemDetail'); if(!el) return;
  el.style.display='block';
  const col=destColorFor(it.destination);
  $('idColor').style.background=col;
  $('idDest').textContent=it.destination||'—';
  $('idRef').textContent=it.ref||'(sin ref)';
  const seq=it.loadSeq!=null?`#${String(it.loadSeq).padStart(3,'0')}`:'—';
  $('idSeq').textContent=seq;
  $('idType').textContent=it.type||'—';
  $('idDim').textContent=`${it.L}×${it.A}×${it.H} cm${it.rotated?' (R)':''}`;
  $('idKg').textContent=`${Math.round(it.weight).toLocaleString()} kg`;
  $('idPos').textContent=`x ${Math.round(it.x)} · y ${Math.round(it.y)} · z ${Math.round(it.z)} cm`;
  const sup=(it.supporters&&it.supporters.length)?`${it.supporters.length} apoyo${it.supporters.length>1?'s':''}`:(it.y<1?'suelo':'—');
  $('idSup').textContent=sup;
  // Stack chips + actions
  const chips=$('idStackChips');
  const cc=[];
  cc.push(it.stackable?'<span class="id-chip ok">Remontable</span>':'<span class="id-chip bad">No remontable</span>');
  if(it.fragile) cc.push('<span class="id-chip warn">Frágil</span>');
  if(it.noStackTop) cc.push('<span class="id-chip bad">No apilar encima</span>');
  if(it.maxTop>0) cc.push(`<span class="id-chip">máx. encima ${it.maxTop} kg</span>`);
  chips.innerHTML=cc.join('');
  const acts=$('idStackActions');
  acts.innerHTML=`
    <button class="id-btn" data-act="toggleNoTop">${it.noStackTop?'Permitir apilar encima':'Bloquear apilado encima'}</button>
    <button class="id-btn" data-act="toggleStack">${it.stackable?'Marcar no remontable':'Marcar remontable'}</button>
  `;
  acts.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>applyItemAction(it.id,b.dataset.act)));
  // ADR
  const adrSec=$('idAdrSection');
  if(it.adr && ADR_CLASSES[it.adr]){
    adrSec.style.display='block';
    const info=ADR_CLASSES[it.adr];
    $('idAdr').innerHTML=`<div class="id-adr-dia" style="background:${info.color}"><span style="transform:rotate(-45deg)">${it.adr}</span></div><div class="id-adr-txt">ADR clase ${it.adr}<small>${info.label}</small></div>`;
    // Conflictos con otros bultos del camion
    const neighbors=state.placed.filter(p=>p.id!==it.id && p.adr);
    const conflicts=neighbors.filter(p=>adrConflict(it.adr, p.adr));
    const compl=$('idCompl');
    if(!neighbors.length) compl.innerHTML='<span class="ok">✓ Único ADR en el camión</span>';
    else if(conflicts.length){
      const classes=[...new Set(conflicts.map(c=>c.adr))].sort();
      compl.innerHTML=`<span class="bad">✗ ${conflicts.length} bulto${conflicts.length>1?'s':''} con clases incompatibles: ${classes.join(', ')}</span><br><span class="ok">Mantén la separación configurada (${state.separation.adr} cm)</span>`;
    } else {
      const classes=[...new Set(neighbors.map(c=>c.adr))].sort();
      compl.innerHTML=`<span class="ok">✓ Compatible con clases presentes: ${classes.join(', ')}</span>`;
    }
  } else {
    adrSec.style.display='none';
  }
}

function applyItemAction(id, act){
  const p=state.placed.find(x=>x.id===id);
  const src=state.items.find(x=>x.id===id);
  if(!p) return;
  if(act==='toggleNoTop'){
    p.noStackTop=!p.noStackTop;
    if(src) src.noStackTop=p.noStackTop;
  } else if(act==='toggleStack'){
    p.stackable=!p.stackable;
    if(src) src.stackable=p.stackable;
  }
  state.selectedItem=p;
  buildItemMeshes(state.placed);
  openItemDetails(p);
  updateKPIs();
  $('statusText').textContent='✎ Flag actualizado — re-optimiza para recalcular la estiba';
}

// ===== Propuestas alternativas =====
async function runProposals(){
  if(!state.items.length){$('statusText').textContent='Sin bultos para proponer'; return;}
  $('propModal').classList.add('open');
  $('propGrid').innerHTML='<div class="prop-running">Generando variantes… (puede tardar ~10s)</div>';
  $('propStatus').textContent='';
  const truck=TRUCKS[state.truck];
  const savedMethod=state.loadingMethod;
  const savedSepDest=state.separation.dest;
  const savedSepAdr=state.separation.adr;
  const variants=[
    {name:'Tu configuración', desc:'Método y separadores actuales · optimización rápida', method:savedMethod, sepDest:savedSepDest, sepAdr:savedSepAdr},
    {name:'Pesado al fondo', desc:'Método por peso · lastre bajo, mejor estabilidad', method:'weight', sepDest:savedSepDest, sepAdr:savedSepAdr},
    {name:'Compacto', desc:'Separación mínima · maximiza volumen y metros lineales', method:savedMethod, sepDest:0, sepAdr:Math.min(savedSepAdr, 10)}
  ];
  const results=[];
  for(const v of variants){
    state.loadingMethod=v.method;
    state.separation.dest=v.sepDest;
    state.separation.adr=v.sepAdr;
    try{
      const r=await optimize(state.items, truck, state.destinations, 'balanced', null);
      const sorted=[...r.placed].sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z);
      sorted.forEach((p,i)=>p.loadSeq=i+1);
      const metrics=computeMetrics(sorted, truck);
      results.push({...v, placed:sorted, unloaded:r.unloaded, metrics});
    }catch(e){
      results.push({...v, placed:[], unloaded:state.items.slice(), metrics:computeMetrics([], truck), error:e.message});
    }
  }
  state.loadingMethod=savedMethod;
  state.separation.dest=savedSepDest;
  state.separation.adr=savedSepAdr;
  // Mejor: mas bultos colocados, mayor volumen, cog ok bonifica
  let best=results[0], bestSc=-Infinity;
  for(const r of results){
    const sc=r.placed.length*1e6 + r.metrics.volPct*100 + (r.metrics.cogOk?50:0) - r.unloaded.length*1e9;
    if(sc>bestSc){bestSc=sc; best=r;}
  }
  renderProposals(results, best);
}

function renderProposals(variants, best){
  const grid=$('propGrid');
  grid.innerHTML=variants.map((v,i)=>{
    const m=v.metrics;
    const isBest=v===best;
    const cogCls=m.cogOk?'':'bad';
    const kgCls=m.weightPct>100?'bad':(m.weightPct>90?'warn':'');
    const ulCls=v.unloaded.length?'warn':'';
    return `<div class="prop-card${isBest?' best':''}" data-idx="${i}">
      <h3>${v.name}${isBest?'<span class="prop-tag">Recomendado</span>':''}</h3>
      <div class="prop-desc">${v.desc}</div>
      <dl>
        <div><dt>Volumen</dt><dd>${m.volPct.toFixed(0)}%</dd></div>
        <div><dt>Bultos</dt><dd class="${ulCls}">${v.placed.length}${v.unloaded.length?' / '+(v.placed.length+v.unloaded.length):''}</dd></div>
        <div><dt>Metros lin.</dt><dd>${m.lm.toFixed(2)} m</dd></div>
        <div><dt>Peso</dt><dd class="${kgCls}">${Math.round(m.totalW).toLocaleString()} kg</dd></div>
        <div><dt>CdG x/L</dt><dd class="${cogCls}">${(m.cogXFrac*100).toFixed(0)}%</dd></div>
        <div><dt>CdG alt.</dt><dd>${(m.cogY/100).toFixed(2)} m</dd></div>
      </dl>
      <button class="prop-apply" type="button">Aplicar esta variante</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.prop-card').forEach(card=>card.addEventListener('click',()=>{
    const idx=+card.dataset.idx; const v=variants[idx];
    state.placed=v.placed; state.unloaded=v.unloaded;
    state.loadingMethod=v.method;
    state.separation.dest=v.sepDest;
    state.separation.adr=v.sepAdr;
    state.optMeta={iterations:20, bestIter:0, level:'balanced', timestamp:new Date().toISOString()};
    document.querySelectorAll('#methodPicker .level').forEach(x=>x.classList.toggle('selected', x.dataset.method===v.method));
    const se=$('sepDest'); if(se) se.value=v.sepDest;
    const sa=$('sepAdr');  if(sa) sa.value=v.sepAdr;
    $('emptyState').style.display='none';
    buildItemMeshes(state.placed);
    updateKPIs(); renderSequenceTable(); renderUnloaded(); renderLegend(); fitView();
    $('propModal').classList.remove('open');
    $('statusText').textContent=`✓ Variante "${v.name}" aplicada`;
  }));
  $('propStatus').textContent='Click en cualquier tarjeta para aplicar esa variante · los cambios no bloquean la optimización manual posterior';
}

// ===== ADR matrix modal =====
function openAdrMatrix(){
  const grid=$('adrMatrix'); if(!grid) return;
  const classes=Object.keys(ADR_CLASSES);
  const cells=[];
  // corner
  cells.push('<div class="adr-corner">clase</div>');
  // header
  for(const c of classes){
    const info=ADR_CLASSES[c];
    cells.push(`<div class="adr-hdr" title="${info.label}" style="border-bottom:3px solid ${info.color}">${c}</div>`);
  }
  // rows
  for(const r of classes){
    const rInfo=ADR_CLASSES[r];
    cells.push(`<div class="adr-hdr" title="${rInfo.label}" style="border-left:3px solid ${rInfo.color}">${r}</div>`);
    for(const c of classes){
      if(r===c){cells.push('<div class="adr-cell self">—</div>'); continue;}
      const bad=adrConflict(r,c);
      // "warn": clases que no estan en la lista estricta pero pueden requerir separacion segun cantidad
      // Simplificación: damos naranja si una direccion es incompatible y la otra no
      const inverse=adrConflict(c,r);
      if(bad && inverse) cells.push('<div class="adr-cell bad" title="Incompatible">✗</div>');
      else if(bad || inverse) cells.push('<div class="adr-cell warn" title="Separación requerida">!</div>');
      else cells.push('<div class="adr-cell ok" title="Compatible">✓</div>');
    }
  }
  grid.innerHTML=cells.join('');
  // Class list
  const list=$('adrClassList');
  list.innerHTML=classes.map(c=>{
    const i=ADR_CLASSES[c];
    return `<div class="adr-class-card"><div class="adr-class-dia" style="background:${i.color}"><span style="transform:rotate(-45deg)">${c}</span></div><div class="adr-class-txt"><b>Clase ${c}</b><small>${i.label}</small></div></div>`;
  }).join('');
  $('adrModal').classList.add('open');
}

function fitView(){
  if(!state.placed.length){controls.targetZoom=1;controls.targetPanX=0;controls.targetPanY=0;controls.targetX=-30;controls.targetY=-25;return;}
  const t=TRUCKS[state.truck]; const A=t.A/100;
  let minX=Infinity,maxX=-Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=0;
  for(const p of state.placed){
    const x1=p.x/100, x2=(p.x+p.L)/100, y2=(p.y+p.H)/100, z1=p.z/100-A/2, z2=(p.z+p.A)/100-A/2;
    if(x1<minX)minX=x1; if(x2>maxX)maxX=x2; if(y2>maxY)maxY=y2;
    if(z1<minZ)minZ=z1; if(z2>maxZ)maxZ=z2;
  }
  const maxSize=Math.max(maxX-minX,maxY-minY,maxZ-minZ);
  const baseRadius=Math.max(12,(t.L/100)*1.4);
  controls.targetZoom=Math.max(0.3,Math.min(3,baseRadius/(maxSize*1.4)));
  const truckCenterX=(t.L/100)/2, truckCenterY=t.H/200;
  controls.targetPanX=(minX+maxX)/2-truckCenterX;
  controls.targetPanY=(minY+maxY)/2-truckCenterY;
  controls.targetX=-30; controls.targetY=-25;
}

// ============================================================
// UI RENDERING
// ============================================================
function renderDestinations(){
  const host=$('destList'); host.innerHTML='';
  state.destinations.forEach((d,idx)=>{
    const row=document.createElement('div'); row.className='dest-row';
    row.innerHTML=`
      <span class="dest-handle">${idx+1}</span>
      <button class="dest-swatch" style="background:${d.color}" data-idx="${idx}" title="Cambiar color"></button>
      <input type="text" value="${d.name}" data-idx="${idx}">
      <button class="dest-rm" data-idx="${idx}" title="Eliminar">×</button>`;
    host.appendChild(row);
    row.querySelector('input').addEventListener('input',e=>{
      state.destinations[idx].name=e.target.value.toUpperCase();
      renderManualDestSelect();
      if(state.placed.length){buildItemMeshes(state.placed); renderSequenceTable(); renderLegend();}
    });
    row.querySelector('.dest-swatch').addEventListener('click',()=>{
      const cur=state.destinations[idx].color;
      state.destinations[idx].color=PALETTE[(PALETTE.indexOf(cur)+1)%PALETTE.length];
      renderDestinations();
      if(state.placed.length){buildItemMeshes(state.placed); renderSequenceTable(); renderLegend();}
    });
    row.querySelector('.dest-rm').addEventListener('click',()=>{
      if(state.destinations.length<=1) return;
      state.destinations.splice(idx,1);
      renderDestinations(); renderManualDestSelect();
    });
  });
  $('destCount').textContent=state.destinations.length;
}
function renderManualDestSelect(){
  const sel=$('mDest'); const prev=sel.value;
  sel.innerHTML=state.destinations.map(d=>`<option value="${d.name}">${d.name}</option>`).join('');
  if(prev && state.destinations.find(d=>d.name===prev)) sel.value=prev;
}
function renderLegend(){
  const l=$('viewerLegend');
  if(!state.placed.length){l.style.display='none';return;}
  l.style.display='block';
  const items = state.destinations.filter(d=>state.placed.some(p=>p.destination===d.name));
  l.innerHTML=`<div class="lg-title">DESTINOS</div>` + items.map(d=>{
    const count=state.placed.filter(p=>p.destination===d.name).length;
    return `<div class="lg-item"><span class="lg-swatch" style="background:${d.color}"></span>${d.name} <span style="color:var(--ink-low);margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:10px">${count}</span></div>`;
  }).join('');
}

function updateKPIs(){
  const truck=TRUCKS[state.truck]; const placed=state.placed; const items=state.items;
  $('itemCount').textContent=items.length;
  const fbL=$('fabLeftBadge'); if(fbL) fbL.textContent=items.length;

  if(!placed.length){
    const fbR=$('fabRightBadge'); if(fbR) fbR.textContent='0%';
    $('kpiVolPct').textContent='0';
    $('kpiLm').textContent='0'; $('kpiKg').textContent='0';
    $('kpiItems').textContent='0'; $('kpiItemsTot').textContent=`/${items.length}`;
    $('kpiVol').textContent='0';
    ['kpiVolFill','kpiLmFill','kpiKgFill','kpiItemsFill'].forEach(id=>$(id).style.width='0%');
    $('kpiVolRing').style.setProperty('--ring','0%');
    $('axFrontVal').innerHTML='0 <em>kg</em>'; $('axRearVal').innerHTML='0 <em>kg</em>';
    $('axFrontFill').style.width='0%'; $('axRearFill').style.width='0%';
    $('axCogVal').textContent='—';
    const axY=$('axCogY'); if(axY) axY.textContent='—';
    const axZ=$('axCogZ'); if(axZ) axZ.textContent='—';
    $('cogDot').setAttribute('cx','120');
    $('cogLine').setAttribute('x1','120'); $('cogLine').setAttribute('x2','120');
    $('axleAlerts').innerHTML=''; $('optInfo').textContent='';
    const rg=$('recGrid'); if(rg) rg.innerHTML='<div class="rec-item"><span class="rec-dot"></span><div class="rec-text">— sin datos —</div></div>';
    $('statusText').textContent=`${items.length} bulto${items.length!==1?'s':''} en cola`;
    return;
  }

  const m=computeMetrics(placed,truck);
  $('kpiVolPct').textContent=m.volPct.toFixed(1);
  const fbR=$('fabRightBadge'); if(fbR) fbR.textContent=`${m.volPct.toFixed(0)}%`;
  $('kpiVolRing').style.setProperty('--ring', Math.min(100,m.volPct)+'%');

  $('kpiLm').textContent=m.lm.toFixed(2);
  $('kpiLmFill').style.width=Math.min(100,m.lmPct)+'%';

  $('kpiKg').textContent=Math.round(m.totalW).toLocaleString();
  $('kpiKgFill').style.width=Math.min(100,m.weightPct)+'%';
  $('kpiKgFill').className='ks-fill'+(m.weightPct>100?' danger':m.weightPct>90?' warn':' ok');

  $('kpiItems').textContent=placed.length;
  $('kpiItemsTot').textContent=`/${items.length}`;
  $('kpiItemsFill').style.width=(placed.length/items.length*100)+'%';

  $('kpiVol').textContent=m.totalVol.toFixed(2);
  $('kpiVolFill').style.width=Math.min(100,m.volPct)+'%';

  const frontMax=12000, rearMax=20000;
  $('axFrontVal').innerHTML=`${Math.round(m.frontKg).toLocaleString()} <em>kg</em>`;
  $('axRearVal').innerHTML=`${Math.round(m.rearKg).toLocaleString()} <em>kg</em>`;
  $('axFrontFill').style.width=Math.min(100,m.frontKg/frontMax*100)+'%';
  $('axRearFill').style.width=Math.min(100,m.rearKg/rearMax*100)+'%';
  $('axFrontFill').classList.toggle('over',m.frontKg>frontMax);
  $('axRearFill').classList.toggle('over',m.rearKg>rearMax);
  $('axFrontVal').classList.toggle('over',m.frontKg>frontMax);
  $('axRearVal').classList.toggle('over',m.rearKg>rearMax);

  const cogRatio=m.cogX/truck.L;
  const cogX = 20 + cogRatio*200;
  $('cogDot').setAttribute('cx', cogX.toFixed(1));
  $('cogLine').setAttribute('x1', cogX.toFixed(1));
  $('cogLine').setAttribute('x2', cogX.toFixed(1));
  $('axCogVal').textContent=`${(m.cogX/100).toFixed(2)} m`;
  const axY=$('axCogY'); if(axY) axY.textContent=`${(m.cogY/100).toFixed(2)} m`;
  const axZ=$('axCogZ'); if(axZ) axZ.textContent=`${(m.cogZ>=0?'+':'')}${(m.cogZ).toFixed(1)} cm`;

  const alerts=[];
  if(m.weightPct>100) alerts.push({level:'danger',text:`⚠ Sobrecarga +${Math.round(m.totalW-truck.maxKg)} kg`});
  if(m.frontKg>frontMax) alerts.push({level:'danger',text:`Eje delantero excede +${Math.round(m.frontKg-frontMax)} kg`});
  if(m.rearKg>rearMax) alerts.push({level:'danger',text:`Eje trasero excede +${Math.round(m.rearKg-rearMax)} kg`});
  if(cogRatio<0.3) alerts.push({level:'warn',text:'CdG adelantado — aligerar frente'});
  if(cogRatio>0.7) alerts.push({level:'warn',text:'CdG atrasado — aligerar fondo'});
  if(m.volPct>95) alerts.push({level:'ok',text:'✓ Camión prácticamente completo'});
  if(state.unloaded.length) alerts.push({level:'danger',text:`${state.unloaded.length} bulto${state.unloaded.length!==1?'s':''} sin cargar`});
  $('axleAlerts').innerHTML=alerts.map(a=>`<div class="alert ${a.level}">${a.text}</div>`).join('');

  renderRecommendations(m, truck);
  renderAdrInventory();
  renderLashing();

  $('statusText').textContent = `${placed.length} bultos · ${m.volPct.toFixed(0)}% · ${Math.round(m.totalW).toLocaleString()} kg`;

  if(state.optMeta){
    const dur = state.optMeta.duration ? ` · ${(state.optMeta.duration/1000).toFixed(1)}s` : '';
    $('optInfo').textContent = `› ${state.optMeta.iterations} iter · mejor en #${state.optMeta.bestIter+1}${dur}`;
  }
}

function renderRecommendations(m, truck){
  const rg=$('recGrid'); if(!rg) return;
  const recs=[];
  // CoG longitudinal
  const xFrac=m.cogXFrac;
  const env=state.cogEnvelope;
  if(xFrac<env.xMin-0.05 || xFrac>env.xMax+0.05) recs.push({level:'bad',title:'CdG longitudinal fuera de envolvente',detail:`x/L = ${(xFrac*100).toFixed(0)}% (ideal ${Math.round(env.xMin*100)}–${Math.round(env.xMax*100)}%)`});
  else if(xFrac<env.xMin || xFrac>env.xMax) recs.push({level:'warn',title:'CdG longitudinal en el borde',detail:`x/L = ${(xFrac*100).toFixed(0)}%`});
  else recs.push({level:'ok',title:'CdG longitudinal correcto',detail:`x = ${(m.cogX/100).toFixed(2)} m · ${(xFrac*100).toFixed(0)}% de L`});
  // CoG lateral (Z)
  const absZ=Math.abs(m.cogZFrac);
  if(absZ>env.zHalf) recs.push({level:'bad',title:'CdG lateral descentrado',detail:`${(m.cogZ).toFixed(1)} cm respecto al eje (máx ${Math.round(env.zHalf*truck.A/2)} cm)`});
  else if(absZ>env.zHalf*0.7) recs.push({level:'warn',title:'CdG lateral con deriva',detail:`${(m.cogZ).toFixed(1)} cm del eje`});
  else recs.push({level:'ok',title:'CdG lateral centrado',detail:`desviación ${(m.cogZ).toFixed(1)} cm`});
  // CoG altura
  if(m.cogY>truck.H*0.55) recs.push({level:'bad',title:'CdG alto',detail:`Y = ${(m.cogY/100).toFixed(2)} m (aceptable ≤ ${(truck.H*0.55/100).toFixed(2)} m). Reordenar pesados abajo.`});
  else if(m.cogY>truck.H*0.45) recs.push({level:'warn',title:'CdG medio-alto',detail:`Y = ${(m.cogY/100).toFixed(2)} m`});
  else recs.push({level:'ok',title:'CdG bajo',detail:`Y = ${(m.cogY/100).toFixed(2)} m`});
  // Peso total y ejes
  const frontMax=12000, rearMax=20000;
  if(m.weightPct>100) recs.push({level:'bad',title:'Sobrecarga total',detail:`+${Math.round(m.totalW-truck.maxKg)} kg sobre MMA`});
  else if(m.weightPct>90) recs.push({level:'warn',title:'Cerca del MMA',detail:`${m.weightPct.toFixed(1)}% del peso máximo`});
  else recs.push({level:'ok',title:'Peso total dentro de límite',detail:`${Math.round(m.totalW).toLocaleString()} kg (${m.weightPct.toFixed(1)}%)`});
  if(m.frontKg>frontMax||m.rearKg>rearMax) recs.push({level:'bad',title:'Eje sobrecargado',detail:`Del ${Math.round(m.frontKg).toLocaleString()}/${frontMax} · Tras ${Math.round(m.rearKg).toLocaleString()}/${rearMax}`});
  // ADR
  const classes=groupAdrClasses(state.placed);
  let adrConflicts=0;
  for(let i=0;i<classes.length;i++) for(let j=i+1;j<classes.length;j++) if(adrConflict(classes[i],classes[j])) adrConflicts++;
  if(!classes.length) recs.push({level:'ok',title:'Sin mercancía ADR',detail:'No hay bultos declarados peligrosos'});
  else if(adrConflicts>0) recs.push({level:'bad',title:`ADR incompatible (${adrConflicts} par${adrConflicts>1?'es':''})`,detail:`Clases a bordo: ${classes.join(', ')} — revisa matriz de segregación`});
  else recs.push({level:'warn',title:`Mercancía ADR (${classes.length} clase${classes.length>1?'s':''})`,detail:`Clases: ${classes.map(c=>c+'·'+(ADR_CLASSES[c]?.label||'')).join('; ')}`});
  // Separación entre destinos
  if(state.separation.dest<3) recs.push({level:'warn',title:'Separación mínima baja',detail:`Solo ${state.separation.dest} cm entre destinos — riesgo de confusión en descarga`});
  // Remontes y maxTop
  const stacked=state.placed.filter(p=>p.supporters&&p.supporters.length).length;
  const noStackUsed=state.items.filter(i=>i.noStackTop).length;
  recs.push({level:'ok',title:`Remontes: ${stacked}/${state.placed.length}`,detail:noStackUsed?`${noStackUsed} bulto${noStackUsed>1?'s':''} marcado${noStackUsed>1?'s':''} "no apilar encima"`:'sin restricciones manuales'});
  // Altura maxima - detectar bultos que casi tocan techo
  const maxY=state.placed.reduce((mx,p)=>Math.max(mx,p.y+p.H),0);
  const headroom=truck.H-maxY;
  if(headroom<5) recs.push({level:'warn',title:'Altura casi llena',detail:`${headroom.toFixed(0)} cm libres al techo`});
  // Unloaded
  if(state.unloaded.length) recs.push({level:'bad',title:`${state.unloaded.length} bulto${state.unloaded.length>1?'s':''} sin cargar`,detail:'Requiere servicio adicional o reequilibrado'});
  // Ocupacion
  if(m.volPct<60) recs.push({level:'warn',title:'Ocupación baja',detail:`${m.volPct.toFixed(0)}% — considera grupaje adicional`});

  rg.innerHTML=recs.map(r=>`<div class="rec-item"><span class="rec-dot ${r.level}"></span><div class="rec-text"><div class="rec-title">${r.title}</div>${r.detail?`<div class="rec-detail">${r.detail}</div>`:''}</div></div>`).join('');
}

function renderLashing(){
  const sec=$('lashSection'); if(!sec) return;
  if(!state.placed.length){sec.style.display='none'; return;}
  sec.style.display='block';
  // Recoger parametros desde UI
  const mu=parseFloat($('lMu').value)||state.lashing.mu;
  const LC=parseFloat($('lLC').value)||state.lashing.LC;
  const STF=parseFloat($('lSTF').value)||state.lashing.STF;
  const ang=parseFloat($('lAng').value)||state.lashing.angle;
  state.lashing.mu=mu; state.lashing.LC=LC; state.lashing.STF=STF; state.lashing.angle=ang;
  const data=computeLashing(state.placed);
  const out=$('lashResult');
  const card=(lvl,title,detail)=>`<div class="rec-item"><span class="rec-dot ${lvl}"></span><div class="rec-text"><div class="rec-title">${title}</div>${detail?`<div class="rec-detail">${detail}</div>`:''}</div></div>`;
  const pieces=[];
  pieces.push(card('ok', `Fuerza frontal (0.8g) · ${Math.round(data.FxDaN).toLocaleString()} daN`, `Lateral (0.5g) · ${Math.round(data.FyDaN).toLocaleString()} daN — masa total ${Math.round(data.mass).toLocaleString()} kg`));
  for(const g of data.groups){
    const lvl=g.nFric>6?'bad':(g.nFric>3?'warn':'ok');
    const extra=[];
    if(g.hasAdr) extra.push('ADR');
    if(g.hasFragile) extra.push('frágiles');
    pieces.push(card(lvl, `${g.dest} · ${g.nFric} correa${g.nFric!==1?'s':''} sobre-lona`,
      `alt: ${g.nDirect} amarres directos @30° LC ${LC} daN · Fx ${Math.round(g.FxDaN).toLocaleString()} daN · ${g.items} bultos / ${Math.round(g.mass).toLocaleString()} kg${extra.length?' · '+extra.join(' + '):''}`));
  }
  out.innerHTML=pieces.join('');
}

// ===== 3D viz de amarres =====
let lashGroup=null;
function clearLashingViz(){
  if(lashGroup){scene.remove(lashGroup); lashGroup.traverse(o=>{if(o.geometry)o.geometry.dispose(); if(o.material){if(Array.isArray(o.material))o.material.forEach(mm=>mm.dispose()); else o.material.dispose();}}); lashGroup=null;}
}
function buildLashingViz(){
  clearLashingViz();
  if(!state.showLashing||!state.placed.length) return;
  const t=TRUCKS[state.truck]; const A=t.A/100;
  const byDest={}; for(const p of state.placed) (byDest[p.destination]=byDest[p.destination]||[]).push(p);
  lashGroup=new THREE.Group();
  const data=computeLashing(state.placed);
  const byDestN={}; data.groups.forEach(g=>byDestN[g.dest]=g.nFric);
  for(const [dest, grp] of Object.entries(byDest)){
    let x1=Infinity,x2=-Infinity,y2=-Infinity;
    for(const p of grp){
      x1=Math.min(x1,p.x/100); x2=Math.max(x2,(p.x+p.L)/100);
      y2=Math.max(y2,(p.y+p.H)/100);
    }
    const n=Math.max(1, byDestN[dest]||1);
    const spacing=(x2-x1)/(n+1);
    const col=new THREE.Color(destColorFor(dest)).getHex();
    for(let i=1;i<=n;i++){
      const x=x1+spacing*i;
      const pts=[new THREE.Vector3(x, 0.01, -A/2), new THREE.Vector3(x, y2+0.04, 0), new THREE.Vector3(x, 0.01, A/2)];
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.9}));
      lashGroup.add(line);
      // anclas en los raíles: esferas pequeñas
      const anchorMat=new THREE.MeshBasicMaterial({color:col});
      const a1=new THREE.Mesh(new THREE.SphereGeometry(0.05,10,10),anchorMat); a1.position.set(x,0.02,-A/2); lashGroup.add(a1);
      const a2=new THREE.Mesh(new THREE.SphereGeometry(0.05,10,10),anchorMat); a2.position.set(x,0.02, A/2); lashGroup.add(a2);
    }
  }
  scene.add(lashGroup);
}

function renderAdrInventory(){
  const sec=$('adrInvSection'); const list=$('adrInvList'); if(!sec||!list) return;
  const adrItems=state.placed.filter(p=>p.adr && ADR_CLASSES[p.adr]);
  if(!adrItems.length){sec.style.display='none'; return;}
  sec.style.display='block';
  // Agrupar por clase
  const byClass={}; for(const it of adrItems){(byClass[it.adr]=byClass[it.adr]||[]).push(it);}
  const classes=Object.keys(byClass).sort();
  const conflicts=new Set();
  for(let i=0;i<classes.length;i++) for(let j=i+1;j<classes.length;j++) if(adrConflict(classes[i],classes[j])){conflicts.add(classes[i]);conflicts.add(classes[j]);}
  const html=classes.map(cls=>{
    const info=ADR_CLASSES[cls];
    const rows=byClass[cls];
    const isConflict=conflicts.has(cls);
    const level=isConflict?'bad':'warn';
    const dot=`<span class="rec-dot ${level}"></span>`;
    const items=rows.slice(0,6).map(it=>{
      const pos=`x ${Math.round(it.x)}·y ${Math.round(it.y)} cm`;
      return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--ink-dim);cursor:pointer" data-pick="${it.id}"><span style="color:var(--ink);font-weight:600">${it.ref||'(sin ref)'}</span><span>${it.destination} · ${pos}</span></div>`;
    }).join('');
    const more=rows.length>6?`<div style="font-size:10px;color:var(--ink-dim);margin-top:3px">+${rows.length-6} más…</div>`:'';
    return `<div class="rec-item"><div class="id-adr-dia" style="background:${info.color};width:26px;height:26px;font-size:12px;margin-top:1px"><span style="transform:rotate(-45deg)">${cls}</span></div><div class="rec-text"><div class="rec-title">Clase ${cls} · ${info.label} <span style="float:right;font-family:'JetBrains Mono',monospace">${rows.length}</span></div>${items}${more}${isConflict?'<div class="rec-detail" style="color:var(--ac-red);margin-top:4px">Incompatible con otra clase a bordo — verificar segregación</div>':''}</div></div>`;
  }).join('');
  list.innerHTML=html;
  // click para seleccionar bulto
  list.querySelectorAll('[data-pick]').forEach(el=>el.addEventListener('click',()=>selectItemById(el.dataset.pick)));
}

function renderSequenceTable(){
  const seqT=$('seqTitle'); const seqH=$('seqHint');
  if(seqT && seqH){
    const titles={lifo:'Secuencia LIFO',fifo:'Secuencia FIFO',weight:'Secuencia por peso',manual:'Secuencia manual'};
    const hints ={lifo:'Fondo → Frente',fifo:'Frente → Fondo',weight:'Pesado al fondo',manual:'Orden configurado'};
    seqT.textContent=titles[state.loadingMethod]||'Secuencia';
    seqH.textContent=hints[state.loadingMethod]||'';
  }
  const tbody=$('seqTable').querySelector('tbody');
  if(!state.placed.length){tbody.innerHTML='<tr><td colspan="5" class="seq-empty">— sin datos —</td></tr>';return;}
  const rows=[...state.placed].sort((a,b)=>a.loadSeq-b.loadSeq);
  tbody.innerHTML=rows.map(p=>{
    const color=destColorFor(p.destination);
    return `<tr data-id="${p.id}" class="${state.selectedItem&&state.selectedItem.id===p.id?'selected':''}">
      <td class="seq-num">${String(p.loadSeq).padStart(3,'0')}</td>
      <td>${p.ref}</td>
      <td><span class="dest-chip" style="background:${color}">${p.destination||'—'}</span></td>
      <td>${(p.x/100).toFixed(2)}×${(p.z/100).toFixed(2)}${p.y>0?'↑'+(p.y/100).toFixed(2):''}</td>
      <td>${Math.round(p.weight)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click',()=>{
      const id=tr.dataset.id; const it=state.placed.find(p=>p.id===id);
      state.selectedItem=(state.selectedItem&&state.selectedItem.id===id)?null:it;
      renderSequenceTable(); buildItemMeshes(state.placed);
      if(state.selectedItem) openItemDetails(state.selectedItem); else closeItemDetails();
    });
  });
}
function renderUnloaded(){
  if(!state.unloaded.length){$('unloadedSection').style.display='none';return;}
  $('unloadedSection').style.display='block';
  const byDest={}; for(const u of state.unloaded){(byDest[u.destination||'?']=byDest[u.destination||'?']||[]).push(u);}
  $('unloadedList').innerHTML=Object.entries(byDest).map(([dest,items])=>{
    const tW=items.reduce((s,i)=>s+i.weight,0), tV=items.reduce((s,i)=>s+i.volume,0);
    return `<div class="alert danger"><b style="color:inherit">${dest}</b> — ${items.length} bultos · ${tV.toFixed(2)} m³ · ${Math.round(tW)} kg</div>`;
  }).join('');
}

function showViewerScale(){
  const t=TRUCKS[state.truck];
  $('viewerScale').style.display='block';
  $('vsL').textContent=(t.L/100).toFixed(2)+' m';
  $('vsA').textContent=(t.A/100).toFixed(2)+' m';
  $('vsH').textContent=(t.H/100).toFixed(2)+' m';
  $('vsV').textContent=((t.L*t.A*t.H)/1e6).toFixed(1)+' m³';
}

// ============================================================
// OPTIMIZATION RUNNER
// ============================================================
async function runOptimization(){
  if(!state.items.length){
    $('statusText').textContent='Añade bultos primero';
    return;
  }
  $('progressOverlay').classList.add('open');
  $('progressMsg').textContent='Optimizando carga';
  $('progressDetail').textContent='Inicializando…';
  $('progressFill').style.width='0%';
  await sleep(50);
  const truck=TRUCKS[state.truck];
  const level=state.optLevel;
  const t0=performance.now();
  const result=await optimize(state.items,truck,state.destinations,level,(pct,detail)=>{
    $('progressFill').style.width=pct+'%';
    $('progressDetail').textContent=detail;
  });
  state.placed=result.placed; state.unloaded=result.unloaded;
  state.optMeta={...result.meta, duration:performance.now()-t0};
  $('emptyState').style.display=state.placed.length?'none':'block';
  buildTruckMesh(); buildItemMeshes(state.placed);
  updateKPIs(); renderSequenceTable(); renderUnloaded(); renderLegend();
  showViewerScale(); fitView();
  updateStepper();
  await sleep(300);
  $('progressOverlay').classList.remove('open');
}

// ============================================================
// FILE HANDLING
// ============================================================
async function handleFile(file){
  $('fileStatus').textContent=`Leyendo ${file.name}…`;
  try{
    const ext=file.name.split('.').pop().toLowerCase();
    if(ext==='xlsx'||ext==='xls'){
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      const items=parseTable(rows); addItems(items);
      $('fileStatus').textContent=`✓ ${items.length} bultos importados`;
    } else if(ext==='csv'){
      const txt=await file.text();
      const rows=parseCSV(txt);
      const items=parseTable(rows); addItems(items);
      $('fileStatus').textContent=`✓ ${items.length} bultos importados`;
    } else {
      $('fileStatus').textContent=`Formato no soportado: ${ext}`;
    }
  }catch(err){console.error(err); $('fileStatus').textContent=`✗ Error: ${err.message}`;}
}

function addItems(items){
  if(!items||!items.length) return;
  const known=state.destinations.map(d=>d.name.toUpperCase());
  for(const it of items){
    const d=(it.destination||'').toUpperCase();
    if(d && !known.includes(d)){
      state.destinations.push({name:d,color:PALETTE[state.destinations.length%PALETTE.length]});
      known.push(d);
    }
  }
  state.items.push(...items);
  renderDestinations(); renderManualDestSelect();
  $('itemCount').textContent=state.items.length;
  const fbL=$('fabLeftBadge'); if(fbL) fbL.textContent=state.items.length;
  $('statusText').textContent=`${state.items.length} bultos en cola`;
  renderItemsList();
  updateStepper();
}

// ===== Pre-opt items list + inline edit =====
function renderItemsList(){
  const box=$('itemsList'); if(!box) return;
  $('itemsListCount').textContent=state.items.length;
  if(!state.items.length){box.innerHTML=''; return;}
  box.innerHTML=state.items.map(it=>{
    const col=destColorFor(it.destination);
    const adrInfo=it.adr?ADR_CLASSES[it.adr]:null;
    const flags=[];
    if(it.fragile) flags.push('<span class="ir-flag frag">Frágil</span>');
    if(!it.stackable) flags.push('<span class="ir-flag">No remont.</span>');
    if(it.noStackTop) flags.push('<span class="ir-flag notop">No encima</span>');
    const adr=adrInfo?`<span class="ir-adr" style="background:${adrInfo.color}" title="ADR ${it.adr} · ${adrInfo.label}"><span>${it.adr}</span></span>`:'';
    return `<div class="item-row" data-id="${it.id}">
      <span class="ir-dot" style="background:${col}"></span>
      <div class="ir-main"><b>${it.ref||'(sin ref)'}</b><small>${it.L}×${it.A}×${it.H}·${Math.round(it.weight)}kg · ${it.destination||'—'}</small></div>
      ${adr}
      <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${flags.join('')}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('.item-row').forEach(row=>row.addEventListener('click',()=>openItemEdit(row.dataset.id)));
}

let _iemEditingId=null;
function openItemEdit(id){
  const it=state.items.find(x=>x.id===id); if(!it) return;
  _iemEditingId=id;
  $('iemTitle').textContent='Editar bulto';
  $('iemSub').textContent=`ID ${id}`;
  $('iemRef').value=it.ref||'';
  $('iemType').value=it.type||'caja';
  $('iemL').value=it.L; $('iemA').value=it.A; $('iemH').value=it.H;
  $('iemW').value=it.weight;
  const destSel=$('iemDest');
  destSel.innerHTML=state.destinations.map(d=>`<option value="${d.name}">${d.name}</option>`).join('');
  destSel.value=it.destination||(state.destinations[0]&&state.destinations[0].name)||'';
  $('iemMaxTop').value=it.maxTop||0;
  $('iemAdr').value=it.adr||'';
  $('iemStack').checked=it.stackable!==false;
  $('iemFrag').checked=it.fragile===true;
  $('iemNoTop').checked=it.noStackTop===true;
  $('itemEditModal').classList.add('open');
}
function saveItemEdit(){
  const id=_iemEditingId; const it=state.items.find(x=>x.id===id); if(!it) return;
  it.ref=$('iemRef').value.trim()||it.ref;
  it.type=$('iemType').value;
  it.L=parseFloat($('iemL').value)||it.L;
  it.A=parseFloat($('iemA').value)||it.A;
  it.H=parseFloat($('iemH').value)||it.H;
  it.weight=parseFloat($('iemW').value)||it.weight;
  it.destination=$('iemDest').value||it.destination;
  it.maxTop=parseFloat($('iemMaxTop').value)||0;
  const adrVal=$('iemAdr').value; it.adr=adrVal?adrVal:null;
  it.stackable=$('iemStack').checked;
  it.fragile=$('iemFrag').checked;
  it.noStackTop=$('iemNoTop').checked;
  it.volume=(it.L*it.A*it.H)/1e6;
  // Sync con la colocacion actual si existe
  const placed=state.placed.find(p=>p.id===id);
  if(placed){ Object.assign(placed, {ref:it.ref,type:it.type,weight:it.weight,maxTop:it.maxTop,adr:it.adr,stackable:it.stackable,fragile:it.fragile,noStackTop:it.noStackTop}); }
  renderItemsList();
  if(state.placed.length) buildItemMeshes(state.placed);
  updateKPIs();
  $('itemEditModal').classList.remove('open');
  $('statusText').textContent='✎ Bulto actualizado — re-optimiza si cambiaron dimensiones/peso';
}
function duplicateItem(){
  const id=_iemEditingId; const it=state.items.find(x=>x.id===id); if(!it) return;
  const copy=makeItem({ref:(it.ref||'ITEM')+'·copia',type:it.type,L:it.L,A:it.A,H:it.H,weight:it.weight,destination:it.destination,stackable:it.stackable,fragile:it.fragile,maxTop:it.maxTop,adr:it.adr,noStackTop:it.noStackTop});
  state.items.push(copy);
  renderItemsList();
  $('itemEditModal').classList.remove('open');
  $('statusText').textContent=`✓ Bulto duplicado: ${copy.ref}`;
}
function deleteCurrentItem(){
  const id=_iemEditingId; const idx=state.items.findIndex(x=>x.id===id); if(idx<0) return;
  state.items.splice(idx,1);
  const pidx=state.placed.findIndex(p=>p.id===id);
  if(pidx>=0){state.placed.splice(pidx,1);}
  if(state.selectedItem && state.selectedItem.id===id){state.selectedItem=null; closeItemDetails();}
  renderItemsList();
  if(state.placed.length) buildItemMeshes(state.placed);
  updateKPIs(); renderSequenceTable();
  $('itemEditModal').classList.remove('open');
  $('itemCount').textContent=state.items.length;
  $('statusText').textContent=`🗑 Bulto eliminado`;
}

// ===== XLSX export =====
function exportXLSX(){
  if(!state.items.length){alert('Sin bultos para exportar'); return;}
  const wb=XLSX.utils.book_new();
  // Packing list
  const pkHead=['ref','tipo','destino','largo_cm','ancho_cm','alto_cm','peso_kg','remontable','fragil','no_apilar_encima','peso_max_encima','adr','volumen_m3'];
  const pkRows=state.items.map(it=>[it.ref,it.type,it.destination,it.L,it.A,it.H,it.weight,it.stackable?'SI':'NO',it.fragile?'SI':'NO',it.noStackTop?'SI':'NO',it.maxTop,it.adr||'',((it.L*it.A*it.H)/1e6).toFixed(3)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pkHead,...pkRows]), 'Packing list');
  // Plan final
  if(state.placed.length){
    const plHead=['seq','ref','destino','x_cm','y_cm','z_cm','largo_cm','ancho_cm','alto_cm','peso_kg','rotado','fragil','adr','apilado_sobre'];
    const plRows=[...state.placed].sort((a,b)=>a.loadSeq-b.loadSeq).map(p=>[p.loadSeq,p.ref,p.destination,p.x,p.y,p.z,p.L,p.A,p.H,p.weight,p.rotated?'SI':'NO',p.fragile?'SI':'NO',p.adr||'',p.stackedOn||'']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([plHead,...plRows]), 'Plan final');
  }
  // No cargados
  if(state.unloaded.length){
    const uHead=['ref','destino','largo_cm','ancho_cm','alto_cm','peso_kg','motivo'];
    const uRows=state.unloaded.map(u=>[u.ref,u.destination,u.L,u.A,u.H,u.weight,'no cabe / excede MMA']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([uHead,...uRows]), 'No cargados');
  }
  // Amarre
  if(state.placed.length){
    const lash=computeLashing(state.placed);
    const lHead=['destino','bultos','masa_kg','Fx_daN','Fy_daN','correas_sobre_lona','amarres_directos_30','ADR','fragil'];
    const lRows=lash.groups.map(g=>[g.dest,g.items,Math.round(g.mass),Math.round(g.FxDaN),Math.round(g.FyDaN),g.nFric,g.nDirect,g.hasAdr?'SI':'NO',g.hasFragile?'SI':'NO']);
    lRows.push(['TOTAL',state.placed.length,Math.round(lash.mass),Math.round(lash.FxDaN),Math.round(lash.FyDaN),'','','','']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([lHead,...lRows]), 'Amarre');
  }
  // Resumen
  const truck=TRUCKS[state.truck];
  const m=state.placed.length?computeMetrics(state.placed,truck):{volPct:0,totalW:0,lm:0,cogX:0,cogY:0,cogZ:0};
  const sum=[
    ['Vehículo', truck.name],
    ['Dimensiones', `${truck.L}x${truck.A}x${truck.H} cm`],
    ['MMA', truck.maxKg+' kg'],
    ['Método', state.loadingMethod],
    ['Separación destinos', state.separation.dest+' cm'],
    ['Separación ADR', state.separation.adr+' cm'],
    ['Bultos totales', state.items.length],
    ['Bultos colocados', state.placed.length],
    ['No cargados', state.unloaded.length],
    ['Ocupación volumen', m.volPct.toFixed(1)+' %'],
    ['Peso total', Math.round(m.totalW).toLocaleString()+' kg'],
    ['Metros lineales', (m.lm||0).toFixed(2)+' m'],
    ['CdG X', (m.cogX/100).toFixed(2)+' m'],
    ['CdG Y', (m.cogY/100).toFixed(2)+' m'],
    ['CdG Z', (m.cogZ||0).toFixed(1)+' cm']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Resumen');
  XLSX.writeFile(wb, `groupage_${Date.now()}.xlsx`);
}

// ===== Templates / escenarios =====
const TPL_KEY='groupage_templates_v1';
function loadTemplatesList(){
  try{return JSON.parse(localStorage.getItem(TPL_KEY)||'[]');}catch(e){return [];}
}
function saveTemplatesList(list){try{localStorage.setItem(TPL_KEY, JSON.stringify(list));}catch(e){alert('No se pudo guardar: '+e.message);}}
function refreshTplSelect(){
  const sel=$('tplSelect'); if(!sel) return;
  const cur=sel.value;
  const list=loadTemplatesList();
  sel.innerHTML=['<option value="">— cargar escenario —</option>', ...list.map(t=>`<option value="${t.name}">${t.name} (${t.items||0} bultos)</option>`)].join('');
  if(cur && list.find(t=>t.name===cur)) sel.value=cur;
}
function saveTemplate(){
  const name=prompt('Nombre del escenario:', `Plantilla ${new Date().toLocaleDateString('es-ES')}`);
  if(!name) return;
  const list=loadTemplatesList();
  const idx=list.findIndex(t=>t.name===name);
  const tpl={
    name, ts:Date.now(),
    truck:state.truck, origin:state.origin,
    destinations:JSON.parse(JSON.stringify(state.destinations)),
    items:JSON.parse(JSON.stringify(state.items)),
    loadingMethod:state.loadingMethod,
    separation:Object.assign({}, state.separation),
    lashing:Object.assign({}, state.lashing),
    cogEnvelope:Object.assign({}, state.cogEnvelope)
  };
  tpl.itemsCount=state.items.length;
  if(idx>=0){if(!confirm(`Ya existe "${name}". ¿Sobrescribir?`)) return; list[idx]=tpl;} else list.push(tpl);
  saveTemplatesList(list);
  refreshTplSelect();
  $('statusText').textContent=`💾 Escenario "${name}" guardado`;
}
function loadTemplate(){
  const name=$('tplSelect').value; if(!name) return;
  const list=loadTemplatesList();
  const tpl=list.find(t=>t.name===name); if(!tpl) return;
  if(state.items.length && !confirm(`Cargar "${name}" reemplazará los bultos y config actuales. ¿Continuar?`)) return;
  state.truck=tpl.truck||state.truck;
  state.origin=tpl.origin||state.origin;
  state.destinations=JSON.parse(JSON.stringify(tpl.destinations||state.destinations));
  state.items=(tpl.items||[]).map(x=>Object.assign({},x,{id:Math.random().toString(36).slice(2,10)}));
  state.placed=[]; state.unloaded=[]; state.selectedItem=null; state.optMeta=null;
  state.loadingMethod=tpl.loadingMethod||state.loadingMethod;
  if(tpl.separation) state.separation=Object.assign({}, tpl.separation);
  if(tpl.lashing) state.lashing=Object.assign({}, tpl.lashing);
  if(tpl.cogEnvelope) state.cogEnvelope=Object.assign({}, tpl.cogEnvelope);
  // UI
  const r=document.querySelector(`input[name="truck"][value="${state.truck}"]`); if(r){r.checked=true; document.querySelectorAll('.truck-card').forEach(c=>c.classList.remove('selected')); r.closest('.truck-card').classList.add('selected');}
  document.querySelectorAll('#methodPicker .level').forEach(l=>l.classList.toggle('selected', l.dataset.method===state.loadingMethod));
  if($('sepDest')) $('sepDest').value=state.separation.dest;
  if($('sepAdr'))  $('sepAdr').value=state.separation.adr;
  if($('lMu'))  $('lMu').value=state.lashing.mu;
  if($('lLC'))  $('lLC').value=state.lashing.LC;
  if($('lSTF')) $('lSTF').value=state.lashing.STF;
  if($('lAng')) $('lAng').value=state.lashing.angle;
  renderDestinations(); renderManualDestSelect(); renderItemsList();
  buildTruckMesh(); clearItemMeshes(); clearCoGMarker(); clearLashingViz();
  $('emptyState').style.display='block'; $('viewerScale').style.display='none'; $('viewerLegend').style.display='none';
  $('itemCount').textContent=state.items.length;
  closeItemDetails();
  updateKPIs(); renderSequenceTable(); renderUnloaded(); updateStepper();
  $('statusText').textContent=`✓ Escenario "${name}" cargado (${state.items.length} bultos)`;
}
function deleteTemplate(){
  const name=$('tplSelect').value; if(!name) return;
  if(!confirm(`Borrar escenario "${name}"?`)) return;
  const list=loadTemplatesList().filter(t=>t.name!==name);
  saveTemplatesList(list);
  refreshTplSelect();
  $('statusText').textContent=`🗑 Escenario "${name}" borrado`;
}

function exportCSV(){
  if(!state.placed.length){alert('Sin datos');return;}
  const rows=[['seq','ref','tipo','destino','x_cm','y_cm','z_cm','largo_cm','ancho_cm','alto_cm','peso_kg','rotado','fragil']];
  const ord=[...state.placed].sort((a,b)=>a.loadSeq-b.loadSeq);
  for(const p of ord) rows.push([p.loadSeq,p.ref,p.type,p.destination,p.x,p.y,p.z,p.L,p.A,p.H,p.weight,p.rotated?'SI':'NO',p.fragile?'SI':'NO']);
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadBlob(csv,`groupage_${Date.now()}.csv`,'text/csv');
}
function exportJSON(){
  if(!state.placed.length){alert('Sin datos');return;}
  const truck=TRUCKS[state.truck];
  const data={generated:new Date().toISOString(),origin:state.origin,truck:{type:state.truck,...truck},destinations:state.destinations,optMeta:state.optMeta,metrics:computeMetrics(state.placed,truck),placed:state.placed,unloaded:state.unloaded};
  downloadBlob(JSON.stringify(data,null,2),`groupage_${Date.now()}.json`,'application/json');
}
function downloadBlob(content,name,type){
  const blob=new Blob([content],{type});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ============================================================
// DEMO
// ============================================================
function loadDemo(){
  state.destinations=[{name:'MADRID',color:'#ff6b1a'},{name:'VALENCIA',color:'#c5f24b'},{name:'BARCELONA',color:'#4ee1c4'}];
  state.items=[];
  const demo=[
    {ref:'MAD-001',type:'palet_eur',L:120,A:80,H:140,weight:620,destination:'MADRID',stackable:true,fragile:false,maxTop:500,qty:6},
    {ref:'MAD-002',type:'palet_eur',L:120,A:80,H:90,weight:380,destination:'MADRID',stackable:true,fragile:false,maxTop:400,qty:4,adr:'3'},
    {ref:'MAD-003',type:'bobina',L:100,A:100,H:110,weight:780,destination:'MADRID',stackable:false,fragile:false,maxTop:0,qty:2,noStackTop:true},
    {ref:'VAL-001',type:'palet_us',L:120,A:100,H:160,weight:540,destination:'VALENCIA',stackable:true,fragile:false,maxTop:300,qty:5},
    {ref:'VAL-002',type:'caja',L:80,A:60,H:70,weight:85,destination:'VALENCIA',stackable:true,fragile:true,maxTop:0,qty:8},
    {ref:'VAL-003',type:'bigbag',L:100,A:100,H:130,weight:950,destination:'VALENCIA',stackable:false,fragile:false,maxTop:0,qty:3},
    {ref:'BCN-001',type:'palet_eur',L:120,A:80,H:170,weight:490,destination:'BARCELONA',stackable:true,fragile:false,maxTop:350,qty:7},
    {ref:'BCN-002',type:'jaula',L:120,A:100,H:180,weight:320,destination:'BARCELONA',stackable:false,fragile:false,maxTop:0,qty:3,adr:'8'},
    {ref:'BCN-003',type:'caja',L:60,A:40,H:50,weight:25,destination:'BARCELONA',stackable:true,fragile:false,maxTop:100,qty:12}
  ];
  for(const d of demo) for(let i=0;i<d.qty;i++){
    state.items.push(makeItem({ref:`${d.ref}/${i+1}`,type:d.type,L:d.L,A:d.A,H:d.H,weight:d.weight,destination:d.destination,stackable:d.stackable,fragile:d.fragile,maxTop:d.maxTop,adr:d.adr||null,noStackTop:d.noStackTop===true}));
  }
  renderDestinations(); renderManualDestSelect(); renderItemsList();
  $('fileStatus').textContent=`✓ Demo: ${state.items.length} bultos, 3 destinos`;
  $('itemCount').textContent=state.items.length;
  updateStepper();
}

// ============================================================
// DOCS
// ============================================================
function genDocNumber(){
  const d=new Date();
  return `GRP-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*10000)}`;
}
function docHeader(title,subtitle,num){
  return `<div class="doc-head">
    <div>
      <div class="doc-logo"><span class="ac">groupage</span> ▸</div>
      <div style="font-size:8pt;color:#666;margin-top:2px">Optimizador de carga · v2.1</div>
    </div>
    <div class="doc-meta">
      <div style="font-weight:600;font-size:9pt;color:#1a1a1a">${title}</div>
      <div>${subtitle}</div>
      <div style="margin-top:4px">Doc nº <b>${num}</b></div>
      <div>${new Date().toLocaleString('es-ES')}</div>
    </div></div>`;
}
function docFooter(label){
  return `<div class="footer-note"><span>Groupage v2.1 · Validar con responsable antes de expedir</span><span>${label||''}</span></div>`;
}
function genSvgView(mode){
  const truck=TRUCKS[state.truck]; const margin=30;
  let wCm,hCm,mapX,mapY,lX;
  if(mode==='top'){wCm=truck.L;hCm=truck.A;mapX=p=>p.x;mapY=p=>p.z;lX='Largo (cm)';}
  else if(mode==='side'){wCm=truck.L;hCm=truck.H;mapX=p=>p.x;mapY=p=>p.y;lX='Largo (cm)';}
  else{wCm=truck.A;hCm=truck.H;mapX=p=>p.z;mapY=p=>p.y;lX='Ancho (cm)';}
  const scale=Math.min(900/wCm,350/hCm);
  const w=wCm*scale+margin*2, h=hCm*scale+margin*2;
  const items=[...state.placed];
  if(mode==='top') items.sort((a,b)=>a.y-b.y);
  else if(mode==='side') items.sort((a,b)=>a.z-b.z);
  else items.sort((a,b)=>(b.x+b.L)-(a.x+a.L));
  let rects='';
  for(const p of items){
    const dw=mode==='top'?p.L:mode==='side'?p.L:p.A;
    const dh=mode==='top'?p.A:mode==='side'?p.H:p.H;
    const x=mapX(p)*scale+margin, y=h-margin-(mapY(p)+dh)*scale;
    const color=destColorFor(p.destination);
    const opacity=(mode!=='top'&&p.y>0)?0.75:0.9;
    rects+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(dw*scale).toFixed(1)}" height="${(dh*scale).toFixed(1)}" fill="${color}" stroke="#333" stroke-width="0.7" opacity="${opacity}"/>`;
    if(dw*scale>18&&dh*scale>14) rects+=`<text x="${(x+dw*scale/2).toFixed(1)}" y="${(y+dh*scale/2+3).toFixed(1)}" font-size="9" font-family="'JetBrains Mono',monospace" text-anchor="middle" fill="#1a1a1a" font-weight="700">${p.loadSeq}</text>`;
  }
  const truckRect=`<rect x="${margin}" y="${margin}" width="${wCm*scale}" height="${hCm*scale}" fill="none" stroke="#1a1a1a" stroke-width="1.5"/>`;
  let ticks='';
  for(let x=0;x<=wCm;x+=100){
    const px=x*scale+margin;
    ticks+=`<line x1="${px}" y1="${h-margin}" x2="${px}" y2="${h-margin+5}" stroke="#888" stroke-width="0.5"/><text x="${px}" y="${h-margin+15}" font-size="7" font-family="monospace" text-anchor="middle" fill="#666">${x}</text>`;
  }
  for(let y=0;y<=hCm;y+=50){
    const py=h-margin-y*scale;
    ticks+=`<line x1="${margin}" y1="${py}" x2="${margin-5}" y2="${py}" stroke="#888" stroke-width="0.5"/><text x="${margin-8}" y="${py+3}" font-size="7" font-family="monospace" text-anchor="end" fill="#666">${y}</text>`;
  }
  const frontLbl=mode!=='back'?`<text x="${margin+4}" y="${margin-4}" font-size="8" font-family="monospace" fill="#ff6b1a" font-weight="700">◀ FRENTE (CABINA)</text>`:'';
  const title=mode==='top'?'VISTA CENITAL':mode==='side'?'VISTA LATERAL':'VISTA TRASERA';
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="background:white;width:100%;height:auto">
    <text x="${w/2}" y="18" font-family="'Space Grotesk',sans-serif" font-weight="700" font-size="12" text-anchor="middle" fill="#1a1a1a">${title}</text>
    ${truckRect}${rects}${ticks}${frontLbl}
    <text x="${w/2}" y="${h-6}" font-size="7" font-family="monospace" text-anchor="middle" fill="#666">${lX} · escala 1:${Math.round(100/scale)}</text>
  </svg>`;
}
function capture3D(){try{return $('canvas').toDataURL('image/png');}catch(e){return null;}}

function generatePlanoDoc(){
  const truck=TRUCKS[state.truck]; const m=computeMetrics(state.placed,truck);
  const num=state._docNum||genDocNumber(); state._docNum=num;
  const img3d=capture3D(); const origen=state.origin;
  return [`<div class="doc-sheet">${docHeader('PLANO DE CARGA','Distribución 2D y 3D',num)}
    <h1>Plano de carga del vehículo</h1>
    <div style="font-size:9pt;color:#555;margin-bottom:10px">${truck.name} · ${(truck.L/100).toFixed(2)}×${(truck.A/100).toFixed(2)}×${(truck.H/100).toFixed(2)} m · ${((truck.L*truck.A*truck.H)/1e6).toFixed(1)} m³ · ${truck.maxKg/1000} t</div>
    <div class="kpi-row">
      <div class="kpi-box"><div class="k-label">Ocupación</div><div class="k-value">${m.volPct.toFixed(1)}%</div></div>
      <div class="kpi-box"><div class="k-label">Metros lin.</div><div class="k-value">${m.lm.toFixed(2)} m</div></div>
      <div class="kpi-box"><div class="k-label">Peso total</div><div class="k-value">${Math.round(m.totalW)} kg</div></div>
      <div class="kpi-box"><div class="k-label">Bultos</div><div class="k-value">${state.placed.length}</div></div>
    </div>
    <h2>Ruta</h2>
    <div style="font-size:10pt;margin:4px 0"><b>Origen:</b> ${origen}</div>
    <div style="font-size:10pt;margin:4px 0"><b>Destinos:</b> ${state.destinations.map(d=>d.name).join(' → ')}</div>
    <h2>Leyenda de destinos</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0">
      ${state.destinations.map(d=>{const c=state.placed.filter(p=>p.destination===d.name).length;return `<div style="display:flex;align-items:center;gap:5px;font-size:9pt"><span style="width:12px;height:12px;background:${d.color};border:1px solid #333"></span>${d.name} <span style="color:#888">(${c})</span></div>`;}).join('')}
    </div>
    <h2>Vista cenital (planta)</h2>
    <div style="text-align:center;margin:8px 0">${genSvgView('top')}</div>
    ${docFooter('Página 1/3')}</div>`,
  `<div class="doc-sheet">${docHeader('PLANO DE CARGA','Vistas ortogonales',num)}
    <h2>Vista lateral</h2><div style="text-align:center;margin:8px 0">${genSvgView('side')}</div>
    <h2>Vista trasera</h2><div style="text-align:center;margin:8px 0">${genSvgView('back')}</div>
    ${docFooter('Página 2/3')}</div>`,
  `<div class="doc-sheet">${docHeader('PLANO DE CARGA','Perspectiva 3D y análisis',num)}
    <h2>Vista 3D</h2>
    ${img3d?`<img src="${img3d}" class="plan-img" style="max-height:360px;object-fit:contain;background:#1a1a1a"/>`:'<div class="warn-box">Vista 3D no disponible</div>'}
    <h2>Equilibrio de ejes (estimado)</h2>
    <table><tr><th>Eje</th><th>Carga kg</th><th>Límite</th><th>Estado</th></tr>
    <tr><td>Delantero</td><td>${Math.round(m.frontKg)}</td><td>12.000</td><td>${m.frontKg>12000?'<b style="color:#c00">EXCEDE</b>':'OK'}</td></tr>
    <tr><td>Trasero</td><td>${Math.round(m.rearKg)}</td><td>20.000</td><td>${m.rearKg>20000?'<b style="color:#c00">EXCEDE</b>':'OK'}</td></tr>
    <tr><td>CdG X</td><td colspan="3">${(m.cogX/100).toFixed(2)} m desde frente</td></tr></table>
    <div class="warn-box">Cálculos estimados. Verificar con peso tara real de la flota.</div>
    ${docFooter('Página 3/3')}</div>`];
}

function generateCtuDoc(){
  const truck=TRUCKS[state.truck]; const m=computeMetrics(state.placed,truck);
  const num=state._docNum||genDocNumber(); state._docNum=num;
  const byDest={}; for(const p of state.placed)(byDest[p.destination]=byDest[p.destination]||[]).push(p);
  return [`<div class="doc-sheet">${docHeader('CERTIFICADO CTU','IMO/UIC/UNECE CTU Code',num)}
    <h1 style="text-align:center">Certificado de arrumazón de UTI</h1>
    <div style="text-align:center;font-size:9pt;color:#555;margin-bottom:12px">Conforme al Código IMO/UIC/UNECE CTU<br>Nº: <b>CTU-${num}</b> · ${new Date().toLocaleDateString('es-ES')}</div>
    <h2>1. Identificación</h2>
    <div class="field-grid">
      <div class="field"><span class="field-label">Tipo UTI:</span><span class="field-value">${truck.name}</span></div>
      <div class="field"><span class="field-label">Dim:</span><span class="field-value">${(truck.L/100).toFixed(2)}×${(truck.A/100).toFixed(2)}×${(truck.H/100).toFixed(2)} m</span></div>
      <div class="field"><span class="field-label">Matrícula:</span><span class="field-value">________</span></div>
      <div class="field"><span class="field-label">Precinto:</span><span class="field-value">________</span></div>
    </div>
    <h2>2. Origen y destinatarios</h2>
    <div class="field" style="border:none"><span class="field-label">Origen:</span><span class="field-value">${state.origin}</span></div>
    <table><tr><th>Ruta</th><th>Destino</th><th>Bultos</th><th>Vol m³</th><th>Peso kg</th><th>Frágil</th></tr>
    ${state.destinations.map((d,i)=>{const it=byDest[d.name]||[];const w=it.reduce((s,i)=>s+i.weight,0);const v=it.reduce((s,i)=>s+(i.L*i.A*i.H)/1e6,0);const fr=it.filter(i=>i.fragile).length;return `<tr><td><b>${i+1}º</b></td><td><b>${d.name}</b></td><td>${it.length}</td><td>${v.toFixed(2)}</td><td>${Math.round(w)}</td><td>${fr}</td></tr>`;}).join('')}</table>
    <h2>3. Totales</h2>
    <div class="kpi-row">
      <div class="kpi-box"><div class="k-label">Bultos</div><div class="k-value">${state.placed.length}</div></div>
      <div class="kpi-box"><div class="k-label">Peso bruto</div><div class="k-value">${Math.round(m.totalW)} kg</div></div>
      <div class="kpi-box"><div class="k-label">Volumen</div><div class="k-value">${m.totalVol.toFixed(2)} m³</div></div>
      <div class="kpi-box"><div class="k-label">Ocupación</div><div class="k-value">${m.volPct.toFixed(1)}%</div></div>
    </div>
    ${docFooter('Página 1/2')}</div>`,
  `<div class="doc-sheet">${docHeader('CERTIFICADO CTU','Declaración y firmas',num)}
    <h2>4. Declaración de conformidad</h2>
    <div class="ctu-pre">El firmante certifica que:
(a) La unidad estaba en condiciones adecuadas para recibir la carga.
(b) La carga ha sido distribuida y asegurada para no moverse en condiciones normales de transporte (IMO: 0,8 g long, 0,5 g lat, 1,0 g vert).
(c) Los bultos apilados respetan los límites de carga sobre superficie; los frágiles no soportan peso encima.
(d) No se han cargado mercancías incompatibles entre sí.
(e) Los datos de bultos han sido verificados contra el packing list de origen.
(f) Se han colocado trincaje, separadores y elementos de fijación necesarios.
(g) Las aberturas de ventilación, drenaje e identificación no están obstruidas.</div>
    <h2>5. Firmas</h2>
    <div class="sig-grid">
      <div class="sig-box"><div class="sig-label">Responsable arrumazón</div>Nombre:<br>___________<br><br>DNI:<br>___________<br><br>Firma:</div>
      <div class="sig-box"><div class="sig-label">Conductor</div>Nombre:<br>___________<br><br>Carnet:<br>___________<br><br>Firma:</div>
      <div class="sig-box"><div class="sig-label">Almacén origen</div>Responsable:<br>___________<br><br>Sello:<br><br>Firma:</div>
    </div>
    <h2>6. Destinatarios — acuse</h2>
    <table><tr><th>Orden</th><th>Destino</th><th>Fecha</th><th>Recibido</th><th>Firma</th></tr>
    ${state.destinations.map((d,i)=>`<tr style="height:36px"><td><b>${i+1}º</b></td><td>${d.name}</td><td>_____</td><td>_____</td><td>_____</td></tr>`).join('')}</table>
    ${docFooter('Página 2/2')}</div>`];
}

function generateSimpleCertDoc(){
  const truck=TRUCKS[state.truck]; const m=computeMetrics(state.placed,truck);
  const num=state._docNum||genDocNumber(); state._docNum=num;
  const byDest={}; for(const p of state.placed)(byDest[p.destination]=byDest[p.destination]||[]).push(p);
  return [`<div class="doc-sheet">${docHeader('ALBARÁN DE ARRUMAZÓN','Certificado simplificado',num)}
    <h1>Albarán de arrumazón</h1>
    <div class="field-grid">
      <div class="field"><span class="field-label">Origen:</span><span class="field-value">${state.origin}</span></div>
      <div class="field"><span class="field-label">Fecha:</span><span class="field-value">${new Date().toLocaleDateString('es-ES')}</span></div>
      <div class="field"><span class="field-label">Vehículo:</span><span class="field-value">${truck.name}</span></div>
      <div class="field"><span class="field-label">Nº:</span><span class="field-value">${num}</span></div>
    </div>
    <h2>Resumen</h2>
    <div class="kpi-row">
      <div class="kpi-box"><div class="k-label">Bultos</div><div class="k-value">${state.placed.length}</div></div>
      <div class="kpi-box"><div class="k-label">Peso</div><div class="k-value">${Math.round(m.totalW)} kg</div></div>
      <div class="kpi-box"><div class="k-label">Volumen</div><div class="k-value">${m.totalVol.toFixed(2)} m³</div></div>
      <div class="kpi-box"><div class="k-label">ML</div><div class="k-value">${m.lm.toFixed(2)} m</div></div>
    </div>
    <h2>Destinos</h2>
    <table><tr><th>#</th><th>Destino</th><th>Bultos</th><th>Peso kg</th><th>Vol m³</th></tr>
    ${state.destinations.map((d,i)=>{const it=byDest[d.name]||[];return `<tr><td>${i+1}</td><td><b>${d.name}</b></td><td>${it.length}</td><td>${Math.round(it.reduce((s,i)=>s+i.weight,0))}</td><td>${it.reduce((s,i)=>s+(i.L*i.A*i.H)/1e6,0).toFixed(2)}</td></tr>`;}).join('')}</table>
    <h2>Instrucciones</h2>
    <ul style="font-size:9pt;padding-left:20px">
      <li>Respetar orden LIFO: primer destino = parte delantera del trailer.</li>
      <li>Los bultos frágiles (⚠) no soportan peso encima.</li>
      <li>Verificar trincaje antes de partir.</li>
    </ul>
    <div class="sig-grid">
      <div class="sig-box"><div class="sig-label">Expedidor</div>Firma:</div>
      <div class="sig-box"><div class="sig-label">Conductor</div>Firma:</div>
      <div class="sig-box"><div class="sig-label">Fecha salida</div></div>
    </div>
    ${docFooter('Página única')}</div>`];
}

function generatePackingListDoc(){
  const num=state._docNum||genDocNumber(); state._docNum=num;
  const truck=TRUCKS[state.truck]; const m=computeMetrics(state.placed,truck);
  const ord=[...state.placed].sort((a,b)=>a.loadSeq-b.loadSeq);
  const FIRST=22, PP=34;
  const render=rows=>rows.map(p=>{
    const color=destColorFor(p.destination);
    return `<tr><td style="font-weight:700;color:#ff6b1a">${String(p.loadSeq).padStart(3,'0')}</td><td>${p.ref}</td><td>${p.type}</td><td><span class="dest-chip" style="background:${color}">${p.destination}</span></td><td>${p.L}×${p.A}×${p.H}</td><td>${Math.round(p.weight)}</td><td>${p.rotated?'R':''}</td><td>${p.y>0?'↑'+(p.y/100).toFixed(1):''}</td><td>${p.fragile?'⚠':''}${!p.stackable?'✕':''}</td></tr>`;
  }).join('');
  const head=`<table><tr><th>#</th><th>Ref</th><th>Tipo</th><th>Destino</th><th>LxAxH cm</th><th>Peso</th><th>Rot</th><th>Apilado</th><th>Flags</th></tr>`;
  const pages=[]; let idx=FIRST; let pn=1;
  const total=Math.ceil((ord.length-FIRST)/PP)+1;
  pages.push(`<div class="doc-sheet">${docHeader('PACKING LIST FINAL','Posiciones asignadas',num)}
    <h1>Packing list definitivo</h1>
    <div style="font-size:9pt;color:#555">${truck.name} · ${state.origin} · ${state.placed.length} bultos</div>
    <div class="kpi-row">
      <div class="kpi-box"><div class="k-label">Peso</div><div class="k-value">${Math.round(m.totalW)} kg</div></div>
      <div class="kpi-box"><div class="k-label">Vol</div><div class="k-value">${m.totalVol.toFixed(2)} m³</div></div>
      <div class="kpi-box"><div class="k-label">Ocup</div><div class="k-value">${m.volPct.toFixed(1)}%</div></div>
      <div class="kpi-box"><div class="k-label">ML</div><div class="k-value">${m.lm.toFixed(2)} m</div></div>
    </div>
    <h2>Listado por secuencia</h2>${head}${render(ord.slice(0,FIRST))}</table>
    ${docFooter(`Página 1/${total}`)}</div>`);
  while(idx<ord.length){pn++; const sl=ord.slice(idx,idx+PP); idx+=PP;
    pages.push(`<div class="doc-sheet">${docHeader('PACKING LIST FINAL',`Continuación · pág ${pn}`,num)}${head}${render(sl)}</table>${docFooter(`Página ${pn}/${total}`)}</div>`);}
  return pages;
}

function generateLashingDoc(){
  const num=state._docNum||genDocNumber();
  const truck=TRUCKS[state.truck];
  const data=computeLashing(state.placed);
  const p=data.params;
  const rows=data.groups.map(g=>`
    <tr>
      <td style="padding:5px;border:1px solid #ddd">${g.dest}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${g.items}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${Math.round(g.mass).toLocaleString()}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${Math.round(g.FxDaN).toLocaleString()}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${Math.round(g.FyDaN).toLocaleString()}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:center;font-weight:700;color:#c2410c">${g.nFric}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:center">${g.nDirect}</td>
    </tr>
  `).join('');
  return [`<div class="doc-sheet">${docHeader('PLAN DE AMARRE / TRINCA','EN 12195-1 · grupaje terrestre',num)}
    <div style="font-size:9.5pt;color:#333;line-height:1.6;margin-bottom:14px">
      Parámetros de cálculo — μ fricción <b>${p.mu}</b> · aceleración frontal <b>${p.cFwd}g</b> · lateral <b>${p.cLat}g</b> · pretensión STF <b>${p.STF} daN</b> · LC por correa <b>${p.LC} daN</b> · ángulo sobre-lona <b>${p.angle}°</b>.
    </div>
    <div style="background:#fff7ed;border-left:3px solid #f97316;padding:10px 12px;margin-bottom:14px;font-size:9pt;color:#7c2d12">
      Cumplimiento normativo aproximado. Revisa siempre EN 12195-1, reglamento CMR y las condiciones reales del vehículo (puntos de anclaje homologados, tipo de correas, DIN/ISO de eslingas).
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:14px">
      <thead>
        <tr style="background:#f4f4f5">
          <th style="padding:6px;border:1px solid #ddd;text-align:left">Destino</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:right">Bultos</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:right">Peso (kg)</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:right">Fx (daN)</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:right">Fy (daN)</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:center">Sobre-lona</th>
          <th style="padding:6px;border:1px solid #ddd;text-align:center">Directos 30°</th>
        </tr>
      </thead>
      <tbody>${rows||'<tr><td colspan="7" style="padding:12px;text-align:center;color:#888">— sin bultos —</td></tr>'}</tbody>
      <tfoot>
        <tr style="background:#fafafa;font-weight:700">
          <td style="padding:6px;border:1px solid #ddd">TOTAL</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right">${state.placed.length}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right">${Math.round(data.mass).toLocaleString()}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right">${Math.round(data.FxDaN).toLocaleString()}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right">${Math.round(data.FyDaN).toLocaleString()}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
    <h3 style="font-size:10pt;margin:16px 0 6px 0">Recomendaciones operativas</h3>
    <ul style="font-size:9pt;color:#333;line-height:1.6;padding-left:18px">
      <li>Colocar <b>piezas pesadas al fondo</b> y bajar el CdG para cumplir el envolvente (ver plano de carga).</li>
      <li>Separar bultos ADR incompatibles mínimo ${state.separation.adr} cm según matriz de segregación (ver certificado ADR si aplica).</li>
      <li>Usar <b>esquineras</b> sobre palets y bultos frágiles antes de ceñir la correa.</li>
      <li>Verificar ángulo real de ceñido: &gt;80° maximiza fricción; si &lt;30° considera amarre directo/cruz.</li>
      <li>Revisar amarres cada <b>80 km</b> o tras frenadas bruscas — especialmente en las primeras horas.</li>
    </ul>
    ${docFooter('Plan de amarre · conforme a EN 12195-1')}
  </div>`];
}

// ============================================================
// INSTRUCCIONES OPERATIVAS (origen / destinos)
// ============================================================
function _placedSortedForLoad(){
  return [...state.placed].sort((a,b)=>a.loadSeq-b.loadSeq);
}
function _remontsInfo(){
  // Mapea cada bulto a los que lleva encima para indicar apilados
  const out={};
  for(const p of state.placed){
    if(p.supporters && p.supporters.length){
      for(const sid of p.supporters){
        (out[sid]=out[sid]||[]).push(p);
      }
    }
  }
  return out;
}
function _adrSummaryForItems(items){
  const classes=[...new Set(items.filter(i=>i.adr).map(i=>i.adr))].sort();
  if(!classes.length) return {classes:[], html:''};
  let conflicts=[];
  for(let i=0;i<classes.length;i++) for(let j=i+1;j<classes.length;j++) if(adrConflict(classes[i],classes[j])) conflicts.push([classes[i],classes[j]]);
  const chips=classes.map(c=>{
    const info=ADR_CLASSES[c]||{label:'',color:'#ef4444'};
    return `<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:${info.color};color:#0a0a0a;font-weight:700;font-size:9pt;margin:2px 4px 2px 0">Clase ${c} · ${info.label}</span>`;
  }).join('');
  let conflictHtml='';
  if(conflicts.length){
    conflictHtml=`<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:8px 10px;margin-top:6px;font-size:9pt;color:#7f1d1d">⚠ <b>Clases incompatibles a bordo</b>: ${conflicts.map(c=>c.join('↔')).join(' · ')} — mantener separación mínima de ${state.separation.adr} cm y comprobar carta de porte ADR.</div>`;
  }
  return {classes, html:`${chips}${conflictHtml}`};
}

function generateOriginInstructionsDoc(){
  const num=state._docNum||genDocNumber();
  const truck=TRUCKS[state.truck];
  const sorted=_placedSortedForLoad();
  const remonts=_remontsInfo();
  const adr=_adrSummaryForItems(sorted);
  const method=({lifo:'LIFO · último cargado · primero descargado',fifo:'FIFO · primero cargado · primero descargado',weight:'Por peso · pesado al fondo',manual:'Manual · orden definido'})[state.loadingMethod]||state.loadingMethod;
  const destOrderHtml=state.destinations.map((d,i)=>`<span style="display:inline-block;padding:3px 8px;border-radius:4px;background:${d.color}22;border:1px solid ${d.color};color:#333;font-weight:600;font-size:9pt;margin:2px 4px 2px 0">${i+1}. ${d.name}</span>`).join('');
  const rows=sorted.map(p=>{
    const top=remonts[p.id]?remonts[p.id].map(x=>x.ref||'(sin ref)').join(', '):'—';
    const obs=[];
    if(p.fragile) obs.push('<b style="color:#b91c1c">FRÁGIL</b>');
    if(p.noStackTop) obs.push('<b style="color:#b91c1c">NO APILAR ENCIMA</b>');
    if(p.maxTop>0) obs.push(`máx. encima ${p.maxTop} kg`);
    if(p.adr){const ai=ADR_CLASSES[p.adr]; obs.push(`<span style="background:${ai.color};color:#0a0a0a;padding:1px 6px;border-radius:3px;font-weight:700">ADR ${p.adr}</span>`);}
    if(p.stackedOn) obs.push(`apilado sobre ${p.stackedOn}`);
    return `<tr>
      <td style="padding:5px;border:1px solid #ddd;text-align:center;font-weight:700">${String(p.loadSeq).padStart(3,'0')}</td>
      <td style="padding:5px;border:1px solid #ddd">${p.ref||'(sin ref)'}</td>
      <td style="padding:5px;border:1px solid #ddd"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${destColorFor(p.destination)};margin-right:5px"></span>${p.destination}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right;font-family:monospace;font-size:8.5pt">x ${Math.round(p.x)}·y ${Math.round(p.y)}·z ${Math.round(p.z)}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${p.L}×${p.A}×${p.H}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:right">${Math.round(p.weight).toLocaleString()}</td>
      <td style="padding:5px;border:1px solid #ddd;text-align:center">${p.stackable?'Sí':'No'}</td>
      <td style="padding:5px;border:1px solid #ddd;font-size:8.5pt">${obs.join(' · ')||'—'}</td>
    </tr>`;
  }).join('');
  const noStack=sorted.filter(p=>p.noStackTop||!p.stackable||p.fragile);
  const noStackRows=noStack.length?noStack.map(p=>{
    const why=[];
    if(!p.stackable) why.push('no remontable');
    if(p.noStackTop) why.push('no apilar encima');
    if(p.fragile) why.push('frágil');
    return `<li style="margin-bottom:3px"><b>${p.ref||'(sin ref)'}</b> · ${p.destination} · ${why.join(' + ')}</li>`;
  }).join(''):'<li style="color:#888">— ninguno —</li>';
  const lash=computeLashing(state.placed);
  const lashRows=lash.groups.map(g=>`<tr><td style="padding:4px;border:1px solid #ddd">${g.dest}</td><td style="padding:4px;border:1px solid #ddd;text-align:right">${Math.round(g.mass).toLocaleString()} kg</td><td style="padding:4px;border:1px solid #ddd;text-align:center;font-weight:700">${g.nFric}</td></tr>`).join('');

  const pages=[`<div class="doc-sheet">${docHeader('INSTRUCCIONES · ALMACÉN CONSOLIDADOR','Origen: '+state.origin,num)}
    <div style="font-size:9pt;color:#333;margin-bottom:10px">
      <b>Vehículo:</b> ${truck.name} · ${truck.L}×${truck.A}×${truck.H} cm · MMA ${truck.maxKg.toLocaleString()} kg ·
      <b>Método:</b> ${method}
    </div>
    <div style="font-size:9pt;color:#333;margin-bottom:8px"><b>Orden de destinos (ruta de entrega):</b><br>${destOrderHtml}</div>

    <h3 style="font-size:10pt;margin:14px 0 6px">1 · Secuencia de carga</h3>
    <p style="font-size:8.5pt;color:#666;margin-bottom:6px">Cargar en orden ascendente (001 primero). x=0 es el fondo del vehículo (frente del remolque). La posición está en cm relativos a la esquina delantera-izquierda.</p>
    <table style="width:100%;border-collapse:collapse;font-size:8.5pt">
      <thead><tr style="background:#f4f4f5">
        <th style="padding:5px;border:1px solid #ddd">#</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:left">Ref</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:left">Destino</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:right">Pos (cm)</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:right">L×A×H</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:right">kg</th>
        <th style="padding:5px;border:1px solid #ddd">Remont.</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:left">Observaciones</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${docFooter('Hoja 1/2 · secuencia')}</div>`,
    `<div class="doc-sheet">${docHeader('INSTRUCCIONES · ALMACÉN CONSOLIDADOR','Separación · ADR · Apilado · Amarre',num)}
    <h3 style="font-size:10pt;margin:0 0 6px">2 · Separación entre lotes</h3>
    <ul style="font-size:9pt;color:#333;line-height:1.6;padding-left:18px;margin-bottom:14px">
      <li>Separación mínima entre destinos: <b>${state.separation.dest} cm</b></li>
      <li>Separación mínima entre ADR incompatibles: <b>${state.separation.adr} cm</b></li>
      <li>Usa separadores de madera, cartón o airbags cuando el hueco supere 10 cm para evitar desplazamientos.</li>
      <li>Marca el cambio de lote con cinta de color en el suelo para identificar cada destino desde la trasera.</li>
    </ul>

    <h3 style="font-size:10pt;margin:0 0 6px">3 · Mercancía ADR</h3>
    ${adr.classes.length?`<div style="margin-bottom:8px">${adr.html}</div>
      <ul style="font-size:9pt;color:#333;line-height:1.6;padding-left:18px;margin-bottom:14px">
        <li>Etiquetar bultos con rombo de clase visible en 2 caras opuestas antes del cierre del remolque.</li>
        <li>Preparar carta de porte ADR (ADR 5.4.1) y certificado de carga/descarga.</li>
        <li>Verificar que el conductor porta EPI ADR (gafas, guantes, linterna ATEX) y extintores adicionales según clase.</li>
        <li>No cargar a altura superior a 1/3 del alto del vehículo si hay clase 2 o 3 (riesgo de vuelco).</li>
      </ul>`:'<p style="font-size:9pt;color:#666;margin-bottom:14px">No hay mercancía ADR en este envío.</p>'}

    <h3 style="font-size:10pt;margin:0 0 6px">4 · Apilado y manipulación</h3>
    <p style="font-size:9pt;color:#333;margin-bottom:4px">Bultos con restricciones:</p>
    <ul style="font-size:9pt;color:#333;line-height:1.6;padding-left:18px;margin-bottom:10px">${noStackRows}</ul>
    <p style="font-size:9pt;color:#333;margin-bottom:14px">Respeta el peso máximo encima indicado en la secuencia. Coloca esquineras de cartón sobre cualquier bulto sensible antes de apilar o amarrar.</p>

    <h3 style="font-size:10pt;margin:0 0 6px">5 · Amarre / trinca (resumen)</h3>
    <p style="font-size:9pt;color:#666;margin-bottom:4px">Parámetros: μ=${lash.params.mu} · 0.8g frontal · 0.5g lateral · STF ${lash.params.STF} daN · ángulo ${lash.params.angle}°</p>
    <table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px">
      <thead><tr style="background:#f4f4f5">
        <th style="padding:5px;border:1px solid #ddd;text-align:left">Destino</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:right">Peso</th>
        <th style="padding:5px;border:1px solid #ddd;text-align:center">Correas sobre-lona</th>
      </tr></thead>
      <tbody>${lashRows||'<tr><td colspan="3" style="text-align:center;padding:6px;color:#888">—</td></tr>'}</tbody>
    </table>
    <p style="font-size:8.5pt;color:#666">Ver hoja "Plan de amarre" para detalle completo (directos, ángulos, puntos de anclaje).</p>
    ${docFooter('Hoja 2/2 · operativa')}</div>`];
  return pages;
}

function generateDestinationInstructionsDoc(){
  const num=state._docNum||genDocNumber();
  const truck=TRUCKS[state.truck];
  const remonts=_remontsInfo();
  const pages=[];
  // Orden de descarga depende de loadingMethod. LIFO: primero destino 1, último N.
  // Un destino por hoja.
  for(let idx=0; idx<state.destinations.length; idx++){
    const d=state.destinations[idx];
    const items=_placedSortedForLoad().filter(p=>p.destination===d.name);
    if(!items.length) continue;
    const totalKg=items.reduce((s,p)=>s+p.weight,0);
    const totalVol=items.reduce((s,p)=>s+(p.L*p.A*p.H)/1e6,0);
    let xMin=Infinity,xMax=-Infinity;
    items.forEach(p=>{xMin=Math.min(xMin,p.x); xMax=Math.max(xMax,p.x+p.L);});
    const adr=_adrSummaryForItems(items);
    const rows=items.map(p=>{
      const obs=[];
      if(p.fragile) obs.push('<b style="color:#b91c1c">FRÁGIL</b>');
      if(p.noStackTop) obs.push('No apilar encima');
      if(!p.stackable) obs.push('No remontable');
      if(p.adr){const ai=ADR_CLASSES[p.adr]; obs.push(`<span style="background:${ai.color};color:#0a0a0a;padding:1px 6px;border-radius:3px;font-weight:700">ADR ${p.adr}</span>`);}
      const top=remonts[p.id]?remonts[p.id].map(x=>`${x.ref} (${x.destination})`).join(', '):'—';
      return `<tr>
        <td style="padding:5px;border:1px solid #ddd;text-align:center;font-weight:700">${String(p.loadSeq).padStart(3,'0')}</td>
        <td style="padding:5px;border:1px solid #ddd">${p.ref||'(sin ref)'}</td>
        <td style="padding:5px;border:1px solid #ddd;text-align:right">${p.L}×${p.A}×${p.H}</td>
        <td style="padding:5px;border:1px solid #ddd;text-align:right">${Math.round(p.weight).toLocaleString()}</td>
        <td style="padding:5px;border:1px solid #ddd;text-align:right;font-family:monospace;font-size:8.5pt">x ${Math.round(p.x)}·z ${Math.round(p.z)}</td>
        <td style="padding:5px;border:1px solid #ddd;font-size:8.5pt">${obs.join(' · ')||'—'}</td>
        <td style="padding:5px;border:1px solid #ddd;font-size:8.5pt">${top}</td>
      </tr>`;
    }).join('');
    pages.push(`<div class="doc-sheet">${docHeader(`INSTRUCCIONES · ${d.name}`,`Almacén receptor · destino ${idx+1}/${state.destinations.length}`,num)}
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <div style="width:18px;height:18px;border-radius:5px;background:${d.color};border:1px solid #333"></div>
        <div style="font-weight:700;font-size:12pt;color:#1a1a1a">${d.name}</div>
        <div style="flex:1"></div>
        <div style="font-size:9pt;color:#333;text-align:right">
          <b>${items.length}</b> bultos · <b>${Math.round(totalKg).toLocaleString()}</b> kg · <b>${totalVol.toFixed(2)}</b> m³
        </div>
      </div>

      <h3 style="font-size:10pt;margin:0 0 4px">1 · Localización en el vehículo</h3>
      <p style="font-size:9pt;color:#333;margin-bottom:10px">Carga situada entre <b>x ${Math.round(xMin)} cm</b> y <b>x ${Math.round(xMax)} cm</b> desde el fondo del remolque. Longitud ocupada por este destino: <b>${Math.round(xMax-xMin)} cm</b>.</p>

      ${adr.classes.length?`<h3 style="font-size:10pt;margin:10px 0 4px">2 · ADR</h3>
        <div style="margin-bottom:6px">${adr.html}</div>
        <ul style="font-size:9pt;color:#333;line-height:1.5;padding-left:18px;margin-bottom:10px">
          <li>Verificar integridad de etiquetas y envases antes de descargar.</li>
          <li>Descargar en zona ADR dedicada, separada de incompatibles.</li>
          <li>Firmar carta de porte ADR · registrar tipo y cantidad.</li>
        </ul>`:''}

      <h3 style="font-size:10pt;margin:10px 0 4px">${adr.classes.length?'3':'2'} · Descarga</h3>
      <p style="font-size:8.5pt;color:#666;margin-bottom:6px">Descargar en orden <b>descendente</b> de secuencia (el último bulto cargado sale primero, por eso bultos con # alto están más cerca de la puerta trasera).</p>
      <table style="width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:10px">
        <thead><tr style="background:#f4f4f5">
          <th style="padding:5px;border:1px solid #ddd">#</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:left">Ref</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:right">L×A×H</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:right">kg</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:right">Pos</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:left">Obs.</th>
          <th style="padding:5px;border:1px solid #ddd;text-align:left">Bultos encima</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <h3 style="font-size:10pt;margin:10px 0 4px">${adr.classes.length?'4':'3'} · Manipulación</h3>
      <ul style="font-size:9pt;color:#333;line-height:1.5;padding-left:18px;margin-bottom:10px">
        <li>Comprobar amarres antes de abrir la puerta trasera — riesgo de caída.</li>
        <li>Retirar con carretilla elevadora respetando capacidad de forks y altura de pinchado.</li>
        <li>Si hay bultos <b>NO apilar encima</b>, marcarlos con adhesivo rojo en el área de recepción hasta su ubicación final.</li>
        <li>Devolver palets EUR intercambiables al conductor si procede (vale de cambio).</li>
      </ul>

      <h3 style="font-size:10pt;margin:10px 0 4px">${adr.classes.length?'5':'4'} · Recepción</h3>
      <table style="width:100%;border-collapse:collapse;font-size:9pt">
        <tr>
          <td style="padding:6px;border:1px solid #ddd;width:50%">Bultos contados: ______ / ${items.length}</td>
          <td style="padding:6px;border:1px solid #ddd;width:50%">Peso confirmado: ______ kg / ${Math.round(totalKg).toLocaleString()} kg</td>
        </tr>
        <tr>
          <td style="padding:6px;border:1px solid #ddd">Incidencias: ______________________________</td>
          <td style="padding:6px;border:1px solid #ddd">Hora descarga: ______</td>
        </tr>
        <tr>
          <td style="padding:22px 6px 6px;border:1px solid #ddd;border-top:none">Firma conductor</td>
          <td style="padding:22px 6px 6px;border:1px solid #ddd;border-top:none">Firma almacén receptor</td>
        </tr>
      </table>
      ${docFooter(`Destino ${idx+1}/${state.destinations.length} · ${d.name}`)}</div>`);
  }
  if(!pages.length){
    pages.push(`<div class="doc-sheet">${docHeader('INSTRUCCIONES DE DESTINO','— sin destinos con bultos —',num)}<p style="font-size:10pt;color:#666;text-align:center;margin-top:60px">No hay bultos colocados para ningún destino todavía. Optimiza primero.</p>${docFooter('')}</div>`);
  }
  return pages;
}

function generateFullDossier(){
  state._docNum=genDocNumber();
  return [
    ...generatePlanoDoc(),
    ...generateCtuDoc(),
    ...generateSimpleCertDoc(),
    ...generateOriginInstructionsDoc(),
    ...generateDestinationInstructionsDoc(),
    ...generateLashingDoc(),
    ...generatePackingListDoc()
  ];
}

function showDoc(pages,title){
  if(!state.placed.length){$('statusText').textContent='Optimiza primero para generar docs';return;}
  $('docTitleText').textContent=title;
  $('docContainer').innerHTML=pages.join('');
  $('docPageIndicator').textContent=`${pages.length} pág${pages.length!==1?'s':''}`;
  $('docModal').classList.add('open');
}

// ============================================================
// STEPPER
// ============================================================
function updateStepper(){
  const steps=document.querySelectorAll('.step');
  // 1: truck always done
  steps[0].classList.add('done');
  // 2: destinations
  if(state.destinations.length>=1) steps[1].classList.add('done');
  // 3: items
  if(state.items.length>0){steps[2].classList.add('done');} else {steps[2].classList.remove('done');}
  // 4: optimized
  if(state.placed.length>0){steps[3].classList.add('done');steps[3].classList.add('active');} else {steps[3].classList.remove('done');}
}

// ============================================================
// EDIT MODE (TWEAKS)
// ============================================================
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "orange",
  "density": "comfortable",
  "boxStyle": "solid"
}/*EDITMODE-END*/;

function applyTweak(key,val){
  const body=document.body;
  if(key==='theme'){body.setAttribute('data-theme',val);}
  else if(key==='accent'){body.setAttribute('data-accent',val); if(state.placed.length){buildTruckMesh();}}
  else if(key==='density'){body.setAttribute('data-density',val);}
  else if(key==='boxStyle'){state.boxStyle=val; if(state.placed.length)buildItemMeshes(state.placed);}
  // update active visuals
  document.querySelectorAll('.sw').forEach(s=>s.classList.toggle('active', s.dataset.accent===body.getAttribute('data-accent')));
  document.querySelectorAll('[data-theme]').forEach(b=>{if(b.classList.contains('opt')) b.classList.toggle('active', b.dataset.theme===body.getAttribute('data-theme'));});
  document.querySelectorAll('[data-density]').forEach(b=>{if(b.classList.contains('opt')) b.classList.toggle('active', b.dataset.density===body.getAttribute('data-density'));});
  document.querySelectorAll('[data-boxstyle]').forEach(b=>b.classList.toggle('active', b.dataset.boxstyle===state.boxStyle));
}

function initTweaks(){
  Object.entries(TWEAK_DEFAULTS).forEach(([k,v])=>applyTweak(k,v));
  window.addEventListener('message', e=>{
    if(!e.data) return;
    if(e.data.type==='__activate_edit_mode') $('tweaksPanel').classList.add('open');
    else if(e.data.type==='__deactivate_edit_mode') $('tweaksPanel').classList.remove('open');
  });
  try{window.parent.postMessage({type:'__edit_mode_available'},'*');}catch(e){}

  $('tweaksClose').addEventListener('click',()=>$('tweaksPanel').classList.remove('open'));
  document.querySelectorAll('.sw').forEach(sw=>sw.addEventListener('click',()=>{
    applyTweak('accent',sw.dataset.accent);
    try{window.parent.postMessage({type:'__edit_mode_set_keys',edits:{accent:sw.dataset.accent}},'*');}catch(e){}
  }));
  document.querySelectorAll('.tweak-opts .opt').forEach(o=>o.addEventListener('click',()=>{
    if(o.dataset.theme){applyTweak('theme',o.dataset.theme); try{window.parent.postMessage({type:'__edit_mode_set_keys',edits:{theme:o.dataset.theme}},'*');}catch(e){}}
    if(o.dataset.density){applyTweak('density',o.dataset.density); try{window.parent.postMessage({type:'__edit_mode_set_keys',edits:{density:o.dataset.density}},'*');}catch(e){}}
    if(o.dataset.boxstyle){applyTweak('boxStyle',o.dataset.boxstyle); try{window.parent.postMessage({type:'__edit_mode_set_keys',edits:{boxStyle:o.dataset.boxstyle}},'*');}catch(e){}}
  }));
}

// ============================================================
// INIT
// ============================================================
function init(){
  // ===== Mobile drawers (CABLEADOS PRIMERO para que siempre funcionen
  // aunque otra parte de init falle — p.ej. WebGL no disponible) =====
  const backdrop=$('panelBackdrop'); const leftP=$('leftPanel'); const rightP=$('rightPanel');
  const openLeft=()=>{if(leftP){leftP.classList.add('open');} if(rightP)rightP.classList.remove('open'); if(backdrop)backdrop.classList.add('open');};
  const openRight=()=>{if(rightP){rightP.classList.add('open');} if(leftP)leftP.classList.remove('open'); if(backdrop)backdrop.classList.add('open');};
  const closeAll=()=>{if(leftP)leftP.classList.remove('open'); if(rightP)rightP.classList.remove('open'); if(backdrop)backdrop.classList.remove('open');};
  { const el=$('fabOpenLeft'); if(el) el.addEventListener('click',openLeft); }
  { const el=$('fabOpenRight'); if(el) el.addEventListener('click',openRight); }
  if(backdrop) backdrop.addEventListener('click',closeAll);
  document.querySelectorAll('.panel-close-btn').forEach(b=>b.addEventListener('click',closeAll));
  window.addEventListener('keydown',e=>{if(e.key==='Escape')closeAll();});
  const closeIfNarrow=()=>{if(window.innerWidth<=1100) closeAll();};
  window.closeIfNarrow=closeIfNarrow;

  // Handler global de errores: muestra toast visible (util sin devtools)
  const showErr=(msg)=>{
    let bar=document.getElementById('__errBar');
    if(!bar){
      bar=document.createElement('div'); bar.id='__errBar';
      bar.style.cssText='position:fixed;left:10px;right:10px;bottom:env(safe-area-inset-bottom,10px);max-height:40vh;overflow:auto;background:#7f1d1d;color:#fff;padding:10px 14px;border-radius:8px;font:12px/1.4 -apple-system,system-ui,sans-serif;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
      bar.innerHTML='<b>⚠ Error</b><button style="float:right;background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer" onclick="this.parentNode.remove()">×</button><div id="__errBody" style="margin-top:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-word"></div>';
      document.body.appendChild(bar);
    }
    const body=document.getElementById('__errBody');
    body.textContent=(body.textContent?body.textContent+'\n':'')+msg;
  };
  window.addEventListener('error', ev=>{showErr(ev.message+(ev.filename?' @ '+ev.filename.split('/').pop()+':'+ev.lineno:''));});
  window.addEventListener('unhandledrejection', ev=>{showErr('Promise: '+(ev.reason&&ev.reason.message||ev.reason||''));});

  // Inits pesados — si fallan, el resto de la UI ya es interactivo
  const safe=(fn,name)=>{try{fn();}catch(e){console.error(name+' failed:',e); showErr(name+': '+e.message);}};
  safe(renderDestinations,'renderDestinations');
  safe(renderManualDestSelect,'renderManualDestSelect');
  safe(initThree,'initThree');
  safe(initTweaks,'initTweaks');
  safe(updateKPIs,'updateKPIs');
  safe(updateStepper,'updateStepper');

  // truck cards
  document.querySelectorAll('.truck-card').forEach(card=>{
    card.addEventListener('click',()=>{
      document.querySelectorAll('.truck-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input').checked=true;
      state.truck=card.querySelector('input').value;
      buildTruckMesh();
      if(state.placed.length) runOptimization();
    });
  });

  $('originName').addEventListener('input',e=>{state.origin=e.target.value;});

  // tabs
  document.querySelectorAll('.tab-bar .tab').forEach(t=>{
    t.addEventListener('click',()=>{
      document.querySelectorAll('.tab-bar .tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.querySelector(`.tab-content[data-tab="${t.dataset.tab}"]`).classList.add('active');
    });
  });

  // dropzone
  const fd=$('fileDrop'), fi=$('fileInput');
  fd.addEventListener('click',()=>fi.click());
  fd.addEventListener('dragover',e=>{e.preventDefault();fd.classList.add('dragover');});
  fd.addEventListener('dragleave',()=>fd.classList.remove('dragover'));
  fd.addEventListener('drop',e=>{e.preventDefault();fd.classList.remove('dragover'); if(e.dataTransfer.files.length)handleFile(e.dataTransfer.files[0]);});
  fi.addEventListener('change',e=>{if(e.target.files.length)handleFile(e.target.files[0]);});

  $('btnParseText').addEventListener('click',()=>{
    const txt=$('textInput').value.trim(); if(!txt) return;
    const items=parseFreeText(txt);
    if(!items.length){$('statusText').textContent='No detecté bultos en el texto';return;}
    addItems(items);
    $('fileStatus').textContent=`✓ ${items.length} bultos parseados`;
  });

  $('btnAddManual').addEventListener('click',()=>{
    const ref=$('mRef').value.trim()||`ITEM-${state.items.length+1}`;
    const type=$('mType').value;
    const L=parseNum($('mL').value)||100, A=parseNum($('mA').value)||100, H=parseNum($('mH').value)||100;
    const W=parseNum($('mW').value)||100, Q=parseInt($('mQ').value)||1;
    const dest=$('mDest').value, stk=$('mStack').checked, frag=$('mFrag').checked;
    const maxTop=parseNum(($('mMaxTop')||{}).value)||0;
    const adrSel=($('mAdr')||{}).value||''; const adr=adrSel||null;
    const noTop=(($('mNoTop')||{}).checked)===true;
    for(let i=0;i<Q;i++) state.items.push(makeItem({ref:Q>1?`${ref}/${i+1}`:ref,type,L,A,H,weight:W,destination:dest,stackable:stk,fragile:frag,maxTop,adr,noStackTop:noTop}));
    $('fileStatus').textContent=`✓ ${Q} bulto${Q!==1?'s':''} añadido${Q!==1?'s':''}`;
    $('itemCount').textContent=state.items.length;
    renderItemsList();
    updateStepper();
  });

  $('btnAddDest').addEventListener('click',()=>{
    state.destinations.push({name:`DESTINO ${state.destinations.length+1}`,color:PALETTE[state.destinations.length%PALETTE.length]});
    renderDestinations(); renderManualDestSelect();
  });

  // level picker (scoped)
  document.querySelectorAll('#levelPicker .level').forEach(l=>{
    l.addEventListener('click',()=>{
      document.querySelectorAll('#levelPicker .level').forEach(x=>x.classList.remove('selected'));
      l.classList.add('selected');
      state.optLevel=l.dataset.level;
    });
  });
  // method picker (carga/descarga)
  document.querySelectorAll('#methodPicker .level').forEach(l=>{
    l.addEventListener('click',()=>{
      document.querySelectorAll('#methodPicker .level').forEach(x=>x.classList.remove('selected'));
      l.classList.add('selected');
      state.loadingMethod=l.dataset.method;
      if(state.placed.length) renderSequenceTable();
    });
  });
  const onSepChange=()=>{
    const d=parseFloat($('sepDest').value); if(!isNaN(d)) state.separation.dest=Math.max(0,d);
    const a=parseFloat($('sepAdr').value);  if(!isNaN(a)) state.separation.adr =Math.max(0,a);
  };
  ['sepDest','sepAdr'].forEach(id=>{const el=$(id); if(el) el.addEventListener('input',onSepChange);});

  $('btnRun').addEventListener('click',()=>{closeIfNarrow(); runOptimization();});
  $('btnClear').addEventListener('click',()=>{
    state.items=[];state.placed=[];state.unloaded=[];state.selectedItem=null;state.optMeta=null;
    clearItemMeshes();
    $('emptyState').style.display='block'; $('fileStatus').textContent='';
    $('viewerScale').style.display='none'; $('viewerLegend').style.display='none';
    closeItemDetails();
    renderItemsList();
    updateKPIs(); renderSequenceTable(); renderUnloaded(); updateStepper();
  });
  $('btnDemo').addEventListener('click',()=>{loadDemo(); setTimeout(runOptimization,200);});

  // viewer controls
  document.querySelectorAll('.vc-btn[data-view]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.vc-btn[data-view]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const v=b.dataset.view;
    if(v==='top'){controls.targetX=0;controls.targetY=-89;}
    else if(v==='side'){controls.targetX=-90;controls.targetY=0;}
    else if(v==='back'){controls.targetX=0;controls.targetY=0;}
    else{controls.targetX=-30;controls.targetY=-25;}
  }));
  $('vcFit').addEventListener('click',fitView);
  $('vcExplode').addEventListener('click',(e)=>{state.exploded=!state.exploded; e.currentTarget.classList.toggle('active'); if(state.placed.length)buildItemMeshes(state.placed);});
  $('vcTransp').addEventListener('click',(e)=>{state.transparent=!state.transparent; e.currentTarget.classList.toggle('active'); if(state.placed.length)buildItemMeshes(state.placed);});

  // item detail + ADR matrix + propuestas
  { const el=$('idClose'); if(el) el.addEventListener('click',()=>{state.selectedItem=null; if(state.placed.length) buildItemMeshes(state.placed); closeItemDetails();}); }
  { const el=$('btnShowAdr'); if(el) el.addEventListener('click',openAdrMatrix); }
  { const el=$('btnShowAdr2'); if(el) el.addEventListener('click',openAdrMatrix); }
  { const el=$('btnProposals'); if(el) el.addEventListener('click',runProposals); }
  // Lashing inputs + viz toggle
  ['lMu','lLC','lSTF','lAng'].forEach(id=>{const el=$(id); if(el) el.addEventListener('input',()=>{renderLashing(); if(state.showLashing) buildLashingViz();});});
  { const el=$('btnLashViz'); if(el) el.addEventListener('click',()=>{
    state.showLashing=!state.showLashing;
    el.classList.toggle('on', state.showLashing);
    el.textContent=state.showLashing?'Ocultar en 3D':'Mostrar en 3D';
    buildLashingViz();
  }); }
  $('adrModal').addEventListener('click',e=>{if(e.target===$('adrModal')) $('adrModal').classList.remove('open');});
  $('propModal').addEventListener('click',e=>{if(e.target===$('propModal')) $('propModal').classList.remove('open');});

  // help + theme
  $('btnHelp').addEventListener('click',()=>$('helpModal').classList.add('open'));
  // stepper clicks → open left panel on narrow, scroll to section on wide
  document.querySelectorAll('#stepper .step').forEach(st=>st.addEventListener('click',()=>{
    const n=st.dataset.step;
    if(window.innerWidth<=1100){openLeft();}
    const target=document.querySelector(`.config-section[data-section="${n}"]`);
    if(target){setTimeout(()=>target.scrollIntoView({behavior:'smooth',block:'start'}),window.innerWidth<=1100?250:0);}
  }));
  document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeModal).classList.remove('open')));
  $('btnTheme').addEventListener('click',()=>{
    const cur=document.body.getAttribute('data-theme');
    applyTweak('theme', cur==='dark'?'light':'dark');
    try{window.parent.postMessage({type:'__edit_mode_set_keys',edits:{theme:document.body.getAttribute('data-theme')}},'*');}catch(e){}
  });

  // docs
  $('btnDocPlan').addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generatePlanoDoc(),'Plano de carga');});
  $('btnDocCtu').addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateCtuDoc(),'Certificado CTU');});
  $('btnDocSimple').addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateSimpleCertDoc(),'Albarán de arrumazón');});
  $('btnDocPacking').addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generatePackingListDoc(),'Packing list final');});
  // Item edit modal + list + templates + XLSX
  { const el=$('btnClearItems'); if(el) el.addEventListener('click',()=>{
    if(!state.items.length) return;
    if(!confirm('Vaciar la lista de bultos?')) return;
    state.items=[]; state.placed=[]; state.unloaded=[]; state.selectedItem=null;
    clearItemMeshes(); clearCoGMarker(); clearLashingViz();
    renderItemsList(); updateKPIs(); renderSequenceTable(); renderUnloaded(); updateStepper();
    $('emptyState').style.display='block'; $('itemCount').textContent='0';
    closeItemDetails();
  }); }
  { const el=$('iemSave'); if(el) el.addEventListener('click',saveItemEdit); }
  { const el=$('iemDup');  if(el) el.addEventListener('click',duplicateItem); }
  { const el=$('iemDel');  if(el) el.addEventListener('click',deleteCurrentItem); }
  $('itemEditModal').addEventListener('click',e=>{if(e.target===$('itemEditModal')) $('itemEditModal').classList.remove('open');});
  { const el=$('btnSaveTpl'); if(el) el.addEventListener('click',saveTemplate); }
  { const el=$('btnLoadTpl'); if(el) el.addEventListener('click',loadTemplate); }
  { const el=$('btnDelTpl');  if(el) el.addEventListener('click',deleteTemplate); }
  { const el=$('btnExportXLSX'); if(el) el.addEventListener('click',exportXLSX); }
  refreshTplSelect();
  renderItemsList();
  { const el=$('btnDocLash'); if(el) el.addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateLashingDoc(),'Plan de amarre / trinca');}); }
  { const el=$('btnDocOrigin'); if(el) el.addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateOriginInstructionsDoc(),'Instrucciones almacén consolidador');}); }
  { const el=$('btnDocDest'); if(el) el.addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateDestinationInstructionsDoc(),'Instrucciones almacenes receptores');}); }
  $('btnDocAll').addEventListener('click',()=>{state._docNum=genDocNumber(); showDoc(generateFullDossier(),'Dossier completo');});
  $('btnDocClose').addEventListener('click',()=>$('docModal').classList.remove('open'));
  $('btnDocPrint').addEventListener('click',()=>window.print());
  $('btnDocPdf').addEventListener('click',async()=>{
    try{
      $('btnDocPdf').textContent='Generando…'; $('btnDocPdf').disabled=true;
      const {jsPDF}=window.jspdf;
      const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
      const sheets=document.querySelectorAll('#docContainer .doc-sheet');
      for(let i=0;i<sheets.length;i++){
        const canvas=await html2canvas(sheets[i],{scale:2,useCORS:true,backgroundColor:'#fff',logging:false});
        const img=canvas.toDataURL('image/jpeg',0.92);
        if(i>0) pdf.addPage();
        pdf.addImage(img,'JPEG',0,0,210,297,undefined,'FAST');
      }
      pdf.save(`groupage_${Date.now()}.pdf`);
      $('btnDocPdf').textContent='↓ Descargar PDF'; $('btnDocPdf').disabled=false;
    }catch(err){console.error(err); alert('Error PDF: '+err.message); $('btnDocPdf').textContent='↓ Descargar PDF'; $('btnDocPdf').disabled=false;}
  });

  $('btnExportCSV').addEventListener('click',exportCSV);
  $('btnExportJSON').addEventListener('click',exportJSON);

  // keyboard
  window.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select')) return;
    if(e.key==='r'||e.key==='R') runOptimization();
    else if(e.key==='f'||e.key==='F') fitView();
    else if(e.key==='1') document.querySelector('.vc-btn[data-view="top"]').click();
    else if(e.key==='2') document.querySelector('.vc-btn[data-view="side"]').click();
    else if(e.key==='3') document.querySelector('.vc-btn[data-view="back"]').click();
    else if(e.key==='4') document.querySelector('.vc-btn[data-view="persp"]').click();
    else if(e.key==='t'||e.key==='T') $('btnTheme').click();
    else if(e.key==='Escape'){document.querySelectorAll('.modal-mask.open,.doc-mask.open').forEach(m=>m.classList.remove('open'));}
  });

  // click outside modal closes
  $('helpModal').addEventListener('click',e=>{if(e.target===$('helpModal')) $('helpModal').classList.remove('open');});

  // ===== Cerrar app =====
  { const el=$('btnClose'); if(el) el.addEventListener('click',()=>{
    if(!confirm('¿Cerrar Groupage Optimizer? Los datos quedan guardados en este dispositivo.')) return;
    try{window.close();}catch(e){}
    // window.close() solo funciona en ventanas abiertas por script o PWA instaladas.
    // Si seguimos aqui, damos feedback al usuario.
    setTimeout(()=>{
      if(!document.hidden) alert('Tu navegador no permite cerrar automáticamente esta ventana. Ciérrala manualmente (⌘W / Ctrl+W) o sal desde el gestor de apps.');
    },180);
  }); }

  // ===== PWA: service worker + install prompt =====
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js').catch(()=>{});});
  }
  let _installEvt=null;
  const instBtn=$('btnInstall');
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); _installEvt=e;
    if(instBtn) instBtn.style.display='';
  });
  if(instBtn) instBtn.addEventListener('click',async()=>{
    if(!_installEvt){
      // iOS y fallback: muestra instrucciones
      alert('Para instalar:\\n\\niPhone/iPad — pulsa Compartir (↑) y "Añadir a pantalla de inicio".\\nAndroid/Chrome — menú ⋮ y "Instalar app".\\nPC (Chrome/Edge) — icono de instalación en la barra de direcciones.');
      return;
    }
    _installEvt.prompt();
    await _installEvt.userChoice;
    _installEvt=null;
    if(instBtn) instBtn.style.display='none';
  });
  window.addEventListener('appinstalled',()=>{_installEvt=null; if(instBtn) instBtn.style.display='none';});
  // Mostrar el boton tambien en iOS (beforeinstallprompt no dispara) si no esta ya instalada
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if(isIOS && !standalone && instBtn) instBtn.style.display='';
}

document.addEventListener('DOMContentLoaded', init);

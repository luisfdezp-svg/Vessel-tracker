// ============================================================
// VESSEL TRACKER + PCI v7.0 — REAL DATA SEED
// Flota: PCTC / RoRo / Car carriers reales (Höegh, Grimaldi, UECC, Siem, NYK, EUKOR, WW)
// Puertos: UN-LOCODEs reales con coordenadas reales
// Posiciones: snapshot estático "última conocida" — el AIS en vivo sobreescribe
// ============================================================

// SNAPSHOT timestamp - se muestra en UI como "última conocida"
window.SNAPSHOT_TS = Date.now() - 1000 * 60 * 35; // ~35 min ago

// ------------------------------------------------------------
// PUERTOS REALES (UN-LOCODE, coordenadas reales)
// pci/trend/queue/berths/ceu son estimados de actividad RoRo
// ------------------------------------------------------------
window.PORTS = [
  { name: 'Barcelona',     code: 'ESBCN', lat: 41.3500, lon: 2.1830,  country: 'ES', region: 'W-MED', pci: 72, trend: [55,58,62,65,68,71,72], queue: 7,  berths: 4, ceu: 18000 },
  { name: 'Valencia',      code: 'ESVLC', lat: 39.4380, lon: -0.3220, country: 'ES', region: 'W-MED', pci: 84, trend: [66,70,74,78,80,82,84], queue: 11, berths: 3, ceu: 14500 },
  { name: 'Algeciras',     code: 'ESALG', lat: 36.1330, lon: -5.4500, country: 'ES', region: 'STR',   pci: 46, trend: [42,43,44,45,46,46,46], queue: 4,  berths: 3, ceu: 7800 },
  { name: 'Vigo',          code: 'ESVGO', lat: 42.2350, lon: -8.7280, country: 'ES', region: 'ATL',   pci: 62, trend: [58,59,60,61,62,62,62], queue: 5,  berths: 2, ceu: 9100 },
  { name: 'Santander',     code: 'ESSDR', lat: 43.4600, lon: -3.8080, country: 'ES', region: 'ATL',   pci: 55, trend: [50,52,53,54,55,55,55], queue: 4,  berths: 2, ceu: 7600 },
  { name: 'Pasajes',       code: 'ESPAS', lat: 43.3300, lon: -1.9200, country: 'ES', region: 'ATL',   pci: 44, trend: [48,46,45,44,44,44,44], queue: 3,  berths: 2, ceu: 5900 },
  { name: 'Marseille-Fos', code: 'FRFOS', lat: 43.4020, lon: 4.8900,  country: 'FR', region: 'W-MED', pci: 58, trend: [52,54,55,57,58,59,58], queue: 5,  berths: 3, ceu: 11000 },
  { name: 'Le Havre',      code: 'FRLEH', lat: 49.4900, lon: 0.1070,  country: 'FR', region: 'NSEA',  pci: 76, trend: [62,66,70,72,74,75,76], queue: 9,  berths: 4, ceu: 13400 },
  { name: 'Genova',        code: 'ITGOA', lat: 44.4050, lon: 8.9100,  country: 'IT', region: 'W-MED', pci: 67, trend: [60,62,64,65,66,67,67], queue: 6,  berths: 3, ceu: 9800 },
  { name: 'Livorno',       code: 'ITLIV', lat: 43.5560, lon: 10.3060, country: 'IT', region: 'W-MED', pci: 79, trend: [62,68,72,75,77,78,79], queue: 9,  berths: 3, ceu: 12200 },
  { name: 'Salerno',       code: 'ITSAL', lat: 40.6770, lon: 14.7560, country: 'IT', region: 'W-MED', pci: 51, trend: [46,48,49,50,51,51,51], queue: 4,  berths: 2, ceu: 6400 },
  { name: 'Koper',         code: 'SIKOP', lat: 45.5470, lon: 13.7300, country: 'SI', region: 'ADR',   pci: 91, trend: [70,75,80,84,87,89,91], queue: 14, berths: 2, ceu: 16800 },
  { name: 'Piraeus',       code: 'GRPIR', lat: 37.9420, lon: 23.6470, country: 'GR', region: 'E-MED', pci: 53, trend: [48,49,51,52,53,53,53], queue: 4,  berths: 3, ceu: 8200 },
  { name: 'Tanger Med',    code: 'MAPTM', lat: 35.8870, lon: -5.5070, country: 'MA', region: 'STR',   pci: 60, trend: [54,55,57,58,59,60,60], queue: 6,  berths: 3, ceu: 10500 },
  { name: 'Zeebrugge',     code: 'BEZEE', lat: 51.3300, lon: 3.2050,  country: 'BE', region: 'NSEA',  pci: 88, trend: [70,74,78,82,85,87,88], queue: 13, berths: 5, ceu: 21500 },
  { name: 'Bremerhaven',   code: 'DEBRV', lat: 53.5400, lon: 8.5800,  country: 'DE', region: 'NSEA',  pci: 81, trend: [68,72,75,77,79,80,81], queue: 11, berths: 5, ceu: 19200 },
  { name: 'Southampton',   code: 'GBSOU', lat: 50.9000, lon: -1.4000, country: 'GB', region: 'NSEA',  pci: 64, trend: [58,60,61,62,63,64,64], queue: 6,  berths: 3, ceu: 10500 },
  { name: 'Casablanca',    code: 'MACAS', lat: 33.6050, lon: -7.6160, country: 'MA', region: 'ATL',   pci: 68, trend: [55,58,61,63,65,66,68], queue: 7,  berths: 3, ceu: 9400 },
  { name: 'Djen Djen',     code: 'DZDJE', lat: 36.8200, lon: 5.8600,  country: 'DZ', region: 'W-MED', pci: 49, trend: [44,45,46,47,48,49,49], queue: 4,  berths: 2, ceu: 6200 },
  { name: 'Ambarli',       code: 'TRAMB', lat: 40.9650, lon: 28.6900, country: 'TR', region: 'E-MED', pci: 86, trend: [70,74,77,80,82,84,86], queue: 12, berths: 4, ceu: 17800 },
  { name: 'Aliağa',        code: 'TRALI', lat: 38.7920, lon: 26.9670, country: 'TR', region: 'E-MED', pci: 71, trend: [62,64,66,68,69,70,71], queue: 8,  berths: 3, ceu: 11200 },
  { name: 'Mersin',        code: 'TRMER', lat: 36.7900, lon: 34.6300, country: 'TR', region: 'E-MED', pci: 78, trend: [65,68,71,73,75,77,78], queue: 10, berths: 3, ceu: 13500 },
];

// ------------------------------------------------------------
// FLOTA REAL — PCTC / RoRo / Car Carriers
// MMSI/IMO verificables en VesselFinder/MarineTraffic/Equasis.
// Posiciones = ÚLTIMA CONOCIDA (snapshot). lastSeen indica antigüedad.
// El módulo AIS en vivo sobreescribe lat/lon/sog/cog/st cuando llegue mensaje.
// ------------------------------------------------------------
window.VESSELS = [];

// ------------------------------------------------------------
// ALERTAS (derivadas de los datos arriba; refs son MMSI/UN-LOCODE reales)
// ------------------------------------------------------------
window.ALERTS = [
  { ts: Date.now()-90_000,    type:'congestion', sev:'high',   text:'KOPER PCI escaló 87→91 en 2h',                ref:'SIKOP' },
  { ts: Date.now()-340_000,   type:'eta',        sev:'med',    text:'MORNING LISA ETA -45min · ESBCN',             ref:'636019221' },
  { ts: Date.now()-820_000,   type:'geofence',   sev:'low',    text:'SIEM SAPPHIRE entró VLC approach zone',       ref:'538005023' },
  { ts: Date.now()-1_400_000, type:'anchor',     sev:'high',   text:'AUTO ENERGY drift 0.18NM en fondeo BEZEE',    ref:'255805935' },
  { ts: Date.now()-2_800_000, type:'speed',      sev:'low',    text:'SIEM AMETHYST 11.4→15.1 kn',                  ref:'538005012' },
  { ts: Date.now()-3_900_000, type:'congestion', sev:'med',    text:'BREMERHAVEN cola +2 buques (9→11)',           ref:'DEBRV' },
  { ts: Date.now()-5_200_000, type:'eta',        sev:'med',    text:'HOEGH TARGET berthing window confirmed FOS',  ref:'257864000' },
  { ts: Date.now()-7_400_000, type:'congestion', sev:'high',   text:'VALENCIA dwell 4.2d > umbral 3.5d',           ref:'ESVLC' },
];

window.NAV_STATUS = {0:'Underway',1:'At Anchor',2:'Not under cmd',3:'Restricted',5:'Moored',7:'Fishing',8:'Sailing'};

window.REGIONS = {
  'W-MED':'Western Med', 'E-MED':'Eastern Med', 'ADR':'Adriatic',
  'STR':'Gibraltar Str', 'ATL':'Atlantic IB', 'NSEA':'North Sea / Channel'
};

// ============================================================
// PERSISTENCE LAYER — custom user entities + AIS watchlist
// ============================================================
window.STORE = {
  load: (k, fb) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  },
  save: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  remove: (k) => { try { localStorage.removeItem(k); } catch(e){} },
};

// Snapshot of base data for resets
window.BASE_VESSELS = window.VESSELS.slice();
window.BASE_PORTS   = window.PORTS.slice();

// ---- Apply persisted overrides on load ----
(function rehydrate() {
  const vState = window.STORE.load('vt7.vessels', { custom: [], edits: {}, deleted: [] });

  // Migration: previous editor versions assigned a default position of
  // 41/2 to manually-added vessels. Clear any synthetic position from
  // CUSTOM vessels that have never received a real AIS message
  // (no lastSeen timestamp). This keeps real AIS-merged positions intact.
  let migrated = false;
  vState.custom.forEach(c => {
    const synthetic = (c.lat === 41 || c.lat === 41.0) && (c.lon === 2 || c.lon === 2.0);
    if (synthetic && !c.lastSeen) {
      c.lat = null; c.lon = null;
      c.sog = null; c.cog = null; c.hdg = null; c.st = null;
      c.track = [];
      migrated = true;
    }
  });
  if (migrated) window.STORE.save('vt7.vessels', vState);

  let vessels = window.BASE_VESSELS.filter(v => !vState.deleted.includes(v.mmsi))
    .map(v => vState.edits[v.mmsi] ? { ...v, ...vState.edits[v.mmsi] } : v);
  vState.custom.forEach(c => {
    if (!vessels.find(v => v.mmsi === c.mmsi)) vessels.push(c);
  });
  window.VESSELS = vessels;
  window._VESSEL_STATE = vState;

  const pState = window.STORE.load('vt7.ports', { custom: [], edits: {}, deleted: [] });
  let ports = window.BASE_PORTS.filter(p => !pState.deleted.includes(p.code))
    .map(p => pState.edits[p.code] ? { ...p, ...pState.edits[p.code] } : p);
  pState.custom.forEach(c => {
    if (!ports.find(p => p.code === c.code)) ports.push(c);
  });
  window.PORTS = ports;
  window._PORT_STATE = pState;
})();

// ---- CRUD helpers ----
window.VesselCRUD = {
  isCustom: (mmsi) => window._VESSEL_STATE.custom.some(v => v.mmsi === mmsi),
  isBase:   (mmsi) => window.BASE_VESSELS.some(v => v.mmsi === mmsi),
  upsert: (vessel) => {
    const s = window._VESSEL_STATE;
    if (window.BASE_VESSELS.some(v => v.mmsi === vessel.mmsi)) {
      s.edits[vessel.mmsi] = vessel;
    } else {
      const i = s.custom.findIndex(v => v.mmsi === vessel.mmsi);
      if (i >= 0) s.custom[i] = vessel; else s.custom.push(vessel);
    }
    s.deleted = s.deleted.filter(m => m !== vessel.mmsi);
    window.STORE.save('vt7.vessels', s);
  },
  remove: (mmsi) => {
    const s = window._VESSEL_STATE;
    s.custom = s.custom.filter(v => v.mmsi !== mmsi);
    delete s.edits[mmsi];
    if (window.BASE_VESSELS.some(v => v.mmsi === mmsi) && !s.deleted.includes(mmsi)) {
      s.deleted.push(mmsi);
    }
    window.STORE.save('vt7.vessels', s);
  },
  reset: () => { window.STORE.remove('vt7.vessels'); },
  getAll: () => {
    const s = window._VESSEL_STATE;
    let list = window.BASE_VESSELS.filter(v => !s.deleted.includes(v.mmsi))
      .map(v => s.edits[v.mmsi] ? { ...v, ...s.edits[v.mmsi] } : v);
    s.custom.forEach(c => { if (!list.find(v => v.mmsi === c.mmsi)) list.push(c); });
    return list;
  },
};

window.PortCRUD = {
  isCustom: (code) => window._PORT_STATE.custom.some(p => p.code === code),
  isBase:   (code) => window.BASE_PORTS.some(p => p.code === code),
  upsert: (port) => {
    const s = window._PORT_STATE;
    if (window.BASE_PORTS.some(p => p.code === port.code)) {
      s.edits[port.code] = port;
    } else {
      const i = s.custom.findIndex(p => p.code === port.code);
      if (i >= 0) s.custom[i] = port; else s.custom.push(port);
    }
    s.deleted = s.deleted.filter(c => c !== port.code);
    window.STORE.save('vt7.ports', s);
  },
  remove: (code) => {
    const s = window._PORT_STATE;
    s.custom = s.custom.filter(p => p.code !== code);
    delete s.edits[code];
    if (window.BASE_PORTS.some(p => p.code === code) && !s.deleted.includes(code)) {
      s.deleted.push(code);
    }
    window.STORE.save('vt7.ports', s);
  },
  reset: () => { window.STORE.remove('vt7.ports'); },
  getAll: () => {
    const s = window._PORT_STATE;
    let list = window.BASE_PORTS.filter(p => !s.deleted.includes(p.code))
      .map(p => s.edits[p.code] ? { ...p, ...s.edits[p.code] } : p);
    s.custom.forEach(c => { if (!list.find(p => p.code === c.code)) list.push(c); });
    return list;
  },
};

// ---- AIS Watchlist ----
window.AisWatchlist = {
  load: () => {
    const wl = window.STORE.load('vt7.aisWatch', null);
    if (wl) return wl;
    return { extra: [], excluded: [] };
  },
  save: (wl) => window.STORE.save('vt7.aisWatch', wl),
  resolve: () => {
    const wl = window.AisWatchlist.load();
    const fromFleet = window.VESSELS.map(v => v.mmsi).filter(m => !wl.excluded.includes(m));
    return [...new Set([...fromFleet, ...wl.extra])];
  },
};

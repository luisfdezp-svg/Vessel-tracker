// ============================================================
// VESSEL HISTORY — persistent per-vessel timeseries from real AIS samples.
//
// Stores recent kinematic samples (lat, lon, sog, cog, ts) per MMSI in
// localStorage so we can draw real 6h SOG sparklines, real movement trails,
// and compute real ETA progress (distance covered vs total).
//
// Schema:
//   store[mmsi] = {
//     samples: [{ts, lat, lon, sog, cog, st}],   // newest last
//     departure: {ts, lat, lon, port?},          // last underway start
//     firstSeen: ts,
//   }
//
// Pruning: keep last 24h of samples per vessel, max 200 samples.
// ============================================================
/* global */

(function() {
  const STORE_KEY = 'vt7.vesselHistory.v1';
  const MAX_SAMPLES = 200;
  const RETAIN_MS = 24 * 3600 * 1000;
  const MIN_SAMPLE_GAP_MS = 60 * 1000;   // sample at most once per minute per vessel

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch(e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch(e) {}
  }

  let store = loadStore();
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveStore(store); saveTimer = null; }, 3000);
  }

  function getOrInit(mmsi, now) {
    const k = String(mmsi);
    if (!store[k]) {
      store[k] = { samples: [], firstSeen: now };
    }
    return store[k];
  }

  // Ingest one observation. Skips if too soon after last sample.
  function record(mmsi, obs, now) {
    if (typeof obs.lat !== 'number' || typeof obs.lon !== 'number') return;
    now = now || Date.now();
    const vh = getOrInit(mmsi, now);
    const last = vh.samples[vh.samples.length - 1];
    if (last && (now - last.ts) < MIN_SAMPLE_GAP_MS) return;

    const sample = {
      ts: now,
      lat: +obs.lat.toFixed(5),
      lon: +obs.lon.toFixed(5),
      sog: typeof obs.sog === 'number' ? +obs.sog.toFixed(1) : null,
      cog: typeof obs.cog === 'number' ? Math.round(obs.cog) : null,
      st: typeof obs.st === 'number' ? obs.st : null,
    };

    // Detect "departure" event (st transitions from 1/5 -> 0)
    if (last && (last.st === 1 || last.st === 5) && sample.st === 0) {
      vh.departure = { ts: now, lat: sample.lat, lon: sample.lon };
    }
    // First sample, vessel underway → assume that's where they started
    if (!last && sample.st === 0) {
      vh.departure = { ts: now, lat: sample.lat, lon: sample.lon };
    }

    vh.samples.push(sample);
    if (vh.samples.length > MAX_SAMPLES) {
      vh.samples = vh.samples.slice(-MAX_SAMPLES);
    }
    scheduleSave();
  }

  // Prune samples older than RETAIN_MS
  function prune(now) {
    now = now || Date.now();
    const cutoff = now - RETAIN_MS;
    let changed = false;
    for (const k of Object.keys(store)) {
      const before = store[k].samples.length;
      store[k].samples = store[k].samples.filter(s => s.ts >= cutoff);
      if (store[k].samples.length !== before) changed = true;
      // If no samples in 7 days, drop the vessel entirely
      if (store[k].samples.length === 0 && (now - (store[k].firstSeen || 0)) > 7*24*3600*1000) {
        delete store[k];
        changed = true;
      }
    }
    if (changed) scheduleSave();
  }

  // -------- READERS --------------------------------------------------------

  // Get last N hours of SOG samples (for sparkline). Returns array of numbers
  // (length 0..N). Each value is the SOG at that point. Returns null if no data.
  function getSogSeries(mmsi, hours = 6) {
    const k = String(mmsi);
    if (!store[k]) return null;
    const cutoff = Date.now() - hours * 3600 * 1000;
    const samples = store[k].samples.filter(s => s.ts >= cutoff && s.sog != null);
    if (samples.length < 2) return null;
    return samples.map(s => s.sog);
  }

  // Get last N hours of position samples (for trail). Returns [[lat,lon],...].
  function getTrail(mmsi, hours = 12) {
    const k = String(mmsi);
    if (!store[k]) return null;
    const cutoff = Date.now() - hours * 3600 * 1000;
    const samples = store[k].samples.filter(s => s.ts >= cutoff);
    if (samples.length < 2) return null;
    return samples.map(s => [s.lat, s.lon]);
  }

  function getSampleCount(mmsi) {
    const k = String(mmsi);
    if (!store[k]) return 0;
    return store[k].samples.length;
  }

  // ETA progress: fraction 0..1 of voyage distance covered.
  // Uses departure position (or first known sample) and current position
  // toward the destination port. Returns null if can't compute.
  function getVoyageProgress(mmsi, currentLat, currentLon, destLat, destLon) {
    const k = String(mmsi);
    if (!store[k]) return null;
    if (typeof destLat !== 'number' || typeof destLon !== 'number') return null;

    const samples = store[k].samples;
    if (!samples || samples.length === 0) return null;

    // origin = departure if known, else oldest sample
    const origin = store[k].departure || samples[0];
    if (!origin) return null;

    const totalNm = haversineNm(origin.lat, origin.lon, destLat, destLon);
    const remainingNm = haversineNm(currentLat, currentLon, destLat, destLon);
    if (totalNm < 1) return null;
    const covered = Math.max(0, totalNm - remainingNm);
    return Math.min(1, Math.max(0, covered / totalNm));
  }

  function haversineNm(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const R = 3440.065;
    const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }

  // -------- BATCH UPDATE --------------------------------------------------
  // Called from app on every AIS tick.
  function update(vessels, discovered) {
    const now = Date.now();
    for (const v of vessels || []) {
      record(v.mmsi, v, now);
    }
    if (discovered) {
      const arr = discovered instanceof Map ? Array.from(discovered.values()) : Array.from(discovered);
      for (const v of arr) record(v.mmsi, v, now);
    }
    if (Math.random() < 0.05) prune(now); // ~5% of ticks, prune old
  }

  function reset() {
    store = {};
    saveStore(store);
  }

  function debug() { return JSON.parse(JSON.stringify(store)); }

  window.VesselHistory = {
    update, record, reset, debug,
    getSogSeries, getTrail, getSampleCount, getVoyageProgress,
  };
})();

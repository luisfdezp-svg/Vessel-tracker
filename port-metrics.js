// ============================================================
// PORT METRICS — REAL congestion metrics derived from AIS feed.
//
// All values are computed from observed vessel state (NavigationalStatus,
// proximity to port coordinates) and persisted to localStorage so they
// survive refresh.
//
// WARM START: on first run for a port, the store is seeded with synthetic
// dwell/throughput/trend values derived from static port size (berths, ceu).
// These are marked with `_est: true` so the UI can label them EST distinctly
// from real CALC/LIVE data. As real samples come in, EST samples expire and
// metrics shift to true LIVE/CALC sources.
//
// SNAPSHOTS: PCI is snapshotted every HOUR for the first 24h after seed,
// then every DAY. This means a fresh install builds a meaningful 7-point
// trend over the first day of use rather than the first week.
//
// Inputs (every tick):
//   - vessels:    your fleet with current AIS overlay (st, lat, lon, mmsi)
//   - discovered: AIS-discovered Map (mmsi -> {st, lat, lon, name, ts})
//   - ports:      [{code, lat, lon, berths, ceu, ...}]
//
// Outputs (mutated onto each port object):
//   - port.live = {
//       queue, atBerth, berthUtil, avgDwellH, throughput7d, pci,
//       lastUpdate, fresh, sampleN: real-only sample count,
//       sampleNEst: estimated samples included,
//       src: { queue, berthUtil, dwell, throughput, pci, trend } each
//             of 'LIVE' | 'CALC' | 'EST' | 'NONE'
//     }
//   - port.trend7d: array of last 7 PCI snapshots
// ============================================================
/* global L */

(function() {
  const ANCHOR_RADIUS_NM = 15;
  const BERTH_RADIUS_NM  = 1.5;
  const DWELL_WINDOW_MS  = 30 * 24 * 3600 * 1000;
  const THRPUT_WINDOW_MS = 7 * 24 * 3600 * 1000;
  const FRESH_MS         = 5 * 60 * 1000;
  const STORE_KEY        = 'vt7.portMetrics.v2';   // bump after schema change

  const SNAPSHOT_HOURLY_FOR_MS = 24 * 3600 * 1000; // first 24h after seed: hourly
  const SNAPSHOT_HOURLY_INTERVAL = 60 * 60 * 1000;
  const SNAPSHOT_DAILY_INTERVAL  = 24 * 60 * 60 * 1000;

  // Haversine in nautical miles
  function nmDist(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const R = 3440.065;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch(e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Deterministic pseudo-random for warm-start seeding (so values are stable per port).
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }
  function seededFloat(seed, salt) {
    const x = Math.sin(seed + salt * 9301) * 43758.5453;
    return x - Math.floor(x);
  }

  let store = loadStore();

  function getPortState(code) {
    if (!store[code]) {
      store[code] = {
        tracks: {},          // active vessels: mmsi -> {firstAnchorTs, firstMooredTs, lastTs, lastSt, lastDist, name}
        dwellEvents: [],     // {mmsi, anchorTs, mooredTs, dwellH, _est?}
        throughputEvents: [],// {mmsi, ts, _est?}
        trend7d: [],         // last 7 PCI snapshots
        lastSnapshotTs: 0,   // last time we pushed to trend7d
        seededTs: 0,         // when this port was warm-started
      };
    }
    return store[code];
  }

  // -------- WARM START -----------------------------------------------------
  // For a port that has never been observed, seed plausible synthetic samples
  // so the UI shows reasonable values immediately. All seeded events carry
  // _est:true; they expire naturally as the data windows roll.
  function seedWarmStart(port, now) {
    const ps = getPortState(port.code);
    if (ps.seededTs > 0) return; // already seeded

    const seed = hashStr(port.code);
    const berths = port.berths || 1;
    const ceuWk  = port.ceu || 8000;

    // Plausible avg dwell for PCTC: 1.5–4 days, varies by port size.
    const baseDwellD = 1.6 + (berths / 6) + seededFloat(seed, 1) * 1.4;
    // Throughput: ~ 1 vessel per berth per ~ceu/(berthCeu*7) days
    const avgVesselCeu = 4500 + seededFloat(seed, 2) * 2500;
    const throughputPerWeek = clamp(Math.round(ceuWk / avgVesselCeu), 3, 28);

    // Generate 8 synthetic dwell events spread over the last 14 days
    for (let i = 0; i < 8; i++) {
      const daysAgo = (i + 1) * 1.6 + seededFloat(seed, 100+i) * 0.8;
      const mooredTs = now - daysAgo * 24 * 3600 * 1000;
      const dwellH = (baseDwellD + (seededFloat(seed, 200+i) - 0.5) * 1.5) * 24;
      const anchorTs = mooredTs - dwellH * 3600 * 1000;
      ps.dwellEvents.push({
        mmsi: 'EST_'+i, anchorTs, mooredTs, dwellH, _est: true,
      });
    }

    // Generate throughputPerWeek events spread across last 7 days
    for (let i = 0; i < throughputPerWeek; i++) {
      const daysAgo = (i / throughputPerWeek) * 6.8 + seededFloat(seed, 300+i) * 0.2;
      const ts = now - daysAgo * 24 * 3600 * 1000;
      ps.throughputEvents.push({ mmsi: 'EST_'+i, ts, _est: true });
    }

    // Generate 7-day trend with deterministic walk around port.pci (or computed estimate)
    const baseEstPci = port.pci || (40 + (berths-2) * 10);
    const trend = [];
    let v = baseEstPci - 8;
    for (let d = 6; d >= 0; d--) {
      v += (seededFloat(seed, 400+d) - 0.5) * 6;
      v = clamp(Math.round(v), 20, 95);
      trend.push(v);
    }
    // Last value should converge toward base
    trend[trend.length-1] = clamp(Math.round(baseEstPci), 20, 95);
    ps.trend7d = trend;
    ps._trendSeeded = true; // mark so we know it's est until enough real snapshots come in

    ps.seededTs = now;
    ps.lastSnapshotTs = now; // start the snapshot clock now
  }

  // -------- INGESTION ------------------------------------------------------
  function attributePort(lat, lon, ports) {
    let best = null, bestD = Infinity;
    for (const p of ports) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const d = nmDist(lat, lon, p.lat, p.lon);
      if (d < ANCHOR_RADIUS_NM && d < bestD) { best = p; bestD = d; }
    }
    return best ? { code: best.code, dist: bestD } : null;
  }

  function ingest(obs, ports, now) {
    if (typeof obs.lat !== 'number' || typeof obs.lon !== 'number') return;
    const att = attributePort(obs.lat, obs.lon, ports);
    if (!att) return;
    const ps = getPortState(att.code);
    const t = ps.tracks[obs.mmsi] || (ps.tracks[obs.mmsi] = { name: obs.name });
    t.lastTs = now;
    t.lastSt = obs.st;
    t.lastDist = att.dist;
    t.name = obs.name || t.name;

    if (obs.st === 1) {
      if (!t.firstAnchorTs) t.firstAnchorTs = now;
    } else if (obs.st === 5 && att.dist <= BERTH_RADIUS_NM) {
      if (!t.firstMooredTs) {
        t.firstMooredTs = now;
        ps.throughputEvents.push({ mmsi: obs.mmsi, ts: now }); // real, no _est
        if (t.firstAnchorTs) {
          const dwellH = (now - t.firstAnchorTs) / 3600000;
          if (dwellH >= 0.5 && dwellH <= 240) {
            ps.dwellEvents.push({ mmsi: obs.mmsi, anchorTs: t.firstAnchorTs, mooredTs: now, dwellH });
          }
        }
      }
    } else if (obs.st === 0) {
      if (t.firstMooredTs && (now - t.firstMooredTs) > 6*3600000) {
        delete ps.tracks[obs.mmsi];
      }
    }
  }

  function prune(now) {
    for (const code of Object.keys(store)) {
      const ps = store[code];
      ps.dwellEvents = ps.dwellEvents.filter(e => (now - e.mooredTs) <= DWELL_WINDOW_MS);
      ps.throughputEvents = ps.throughputEvents.filter(e => (now - e.ts) <= THRPUT_WINDOW_MS);
      for (const mmsi of Object.keys(ps.tracks)) {
        if ((now - ps.tracks[mmsi].lastTs) > 24*3600000) delete ps.tracks[mmsi];
      }
    }
  }

  // -------- COMPUTE --------------------------------------------------------
  function computeFor(port, now) {
    const ps = getPortState(port.code);

    // Real-time queue/berth from active tracks (these are ALWAYS real, never est)
    let queue = 0, atBerth = 0, lastUpdate = 0, anyTrack = false;
    for (const mmsi of Object.keys(ps.tracks)) {
      const t = ps.tracks[mmsi];
      if ((now - t.lastTs) > 30*60*1000) continue;
      anyTrack = true;
      if (t.lastTs > lastUpdate) lastUpdate = t.lastTs;
      if (t.lastSt === 1) queue++;
      else if (t.lastSt === 5 && (t.lastDist == null || t.lastDist <= BERTH_RADIUS_NM)) atBerth++;
    }
    const berths = port.berths || 1;
    const berthUtil = clamp(atBerth / berths, 0, 1);
    const queueScore = clamp(queue / (berths * 2), 0, 1);

    // Dwell (mix of real + est)
    const realDwell = ps.dwellEvents.filter(e => !e._est);
    const allDwell  = ps.dwellEvents;
    const useDwell  = realDwell.length >= 3 ? realDwell : allDwell;
    const avgDwellH = useDwell.length
      ? useDwell.reduce((a,b)=>a+b.dwellH,0) / useDwell.length
      : null;
    const dwellScore = avgDwellH != null
      ? clamp((avgDwellH - 24) / 72, 0, 1)
      : 0;

    // Throughput
    const realThr = ps.throughputEvents.filter(e => !e._est);
    const useThr  = realThr.length >= 3 ? realThr : ps.throughputEvents;
    const throughput7d = new Set(useThr.map(e => e.mmsi)).size;
    const throughputCEUWk = throughput7d * (port.ceu ? port.ceu / Math.max(throughput7d, 1) : 0);

    const pci = Math.round(clamp(
      30 * queueScore + 40 * berthUtil + 30 * dwellScore,
      0, 100
    ));

    // Provenance per metric:
    //  LIVE  = real-time observation (queue, atBerth, berthUtil)
    //  CALC  = derived from real samples >= 3
    //  EST   = derived from warm-start synthetic samples
    //  NONE  = no data at all
    const src = {
      queue:      anyTrack ? 'LIVE' : (ps._trendSeeded ? 'EST' : 'NONE'),
      berthUtil:  anyTrack ? 'LIVE' : (ps._trendSeeded ? 'EST' : 'NONE'),
      dwell:      realDwell.length >= 3 ? 'CALC' : (allDwell.length > 0 ? 'EST' : 'NONE'),
      throughput: realThr.length >= 3 ? 'CALC' : (ps.throughputEvents.length > 0 ? 'EST' : 'NONE'),
      pci:        anyTrack ? 'LIVE' : (ps._trendSeeded ? 'EST' : 'NONE'),
      trend:      ps.trend7d.length >= 7 && !ps._trendSeeded ? 'LIVE'
                  : (ps.trend7d.length > 0 && ps._trendSeeded === false ? 'CALC'
                     : (ps.trend7d.length > 0 ? 'EST' : 'NONE')),
    };

    return {
      queue, atBerth, berthUtil,
      avgDwellH,
      sampleN: realDwell.length,         // real-only count for "n=" label
      sampleNEst: allDwell.length - realDwell.length,
      throughput7d,
      throughputReal: realThr.length,
      throughputCEUWk: Math.round(throughputCEUWk),
      pci,
      lastUpdate,
      fresh: lastUpdate > 0 && (now - lastUpdate) < FRESH_MS,
      src,
    };
  }

  // Snapshot — hourly for first 24h after seed, daily after.
  function maybeSnapshot(port, live, now) {
    const ps = getPortState(port.code);
    if (!ps.seededTs) return;
    const ageMs = now - ps.seededTs;
    const interval = ageMs < SNAPSHOT_HOURLY_FOR_MS
      ? SNAPSHOT_HOURLY_INTERVAL
      : SNAPSHOT_DAILY_INTERVAL;
    if (now - ps.lastSnapshotTs < interval) return;

    // Push snapshot. If we still have synthetic trend, replace it gradually:
    // shift left and push the new value.
    if (ps._trendSeeded === true && live.src.pci !== 'EST') {
      // First real datapoint — start replacing the synthetic trend
      ps._trendSeeded = false;
      ps.trend7d = ps.trend7d.slice(); // copy
    }
    ps.trend7d.push(live.pci);
    if (ps.trend7d.length > 7) ps.trend7d = ps.trend7d.slice(-7);
    ps.lastSnapshotTs = now;
  }

  // -------- PUBLIC API -----------------------------------------------------
  let pruneTimer = null;
  let saveTimer = null;

  function update(vessels, discovered, ports) {
    const now = Date.now();

    // Warm-seed any unseeded port (idempotent)
    for (const p of ports) seedWarmStart(p, now);

    // Ingest fleet
    for (const v of vessels || []) {
      if (typeof v.lat === 'number' && typeof v.lon === 'number') {
        ingest({
          mmsi: String(v.mmsi), name: v.name, lat: v.lat, lon: v.lon, st: v.st,
        }, ports, now);
      }
    }
    if (discovered) {
      const arr = discovered instanceof Map ? Array.from(discovered.values()) : Array.from(discovered);
      for (const v of arr) {
        if (typeof v.lat === 'number' && typeof v.lon === 'number') {
          ingest({
            mmsi: String(v.mmsi), name: v.name, lat: v.lat, lon: v.lon, st: v.st,
          }, ports, now);
        }
      }
    }

    if (!pruneTimer) {
      pruneTimer = setTimeout(() => { prune(Date.now()); pruneTimer = null; }, 0);
    }

    for (const p of ports) {
      const live = computeFor(p, now);
      p.live = live;
      maybeSnapshot(p, live, now);
      const ps = getPortState(p.code);
      p.trend7d = ps.trend7d.slice();
      p.trendSrc = live.src.trend;
    }

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveStore(store); saveTimer = null; }, 2000);
  }

  function reset() {
    store = {};
    saveStore(store);
  }

  function debug() {
    return JSON.parse(JSON.stringify(store));
  }

  window.PortMetrics = {
    update, reset, debug,
    ANCHOR_RADIUS_NM, BERTH_RADIUS_NM,
  };
})();

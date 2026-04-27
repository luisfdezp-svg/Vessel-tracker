/* global PORTS */
// ============================================================
// ALERTS ENGINE — real-time alert generation from live AIS + port metrics.
//
// Runs on a 30s tick. Inputs: vessels (merged AIS), ports (with .live),
// VesselHistory (for trend deltas), and the user's "home port" focus.
//
// Alert categories:
//   ETA_WINDOW — fleet vessel with AIS-declared dest = home port,
//                emits at 96h, 48h, 24h, 12h, 6h before ETA (one per crossing).
//   ETA_SHIFT  — declared ETA changed by > N min vs last observation.
//   GEOFENCE   — vessel entered approach / anchor / berth zone of a port.
//   ANCHOR_DRIFT — vessel with NavStatus=anchored is moving > 0.5 kn.
//   SPEED_DROP — SOG dropped by > N kn within last 30 min (engine trouble?).
//   CONGESTION — port PCI rose > Δ in the last 2h.
//   QUEUE_GROW — port queue count grew by > N vessels in 1h.
//   DWELL_HIGH — port avg dwell > threshold days.
//
// Persists "fired" markers in localStorage so we don't re-emit the same
// 96h/48h/24h crossing twice across reloads.
// ============================================================

(function() {
  const FIRED_KEY = 'vt7.alerts.fired.v1';
  const PORT_HIST_KEY = 'vt7.alerts.portHist.v1';
  const ETA_OBS_KEY = 'vt7.alerts.etaObs.v1';

  // ETA windows in hours — emit once when the ETA crosses below each.
  const ETA_WINDOWS = [96, 48, 24, 12, 6];

  // Default thresholds (overridable from app)
  const DEFAULTS = {
    homePort: 'ESBCN',
    etaShiftMin: 30,           // min change to flag
    speedDropKn: 4,            // kn drop in 30 min
    pciDelta2h: 5,             // PCI rise over 2h
    queueDelta1h: 2,           // +N vessels queued in 1h
    dwellDays: 3.5,            // dwell threshold
    anchorDriftKn: 0.5,
  };

  let cfg = { ...DEFAULTS };

  function loadJSON(k, def) {
    try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // fired = {alertId: ts}  — alertId encodes vessel + window so each crossing fires once
  let fired = loadJSON(FIRED_KEY, {});
  // portHist = {locode: [{ts, pci, queue, dwell}, ...]}  — last 6h of port snapshots
  let portHist = loadJSON(PORT_HIST_KEY, {});
  // etaObs = {mmsi: {dest, eta, etaTs}}  — last observed declared ETA per vessel
  let etaObs = loadJSON(ETA_OBS_KEY, {});

  function pruneFired() {
    // Drop firings older than 7 days
    const cutoff = Date.now() - 7*24*3600*1000;
    let changed = false;
    for (const k of Object.keys(fired)) {
      if (fired[k] < cutoff) { delete fired[k]; changed = true; }
    }
    if (changed) saveJSON(FIRED_KEY, fired);
  }
  function prunePortHist() {
    const cutoff = Date.now() - 6*3600*1000;
    let changed = false;
    for (const loc of Object.keys(portHist)) {
      const arr = portHist[loc].filter(s => s.ts >= cutoff);
      if (arr.length !== portHist[loc].length) { portHist[loc] = arr; changed = true; }
    }
    if (changed) saveJSON(PORT_HIST_KEY, portHist);
  }

  function parseEta(etaStr) {
    // Format from AIS service: "DD/MM/YYYY HH:MM"
    if (!etaStr || typeof etaStr !== 'string') return null;
    const m = etaStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]),
                       parseInt(m[4]), parseInt(m[5]));
    const t = d.getTime();
    return isNaN(t) ? null : t;
  }

  // Match AIS "Destination" string to a UN-LOCODE port we monitor.
  // AIS dest is free text; common patterns: "ESBCN", "BARCELONA",
  // "ES BCN", "BCN". We compare loosely.
  function matchDest(destStr, ports) {
    if (!destStr) return null;
    const u = destStr.toUpperCase().replace(/\s+/g, ' ').trim();
    for (const p of ports) {
      if (!p || !p.locode) continue;
      const loc = p.locode.toUpperCase();
      if (u === loc || u === loc.replace(/^[A-Z]{2}/, '') ||
          u.includes(loc) ||
          (p.name && u.includes(p.name.toUpperCase()))) {
        return p;
      }
    }
    return null;
  }

  function haversineNm(lat1, lon1, lat2, lon2) {
    const toR = d => d * Math.PI / 180;
    const R = 3440.065;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Returns array of new alerts to emit (with stable id)
  function evaluate(vessels, ports, opts) {
    cfg = { ...DEFAULTS, ...(opts || {}) };
    const now = Date.now();
    const out = [];
    const homePort = ports.find(p => p.locode === cfg.homePort);

    pruneFired();
    prunePortHist();

    // -------- per-vessel rules --------
    for (const v of vessels) {
      if (!v || !v.mmsi) continue;

      // 1) ETA_WINDOW — only for vessels with declared dest matching a monitored port
      const destPort = matchDest(v.dest, ports);
      const etaMs = parseEta(v.eta);

      if (destPort && etaMs && etaMs > now) {
        const hoursUntil = (etaMs - now) / 3600000;
        for (const win of ETA_WINDOWS) {
          // Fire when we cross below win hours (within a 30min window so we
          // don't miss it between ticks)
          if (hoursUntil <= win && hoursUntil > win - 0.5) {
            const id = `eta_win:${v.mmsi}:${destPort.locode}:${etaMs}:${win}`;
            if (!fired[id]) {
              fired[id] = now;
              const sevMap = { 96:'low', 48:'med', 24:'med', 12:'high', 6:'high' };
              out.push({
                id, ts: now,
                type: 'eta_window',
                sev: sevMap[win] || 'med',
                text: `${v.name || v.mmsi} ETA ${destPort.locode} en ${win}h`,
                ref: destPort.locode,
                mmsi: v.mmsi,
                meta: { window: win, etaMs, destLocode: destPort.locode },
              });
            }
          }
        }
      }

      // 2) ETA_SHIFT — declared ETA changed > N min for fleet vessels with a tracked dest
      if (destPort && etaMs) {
        const prev = etaObs[v.mmsi];
        if (prev && prev.dest === v.dest && prev.eta !== v.eta) {
          const prevMs = parseEta(prev.eta);
          if (prevMs) {
            const deltaMin = Math.round((etaMs - prevMs) / 60000);
            if (Math.abs(deltaMin) >= cfg.etaShiftMin) {
              const id = `eta_shift:${v.mmsi}:${etaMs}`;
              if (!fired[id]) {
                fired[id] = now;
                const sign = deltaMin > 0 ? '+' : '';
                out.push({
                  id, ts: now,
                  type: 'eta_shift',
                  sev: Math.abs(deltaMin) >= 120 ? 'high' : 'med',
                  text: `${v.name || v.mmsi} ETA ${sign}${deltaMin}min · ${destPort.locode}`,
                  ref: v.mmsi,
                  mmsi: v.mmsi,
                  meta: { deltaMin, destLocode: destPort.locode },
                });
              }
            }
          }
        }
        etaObs[v.mmsi] = { dest: v.dest, eta: v.eta, etaTs: now };
      }

      // 3) ANCHOR_DRIFT — anchored (st=1) but moving
      if (v.st === 1 && typeof v.sog === 'number' && v.sog >= cfg.anchorDriftKn) {
        // Bucket by 30-min windows so we don't spam
        const bucket = Math.floor(now / (30*60000));
        const id = `anchor_drift:${v.mmsi}:${bucket}`;
        if (!fired[id]) {
          fired[id] = now;
          out.push({
            id, ts: now,
            type: 'anchor_drift',
            sev: v.sog >= 1.5 ? 'high' : 'med',
            text: `${v.name || v.mmsi} drift ${v.sog.toFixed(2)}kn (anchored)`,
            ref: v.mmsi,
            mmsi: v.mmsi,
          });
        }
      }

      // 4) SPEED_DROP — SOG dropped > N kn in last 30 min (from VesselHistory)
      if (window.VesselHistory && typeof v.sog === 'number') {
        const series = window.VesselHistory.getSogSeries(v.mmsi, 1); // last 1h
        if (series && series.length >= 4) {
          const recent = series.slice(-2).reduce((a,b)=>a+b,0)/2;
          const earlier = series.slice(0, Math.min(4, series.length-2));
          const earlierAvg = earlier.reduce((a,b)=>a+b,0)/earlier.length;
          if (earlierAvg > 8 && earlierAvg - recent >= cfg.speedDropKn) {
            const bucket = Math.floor(now / (30*60000));
            const id = `speed_drop:${v.mmsi}:${bucket}`;
            if (!fired[id]) {
              fired[id] = now;
              out.push({
                id, ts: now,
                type: 'speed_drop',
                sev: 'med',
                text: `${v.name || v.mmsi} SOG ${earlierAvg.toFixed(1)}→${recent.toFixed(1)}kn`,
                ref: v.mmsi,
                mmsi: v.mmsi,
              });
            }
          }
        }
      }
    }

    // -------- per-port rules --------
    for (const p of ports) {
      if (!p || !p.live || !p.locode) continue;

      // record snapshot
      if (!portHist[p.locode]) portHist[p.locode] = [];
      portHist[p.locode].push({
        ts: now,
        pci: p.live.pci,
        queue: p.live.queueCount,
        dwell: p.live.dwell,
      });

      const hist = portHist[p.locode];

      // 5) CONGESTION — PCI rose > Δ in last 2h
      const cutoff2h = now - 2*3600*1000;
      const old2h = hist.find(s => s.ts >= cutoff2h);
      if (old2h && p.live.pci != null && old2h.pci != null) {
        const delta = p.live.pci - old2h.pci;
        if (delta >= cfg.pciDelta2h) {
          const bucket = Math.floor(now / (60*60000));
          const id = `pci_rise:${p.locode}:${bucket}`;
          if (!fired[id]) {
            fired[id] = now;
            out.push({
              id, ts: now,
              type: 'congestion',
              sev: p.live.pci >= 75 ? 'high' : 'med',
              text: `${p.locode} PCI ${old2h.pci.toFixed(0)}→${p.live.pci.toFixed(0)} en 2h`,
              ref: p.locode,
            });
          }
        }
      }

      // 6) QUEUE_GROW — queue grew > N in 1h
      const cutoff1h = now - 3600*1000;
      const old1h = hist.find(s => s.ts >= cutoff1h);
      if (old1h && p.live.queueCount != null && old1h.queue != null) {
        const dq = p.live.queueCount - old1h.queue;
        if (dq >= cfg.queueDelta1h) {
          const bucket = Math.floor(now / (60*60000));
          const id = `queue_grow:${p.locode}:${bucket}`;
          if (!fired[id]) {
            fired[id] = now;
            out.push({
              id, ts: now,
              type: 'queue',
              sev: dq >= 4 ? 'high' : 'med',
              text: `${p.locode} cola +${dq} buques (${old1h.queue}→${p.live.queueCount})`,
              ref: p.locode,
            });
          }
        }
      }

      // 7) DWELL_HIGH — avg dwell exceeds threshold
      if (p.live.dwell != null && p.live.dwell > cfg.dwellDays) {
        const bucket = Math.floor(now / (4*3600*1000)); // every 4h max
        const id = `dwell:${p.locode}:${bucket}`;
        if (!fired[id]) {
          fired[id] = now;
          out.push({
            id, ts: now,
            type: 'dwell',
            sev: p.live.dwell > cfg.dwellDays + 1 ? 'high' : 'med',
            text: `${p.locode} dwell ${p.live.dwell.toFixed(1)}d > umbral ${cfg.dwellDays.toFixed(1)}d`,
            ref: p.locode,
          });
        }
      }
    }

    saveJSON(FIRED_KEY, fired);
    saveJSON(PORT_HIST_KEY, portHist);
    saveJSON(ETA_OBS_KEY, etaObs);

    return out;
  }

  function reset() {
    fired = {}; portHist = {}; etaObs = {};
    localStorage.removeItem(FIRED_KEY);
    localStorage.removeItem(PORT_HIST_KEY);
    localStorage.removeItem(ETA_OBS_KEY);
  }

  window.AlertsEngine = {
    evaluate,
    reset,
    parseEta,
    matchDest,
    DEFAULTS,
    ETA_WINDOWS,
  };
})();

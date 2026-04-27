/* global React, ReactDOM, L, PORTS, VESSELS, ALERTS, NAV_STATUS, REGIONS, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakSelect, createAisService, STORE, VesselCRUD, PortCRUD, AisWatchlist, EntityEditor, AisWatchlistEditor */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============================================================
// HELPERS
// ============================================================
const VESSEL_COLORS = ['#5dd5ff','#ffb84d','#7ee08f','#c79bff','#ff7b88','#ffd166','#56cdb8','#ff9bd2','#9ec5fe','#fcd34d','#67e8f9','#fda4af','#a3e635','#facc15'];
const colorFor = (idx) => VESSEL_COLORS[idx % VESSEL_COLORS.length];
const pciColor = (pci) => pci >= 75 ? 'high' : pci >= 50 ? 'med' : 'low';
const pciHex = (pci) => pci >= 75 ? '#e85a4f' : pci >= 50 ? '#ffb84d' : '#7ee08f';

const fmtAge = (ts) => {
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return s+'s';
  if (s < 3600) return Math.floor(s/60)+'m';
  if (s < 86400) return Math.floor(s/3600)+'h';
  return Math.floor(s/86400)+'d';
};

const fmtCoord = (v, type) => {
  const abs = Math.abs(v);
  const dir = type==='lat' ? (v>=0?'N':'S') : (v>=0?'E':'W');
  return abs.toFixed(4) + '°' + dir;
};

function haversine(la1, lo1, la2, lo2) {
  const R = 3440.065, x = Math.PI/180;
  const dLa = (la2-la1)*x, dLo = (lo2-lo1)*x;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*x)*Math.cos(la2*x)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Detect mobile
function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = e => setMatches(e.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return matches;
}

// Bookmarks hook
function useBookmarks() {
  const [bm, setBm] = useState(() => window.STORE.load('vt7.bookmarks', []));
  const toggle = useCallback((mmsi) => {
    setBm(prev => {
      const next = prev.includes(mmsi) ? prev.filter(x => x !== mmsi) : [...prev, mmsi];
      window.STORE.save('vt7.bookmarks', next);
      return next;
    });
  }, []);
  return { bookmarks: bm, toggle, isBookmarked: (m) => bm.includes(m) };
}

// CRUD hooks — re-render on entity changes
function useEntities() {
  const [vRev, bumpV] = useState(0);
  const [pRev, bumpP] = useState(0);
  const vessels = useMemo(() => VesselCRUD.getAll(), [vRev]);
  const ports   = useMemo(() => PortCRUD.getAll(),   [pRev]);
  return {
    vessels, ports,
    saveVessel: (v) => { VesselCRUD.upsert(v); window.VESSELS = VesselCRUD.getAll(); bumpV(x=>x+1); },
    deleteVessel: (m) => { VesselCRUD.remove(m); window.VESSELS = VesselCRUD.getAll(); bumpV(x=>x+1); },
    savePort: (p) => { PortCRUD.upsert(p); window.PORTS = PortCRUD.getAll(); bumpP(x=>x+1); },
    deletePort: (c) => { PortCRUD.remove(c); window.PORTS = PortCRUD.getAll(); bumpP(x=>x+1); },
    isVesselCustom: (m) => VesselCRUD.isCustom(m) || !VesselCRUD.isBase(m),
    isPortCustom:   (c) => PortCRUD.isCustom(c)   || !PortCRUD.isBase(c),
  };
}

// AIS watchlist hook
function useAisWatchlist(vessels) {
  const [wl, setWl] = useState(() => AisWatchlist.load());
  const update = useCallback((next) => {
    AisWatchlist.save(next);
    setWl(next);
  }, []);
  const resolved = useMemo(() => {
    const fromFleet = vessels.map(v => v.mmsi).filter(m => !wl.excluded.includes(m));
    return [...new Set([...fromFleet, ...wl.extra])];
  }, [vessels, wl]);
  return { watchlist: wl, update, resolved };
}

// ============================================================
// MAP CONTROLLER
// ============================================================
function useLeafletMap(containerRef, opts) {
  const mapRef = useRef(null);
  const layersRef = useRef({ tracks:{}, vessels:{}, ports:[], heatmap:[], tile:null });

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false, attributionControl: false, preferCanvas: true,
    }).setView([43.5, 5.0], 5);
    L.control.zoom({position:'bottomright'}).addTo(map);
    mapRef.current = map;
    map.on('mousemove', (e) => { if (opts.onCursor) opts.onCursor(e.latlng); });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (layersRef.current.tile) map.removeLayer(layersRef.current.tile);
    const styles = {
      dark:    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      darkLab: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      light:   'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      sat:     'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    };
    const url = styles[opts.mapStyle] || styles.dark;
    const sub = url.includes('cartocdn') ? {subdomains:'abcd'} : {};
    layersRef.current.tile = L.tileLayer(url, {maxZoom:18, ...sub}).addTo(map);
    layersRef.current.tile.bringToBack();
  }, [opts.mapStyle]);

  return { map: mapRef.current, mapRef, layersRef };
}

// ============================================================
// AIS STATUS PANEL
// ============================================================
function AisStatusPanel({ ais, onConnect, onDisconnect, log, isMobile }) {
  const [collapsed, setCollapsed] = useState(isMobile);
  const [apiKey, setApiKey] = useState(() => window.STORE.load('vt7.aisKey',''));

  useEffect(() => { window.STORE.save('vt7.aisKey', apiKey); }, [apiKey]);

  return (
    <div className={'ais-status'+(collapsed?' collapsed':'')}>
      <div className="ahead">
        <span className="atitle">AIS Stream</span>
        <span style={{display:'flex', gap:6, alignItems:'center'}}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:4,
            fontSize:8, letterSpacing:'0.18em', textTransform:'uppercase',
            color: ais.on ? 'var(--green)' : 'var(--dim)'
          }}>
            <span style={{
              width:6,height:6,borderRadius:'50%',
              background: ais.on ? 'var(--green)' : 'var(--muted)',
              animation: ais.on ? 'pulse 1.6s ease-in-out infinite' : 'none'
            }}></span>
            {ais.on ? 'LIVE' : 'OFF'}
          </span>
          <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>{collapsed?'▾':'▴'}</button>
        </span>
      </div>
      <div className="ahide">
        <input
          className="api-input"
          type="text"
          placeholder="aisstream.io API key"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="arow"><span className="k">Messages</span><span style={{color:'var(--cyan)',fontVariantNumeric:'tabular-nums'}}>{ais.msgCount.toLocaleString('en-US')}</span></div>
        <div className="arow"><span className="k">Tracking</span><span>{ais.tracking} vessels</span></div>
        <div style={{display:'flex', gap:6, marginTop:8}}>
          {!ais.on
            ? <button className="ais-btn go" onClick={() => onConnect(apiKey)}>▶ Connect</button>
            : <button className="ais-btn stop" onClick={onDisconnect}>■ Stop</button>}
        </div>
        <div className="alog">
          {log.length === 0
            ? <span className="g">Ready · paste key & connect</span>
            : log.slice(-12).map((l,i) => <div key={i} className={l.k}>{l.t} {l.m}</div>)}
        </div>
        <div style={{fontSize:8, color:'var(--dim)', marginTop:6, letterSpacing:'0.05em', lineHeight:1.4}}>
          Free key: aisstream.io · BBox 25°–65°N, 15°W–45°E · auto-reconnect on
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TOPBAR
// ============================================================
function Topbar({ vessels, ports, alertCount, ais, isMobile, onToggleSidebar }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const sailing = vessels.filter(v => v.st === 0).length;
  const anchored = vessels.filter(v => v.st === 1).length;
  const moored = vessels.filter(v => v.st === 5).length;
  const highCong = ports.filter(p => p.pci >= 75).length;
  const utc = now.toISOString().substring(11,19) + 'Z';

  return (
    <div className="topbar">
      <div className="brand">
        {isMobile && (
          <button onClick={onToggleSidebar} style={{background:'none',border:'1px solid var(--border-2)',color:'var(--text-2)',width:24,height:24,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,marginRight:6}}>☰</button>
        )}
        <div className="brand-mark"></div>
        <div className="brand-text">
          <div className="t1">VESSEL TRACKER + PCI</div>
          <div className="t2">v7.0 · Operator Console</div>
        </div>
      </div>
      <div className="topbar-stats">
        <div className="tstat"><div className="l">Tracked</div><div className="v cyan">{String(vessels.length).padStart(2,'0')} <span style={{color:'var(--dim)',fontSize:9}}>SHIPS</span></div></div>
        <div className="tstat"><div className="l">Underway</div><div className="v green">{String(sailing).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">Anchored</div><div className="v amber">{String(anchored).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">Moored</div><div className="v">{String(moored).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">Ports Mon.</div><div className="v cyan">{String(ports.length).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">PCI ≥75</div><div className="v red">{String(highCong).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">Alerts 24h</div><div className="v amber">{String(alertCount).padStart(2,'0')}</div></div>
        <div className="tstat"><div className="l">AIS msgs</div><div className="v">{ais.msgCount.toLocaleString('en-US')}</div></div>
      </div>
      <div className="topbar-right">
        <div className="utc-clock">{utc}</div>
        <div className="live-pill" style={{
          background: ais.on ? 'oklch(0.30 0.06 155 / 0.25)' : 'oklch(0.30 0.06 75 / 0.20)',
          borderColor: ais.on ? 'var(--green)' : 'var(--amber)',
          color: ais.on ? 'var(--green)' : 'var(--amber)',
          display:'flex', alignItems:'center', gap:6,
        }} title={ais.on ? 'AIS feed live' : 'Showing last-known snapshot — connect AIS for live'}>
          {ais.on
            ? 'LIVE'
            : <>SNAPSHOT<span style={{fontSize:8,opacity:0.7,fontWeight:400}}>{fmtAge(window.SNAPSHOT_TS)} ago</span></>
          }
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SEARCHBOX — isolated to prevent focus loss on parent re-render
// ============================================================
const SearchBox = React.memo(function SearchBox({ value, onChange }) {
  // Keep local state; only push up when it actually changes
  const [local, setLocal] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync down only if external value changed AND differs from local (e.g. clear)
  useEffect(() => { if (value !== local) setLocal(value); /* eslint-disable-line */ }, [value]);

  // Debounce upward
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChangeRef.current(local), 120);
    return () => clearTimeout(t);
  }, [local, value]);

  return (
    <div className="search-wrap">
      <span className="search-icon"></span>
      <input
        className="search-input"
        placeholder="Search MMSI / IMO / name…"
        value={local}
        onChange={e => setLocal(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
});

// ============================================================
// SIDEBAR
// ============================================================
function Sidebar({ vessels, selectedMmsi, onSelect, query, setQuery, filter, setFilter, bookmarks, toggleBookmark, isMobile, sidebarOpen, onCloseSidebar, onAddVessel, onEditVessel, onDeleteVessel, isVesselCustom, discovered, onAddDiscovered, aisOn, globalHunt, onGlobalHunt, onStopGlobalHunt }) {
  const filterOptions = [
    {k:'all', l:'ALL'}, {k:'starred', l:'★'},
    {k:'underway', l:'NAV'}, {k:'anchored', l:'ANCH'}, {k:'moored', l:'MOOR'},
    {k:'eta', l:'ETA<24H'},
  ];

  const visible = useMemo(() => vessels.filter(v => {
    if (query) {
      const q = query.toLowerCase();
      const name = String(v.name || '').toLowerCase();
      const mmsi = String(v.mmsi || '');
      const imo  = String(v.imo  || '');
      if (!(name.includes(q) || mmsi.includes(q) || imo.includes(q))) return false;
    }
    if (filter==='starred' && !bookmarks.includes(v.mmsi)) return false;
    if (filter==='underway' && v.st !== 0) return false;
    if (filter==='anchored' && v.st !== 1) return false;
    if (filter==='moored' && v.st !== 5) return false;
    if (filter==='eta' && !(v.eta && /\d{2}\/\d{2}\/\d{4}/.test(v.eta))) return false;
    return true;
  }), [vessels, query, filter, bookmarks]);

  // Search also extends to AIS-discovered vessels in current bbox (not in fleet)
  const discoveredMatches = useMemo(() => {
    if (!query) return [];
    if (!discovered) return [];
    const q = query.toLowerCase();
    const fleetMmsi = new Set(vessels.map(v => String(v.mmsi)));
    const arr = discovered instanceof Map ? Array.from(discovered.values()) : Array.from(discovered);
    return arr.filter(v => {
      if (!v) return false;
      if (fleetMmsi.has(String(v.mmsi))) return false;
      const name = String(v.name || '').toLowerCase();
      const mmsi = String(v.mmsi || '');
      const imo  = String(v.imo  || '');
      return name.includes(q) || mmsi.includes(q) || imo.includes(q);
    }).slice(0, 50);
  }, [discovered, query, vessels]);

  const starred = vessels.filter(v => bookmarks.includes(v.mmsi));

  return (
    <div className={'sidebar'+(sidebarOpen?' open':'')}>
      {isMobile && <button className="sb-close" onClick={onCloseSidebar}>✕</button>}

      <div className="sb-section">
        <div className="sb-section-head">
          <span>FLEET</span>
          <span style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="count">{visible.length}/{vessels.length}</span>
            <button className="sb-add-btn" onClick={onAddVessel}>+ ADD</button>
          </span>
        </div>
        <SearchBox value={query} onChange={setQuery} />

        <div className="filter-row">
          {filterOptions.map(o => (
            <button key={o.k} className={'fchip'+(filter===o.k?' on':'')} onClick={() => setFilter(o.k)}>{o.l}</button>
          ))}
        </div>
      </div>

      <div className="fleet-list">
        {starred.length > 0 && filter !== 'starred' && (
          <div className="bookmark-section">
            <div className="sb-section-head">
              <span>★ STARRED</span>
              <span className="count">{starred.length}</span>
            </div>
          </div>
        )}
        {visible.map((v) => {
          const idx = vessels.findIndex(vv => vv.mmsi === v.mmsi);
          const col = colorFor(idx);
          const stClass = v.st === 1 ? 'anchored' : v.st === 5 ? 'moored' : '';
          const hasPos = typeof v.lat === 'number' && typeof v.lon === 'number';
          const stLabel = !hasPos ? 'NO AIS'
            : v.st === 1 ? 'ANCH' : v.st === 5 ? 'MOOR' : (NAV_STATUS[v.st]||'').toUpperCase().slice(0,4);
          const isBm = bookmarks.includes(v.mmsi);
          const ageMs = v.lastSeen ? (Date.now() - v.lastSeen) : null;
          const isStale = ageMs != null && ageMs > 60*60*1000; // >1h
          return (
            <div key={v.mmsi}
              className={'fleet-item'+(selectedMmsi===v.mmsi?' selected':'')+(isStale?' stale':'')}
              onClick={() => onSelect(v.mmsi)}
              title={isStale ? 'Stale — last AIS update '+fmtAge(v.lastSeen)+' ago' : undefined}
            >
              <div className="fleet-color" style={{background:col}}></div>
              <div className="fleet-info">
                <div className="fleet-name">
                  {v.name}{isVesselCustom(v.mmsi) && <span className="custom-badge">CUSTOM</span>}
                  {isStale && <span style={{marginLeft:6,fontSize:8,letterSpacing:'0.15em',color:'var(--amber)',fontWeight:700}}>STALE</span>}
                </div>
                <div className="fleet-meta">
                  <span className="flag-tag">{v.flag}</span>
                  <span>{v.mmsi}</span>
                  <span>·</span>
                  <span>{v.ceu.toLocaleString()} CEU</span>
                </div>
              </div>
              <div className="fleet-status">
                <div className="sog">{typeof v.sog === 'number' ? v.sog.toFixed(1) : '—'}</div>
                <div className={'stat '+stClass}>{stLabel}</div>
              </div>
              <button className={'bm-mini bm-star'+(isBm?' on':'')}
                onClick={e => { e.stopPropagation(); toggleBookmark(v.mmsi); }}
                title={isBm ? 'Remove bookmark' : 'Add bookmark'}>
                {isBm ? '★' : '☆'}
              </button>
              <div className="row-actions">
                <button className="inline-act" title="Edit"
                  onClick={e => { e.stopPropagation(); onEditVessel(v); }}>✎</button>
                <button className="inline-act danger" title="Delete"
                  onClick={e => { e.stopPropagation();
                    if (confirm(`Delete ${v.name}?`)) onDeleteVessel(v.mmsi); }}>✕</button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && discoveredMatches.length === 0 && (
          <div style={{padding:'30px 16px', textAlign:'center', color:'var(--dim)', fontSize:11, letterSpacing:'0.1em'}}>NO VESSELS MATCH</div>
        )}

        {/* Global Hunt banner — appears when user has a query and AIS is connected.
            Lets them broaden the AIS subscription to the whole world to locate a
            specific vessel that may be outside the current map bbox. */}
        {query && aisOn && (
          <div style={{
            padding:'10px 14px', margin:'8px 10px',
            background: globalHunt ? 'rgba(95,208,232,0.08)' : 'rgba(255,180,80,0.06)',
            border: '1px solid '+(globalHunt ? 'rgba(95,208,232,0.35)' : 'rgba(255,180,80,0.25)'),
            borderRadius: 2, fontSize: 10, letterSpacing: '0.05em',
            display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
          }}>
            {globalHunt ? (
              <>
                <span style={{display:'inline-block',width:6,height:6,background:'#5fd0e8',borderRadius:'50%',animation:'pulse 1.4s ease-in-out infinite'}}></span>
                <span style={{color:'#5fd0e8',fontWeight:600,letterSpacing:'0.1em'}}>HUNTING</span>
                <span style={{color:'var(--text-2)'}}>"{globalHunt}"</span>
                <span style={{color:'var(--dim)',flex:1}}>· global AIS feed</span>
                <button
                  onClick={onStopGlobalHunt}
                  style={{background:'none',border:'1px solid rgba(95,208,232,0.4)',color:'#5fd0e8',padding:'3px 8px',fontSize:9,letterSpacing:'0.1em',cursor:'pointer',fontFamily:'inherit'}}>
                  STOP
                </button>
              </>
            ) : (
              <>
                <span style={{color:'#ffb450'}}>◇</span>
                <span style={{color:'var(--text-2)',flex:1}}>Not in current bbox?</span>
                <button
                  onClick={() => onGlobalHunt(query)}
                  style={{background:'rgba(255,180,80,0.12)',border:'1px solid rgba(255,180,80,0.45)',color:'#ffb450',padding:'4px 10px',fontSize:9,letterSpacing:'0.12em',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                  HUNT GLOBALLY
                </button>
              </>
            )}
          </div>
        )}

        {discoveredMatches.length > 0 && (
          <div className="discovered-section">
            <div className="sb-section-head" style={{padding:'10px 14px 6px', borderTop:'1px solid var(--border-2)', marginTop:6}}>
              <span style={{color:'#5fd0e8'}}>◇ IN BBOX (AIS)</span>
              <span className="count">{discoveredMatches.length}</span>
            </div>
            {discoveredMatches.map(v => (
              <div key={'d-'+v.mmsi}
                className="fleet-item discovered-item"
                onClick={() => onAddDiscovered && onAddDiscovered(v)}
                title="Click to add to fleet"
              >
                <div className="fleet-color" style={{background:'#5fd0e8', opacity:0.7}}></div>
                <div className="fleet-info">
                  <div className="fleet-name" style={{color:'#b4c8dc'}}>
                    {v.name || ('MMSI '+v.mmsi)}
                    <span className="custom-badge" style={{background:'rgba(95,208,232,0.15)',color:'#5fd0e8',borderColor:'rgba(95,208,232,0.4)'}}>BBOX</span>
                  </div>
                  <div className="fleet-meta">
                    {v.flag && <span className="flag-tag">{v.flag}</span>}
                    <span>{v.mmsi}</span>
                    {v.imo && <><span>·</span><span>IMO {v.imo}</span></>}
                  </div>
                </div>
                <div className="fleet-status">
                  <div className="sog">{(v.sog||0).toFixed(1)}</div>
                  <div className="stat" style={{color:'#5fd0e8'}}>+ADD</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAP VIEW
// ============================================================
function MapView({ vessels, ports, discovered, selectedMmsi, onSelectVessel, onSelectPort, onAddDiscovered, onBoundsChange, discoverMode, onToggleDiscover, aisOn, mapStyle, layers, density, isMobile }) {
  const containerRef = useRef(null);
  const [cursor, setCursor] = useState({lat:0,lng:0});
  const [zoom, setZoom] = useState(5);
  const { mapRef, layersRef } = useLeafletMap(containerRef, { mapStyle, onCursor: setCursor });
  const discoveredLayerRef = useRef({});
  const boundsTimerRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [density, isMobile]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    const onMove = () => {
      if (!onBoundsChange) return;
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = setTimeout(() => {
        const b = map.getBounds();
        onBoundsChange([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]);
      }, 800);
    };
    map.on('zoomend', onZoom);
    map.on('moveend', onMove);
    // Fire once on mount
    onMove();
    return () => { map.off('zoomend', onZoom); map.off('moveend', onMove); };
  }, [onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    Object.values(layersRef.current.vessels).forEach(m => map.removeLayer(m));
    Object.values(layersRef.current.tracks).forEach(t => map.removeLayer(t));
    layersRef.current.vessels = {};
    layersRef.current.tracks = {};
    if (!layers.vessels) return;

    vessels.forEach((v, i) => {
      // Skip vessels without a real position — manually-added vessels stay
      // hidden from the map until AIS delivers a position report.
      if (typeof v.lat !== 'number' || typeof v.lon !== 'number') return;

      const col = colorFor(i);
      const isSel = v.mmsi === selectedMmsi;
      const heading = v.hdg ?? v.cog ?? 0;
      if (layers.tracks) {
        // Prefer REAL trail from VesselHistory (last 12h of AIS samples).
        // Fall back to v.track only if no real history yet.
        let trailCoords = null;
        if (window.VesselHistory) {
          trailCoords = window.VesselHistory.getTrail(v.mmsi, 12);
        }
        if (!trailCoords && v.track && v.track.length > 1) {
          trailCoords = v.track;
        }
        if (trailCoords && trailCoords.length > 1) {
          const poly = L.polyline(trailCoords, {
            color: col, weight: isSel ? 2.5 : 1.5,
            opacity: isSel ? 0.85 : 0.45,
            dashArray: isSel ? null : '3 4',
          }).addTo(map);
          layersRef.current.tracks[v.mmsi] = poly;
        }
      }
      const size = isSel ? 26 : 20;
      const stroke = isSel ? '#ffffff' : 'rgba(255,255,255,0.55)';
      const html = `
        <div class="vessel-marker">
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="overflow:visible">
            <g transform="rotate(${heading} 12 12)">
              <polygon points="12,2 19,21 12,16 5,21" fill="${col}" stroke="${stroke}" stroke-width="${isSel?1.4:0.8}"/>
              ${isSel ? `<circle cx="12" cy="12" r="14" fill="none" stroke="${col}" stroke-width="1" opacity="0.5"/>` : ''}
            </g>
          </svg>
        </div>`;
      const icon = L.divIcon({ html, iconSize:[size,size], iconAnchor:[size/2,size/2], className:'' });
      const m = L.marker([v.lat, v.lon], { icon, zIndexOffset: isSel ? 1000 : 0 }).addTo(map);
      m.bindTooltip(`<b style="color:${col}">${v.name}</b> · ${typeof v.sog==='number'?v.sog.toFixed(1):'—'}kn · ${v.flag||'—'}`,
        { permanent: zoom >= 6 && !isMobile, direction:'right', offset:[10,0], className:'vessel-label' });
      m.on('click', () => onSelectVessel(v.mmsi));
      layersRef.current.vessels[v.mmsi] = m;
    });
  }, [vessels, selectedMmsi, layers.vessels, layers.tracks, zoom, isMobile]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    layersRef.current.ports.forEach(p => map.removeLayer(p));
    layersRef.current.heatmap.forEach(h => map.removeLayer(h));
    layersRef.current.ports = [];
    layersRef.current.heatmap = [];
    if (!layers.ports) return;

    ports.forEach(p => {
      if (layers.heatmap) {
        const radius = 18000 + p.pci * 600;
        const c = L.circle([p.lat, p.lon], {
          radius, color: pciHex(p.pci), weight: 0,
          fillColor: pciHex(p.pci), fillOpacity: 0.10 + p.pci/400,
        }).addTo(map);
        layersRef.current.heatmap.push(c);
        const ring = L.circle([p.lat, p.lon], {
          radius: radius * 0.6, color: pciHex(p.pci), weight: 1,
          dashArray: '3 4', fill: false, opacity: 0.5,
        }).addTo(map);
        layersRef.current.heatmap.push(ring);
      }
      const html = `<div style="position:relative;width:18px;height:18px;display:flex;align-items:center;justify-content:center"><div style="width:10px;height:10px;background:${pciHex(p.pci)};border:1px solid #fff;transform:rotate(45deg)"></div></div>`;
      const icon = L.divIcon({ html, iconSize:[18,18], iconAnchor:[9,9], className:'port-marker' });
      const marker = L.marker([p.lat, p.lon], { icon }).addTo(map);
      marker.bindTooltip(`<b>${p.name}</b> <span style="color:${pciHex(p.pci)}">PCI ${p.pci}</span> · Q${p.queue}`,
        { direction:'top', className:'vessel-label', offset:[0,-6] });
      marker.on('click', () => onSelectPort(p.code));
      layersRef.current.ports.push(marker);
    });
  }, [ports, layers.ports, layers.heatmap]);

  // Render discovered vessels (PCC/PCTC found in bbox via AIS, not in fleet)
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    Object.values(discoveredLayerRef.current).forEach(m => map.removeLayer(m));
    discoveredLayerRef.current = {};
    if (!layers.vessels || !discovered) return;
    discovered.forEach((v) => {
      if (!v.lat || !v.lon) return;
      const heading = v.hdg ?? v.cog ?? 0;
      const html = `
        <div class="vessel-marker discovered">
          <svg width="20" height="20" viewBox="0 0 24 24" style="overflow:visible">
            <g transform="rotate(${heading} 12 12)">
              <polygon points="12,2 19,21 12,17 5,21" fill="rgba(95,208,232,0.55)" stroke="rgba(95,208,232,1)" stroke-width="1.2"/>
              <circle cx="12" cy="12" r="1.6" fill="rgba(255,255,255,0.95)"/>
            </g>
          </svg>
        </div>`;
      const icon = L.divIcon({ html, iconSize:[20,20], iconAnchor:[10,10], className:'' });
      const m = L.marker([v.lat, v.lon], { icon, zIndexOffset: -50 }).addTo(map);
      const typeLabel = ({70:'CARGO',71:'CARGO-A',72:'CARGO-B',77:'VEHICLES',79:'CARGO-D'}[v.type] || 'PCTC');
      m.bindTooltip(
        `<b style="color:#b4c8dc">${v.name||v.mmsi}</b> · ${typeLabel}<br/>` +
        `<span style="color:#7a8a9a;font-size:10px">MMSI ${v.mmsi}${v.imo?(' · IMO '+v.imo):''}</span><br/>` +
        `${(v.sog||0).toFixed(1)}kn · COG ${Math.round(v.cog||0)}°` +
        (v.dest?`<br/><span style='color:#7a8a9a'>→ ${v.dest}</span>`:'') +
        `<br/><span style='color:#5fd0e8;font-size:9px;letter-spacing:0.1em'>CLICK TO ADD TO FLEET</span>`,
        { direction:'right', offset:[8,0], className:'vessel-label' }
      );
      m.on('click', () => onAddDiscovered && onAddDiscovered(v));
      discoveredLayerRef.current[v.mmsi] = m;
    });
  }, [discovered, layers.vessels]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !vessels.length) return;
    const positioned = vessels.filter(v => typeof v.lat==='number' && typeof v.lon==='number');
    if (!positioned.length) return;
    const b = L.latLngBounds(positioned.map(v => [v.lat, v.lon]));
    map.fitBounds(b, { padding:[60,60], maxZoom:6 });
  }, [vessels.length === VESSELS.length]);

  // -------- ZOOM TO SELECTED ---------------------------------------------
  // When a vessel is selected (from list or marker click), fly to it and
  // remember the previous view so the user can come back via "Zoom out".
  const viewStackRef = useRef([]);   // stack of {center:[lat,lng], zoom}
  const lastSelectedRef = useRef(null);
  const [hasPrev, setHasPrev] = useState(false);
  const programmaticMoveRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (!selectedMmsi) return;
    if (lastSelectedRef.current === selectedMmsi) return;
    lastSelectedRef.current = selectedMmsi;
    const v = vessels.find(vv => String(vv.mmsi) === String(selectedMmsi));
    if (!v || typeof v.lat !== 'number' || typeof v.lon !== 'number') return;

    // Only push if the user is currently zoomed out (i.e. not already focused).
    const cur = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
    if (cur.zoom < 9) {
      viewStackRef.current.push(cur);
      setHasPrev(true);
    }
    programmaticMoveRef.current = true;
    map.flyTo([v.lat, v.lon], 11, { duration: 0.9 });
  }, [selectedMmsi, vessels]);

  const zoomOut = () => {
    const map = mapRef.current; if (!map) return;
    const prev = viewStackRef.current.pop();
    setHasPrev(viewStackRef.current.length > 0);
    if (prev) {
      programmaticMoveRef.current = true;
      map.flyTo(prev.center, prev.zoom, { duration: 0.7 });
    } else {
      // Fallback: zoom out by 4 levels
      map.flyTo(map.getCenter(), Math.max(map.getZoom() - 4, 4), { duration: 0.5 });
    }
  };

  const viewFleet = () => {
    const map = mapRef.current; if (!map || !vessels.length) return;
    const cur = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
    if (cur.zoom > 7) {
      viewStackRef.current.push(cur);
      setHasPrev(true);
    } else {
      viewStackRef.current = [];
      setHasPrev(false);
    }
    const positioned = vessels.filter(v => typeof v.lat==='number' && typeof v.lon==='number');
    if (!positioned.length) return;
    const b = L.latLngBounds(positioned.map(v => [v.lat, v.lon]));
    programmaticMoveRef.current = true;
    map.flyToBounds(b, { padding: [60, 60], maxZoom: 6, duration: 0.9 });
  };

  return (
    <div className="map-wrap">
      <div ref={containerRef} id="map"></div>
      <div className="hud-corner tl"></div>
      <div className="hud-corner tr"></div>
      <div className="hud-corner bl"></div>
      <div className="hud-corner br"></div>

      {/* Floating zoom controls — sit above bottom-right Leaflet zoom buttons */}
      <div className="map-floating-actions">
        {hasPrev && (
          <button className="mfa-btn" onClick={zoomOut} title="Return to previous view">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:4,verticalAlign:'-2px'}}>
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            ZOOM OUT
          </button>
        )}
        <button className="mfa-btn" onClick={viewFleet} title="Fit all fleet vessels">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:4,verticalAlign:'-2px'}}>
            <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4"/>
          </svg>
          VIEW FLEET
        </button>
      </div>

      <div className="map-overlay scale-bar">
        <span className="bar"></span>
        Z{zoom} · 1:{(Math.pow(2,15-zoom)*5000).toFixed(0)}km
      </div>
      <div className="map-overlay coord-readout">
        <div><span className="k">LAT</span><span className="v">{fmtCoord(cursor.lat,'lat')}</span></div>
        <div><span className="k">LON</span><span className="v">{fmtCoord(cursor.lng,'lon')}</span></div>
      </div>
      <div className="map-overlay legend">
        <div className="ltitle">PCI Heat</div>
        <div className="legend-row"><span className="sw" style={{background:'#7ee08f'}}></span><span style={{color:'var(--dim)',fontSize:9}}>0–49 LOW</span></div>
        <div className="legend-row"><span className="sw" style={{background:'#ffb84d'}}></span><span style={{color:'var(--dim)',fontSize:9}}>50–74 MED</span></div>
        <div className="legend-row"><span className="sw" style={{background:'#e85a4f'}}></span><span style={{color:'var(--dim)',fontSize:9}}>75+ HIGH</span></div>
      </div>

      <div className="map-overlay discover-toggle" onClick={onToggleDiscover} title="Subscribe to PCC/PCTC/RoRo in visible map area">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{
            width:8,height:8,borderRadius:'50%',
            background: discoverMode ? (aisOn ? 'var(--green)' : 'var(--amber)') : 'var(--dim)',
            boxShadow: discoverMode && aisOn ? '0 0 8px var(--green)' : 'none',
            animation: discoverMode && aisOn ? 'pulse 1.5s infinite' : 'none',
          }}></span>
          <div>
            <div style={{fontSize:9,letterSpacing:'0.18em',fontWeight:600,color: discoverMode?'var(--cyan)':'var(--dim)'}}>
              DISCOVER PCTC IN AREA
            </div>
            <div style={{fontSize:9,color:'var(--dim)',marginTop:2,letterSpacing:'0.04em'}}>
              {!aisOn
                ? 'Connect AIS feed first'
                : discoverMode
                  ? `${discovered ? discovered.size : 0} vessels in view`
                  : 'Click to subscribe to bbox'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PRIMITIVES
// ============================================================
function Sparkline({ data, color, height=28 }) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const w = 100, h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length-1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" />
      <circle cx={w} cy={(h - ((data[data.length-1] - min) / range) * (h - 4) - 2)} r="1.8" fill={color} />
    </svg>
  );
}

function Compass({ heading }) {
  return (
    <div className="compass">
      <div className="nlabel n">N</div><div className="nlabel s">S</div>
      <div className="nlabel e">E</div><div className="nlabel w">W</div>
      <div className="needle" style={{transform:`translate(-50%, -50%) rotate(${heading}deg) translateY(-50%)`}}></div>
      <div className="center-dot"></div>
    </div>
  );
}

// ============================================================
// VESSEL DETAIL
// ============================================================
function VesselDetail({ vessel, vessels, ports, isBookmarked, onToggleBookmark, aisOn, liveOverlay }) {
  if (!vessel) {
    return (
      <div style={{padding:'40px 20px', textAlign:'center', color:'var(--dim)', fontSize:11, letterSpacing:'0.1em'}}>
        SELECT A VESSEL FROM FLEET
      </div>
    );
  }
  const idx = vessels.findIndex(v => v.mmsi === vessel.mmsi);
  const col = colorFor(idx);
  const port = ports.find(p => p.code === vessel.dest);
  const stLabel = NAV_STATUS[vessel.st] || '—';
  const isDiscovered = !!vessel._discovered;
  const hasLiveAis = !!(aisOn && liveOverlay && liveOverlay[vessel.mmsi]);

  // Real SOG history (last 6h) from VesselHistory store
  const realSogSeries = (typeof window !== 'undefined' && window.VesselHistory)
    ? window.VesselHistory.getSogSeries(vessel.mmsi, 6) : null;
  const sampleCount = (typeof window !== 'undefined' && window.VesselHistory)
    ? window.VesselHistory.getSampleCount(vessel.mmsi) : 0;
  const sogTrend = realSogSeries; // null if not enough samples

  // Real voyage progress from departure to destination port
  const realProgress = (port && window.VesselHistory)
    ? window.VesselHistory.getVoyageProgress(vessel.mmsi, vessel.lat, vessel.lon, port.lat, port.lon)
    : null;
  const etaProgressShow = vessel.st === 0 && port && realProgress != null;

  // Pip — same vocabulary as PortDetail
  const Pip = ({ s }) => {
    if (!s || s === 'NONE') s = 'MOCK';
    const meta = {
      LIVE: { c:'#5fd0e8', bg:'rgba(95,208,232,0.12)', bd:'rgba(95,208,232,0.35)', dot:true },
      AIS:  { c:'#7fc97f', bg:'rgba(127,201,127,0.10)', bd:'rgba(127,201,127,0.30)', dot:false },
      EST:  { c:'#ffb450', bg:'rgba(255,180,80,0.10)',  bd:'rgba(255,180,80,0.30)',  dot:false },
      MOCK: { c:'#9aa6b3', bg:'rgba(154,166,179,0.08)', bd:'rgba(154,166,179,0.20)', dot:false },
    }[s];
    return (
      <span style={{
        display:'inline-flex',alignItems:'center',gap:3,
        fontSize:7,letterSpacing:'0.18em',fontWeight:700,
        color: meta.c, marginLeft:6,
        padding:'1px 4px',borderRadius:1,
        background: meta.bg, border:'1px solid '+meta.bd,
      }}>
        {meta.dot && <span style={{display:'inline-block',width:4,height:4,background:meta.c,borderRadius:'50%',animation:'pulse 1.4s ease-in-out infinite'}}></span>}
        {s}
      </span>
    );
  };

  // Helper for "—" fields
  const Dash = () => <span style={{color:'var(--dim)'}}>—</span>;

  return (
    <div>
      <div className="vd-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
          <div className="vd-name" style={{color: col}}>{vessel.name}</div>
          <button className={'bm-star'+(isBookmarked?' on':'')}
            onClick={() => onToggleBookmark(vessel.mmsi)}
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            style={{fontSize:18, width:24, height:24}}>
            {isBookmarked ? '★' : '☆'}
          </button>
        </div>
        <div className="vd-sub">
          <span><b>IMO</b> {vessel.imo || '—'}</span>
          <span><b>MMSI</b> {vessel.mmsi}</span>
          {vessel.cs && <span><b>{vessel.cs}</b></span>}
        </div>
        <div className="vd-pillrow">
          <span className={'vd-pill '+(vessel.st===0?'green':vessel.st===1?'amber':'cyan')}>{stLabel}<Pip s="AIS" /></span>
          <span className="vd-pill">{vessel.type}{isDiscovered && <Pip s="EST" />}</span>
          {vessel.flag && <span className="vd-pill cyan">{vessel.flag}</span>}
          {vessel.ceu > 0 && <span className="vd-pill">{vessel.ceu.toLocaleString()} CEU<Pip s={isDiscovered?'EST':'MOCK'} /></span>}
        </div>
      </div>

      {/* No-AIS banner — manually-added vessel hasn't received any AIS yet */}
      {(typeof vessel.lat !== 'number' || typeof vessel.lon !== 'number') && (
        <div style={{
          padding:'10px 14px',
          background:'rgba(255,170,0,0.08)',
          borderTop:'1px solid rgba(255,170,0,0.3)',
          borderBottom:'1px solid rgba(255,170,0,0.3)',
          fontSize:10,
          letterSpacing:'0.05em',
          color:'var(--amber)',
          lineHeight:1.6,
        }}>
          <div style={{fontWeight:700,letterSpacing:'0.15em',marginBottom:3}}>WAITING FOR AIS</div>
          <div style={{color:'var(--dim)'}}>
            Vessel added manually. Position will populate when AISstream
            broadcasts a message for this MMSI within your current bbox or
            fleet subscription.
          </div>
        </div>
      )}

      {/* Operator section — only meaningful for seed-fleet vessels */}
      {!isDiscovered && vessel.operator && (
        <div className="vd-section">
          <div className="vd-stitle"><span>Operator</span><span style={{color:'var(--dim)'}}>FLEET DB</span></div>
          <div className="vd-grid">
            <div className="vd-field"><div className="l">Operator</div><div className="v">{vessel.operator}</div></div>
            <div className="vd-field"><div className="l">Charterer<Pip s="MOCK" /></div><div className="v"><Dash /></div></div>
          </div>
        </div>
      )}
      {isDiscovered && (
        <div className="vd-section">
          <div className="vd-stitle"><span>Identity</span><span style={{color:'#ffb450'}}>AIS DISCOVERED</span></div>
          <div style={{padding:'6px 8px',background:'rgba(255,180,80,0.06)',border:'1px solid rgba(255,180,80,0.20)',fontSize:9,letterSpacing:'0.05em',color:'var(--text-2)'}}>
            <b style={{color:'#ffb450'}}>NO COMMERCIAL DATA</b> — operator, charterer and capacity are not broadcast over AIS. Only navigational data is real.
          </div>
        </div>
      )}

      <div className="vd-section">
        <div className="vd-stitle">
          <span>Kinematics<Pip s={hasLiveAis ? 'LIVE' : 'AIS'} /></span>
          <span style={{display:'flex',alignItems:'center',gap:6}}>
            {hasLiveAis
              ? <><span style={{width:6,height:6,borderRadius:'50%',background:'var(--green)',display:'inline-block',animation:'pulse 1.5s infinite'}}></span><span style={{color:'#5fd0e8'}}>LIVE AIS</span></>
              : <><span style={{color:'var(--amber)'}}>◆</span>LAST KNOWN · {fmtAge(vessel.lastSeen||window.SNAPSHOT_TS)} ago</>
            }
          </span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 90px', gap:14, alignItems:'center'}}>
          <div>
            <div className="vd-grid" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>
              <div className="vd-field"><div className="l">SOG</div><div className="v lg cyan">{typeof vessel.sog === 'number' ? vessel.sog.toFixed(1) : '—'}<span style={{fontSize:9,color:'var(--dim)',marginLeft:3}}>kn</span></div></div>
              <div className="vd-field"><div className="l">COG</div><div className="v lg">{typeof vessel.cog === 'number' ? Math.round(vessel.cog)+'°' : '—'}</div></div>
              <div className="vd-field"><div className="l">HDG</div><div className="v lg">{typeof (vessel.hdg ?? vessel.cog) === 'number' ? Math.round(vessel.hdg ?? vessel.cog)+'°' : '—'}</div></div>
            </div>
            {sogTrend && sogTrend.length >= 2 && (
              <div style={{marginTop:8}}>
                <div style={{fontSize:8,color:'var(--dim)',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4,display:'flex',alignItems:'center'}}>SOG · 6h<Pip s="LIVE" /></div>
                <Sparkline data={sogTrend} color={col} />
              </div>
            )}
            {(!sogTrend || sogTrend.length < 2) && (
              <div style={{marginTop:8,fontSize:9,color:'var(--dim)',letterSpacing:'0.05em'}}>
                <b style={{color:'var(--dim)'}}>SOG · 6h</b> — accumulating samples ({sampleCount}/2 needed). Connect AIS + leave running to build history.
              </div>
            )}
          </div>
          <Compass heading={vessel.hdg||vessel.cog} />
        </div>
      </div>

      <div className="vd-section">
        <div className="vd-stitle"><span>Voyage</span><span>{vessel.dest||'—'}</span></div>
        <div className="vd-grid">
          <div className="vd-field" style={{gridColumn:'1 / -1'}}>
            <div className="l">Destination<Pip s={vessel.dest ? 'AIS' : 'MOCK'} /></div>
            <div className="v" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              {vessel.dest
                ? <>
                    <span>{port ? port.name : vessel.dest}</span>
                    {port && <span className={'vd-pill '+pciColor(port.pci)} style={{padding:'2px 6px'}}>PCI {port.pci}<Pip s={port.live && port.live.src ? port.live.src.pci : 'EST'} /></span>}
                  </>
                : <Dash />}
            </div>
          </div>
          <div className="vd-field"><div className="l">ETA<Pip s={vessel.eta ? 'AIS' : 'MOCK'} /></div><div className="v cyan" style={{fontSize:13}}>{vessel.eta || <Dash />}</div></div>
          <div className="vd-field"><div className="l">Distance</div><div className="v">{port ? Math.round(haversine(vessel.lat, vessel.lon, port.lat, port.lon))+' NM' : <Dash />}</div></div>
        </div>
        {etaProgressShow && (
          <>
            <div className="eta-bar">
              <div className="fill" style={{width: (realProgress*100)+'%'}}></div>
              <div className="marker" style={{left: (realProgress*100)+'%'}}></div>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:8, color:'var(--dim)', marginTop:4, letterSpacing:'0.1em', textTransform:'uppercase'}}>
              <span>Departure</span><span>{(realProgress*100).toFixed(0)}%<Pip s="LIVE" /></span><span>Berth</span>
            </div>
          </>
        )}
      </div>

      <div className="vd-section">
        <div className="vd-stitle"><span>Position<Pip s={hasLiveAis ? 'LIVE' : 'AIS'} /></span><span>WGS84</span></div>
        <div className="vd-grid">
          <div className="vd-field"><div className="l">Latitude</div><div className="v">{fmtCoord(vessel.lat, 'lat')}</div></div>
          <div className="vd-field"><div className="l">Longitude</div><div className="v">{fmtCoord(vessel.lon, 'lon')}</div></div>
        </div>
      </div>

      {/* Capacity removed — load %, units, charterer not broadcast over AIS.
          Re-enable only when commercial feed is wired. */}
    </div>
  );
}

// ============================================================
// PCI DASHBOARD
// ============================================================
function PciDashboard({ ports, selectedPortCode, onSelectPort, onAddPort, onEditPort, onDeletePort, isPortCustom }) {
  const [sortBy, setSortBy] = useState('pci');
  const [region, setRegion] = useState('all');

  const sorted = useMemo(() => {
    let list = ports.slice();
    if (region !== 'all') list = list.filter(p => p.region === region);
    list.sort((a, b) => {
      if (sortBy==='pci') return b.pci - a.pci;
      if (sortBy==='queue') return b.queue - a.queue;
      if (sortBy==='name') return a.name.localeCompare(b.name);
      return 0;
    });
    return list;
  }, [ports, sortBy, region]);

  const avgPci = Math.round(ports.reduce((s,p)=>s+p.pci,0) / ports.length);
  const totalQueue = ports.reduce((s,p)=>{
    // prefer live-observed queue if available
    return s + ((p.live && p.live.src && p.live.src.queue==='LIVE') ? p.live.queue : p.queue);
  },0);
  const highCount = ports.filter(p => p.pci >= 75).length;

  // Real 7d delta from trend snapshots
  const avgDelta = (() => {
    let total = 0, n = 0;
    for (const p of ports) {
      const t = p.trend7d || p.trend;
      if (t && t.length >= 2) { total += (t[t.length-1] - t[0]); n++; }
    }
    return n > 0 ? Math.round(total / n) : null;
  })();

  return (
    <div>
      <div className="pci-summary">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:8, letterSpacing:'0.22em', textTransform:'uppercase', color:'var(--dim)', fontWeight:600}}>Network Status</div>
          <button className="sb-add-btn" onClick={onAddPort}>+ ADD PORT</button>
        </div>
        <div className="pci-summary-grid">
          <div className="pci-summary-cell">
            <div className="l">AVG PCI</div>
            <div className="v" style={{color: pciHex(avgPci)}}>{avgPci}</div>
            <div className={'delta '+(avgDelta==null?'flat':avgDelta>0?'up':'down')}>
              {avgDelta==null ? '—' : (avgDelta>0?'↑ +':'↓ ')+Math.abs(avgDelta)+' / 7d'}
            </div>
          </div>
          <div className="pci-summary-cell">
            <div className="l">QUEUE</div>
            <div className="v">{totalQueue}</div>
            <div className="delta flat">vsl waiting</div>
          </div>
          <div className="pci-summary-cell">
            <div className="l">HIGH</div>
            <div className="v" style={{color:'var(--red)'}}>{highCount}</div>
            <div className="delta flat">≥ 75 PCI</div>
          </div>
        </div>
      </div>

      <div style={{display:'flex', gap:4, padding:'10px 14px', borderBottom:'1px solid var(--border)', flexWrap:'wrap'}}>
        {['all','W-MED','E-MED','ATL','NSEA','ADR','STR'].map(r => (
          <button key={r} className={'fchip'+(region===r?' on':'')} onClick={()=>setRegion(r)}>{r==='all'?'ALL':r}</button>
        ))}
      </div>

      <div style={{display:'flex', gap:4, padding:'8px 14px', borderBottom:'1px solid var(--border)'}}>
        <span style={{fontSize:8, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--dim)', alignSelf:'center', marginRight:6, fontWeight:600}}>SORT</span>
        {[['pci','PCI'],['queue','Q'],['name','A→Z']].map(([k,l]) => (
          <button key={k} className={'fchip'+(sortBy===k?' on':'')} onClick={()=>setSortBy(k)}>{l}</button>
        ))}
      </div>

      {sorted.map(p => {
        const cls = pciColor(p.pci);
        const trendArr = (p.trend7d && p.trend7d.length >= 2) ? p.trend7d : null;
        const trendDelta = trendArr ? (trendArr[trendArr.length-1] - trendArr[0]) : 0;
        return (
          <div key={p.code} className={'port-row'+(selectedPortCode===p.code?' selected':'')} onClick={() => onSelectPort(p.code)}>
            <div className={'pci-pill '+cls}>{p.pci}</div>
            <div className="port-info">
              <div className="pn">{p.name}{isPortCustom(p.code) && <span className="custom-badge">CUSTOM</span>}</div>
              <div className="pm">{p.code} · {REGIONS[p.region]}</div>
            </div>
            <div style={{height:28, minWidth:50}}>
              {trendArr
                ? <>
                    <Sparkline data={trendArr} color={pciHex(p.pci)} height={28} />
                    <div style={{fontSize:8, color:trendDelta>0?'var(--red)':'var(--green)', textAlign:'right', letterSpacing:'0.05em', marginTop:1}}>
                      {trendDelta>0?'+':''}{trendDelta} 7d
                    </div>
                  </>
                : <div style={{fontSize:8,color:'var(--dim)',textAlign:'right',letterSpacing:'0.1em',marginTop:6}}>—</div>
              }
            </div>
            <div className="port-queue">
              <div style={{fontSize:14, fontWeight:600, color:p.queue>=10?'var(--red)':p.queue>=6?'var(--amber)':'var(--text)'}}>{p.queue}</div>
              <div className="ql">QUEUE</div>
            </div>
            <div className="row-actions">
              <button className="inline-act" title="Edit"
                onClick={e => { e.stopPropagation(); onEditPort(p); }}>✎</button>
              <button className="inline-act danger" title="Delete"
                onClick={e => { e.stopPropagation();
                  if (confirm(`Delete port ${p.name}?`)) onDeletePort(p.code); }}>✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// PORT DETAIL
// ============================================================
function PortDetail({ port, vessels, discovered, alerts, onExpand, onSelectVessel }) {
  if (!port) return null;
  const inbound = vessels.filter(v => v.dest === port.code);

  // ---- Compute live queue / at-berth lists from active vessels & discovered ----
  // Uses same radii as PortMetrics so list count matches the live.queue / live.atBerth scalars.
  const ANCHOR_R = (window.PortMetrics && window.PortMetrics.ANCHOR_RADIUS_NM) || 8;
  const BERTH_R  = (window.PortMetrics && window.PortMetrics.BERTH_RADIUS_NM)  || 1.2;
  const portAlerts = (alerts || []).filter(a => a.port === port.code);

  const allActive = (() => {
    const fleet = vessels.filter(v => typeof v.lat === 'number' && typeof v.lon === 'number');
    if (!discovered) return fleet;
    const seen = new Set(fleet.map(v => String(v.mmsi)));
    const arr = discovered instanceof Map ? Array.from(discovered.values()) : Array.from(discovered);
    return fleet.concat(arr.filter(v => v && !seen.has(String(v.mmsi)) && typeof v.lat === 'number' && typeof v.lon === 'number'));
  })();

  const queueList = [];
  const berthList = [];
  for (const v of allActive) {
    const d = haversine(v.lat, v.lon, port.lat, port.lon);
    if (d > ANCHOR_R) continue;
    if (v.st === 1) queueList.push({ ...v, distNM: d });
    else if (v.st === 5 && d <= BERTH_R) berthList.push({ ...v, distNM: d });
  }
  queueList.sort((a, b) => a.distNM - b.distNM);
  berthList.sort((a, b) => a.distNM - b.distNM);
  const cls = pciColor(port.pci);
  const live = port.live;
  const isLive = !!(live && live.fresh);
  const hasAnyLive = !!(live && (live.lastUpdate > 0 || live.sampleN > 0));
  const src = (live && live.src) || {};

  // Source-aware fields
  const queueVal = (src.queue==='LIVE') ? live.queue : port.queue;
  const dwellVal = (live && live.avgDwellH != null) ? live.avgDwellH / 24 : null;
  const berthUtilVal = (src.berthUtil==='LIVE') ? Math.round(live.berthUtil * 100) : null;
  const thrVal = (live && live.throughput7d > 0) ? live.throughput7d : null;
  const trendArr = (port.trend7d && port.trend7d.length >= 2) ? port.trend7d : null;

  // Helper to render a "source" pip next to a metric.
  // s: 'LIVE' (cyan, pulse), 'CALC' (green), 'EST' (amber), 'MOCK' (grey), 'NONE'
  const Pip = ({ s, sample }) => {
    if (!s || s === 'NONE') s = 'MOCK';
    const meta = {
      LIVE: { c:'#5fd0e8', bg:'rgba(95,208,232,0.12)', bd:'rgba(95,208,232,0.35)', dot:true },
      CALC: { c:'#7fc97f', bg:'rgba(127,201,127,0.10)', bd:'rgba(127,201,127,0.30)', dot:false },
      EST:  { c:'#ffb450', bg:'rgba(255,180,80,0.10)',  bd:'rgba(255,180,80,0.30)',  dot:false },
      MOCK: { c:'#9aa6b3', bg:'rgba(154,166,179,0.08)', bd:'rgba(154,166,179,0.20)', dot:false },
    }[s];
    return (
      <span style={{
        display:'inline-flex',alignItems:'center',gap:3,
        fontSize:7,letterSpacing:'0.18em',fontWeight:700,
        color: meta.c, marginLeft:6,
        padding:'1px 4px',borderRadius:1,
        background: meta.bg, border:'1px solid '+meta.bd,
      }}>
        {meta.dot && <span style={{display:'inline-block',width:4,height:4,background:meta.c,borderRadius:'50%',animation:'pulse 1.4s ease-in-out infinite'}}></span>}
        {s}
        {sample != null && s!=='MOCK' && <span style={{opacity:0.55}}>· n={sample}</span>}
      </span>
    );
  };

  // Header status badge
  let statusBadge;
  if (isLive) {
    statusBadge = <><span style={{display:'inline-block',width:6,height:6,background:'#5fd0e8',borderRadius:'50%',animation:'pulse 1.4s ease-in-out infinite'}}></span><span style={{color:'#5fd0e8'}}>LIVE</span></>;
  } else if (hasAnyLive) {
    statusBadge = <span style={{color:'var(--amber)'}}>STALE</span>;
  } else if (port.trend7d && port.trend7d.length > 0) {
    statusBadge = <span style={{color:'#ffb450'}}>EST · WARM-START</span>;
  } else {
    statusBadge = <span style={{color:'var(--dim)'}}>NO AIS</span>;
  }

  return (
    <div>
      <div className="vd-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div className="vd-name">{port.name}</div>
            <div className="vd-sub">
              <span><b>{port.code}</b></span>
              <span>{REGIONS[port.region]}</span>
              <span>{fmtCoord(port.lat,'lat')} {fmtCoord(port.lon,'lon')}</span>
            </div>
          </div>
          {onExpand && (
            <button
              onClick={onExpand}
              title="Open fullscreen port view"
              style={{
                fontFamily:'inherit',fontSize:9,letterSpacing:'0.18em',fontWeight:700,
                padding:'6px 10px',color:'var(--cyan)',background:'transparent',
                border:'1px solid var(--border-2)',cursor:'pointer',whiteSpace:'nowrap',
                textTransform:'uppercase',
              }}
            >⤢ EXPAND</button>
          )}
        </div>
        <div className="vd-pillrow">
          <span className={'vd-pill '+cls}>PCI {port.pci}<Pip s={src.pci} /></span>
          <span className="vd-pill">{port.berths} BERTHS</span>
          <span className="vd-pill amber">Q {queueVal}<Pip s={src.queue} /></span>
          <span className="vd-pill">{(port.ceu/1000).toFixed(1)}k CEU/wk</span>
        </div>
      </div>

      <div className="vd-section">
        <div className="vd-stitle">
          <span>PCI 7-Day Trend<Pip s={src.trend} /></span>
          <span>
            {(() => {
              const a = trendArr;
              if (!a) return '—';
              const d = a[a.length-1] - a[0];
              return (d>0?'↑ ':'↓ ') + Math.abs(d);
            })()}
          </span>
        </div>
        {trendArr
          ? <Sparkline data={trendArr} color={pciHex(port.pci)} height={48} />
          : <div style={{height:48,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--dim)',letterSpacing:'0.1em'}}>NO TREND DATA YET</div>
        }
        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--dim)',marginTop:4,letterSpacing:'0.05em'}}>
          {(trendArr ? trendArr.map((_,i,arr)=> i===arr.length-1?'NOW':('-'+(arr.length-1-i)+'d')) : []).map((d,i) => <span key={i}>{d}</span>)}
        </div>
      </div>

      <div className="vd-section">
        <div className="vd-stitle">
          <span>Operations</span>
          <span style={{display:'flex',alignItems:'center',gap:6}}>{statusBadge}</span>
        </div>
        <div className="vd-grid three">
          <div className="vd-field">
            <div className="l">Avg Dwell<Pip s={src.dwell} sample={src.dwell==='CALC'?live.sampleN:undefined} /></div>
            <div className="v lg amber">
              {dwellVal != null ? dwellVal.toFixed(1) : '—'}
              <span style={{fontSize:9,color:'var(--dim)',marginLeft:3}}>d</span>
            </div>
          </div>
          <div className="vd-field">
            <div className="l">Berth Util<Pip s={src.berthUtil} /></div>
            <div className="v lg">{berthUtilVal != null ? berthUtilVal+'%' : '—'}</div>
          </div>
          <div className="vd-field">
            <div className="l">Throughput<Pip s={src.throughput} sample={src.throughput==='CALC'?live.throughputReal:undefined} /></div>
            <div className="v lg">
              {thrVal != null ? thrVal : '—'}
              <span style={{fontSize:9,color:'var(--dim)',marginLeft:3}}>vsl/7d</span>
            </div>
          </div>
        </div>
        {!isLive && !hasAnyLive && (
          <div style={{marginTop:8,padding:'6px 8px',background:'rgba(255,180,80,0.06)',border:'1px solid rgba(255,180,80,0.20)',fontSize:9,letterSpacing:'0.05em',color:'var(--text-2)'}}>
            <b style={{color:'#ffb450'}}>WARM-START EST</b> — values seeded from port size (berths/CEU). Connect AIS Stream + Discover to replace with real LIVE/CALC data as samples accumulate.
          </div>
        )}
      </div>

      <div className="vd-section">
        <div className="vd-stitle">
          <span>Berth Occupancy<Pip s={src.berthUtil} /></span>
          <span>{berthList.length}/{port.berths}</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(port.berths,8)}, 1fr)`,gap:4}}>
          {Array.from({length: port.berths}).map((_, i) => {
            const occupant = berthList[i];
            return (
              <div key={i} style={{
                aspectRatio:'1.4 / 1',
                border:'1px solid '+(occupant?'var(--cyan)':'var(--border-2)'),
                background: occupant ? 'rgba(95,208,232,0.10)' : 'transparent',
                display:'flex',alignItems:'center',justifyContent:'center',
                cursor: occupant ? 'pointer' : 'default',
                position:'relative',
              }}
              onClick={() => occupant && onSelectVessel && onSelectVessel(occupant.mmsi)}
              title={occupant ? `${occupant.name} · ${occupant.distNM.toFixed(1)} NM` : 'Empty'}
              >
                <span style={{
                  fontSize:8,letterSpacing:'0.1em',fontWeight:600,
                  color: occupant ? 'var(--cyan)' : 'var(--dim)',
                  textAlign:'center',padding:'0 2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:'100%',
                }}>
                  {occupant ? (occupant.name.length > 8 ? occupant.name.slice(0,7)+'…' : occupant.name) : 'B'+(i+1)}
                </span>
              </div>
            );
          })}
        </div>
        {berthList.length === 0 && port.berths > 0 && (
          <div style={{marginTop:6,fontSize:9,color:'var(--dim)',letterSpacing:'0.05em'}}>
            No vessels detected at berth. Connect AIS to populate.
          </div>
        )}
      </div>

      <div className="vd-section">
        <div className="vd-stitle">
          <span>Queue<Pip s={src.queue} /></span>
          <span>{queueList.length} ANCHORED</span>
        </div>
        {queueList.length === 0
          ? <div style={{fontSize:10,color:'var(--dim)',padding:'8px 0',letterSpacing:'0.05em'}}>No anchored vessels within {ANCHOR_R} NM.</div>
          : queueList.slice(0, 8).map((v, i) => {
              const idx = vessels.findIndex(vv => vv.mmsi===v.mmsi);
              const col = idx >= 0 ? colorFor(idx) : '#9aa6b3';
              return (
                <div key={v.mmsi}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:11,cursor:'pointer'}}
                  onClick={() => onSelectVessel && onSelectVessel(v.mmsi)}
                >
                  <div style={{fontSize:9,color:'var(--dim)',width:14,textAlign:'right',fontWeight:600}}>{i+1}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:col,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{v.name}</div>
                    <div style={{fontSize:9,color:'var(--dim)'}}>MMSI {v.mmsi}{v.flag?' · '+v.flag:''}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'var(--amber)'}}>{v.distNM.toFixed(1)} NM</div>
                    <div style={{fontSize:9,color:'var(--dim)'}}>ANCHORED</div>
                  </div>
                </div>
              );
            })
        }
        {queueList.length > 8 && (
          <div style={{fontSize:9,color:'var(--dim)',padding:'6px 0 0',letterSpacing:'0.05em'}}>+{queueList.length - 8} more</div>
        )}
      </div>

      {portAlerts.length > 0 && (
        <div className="vd-section">
          <div className="vd-stitle"><span>Port Alerts</span><span>{portAlerts.length}</span></div>
          {portAlerts.slice(0, 5).map((a, i) => (
            <div key={i} style={{
              display:'flex',gap:8,padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:10,
            }}>
              <div style={{
                width:6,height:6,borderRadius:'50%',marginTop:5,flexShrink:0,
                background: a.severity==='HIGH'?'var(--red)':a.severity==='MED'?'var(--amber)':'var(--cyan)',
              }}></div>
              <div style={{flex:1}}>
                <div>{a.text || a.message || a.type}</div>
                <div style={{fontSize:8,color:'var(--dim)',letterSpacing:'0.1em',marginTop:2}}>
                  {a.severity || 'INFO'} · {a.type}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="vd-section">
        <div className="vd-stitle"><span>Inbound Fleet</span><span>{inbound.length}</span></div>
        {inbound.length === 0
          ? <div style={{fontSize:11, color:'var(--dim)', padding:'8px 0'}}>No tracked vessels routing here.</div>
          : inbound.map(v => {
              const idx = vessels.findIndex(vv => vv.mmsi===v.mmsi);
              const col = colorFor(idx);
              return (
                <div key={v.mmsi} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:11}}>
                  <div>
                    <div style={{color:col,fontWeight:600}}>{v.name}</div>
                    <div style={{fontSize:9,color:'var(--dim)'}}>{v.operator} · {v.ceu.toLocaleString()} CEU</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{color:'var(--cyan)',fontSize:10}}>{v.eta}</div>
                    <div style={{fontSize:9,color:'var(--dim)'}}>{typeof v.lat==='number'&&typeof v.lon==='number' ? Math.round(haversine(v.lat,v.lon,port.lat,port.lon))+' NM' : '—'} · {typeof v.sog==='number' ? v.sog.toFixed(1)+' kn' : '— kn'}</div>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ============================================================
// COMPARE TAB — side-by-side ports (LIVE/CALC/MOCK aware)
// ============================================================
function CompareTab({ ports, vessels }) {
  const [selected, setSelected] = useState(() => window.STORE.load('vt7.compare', ['ESBCN','ESVLC','SIKOP']));

  useEffect(() => { window.STORE.save('vt7.compare', selected); }, [selected]);

  const toggle = (code) => {
    setSelected(prev => prev.includes(code)
      ? prev.filter(c => c !== code)
      : prev.length >= 4 ? [...prev.slice(1), code] : [...prev, code]);
  };

  const cmpPorts = selected.map(c => ports.find(p => p.code === c)).filter(Boolean);
  const isThree = cmpPorts.length === 3;

  // Helpers — read live values when available, fall back to seed.
  // Each accessor returns { val, src } where src is the data tier:
  //   LIVE = observed from AIS in last hour
  //   CALC = computed from accumulated AIS samples
  //   MOCK = seed value (no live samples yet)
  //   —    = no data at all
  const getPci = (p) => {
    const live = p.live;
    if (live && live.fresh && typeof live.pci === 'number') return { val: Math.round(live.pci), src: 'CALC' };
    return { val: p.pci, src: 'MOCK' };
  };
  const getQueue = (p) => {
    const live = p.live;
    if (live && live.src && live.src.queue === 'LIVE') return { val: live.queue, src: 'LIVE' };
    if (live && typeof live.queue === 'number' && live.fresh) return { val: live.queue, src: 'LIVE' };
    return { val: null, src: '—' };
  };
  const getBerths = (p) => ({ val: p.berths, src: 'STRUCT' }); // structural — not derivable from AIS
  const getDwell = (p) => {
    const live = p.live;
    if (live && typeof live.avgDwellH === 'number') return { val: +(live.avgDwellH/24).toFixed(1), src: 'CALC' };
    return { val: null, src: '—' };
  };
  const getUtil = (p) => {
    const live = p.live;
    if (live && typeof live.berthUtil === 'number') return { val: Math.round(live.berthUtil*100), src: 'CALC' };
    return { val: null, src: '—' };
  };
  const getInbound = (p) => ({
    val: vessels.filter(v => v.dest === p.code).length,
    src: 'LIVE',
  });

  // Comparative metrics — bar chart values
  const metrics = [
    { k:'pci',     l:'PCI',          get: getPci,    max: 100 },
    { k:'queue',   l:'Queue',        get: getQueue,  max: 16  },
    { k:'berths',  l:'Berths',       get: getBerths, max: 6   },
    { k:'dwell',   l:'Dwell (d)',    get: getDwell,  max: 5   },
    { k:'util',    l:'Berth Util %', get: getUtil,   max: 100 },
    { k:'inbound', l:'Inbound',      get: getInbound,max: 10  },
  ];

  // Tiny tier badge (matches Pip semantics)
  const SrcTag = ({ s }) => {
    if (!s || s === '—' || s === 'STRUCT') return null;
    const colors = { LIVE:'#5fe88f', CALC:'#5fd0e8', MOCK:'#ffb450', EST:'#ffb450' };
    return (
      <span style={{
        marginLeft:5, fontSize:8, letterSpacing:'0.1em',
        color: colors[s] || 'var(--dim)',
        opacity: s === 'MOCK' ? 0.7 : 1,
      }}>·{s}</span>
    );
  };

  return (
    <div>
      <div className="vd-header" style={{padding:'12px 16px'}}>
        <div className="vd-stitle"><span>Compare Ports</span><span>{selected.length}/4</span></div>
        <div style={{fontSize:10, color:'var(--dim)', letterSpacing:'0.04em', marginBottom:8}}>Select 2–4 ports to benchmark side-by-side. Saved locally.</div>
        <div style={{fontSize:9, color:'var(--dim)', letterSpacing:'0.08em', marginBottom:4}}>
          <span style={{color:'#5fe88f'}}>LIVE</span> from AIS · <span style={{color:'#5fd0e8'}}>CALC</span> from samples · <span style={{color:'#ffb450'}}>MOCK</span> seed
        </div>
      </div>

      <div className="cmp-wrap">
        <div className="cmp-search">
          {ports.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p => (
            <button key={p.code}
              className={'cmp-port-chip'+(selected.includes(p.code)?' on':'')}
              onClick={() => toggle(p.code)}>{p.code}</button>
          ))}
        </div>

        {cmpPorts.length < 2 && (
          <div style={{padding:'30px 0', textAlign:'center', color:'var(--dim)', fontSize:11, letterSpacing:'0.1em'}}>
            SELECT AT LEAST 2 PORTS
          </div>
        )}

        {cmpPorts.length >= 2 && (
          <>
            <div className={'cmp-grid'+(isThree?' three':'')} style={cmpPorts.length === 4 ? {gridTemplateColumns:'1fr 1fr'} : {}}>
              {cmpPorts.map(p => {
                const pci = getPci(p);
                const queue = getQueue(p);
                const berths = getBerths(p);
                const dwell = getDwell(p);
                const inbound = getInbound(p);
                return (
                  <div key={p.code} className="cmp-card">
                    <div className="cn">{p.name}</div>
                    <div className="cm">{p.code} · {REGIONS[p.region]}</div>
                    <div className="cpci" style={{color: pciHex(pci.val)}}>
                      {pci.val}
                      <SrcTag s={pci.src} />
                    </div>
                    <div style={{height:24, marginBottom:8}}>
                      {(p.trend7d && p.trend7d.length>=2)
                        ? <Sparkline data={p.trend7d} color={pciHex(pci.val)} height={24} />
                        : <div style={{fontSize:8,color:'var(--dim)',textAlign:'center',marginTop:8,letterSpacing:'0.1em'}}>NO TREND</div>
                      }
                    </div>
                    <div className="cstat"><span className="l">Queue<SrcTag s={queue.src} /></span><span>{queue.val ?? '—'}</span></div>
                    <div className="cstat"><span className="l">Berths</span><span>{berths.val}</span></div>
                    <div className="cstat"><span className="l">Dwell<SrcTag s={dwell.src} /></span><span>{dwell.val != null ? dwell.val+'d' : '—'}</span></div>
                    <div className="cstat"><span className="l">Inbound</span><span style={{color:'var(--cyan)'}}>{inbound.val}</span></div>
                  </div>
                );
              })}
            </div>

            <div style={{marginTop:14, padding:'10px 0', borderTop:'1px solid var(--border)'}}>
              <div className="vd-stitle" style={{padding:'0 0 8px'}}>
                <span>Side-by-side Metrics</span><span>NORMALIZED</span>
              </div>
              {metrics.map(m => (
                <div key={m.k} style={{marginBottom:10}}>
                  <div style={{fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--dim)', marginBottom:3, fontWeight:600}}>{m.l}</div>
                  {cmpPorts.map((p) => {
                    const r = m.get(p);
                    if (r.val == null) {
                      return (
                        <div key={p.code} className="cmp-bar-row">
                          <div className="l">{p.code}</div>
                          <div className="cmp-bar"></div>
                          <div className="v" style={{color:'var(--dim)',fontSize:10}}>—</div>
                        </div>
                      );
                    }
                    const pct = Math.min(100, (r.val / m.max) * 100);
                    const barColor = m.k === 'pci' ? pciHex(r.val) :
                                     m.k === 'queue' ? (r.val>=10?'var(--red)':r.val>=6?'var(--amber)':'var(--cyan)') :
                                     'var(--cyan)';
                    return (
                      <div key={p.code} className="cmp-bar-row">
                        <div className="l">{p.code}</div>
                        <div className="cmp-bar"><div className="fill" style={{width:pct+'%', background:barColor, opacity: r.src==='MOCK'?0.4:1}}></div></div>
                        <div className="v" style={{color:barColor}}>{r.val}<SrcTag s={r.src} /></div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div style={{marginTop:14, padding:'10px 0', borderTop:'1px solid var(--border)'}}>
              <div className="vd-stitle" style={{padding:'0 0 8px'}}>
                <span>Best / Worst</span><span>VS SELECTED</span>
              </div>
              {(() => {
                const best = cmpPorts.reduce((a,b)=> getPci(a).val < getPci(b).val ? a : b);
                const worst = cmpPorts.reduce((a,b)=> getPci(a).val > getPci(b).val ? a : b);
                const bestPci = getPci(best);
                const worstPci = getPci(worst);
                const bestQ = getQueue(best);
                const worstQ = getQueue(worst);
                return (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                    <div style={{border:'1px solid var(--green)',padding:8,background:'oklch(0.74 0.14 155 / 0.06)'}}>
                      <div style={{fontSize:8,letterSpacing:'0.2em',textTransform:'uppercase',color:'var(--green)',fontWeight:600,marginBottom:3}}>★ BEST</div>
                      <div style={{fontSize:13,fontWeight:600}}>{best.name}</div>
                      <div style={{fontSize:10,color:'var(--dim)',marginTop:2}}>PCI {bestPci.val} · Q{bestQ.val ?? '—'}</div>
                    </div>
                    <div style={{border:'1px solid var(--red)',padding:8,background:'oklch(0.66 0.18 25 / 0.06)'}}>
                      <div style={{fontSize:8,letterSpacing:'0.2em',textTransform:'uppercase',color:'var(--red)',fontWeight:600,marginBottom:3}}>⚠ WORST</div>
                      <div style={{fontSize:13,fontWeight:600}}>{worst.name}</div>
                      <div style={{fontSize:10,color:'var(--dim)',marginTop:2}}>PCI {worstPci.val} · Q{worstQ.val ?? '—'}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ALERTS
// ============================================================
function AlertsTab({ alerts, homePort }) {
  // Group by category for the summary header
  const byCat = alerts.reduce((acc, a) => { acc[a.type] = (acc[a.type]||0)+1; return acc; }, {});
  const etaCount = (byCat.eta_window||0) + (byCat.eta_shift||0);

  // Filter chips
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? alerts :
    filter === 'eta' ? alerts.filter(a => a.type === 'eta_window' || a.type === 'eta_shift') :
    filter === 'fleet' ? alerts.filter(a => !!a.mmsi) :
    filter === 'port' ? alerts.filter(a => !a.mmsi) :
    alerts;

  return (
    <div>
      <div className="vd-header" style={{padding:'12px 16px'}}>
        <div className="vd-stitle"><span>Live Alerts</span><span>{alerts.length} EVENTS · 24H</span></div>
        <div style={{display:'flex',gap:10,fontSize:10,color:'var(--dim)',letterSpacing:'0.05em',marginTop:6,flexWrap:'wrap'}}>
          <span>Auto-refresh 30s</span>
          <span style={{color:'var(--cyan)'}}>HOME · {homePort||'ESBCN'}</span>
          {etaCount > 0 && <span style={{color:'var(--amber)'}}>ETA · {etaCount}</span>}
          {byCat.congestion > 0 && <span style={{color:'var(--red)'}}>PCI · {byCat.congestion}</span>}
          {byCat.queue > 0 && <span>QUEUE · {byCat.queue}</span>}
        </div>
        <div style={{display:'flex',gap:4,marginTop:10}}>
          {[
            {k:'all',   l:'ALL'},
            {k:'eta',   l:'ETA'},
            {k:'fleet', l:'FLEET'},
            {k:'port',  l:'PORTS'},
          ].map(t => (
            <button key={t.k}
              className={'filter-chip '+(filter===t.k?'on':'')}
              onClick={() => setFilter(t.k)}
              style={{
                background: filter===t.k ? 'var(--cyan)' : 'transparent',
                color: filter===t.k ? '#000' : 'var(--dim)',
                border: '1px solid '+(filter===t.k?'var(--cyan)':'var(--bord)'),
                fontSize: 9, padding: '3px 8px', letterSpacing:'0.1em',
                fontFamily:'inherit', cursor:'pointer',
              }}>{t.l}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 && (
        <div style={{padding:'30px 16px',color:'var(--dim)',fontSize:11,letterSpacing:'0.05em',lineHeight:1.6}}>
          <div style={{color:'var(--cyan)',marginBottom:6,letterSpacing:'0.15em',fontSize:10}}>NO ALERTS</div>
          {alerts.length === 0 ? (
            <div>
              Engine running every 30s.<br/>
              Will fire when:
              <ul style={{margin:'8px 0 0 16px',padding:0,fontSize:10}}>
                <li>fleet vessel ETA → {homePort||'ESBCN'} crosses 96h / 48h / 24h / 12h / 6h</li>
                <li>declared ETA shifts ≥30 min</li>
                <li>port PCI rises ≥5 in 2h</li>
                <li>queue grows ≥2 in 1h</li>
                <li>anchor drift, speed drop, dwell &gt; threshold</li>
              </ul>
            </div>
          ) : <div>No alerts in this category.</div>}
        </div>
      )}
      {filtered.map((a) => (
        <div key={a.id || a.ts+'-'+a.text} className="alert-row">
          <div className={'alert-bar '+a.sev}></div>
          <div>
            <div className="alert-text">{a.text}</div>
            <div className="alert-meta">
              <span style={{color: a.sev==='high'?'var(--red)':a.sev==='med'?'var(--amber)':'var(--cyan)'}}>
                {(a.type||'').replace('_',' ').toUpperCase()}
              </span>
              <span>{a.ref}</span>
            </div>
          </div>
          <div className="alert-time">{fmtAge(a.ts)}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// TICKER
// ============================================================
function Ticker({ ports, vessels }) {
  const items = [];
  ports.slice().sort((a,b)=>b.pci-a.pci).slice(0,10).forEach(p => {
    const t = p.trend7d;
    const delta = (t && t.length >= 3) ? (t[t.length-1] - t[t.length-3]) : 0;
    items.push(
      <span key={'p'+p.code} className="ticker-item">
        <span className="k">{p.code}</span>
        <span style={{color: pciHex(p.pci)}}>PCI {p.pci}</span>
        <span className={'arrow '+(delta>0?'up':delta<0?'down':'')}>{delta>0?'▲':delta<0?'▼':'■'} {Math.abs(delta)}</span>
        <span style={{color:'var(--dim)'}}>Q{p.queue}</span>
      </span>
    );
  });
  vessels.slice(0,8).forEach(v => {
    items.push(
      <span key={'v'+v.mmsi} className="ticker-item">
        <span className="k">AIS</span>
        <span>{v.name}</span>
        <span style={{color:'var(--cyan)'}}>{typeof v.sog==='number' ? v.sog.toFixed(1) : '—'}kn</span>
        <span style={{color:'var(--dim)'}}>→ {v.dest}</span>
      </span>
    );
  });
  return (
    <div className="ticker">
      <div className="ticker-label">PCI · AIS FEED</div>
      <div className="ticker-track">
        <div className="ticker-content">{items}{items}</div>
      </div>
    </div>
  );
}

// ============================================================
// TIME SLIDER
// ============================================================
function TimeSlider({ visible }) {
  const [pos, setPos] = useState(1.0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPos(p => p >= 1 ? 0 : p + 0.005), 100);
    return () => clearInterval(t);
  }, [playing]);
  if (!visible) return null;
  const hoursAgo = Math.round((1 - pos) * 24);
  const label = hoursAgo === 0 ? 'NOW' : `T-${String(hoursAgo).padStart(2,'0')}H`;
  return (
    <div className="time-slider">
      <button className="ts-btn" onClick={() => setPlaying(!playing)}>{playing?'❚❚':'▶'}</button>
      <button className="ts-btn" onClick={() => setPos(0)}>⏮</button>
      <div className="ts-track" onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos((e.clientX - rect.left) / rect.width);
      }}>
        <div className="filled" style={{width: (pos*100)+'%'}}></div>
        <div className="head" style={{left: (pos*100)+'%'}}></div>
      </div>
      <div className="ts-time">{label} · 24h replay</div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "auto",
  "density": "standard",
  "mapStyle": "auto",
  "showHeatmap": true,
  "showTracks": true,
  "showPorts": true,
  "showVessels": true,
  "showTimeSlider": false,
  "accent": "cyan",
  "showAisPanel": true,
  "homePort": "ESBCN",
  "etaShiftMin": 30,
  "pciDelta2h": 5,
  "queueDelta1h": 2,
  "speedDropKn": 4,
  "dwellDays": 3.5
}/*EDITMODE-END*/;

// ============================================================
// PORT FULLSCREEN — focused dashboard view for a single port
// ============================================================
function PortFullscreen({ port, vessels, discovered, alerts, onClose, onSelectVessel }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ port:null, vessels:[] });
  const [activeTab, setActiveTab] = useState('queue');

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Bootstrap leaflet map
  useEffect(() => {
    if (!port || !mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [port.lat, port.lon], zoom: 11,
      zoomControl: false, attributionControl: false,
      preferCanvas: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png', {
      maxZoom: 18, subdomains: 'abcd',
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    mapRef.current = map;
    return () => { try { map.remove(); } catch (e) {} mapRef.current = null; };
  }, [port?.code]);

  // Compute queue / berth lists (same logic as PortDetail)
  const ANCHOR_R = (window.PortMetrics && window.PortMetrics.ANCHOR_RADIUS_NM) || 8;
  const BERTH_R  = (window.PortMetrics && window.PortMetrics.BERTH_RADIUS_NM)  || 1.2;

  const allActive = useMemo(() => {
    if (!port) return [];
    const fleet = vessels.filter(v => typeof v.lat === 'number' && typeof v.lon === 'number');
    if (!discovered) return fleet;
    const seen = new Set(fleet.map(v => String(v.mmsi)));
    const arr = discovered instanceof Map ? Array.from(discovered.values()) : Array.from(discovered);
    return fleet.concat(arr.filter(v => v && !seen.has(String(v.mmsi)) && typeof v.lat === 'number' && typeof v.lon === 'number'));
  }, [vessels, discovered, port?.code]);

  const { queueList, berthList, nearbyList, inboundList } = useMemo(() => {
    if (!port) return { queueList:[], berthList:[], nearbyList:[], inboundList:[] };
    const queueList = [], berthList = [], nearbyList = [];
    for (const v of allActive) {
      const d = haversine(v.lat, v.lon, port.lat, port.lon);
      const item = { ...v, distNM: d };
      if (d <= ANCHOR_R && v.st === 1) queueList.push(item);
      else if (d <= BERTH_R && v.st === 5) berthList.push(item);
      else if (d <= ANCHOR_R) nearbyList.push(item);
    }
    queueList.sort((a, b) => a.distNM - b.distNM);
    berthList.sort((a, b) => a.distNM - b.distNM);
    nearbyList.sort((a, b) => a.distNM - b.distNM);
    const inboundList = vessels
      .filter(v => v.dest === port.code)
      .map(v => ({
        ...v,
        distNM: (typeof v.lat==='number' && typeof v.lon==='number') ? haversine(v.lat, v.lon, port.lat, port.lon) : null,
      }))
      .sort((a, b) => (a.distNM == null ? 1e9 : a.distNM) - (b.distNM == null ? 1e9 : b.distNM));
    return { queueList, berthList, nearbyList, inboundList };
  }, [allActive, port?.code, vessels]);

  // Render port + vessels on the mini-map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !port) return;

    // Clear
    if (layersRef.current.port) { map.removeLayer(layersRef.current.port); layersRef.current.port = null; }
    layersRef.current.vessels.forEach(m => map.removeLayer(m));
    layersRef.current.vessels = [];

    // Port marker + radius rings
    const portIcon = L.divIcon({
      html: `<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center"><div style="width:14px;height:14px;background:${pciHex(port.pci)};border:2px solid #000;transform:rotate(45deg)"></div></div>`,
      iconSize:[22,22], iconAnchor:[11,11], className:'port-marker',
    });
    const portMarker = L.marker([port.lat, port.lon], { icon: portIcon }).addTo(map);
    layersRef.current.port = portMarker;

    // Anchor radius ring (8 NM ≈ 14816 m)
    L.circle([port.lat, port.lon], {
      radius: ANCHOR_R * 1852, color: 'var(--cyan)', weight: 1, dashArray:'4 6',
      fill: false, opacity: 0.3,
    }).addTo(map);
    // Berth radius (1.2 NM ≈ 2222 m)
    L.circle([port.lat, port.lon], {
      radius: BERTH_R * 1852, color: '#5fe88f', weight: 1,
      fill: false, opacity: 0.5,
    }).addTo(map);

    // Add markers for queue (amber), berth (green), nearby (grey), inbound (cyan)
    const renderVessel = (v, color, kind) => {
      const heading = v.hdg ?? v.cog ?? 0;
      const html = `
        <div class="vessel-marker" style="opacity:${kind==='nearby'?0.6:1}">
          <svg width="18" height="18" viewBox="0 0 24 24" style="overflow:visible">
            <g transform="rotate(${heading} 12 12)">
              <path d="M 12 2 L 18 20 L 12 17 L 6 20 Z" fill="${color}" stroke="#000" stroke-width="0.8"/>
            </g>
          </svg>
        </div>`;
      const icon = L.divIcon({ html, iconSize:[18,18], iconAnchor:[9,9], className:'vessel-marker-wrap' });
      const m = L.marker([v.lat, v.lon], { icon }).addTo(map);
      m.bindTooltip(`<b>${v.name||'MMSI '+v.mmsi}</b><br>${kind.toUpperCase()} · ${v.distNM.toFixed(1)} NM`,
        { direction:'right', offset:[8,0], className:'vessel-label' });
      m.on('click', () => onSelectVessel && onSelectVessel(v.mmsi));
      layersRef.current.vessels.push(m);
    };
    queueList.forEach(v => renderVessel(v, '#ffb84d', 'queue'));
    berthList.forEach(v => renderVessel(v, '#5fe88f', 'berth'));
    nearbyList.slice(0, 30).forEach(v => renderVessel(v, '#9aa6b3', 'nearby'));
  }, [port?.code, queueList, berthList, nearbyList]);

  if (!port) return null;

  const cls = pciColor(port.pci);
  const live = port.live;
  const src = (live && live.src) || {};
  const portAlerts = (alerts || []).filter(a => a.port === port.code);
  const trendArr = (port.trend7d && port.trend7d.length >= 2) ? port.trend7d : null;
  const queueVal = (src.queue==='LIVE') ? live.queue : port.queue;
  const dwellVal = (live && live.avgDwellH != null) ? live.avgDwellH/24 : null;
  const utilVal  = (live && live.berthUtil != null) ? Math.round(live.berthUtil*100) : null;
  const thrVal   = (live && live.throughput7d > 0) ? live.throughput7d : null;

  const Pip = ({ s }) => {
    if (!s || s === 'NONE') s = 'MOCK';
    const meta = {
      LIVE: { c:'#5fd0e8', bg:'rgba(95,208,232,0.12)', bd:'rgba(95,208,232,0.35)' },
      CALC: { c:'#7fc97f', bg:'rgba(127,201,127,0.10)', bd:'rgba(127,201,127,0.30)' },
      EST:  { c:'#ffb450', bg:'rgba(255,180,80,0.10)',  bd:'rgba(255,180,80,0.30)'  },
      MOCK: { c:'#9aa6b3', bg:'rgba(154,166,179,0.08)', bd:'rgba(154,166,179,0.20)' },
    }[s];
    return <span style={{
      display:'inline-flex',alignItems:'center',
      fontSize:8,letterSpacing:'0.18em',fontWeight:700,
      color: meta.c, marginLeft:6,
      padding:'1px 5px', background: meta.bg, border:'1px solid '+meta.bd,
    }}>{s}</span>;
  };

  return (
    <div style={{
      position:'fixed',inset:0,zIndex:9000,
      background:'var(--bg)',display:'flex',flexDirection:'column',
      animation:'pf-fade 0.18s ease-out',
    }}>
      <style>{`@keyframes pf-fade { from { opacity: 0; transform: scale(0.99); } to { opacity: 1; transform: scale(1); } }`}</style>

      {/* ---- Header ---- */}
      <div style={{
        flexShrink:0,padding:'14px 22px',
        borderBottom:'1px solid var(--border)',
        display:'flex',alignItems:'center',gap:18,
      }}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:4}}>
            <div style={{fontSize:24,fontWeight:600,letterSpacing:'-0.01em'}}>{port.name}</div>
            <div style={{fontSize:11,letterSpacing:'0.18em',color:'var(--dim)'}}>{port.code} · {REGIONS[port.region]}</div>
          </div>
          <div style={{fontSize:10,letterSpacing:'0.05em',color:'var(--dim)'}}>
            {fmtCoord(port.lat,'lat')} {fmtCoord(port.lon,'lon')} · {port.berths} BERTHS · {(port.ceu/1000).toFixed(1)}k CEU/wk
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            fontFamily:'inherit',fontSize:10,letterSpacing:'0.18em',fontWeight:700,
            padding:'8px 14px',color:'var(--text)',background:'transparent',
            border:'1px solid var(--border-2)',cursor:'pointer',
            textTransform:'uppercase',
          }}
          title="Close (Esc)"
        >✕ CLOSE</button>
      </div>

      {/* ---- Body: 2 columns (left: KPIs+map, right: tabs) ---- */}
      <div style={{flex:1,display:'grid',gridTemplateColumns:'1fr 380px',minHeight:0}}>
        {/* LEFT: KPIs + map */}
        <div style={{display:'flex',flexDirection:'column',minHeight:0,borderRight:'1px solid var(--border)'}}>
          {/* KPI strip */}
          <div style={{
            flexShrink:0,padding:'14px 22px',
            display:'grid',gridTemplateColumns:'repeat(5, 1fr)',gap:14,
            borderBottom:'1px solid var(--border)',
          }}>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--dim)',marginBottom:5}}>PCI<Pip s={src.pci} /></div>
              <div style={{fontSize:38,fontWeight:600,color:pciHex(port.pci),lineHeight:1}}>{port.pci}</div>
              {trendArr && (
                <div style={{marginTop:6,height:24}}>
                  <Sparkline data={trendArr} color={pciHex(port.pci)} height={24} />
                </div>
              )}
            </div>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--dim)',marginBottom:5}}>QUEUE<Pip s={src.queue} /></div>
              <div style={{fontSize:38,fontWeight:600,color:'var(--amber)',lineHeight:1}}>{queueVal}</div>
              <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.1em',marginTop:6}}>{queueList.length} ANCHORED</div>
            </div>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--dim)',marginBottom:5}}>AT BERTH<Pip s={src.berthUtil} /></div>
              <div style={{fontSize:38,fontWeight:600,color:'var(--cyan)',lineHeight:1}}>{berthList.length}<span style={{fontSize:18,color:'var(--dim)'}}>/{port.berths}</span></div>
              <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.1em',marginTop:6}}>{utilVal != null ? utilVal+'% UTIL' : '—'}</div>
            </div>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--dim)',marginBottom:5}}>AVG DWELL<Pip s={src.dwell} /></div>
              <div style={{fontSize:38,fontWeight:600,color:'var(--text)',lineHeight:1}}>{dwellVal != null ? dwellVal.toFixed(1) : '—'}<span style={{fontSize:18,color:'var(--dim)'}}>d</span></div>
              <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.1em',marginTop:6}}>n={live && live.sampleN ? live.sampleN : 0}</div>
            </div>
            <div>
              <div style={{fontSize:9,letterSpacing:'0.18em',color:'var(--dim)',marginBottom:5}}>THROUGHPUT<Pip s={src.throughput} /></div>
              <div style={{fontSize:38,fontWeight:600,color:'var(--text)',lineHeight:1}}>{thrVal != null ? thrVal : '—'}</div>
              <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.1em',marginTop:6}}>VESSELS / 7D</div>
            </div>
          </div>

          {/* Map */}
          <div ref={mapContainerRef} style={{flex:1,minHeight:0,background:'#0a0d10',position:'relative'}}>
            {/* Legend overlay */}
            <div style={{
              position:'absolute',bottom:14,left:14,zIndex:500,
              padding:'8px 12px',background:'rgba(10,13,16,0.85)',border:'1px solid var(--border-2)',
              fontSize:9,letterSpacing:'0.1em',
            }}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                <span style={{width:8,height:8,background:'#5fe88f',display:'inline-block'}}></span>
                <span>AT BERTH ({berthList.length})</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                <span style={{width:8,height:8,background:'#ffb84d',display:'inline-block'}}></span>
                <span>QUEUE ({queueList.length})</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{width:8,height:8,background:'#9aa6b3',display:'inline-block'}}></span>
                <span>NEARBY ({Math.min(nearbyList.length,30)})</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Tabs */}
        <div style={{display:'flex',flexDirection:'column',minHeight:0,background:'var(--bg-2)'}}>
          <div style={{flexShrink:0,display:'flex',borderBottom:'1px solid var(--border)'}}>
            {[
              {k:'queue',l:'QUEUE',n:queueList.length},
              {k:'berth',l:'BERTHS',n:berthList.length},
              {k:'inbound',l:'INBOUND',n:inboundList.length},
              {k:'alerts',l:'ALERTS',n:portAlerts.length},
            ].map(t => (
              <button key={t.k}
                onClick={() => setActiveTab(t.k)}
                style={{
                  flex:1,padding:'12px 8px',fontFamily:'inherit',
                  fontSize:9,letterSpacing:'0.18em',fontWeight:700,textTransform:'uppercase',
                  background:'transparent',border:'none',
                  borderBottom:'2px solid '+(activeTab===t.k?'var(--cyan)':'transparent'),
                  color: activeTab===t.k?'var(--text)':'var(--dim)',
                  cursor:'pointer',
                }}
              >{t.l} {t.n>0 && <span style={{color:'var(--cyan)',marginLeft:3}}>{t.n}</span>}</button>
            ))}
          </div>

          <div style={{flex:1,overflow:'auto',padding:'14px 16px'}}>
            {activeTab === 'queue' && (
              queueList.length === 0
                ? <div style={{padding:'40px 0',textAlign:'center',color:'var(--dim)',fontSize:11,letterSpacing:'0.1em'}}>
                    NO ANCHORED VESSELS<br/>
                    <span style={{fontSize:9,opacity:0.7}}>within {ANCHOR_R} NM of port</span>
                  </div>
                : queueList.map((v, i) => {
                    const idx = vessels.findIndex(vv => vv.mmsi===v.mmsi);
                    const col = idx >= 0 ? colorFor(idx) : '#9aa6b3';
                    return (
                      <div key={v.mmsi}
                        onClick={() => onSelectVessel && onSelectVessel(v.mmsi)}
                        style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}
                      >
                        <div style={{fontSize:10,color:'var(--dim)',width:18,textAlign:'right',fontWeight:700}}>{i+1}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:col,fontWeight:600,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{v.name}</div>
                          <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.05em'}}>{v.mmsi}{v.flag?' · '+v.flag:''}{v.type?' · '+v.type:''}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:11,color:'var(--amber)',fontWeight:600}}>{v.distNM.toFixed(1)} NM</div>
                          <div style={{fontSize:8,color:'var(--dim)',letterSpacing:'0.1em'}}>SOG {(v.sog||0).toFixed(1)}</div>
                        </div>
                      </div>
                    );
                  })
            )}

            {activeTab === 'berth' && (
              berthList.length === 0
                ? <div style={{padding:'40px 0',textAlign:'center',color:'var(--dim)',fontSize:11,letterSpacing:'0.1em'}}>
                    NO VESSELS AT BERTH
                  </div>
                : (
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(port.berths,4)}, 1fr)`,gap:5,marginBottom:14}}>
                      {Array.from({length: port.berths}).map((_, i) => {
                        const occ = berthList[i];
                        return (
                          <div key={i} style={{
                            aspectRatio:'1.4 / 1',
                            border:'1px solid '+(occ?'#5fe88f':'var(--border-2)'),
                            background: occ ? 'rgba(95,232,143,0.10)' : 'transparent',
                            display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                            cursor: occ ? 'pointer' : 'default',padding:4,
                          }} onClick={() => occ && onSelectVessel && onSelectVessel(occ.mmsi)}>
                            <div style={{fontSize:8,letterSpacing:'0.15em',color:'var(--dim)',marginBottom:3}}>B{i+1}</div>
                            <div style={{
                              fontSize:9,fontWeight:600,
                              color:occ?'#5fe88f':'var(--dim)',
                              textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',width:'100%',
                            }}>{occ ? occ.name : '—'}</div>
                          </div>
                        );
                      })}
                    </div>
                    {berthList.map(v => {
                      const idx = vessels.findIndex(vv => vv.mmsi===v.mmsi);
                      const col = idx >= 0 ? colorFor(idx) : '#5fe88f';
                      return (
                        <div key={v.mmsi}
                          onClick={() => onSelectVessel && onSelectVessel(v.mmsi)}
                          style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}
                        >
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{color:col,fontWeight:600,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{v.name}</div>
                            <div style={{fontSize:9,color:'var(--dim)',letterSpacing:'0.05em'}}>{v.mmsi}{v.flag?' · '+v.flag:''}</div>
                          </div>
                          <div style={{fontSize:9,color:'#5fe88f',letterSpacing:'0.1em'}}>MOORED</div>
                        </div>
                      );
                    })}
                  </div>
                )
            )}

            {activeTab === 'inbound' && (
              inboundList.length === 0
                ? <div style={{padding:'40px 0',textAlign:'center',color:'var(--dim)',fontSize:11,letterSpacing:'0.1em'}}>
                    NO TRACKED VESSELS ROUTING HERE
                  </div>
                : inboundList.map(v => {
                    const idx = vessels.findIndex(vv => vv.mmsi===v.mmsi);
                    const col = colorFor(idx);
                    return (
                      <div key={v.mmsi}
                        onClick={() => onSelectVessel && onSelectVessel(v.mmsi)}
                        style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}
                      >
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:col,fontWeight:600,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{v.name}</div>
                          <div style={{fontSize:9,color:'var(--dim)'}}>{v.operator || v.mmsi}{v.ceu>0?' · '+v.ceu.toLocaleString()+' CEU':''}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:11,color:'var(--cyan)',fontWeight:600}}>{v.eta || '—'}</div>
                          <div style={{fontSize:9,color:'var(--dim)'}}>{v.distNM != null ? Math.round(v.distNM)+' NM' : '—'} · {(v.sog||0).toFixed(1)} kn</div>
                        </div>
                      </div>
                    );
                  })
            )}

            {activeTab === 'alerts' && (
              portAlerts.length === 0
                ? <div style={{padding:'40px 0',textAlign:'center',color:'var(--dim)',fontSize:11,letterSpacing:'0.1em'}}>
                    NO ACTIVE ALERTS
                  </div>
                : portAlerts.map((a, i) => (
                    <div key={i} style={{display:'flex',gap:10,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                      <div style={{
                        width:8,height:8,borderRadius:'50%',marginTop:5,flexShrink:0,
                        background: a.severity==='HIGH'?'var(--red)':a.severity==='MED'?'var(--amber)':'var(--cyan)',
                      }}></div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11}}>{a.text || a.message || a.type}</div>
                        <div style={{fontSize:8,color:'var(--dim)',letterSpacing:'0.1em',marginTop:3}}>
                          {a.severity || 'INFO'} · {a.type} · {a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-GB') : ''}
                        </div>
                      </div>
                    </div>
                  ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [selectedMmsi, setSelectedMmsi] = useState('636017823');
  const [selectedPort, setSelectedPort] = useState(null);
  const [portFullscreen, setPortFullscreen] = useState(null); // port code or null
  const [activeTab, setActiveTab] = useState('vessel');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const { bookmarks, toggle: toggleBookmark } = useBookmarks();

  // Editor state
  const [editor, setEditor] = useState(null); // { kind:'vessel'|'port', initial?, isCustom? }
  const [aisEditorOpen, setAisEditorOpen] = useState(false);

  // CRUD entities
  const ents = useEntities();

  // Live AIS data overlay
  const [liveOverlay, setLiveOverlay] = useState({});
  const [discovered, setDiscovered] = useState(new Map());
  const [discoverMode, setDiscoverMode] = useState(false);
  const [globalHunt, setGlobalHunt] = useState(null); // null | string (query)
  const [aisStatus, setAisStatus] = useState({ on:false, msgCount:0 });
  const [aisLog, setAisLog] = useState([]);
  const aisRef = useRef(null);

  // AIS watchlist (decoupled from fleet)
  const aisWl = useAisWatchlist(ents.vessels);

  // Mobile/responsive
  const isMobile = useMedia('(max-width: 1023px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Resolve auto theme based on local time (19:00-07:00 = dark)
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const h = new Date().getHours();
    return (h >= 19 || h < 7) ? 'dark' : 'light';
  });
  useEffect(() => {
    if (tweaks.theme !== 'auto') return;
    const tick = () => {
      const h = new Date().getHours();
      setResolvedTheme((h >= 19 || h < 7) ? 'dark' : 'light');
    };
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, [tweaks.theme]);

  const effectiveTheme = tweaks.theme === 'auto' ? resolvedTheme : tweaks.theme;
  const effectiveMapStyle = tweaks.mapStyle === 'auto' ? (effectiveTheme === 'dark' ? 'dark' : 'light') : tweaks.mapStyle;

  // Apply theme + accent
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    if (tweaks.accent === 'amber') document.documentElement.style.setProperty('--cyan', 'oklch(0.80 0.14 75)');
    else if (tweaks.accent === 'green') document.documentElement.style.setProperty('--cyan', 'oklch(0.74 0.14 155)');
    else if (tweaks.accent === 'magenta') document.documentElement.style.setProperty('--cyan', 'oklch(0.70 0.16 330)');
    else document.documentElement.style.removeProperty('--cyan');
  }, [effectiveTheme, tweaks.accent]);

  // AIS service init
  useEffect(() => {
    const pushLog = (m, k='g') => setAisLog(prev => [...prev.slice(-50), { t: new Date().toLocaleTimeString('en-GB'), m, k }]);
    aisRef.current = createAisService({
      onPosition: (p) => {
        setLiveOverlay(prev => ({ ...prev, [p.mmsi]: p }));
      },
      onStatic: (s) => {
        setLiveOverlay(prev => ({ ...prev, [s.mmsi]: { ...(prev[s.mmsi]||{}), ...s } }));
      },
      onDiscover: (v) => {
        setDiscovered(prev => {
          const next = new Map(prev);
          const existing = next.get(v.mmsi) || {};
          next.set(v.mmsi, { ...existing, ...v });
          // Cap at 300 to avoid runaway
          if (next.size > 300) {
            // Drop oldest by ts
            const arr = [...next.entries()].sort((a,b)=>(a[1].ts||0)-(b[1].ts||0));
            for (let i = 0; i < arr.length - 300; i++) next.delete(arr[i][0]);
          }
          return next;
        });
      },
      onStatus: (st) => setAisStatus(s => ({ ...s, ...st, tracking: VESSELS.length })),
      onError: (e) => pushLog('⚠ '+e, 'e'),
      onLog: pushLog,
    });
    return () => aisRef.current && aisRef.current.disconnect();
  }, []);

  const onAisConnect = useCallback((apiKey) => {
    if (!apiKey) {
      setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: '⚠ Missing API key', k: 'w' }]);
      return;
    }
    // Auto-enable discover if fleet is empty/small (so user sees vessels immediately)
    if (aisWl.resolved.length < 5 && !discoverMode) {
      setDiscoverMode(true);
      aisRef.current.setDiscover(true);
      setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'Auto-enabled DISCOVER (empty fleet)', k: 'o' }]);
    }
    aisRef.current.connect(apiKey, aisWl.resolved);
  }, [aisWl.resolved, discoverMode]);

  const onAisDisconnect = useCallback(() => {
    aisRef.current.disconnect();
    setAisStatus(s => ({ ...s, on: false }));
    setDiscovered(new Map());
    setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'Disconnected', k: 'g' }]);
  }, []);

  // Bbox + discover wiring
  const onBoundsChange = useCallback((box) => {
    if (aisRef.current) aisRef.current.setBBox(box);
  }, []);
  const toggleDiscover = useCallback(() => {
    setDiscoverMode(prev => {
      const next = !prev;
      if (aisRef.current) aisRef.current.setDiscover(next);
      if (!next) setDiscovered(new Map());
      return next;
    });
  }, []);

  // Global Hunt — broadens AIS subscription to the whole world and emits any vessel
  // whose name/MMSI/IMO matches the query (no type filter). Used when the user is
  // looking for a specific vessel that may be outside the current bbox.
  const onGlobalHunt = useCallback((q) => {
    const query = (q || '').trim();
    if (!query) return;
    setGlobalHunt(query);
    if (aisRef.current) aisRef.current.setGlobalSearch(query);
    setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'GLOBAL HUNT: "'+query+'"', k: 'o' }]);
  }, []);

  const stopGlobalHunt = useCallback(() => {
    setGlobalHunt(null);
    if (aisRef.current) aisRef.current.setGlobalSearch(null);
    setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'GLOBAL HUNT off', k: 'g' }]);
  }, []);

  // Auto-stop global hunt when query cleared or query no longer matches the hunt target
  useEffect(() => {
    if (!globalHunt) return;
    if (!query) { stopGlobalHunt(); return; }
    // If user typed something completely different from what we're hunting, restart hunt with new query
    const q = query.toLowerCase().trim();
    const h = globalHunt.toLowerCase().trim();
    if (!q.includes(h) && !h.includes(q)) {
      // unrelated query — switch hunt target
      setGlobalHunt(q);
      if (aisRef.current) aisRef.current.setGlobalSearch(q);
    }
  }, [query, globalHunt, stopGlobalHunt]);

  // Auto-enable discover whenever fleet becomes empty/small while AIS connected
  useEffect(() => {
    if (!aisStatus.on) return;
    if (aisWl.resolved.length < 5 && !discoverMode) {
      setDiscoverMode(true);
      if (aisRef.current) aisRef.current.setDiscover(true);
      setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'DISCOVER auto-on (fleet empty)', k: 'o' }]);
    }
  }, [aisStatus.on, aisWl.resolved.length, discoverMode]);

  // Auto-connect AIS on mount if key is in localStorage
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (autoConnectedRef.current) return;
    if (!aisRef.current) return;
    const savedKey = window.STORE.load('vt7.aisKey', '');
    if (savedKey && aisWl.resolved.length >= 0) {
      autoConnectedRef.current = true;
      // Auto-enable discover if fleet small
      if (aisWl.resolved.length < 5) {
        setDiscoverMode(true);
        aisRef.current.setDiscover(true);
      }
      setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: 'Auto-connecting (saved key)' + (aisWl.resolved.length < 5?' + DISCOVER':''), k: 'g' }]);
      aisRef.current.connect(savedKey, aisWl.resolved);
    }
  }, [aisWl.resolved]);

  // Merge entity vessels with live AIS overlay
  // Merge entity vessels with live AIS overlay.
  // Position messages bring lat/lon/sog/cog/hdg/st/eta/dest.
  // Static messages bring name/imo/cs/flag/type/ceu.
  // Both kinds may arrive in any order; merge updates every observed field.
  const vessels = useMemo(() => ents.vessels.map(v => {
    const live = liveOverlay[v.mmsi];
    if (!live) return v;

    const merged = {
      ...v,
      // Kinematics (from position reports)
      lat:  typeof live.lat === 'number' ? live.lat  : v.lat,
      lon:  typeof live.lon === 'number' ? live.lon  : v.lon,
      sog:  typeof live.sog === 'number' ? live.sog  : v.sog,
      cog:  typeof live.cog === 'number' ? live.cog  : v.cog,
      hdg:  typeof live.hdg === 'number' ? live.hdg  : v.hdg,
      st:   typeof live.st  === 'number' ? live.st   : v.st,
      // Voyage (from position type 5)
      eta:  live.eta  || v.eta,
      dest: live.dest || v.dest,
      // Static identity (from ShipStaticData / type 5) — AIS always wins
      name: live.name || v.name,
      imo:  live.imo  || v.imo,
      cs:   live.cs   || v.cs,
      flag: live.flag || v.flag,
      type: live.type || v.type,
      ceu:  (typeof live.ceu === 'number' && live.ceu > 0) ? live.ceu : v.ceu,
      // Track when we last got any update
      lastSeen: live.ts || Date.now(),
    };
    return merged;
  }), [liveOverlay, ents.vessels]);

  // ----- LIVE PORT METRICS — derived from AIS observations ----------------
  // Tick every 15s OR whenever AIS msg count changes, recompute queue / berth
  // util / dwell / throughput / PCI from observed vessel positions+states.
  const [metricsTick, setMetricsTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMetricsTick(t => t+1), 15000);
    return () => clearInterval(id);
  }, []);

  const livePorts = useMemo(() => {
    if (!window.PortMetrics) return ents.ports;
    // Mutate in place (PortMetrics writes p.live, p.trend7d on each port)
    // Then return shallow clones so React sees changes.
    window.PortMetrics.update(vessels, discovered, ents.ports);
    if (window.VesselHistory) window.VesselHistory.update(vessels, discovered);
    return ents.ports.map(p => {
      const live = p.live;
      const trend7d = p.trend7d || [];
      return {
        ...p,
        // Override mockup fields with REAL when we have live data
        pci:     live && live.fresh ? live.pci : p.pci,
        queue:   live && live.fresh ? live.queue : p.queue,
        trend7d: trend7d.length >= 2 ? trend7d : null,
        live,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ents.ports, vessels, discovered, metricsTick, aisStatus.msgCount]);

  const aisStatusForUi = { ...aisStatus, tracking: aisWl.resolved.length };

  // ----- LIVE ALERTS — generated from real fleet AIS + port metrics ------
  // The engine evaluates rules every 30s using current vessels & livePorts.
  // Fired alerts persist for 24h and accumulate in alertLog.
  const [alertLog, setAlertLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vt7.alerts.log.v1')) || []; }
    catch (e) { return []; }
  });
  const homePort = (tweaks && tweaks.homePort) || 'ESBCN';
  useEffect(() => {
    if (!window.AlertsEngine) return;
    const tick = () => {
      const newAlerts = window.AlertsEngine.evaluate(vessels, livePorts, {
        homePort,
        etaShiftMin: tweaks.etaShiftMin,
        pciDelta2h: tweaks.pciDelta2h,
        queueDelta1h: tweaks.queueDelta1h,
        speedDropKn: tweaks.speedDropKn,
        dwellDays: tweaks.dwellDays,
      });
      if (newAlerts.length > 0) {
        setAlertLog(prev => {
          const cutoff = Date.now() - 24*3600*1000;
          const merged = [...newAlerts, ...prev]
            .filter(a => a.ts >= cutoff)
            .slice(0, 100);
          try { localStorage.setItem('vt7.alerts.log.v1', JSON.stringify(merged)); } catch (e) {}
          return merged;
        });
      } else {
        // Still prune old ones from log
        setAlertLog(prev => {
          const cutoff = Date.now() - 24*3600*1000;
          const filtered = prev.filter(a => a.ts >= cutoff);
          if (filtered.length !== prev.length) {
            try { localStorage.setItem('vt7.alerts.log.v1', JSON.stringify(filtered)); } catch (e) {}
            return filtered;
          }
          return prev;
        });
      }
    };
    tick(); // run once on mount/dep-change
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [vessels, livePorts, homePort]);

  const vessel = vessels.find(v => v.mmsi === selectedMmsi);
  const port = livePorts.find(p => p.code === selectedPort);

  const onSelectVessel = (mmsi) => {
    setSelectedMmsi(mmsi); setActiveTab('vessel');
    if (isMobile) { setSidebarOpen(false); setInspectorOpen(true); }
  };
  const onSelectPort = (code) => {
    setSelectedPort(code); setActiveTab('port');
    if (isMobile) setInspectorOpen(true);
  };

  const onAddVessel = () => setEditor({ kind:'vessel', initial:null });
  const onEditVessel = (v) => setEditor({ kind:'vessel', initial:v, isCustom: ents.isVesselCustom(v.mmsi) });
  const onDeleteVessel = (mmsi) => {
    ents.deleteVessel(mmsi);
    if (selectedMmsi === mmsi) setSelectedMmsi(ents.vessels.find(v=>v.mmsi!==mmsi)?.mmsi || '');
  };
  const onAddPort = () => setEditor({ kind:'port', initial:null });
  const onEditPort = (p) => setEditor({ kind:'port', initial:p, isCustom: ents.isPortCustom(p.code) });
  const onDeletePort = (code) => {
    ents.deletePort(code);
    if (selectedPort === code) setSelectedPort(null);
  };

  const tabs = [
    {k:'vessel',  l:'VESSEL'},
    {k:'pci',     l:'PCI'},
    {k:'port',    l:'PORT'},
    {k:'compare', l:'CMP'},
    {k:'alerts',  l:'ALERTS'},
  ];

  return (
    <div className="app" data-density={tweaks.density}>
      <Topbar
        vessels={vessels} ports={livePorts}
        alertCount={alertLog.length}
        ais={aisStatusForUi}
        isMobile={isMobile}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />
      <Sidebar
        vessels={vessels}
        selectedMmsi={selectedMmsi}
        onSelect={onSelectVessel}
        query={query} setQuery={setQuery}
        filter={filter} setFilter={setFilter}
        bookmarks={bookmarks}
        toggleBookmark={toggleBookmark}
        isMobile={isMobile}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        onAddVessel={onAddVessel}
        onEditVessel={onEditVessel}
        onDeleteVessel={onDeleteVessel}
        isVesselCustom={ents.isVesselCustom}
        discovered={discovered}
        aisOn={aisStatus.on}
        globalHunt={globalHunt}
        onGlobalHunt={onGlobalHunt}
        onStopGlobalHunt={stopGlobalHunt}
        onAddDiscovered={(v) => {
          ents.saveVessel({
            mmsi: String(v.mmsi), imo: v.imo ? String(v.imo) : '', name: v.name || ('MMSI '+v.mmsi),
            flag: v.flag || '', cs: v.cs || '', operator: v.operator || '',
            type: 'PCTC', ceu: v.ceu || 0, _discovered: true,
            lat: v.lat, lon: v.lon, sog: v.sog||0, cog: v.cog||0, hdg: v.hdg||v.cog||0,
            st: v.st||0, dest: v.dest||'', eta: v.eta||'',
            lastSeen: Date.now(), track: [[v.lat, v.lon]],
          });
          setSelectedMmsi(String(v.mmsi));
        }}
      />
      <MapView
        vessels={vessels} ports={livePorts}
        discovered={discovered}
        selectedMmsi={selectedMmsi}
        onSelectVessel={onSelectVessel}
        onSelectPort={onSelectPort}
        onAddDiscovered={(v) => {
          ents.saveVessel({
            mmsi: String(v.mmsi), imo: v.imo ? String(v.imo) : '', name: v.name || ('MMSI '+v.mmsi),
            flag: v.flag || '', cs: v.cs || '', operator: v.operator || '',
            type: 'PCTC', ceu: v.ceu || 0, _discovered: true,
            lat: v.lat, lon: v.lon, sog: v.sog||0, cog: v.cog||0, hdg: v.hdg||v.cog||0,
            st: v.st||0, dest: v.dest||'', eta: v.eta||'',
            lastSeen: Date.now(), track: [[v.lat, v.lon]],
          });
          setAisLog(prev => [...prev, { t: new Date().toLocaleTimeString('en-GB'), m: '+ FLEET: '+(v.name||v.mmsi), k: 'g' }]);
        }}
        onBoundsChange={onBoundsChange}
        discoverMode={discoverMode}
        onToggleDiscover={toggleDiscover}
        aisOn={aisStatus.on}
        mapStyle={effectiveMapStyle}
        density={tweaks.density}
        isMobile={isMobile}
        layers={{
          heatmap: tweaks.showHeatmap, tracks: tweaks.showTracks,
          ports: tweaks.showPorts, vessels: tweaks.showVessels,
        }}
      />

      {tweaks.showAisPanel && (
        <AisStatusPanel
          ais={aisStatusForUi}
          onConnect={onAisConnect}
          onDisconnect={onAisDisconnect}
          log={aisLog}
          isMobile={isMobile}
        />
      )}

      <div className={'inspector'+(isMobile && inspectorOpen?' open':'')}>
        <div className="insp-tabs" onClick={() => isMobile && setInspectorOpen(o => !o)}>
          {tabs.map(t => (
            <button key={t.k}
              className={'insp-tab'+(activeTab===t.k?' active':'')}
              onClick={(e) => { e.stopPropagation(); setActiveTab(t.k); if (isMobile) setInspectorOpen(true); }}
            >{t.l}</button>
          ))}
        </div>
        <div className="insp-body">
          {activeTab === 'vessel'  && <VesselDetail vessel={vessel} vessels={vessels} ports={livePorts} isBookmarked={vessel ? bookmarks.includes(vessel.mmsi) : false} onToggleBookmark={toggleBookmark} aisOn={aisStatus.on} liveOverlay={liveOverlay} />}
          {activeTab === 'pci'     && <PciDashboard ports={livePorts} selectedPortCode={selectedPort} onSelectPort={onSelectPort} onAddPort={onAddPort} onEditPort={onEditPort} onDeletePort={onDeletePort} isPortCustom={ents.isPortCustom} />}
          {activeTab === 'port'    && (port ? <PortDetail port={port} vessels={vessels} discovered={discovered} alerts={alertLog} onExpand={() => setPortFullscreen(port.code)} onSelectVessel={onSelectVessel} /> : <div style={{padding:'40px 20px',textAlign:'center',color:'var(--dim)',fontSize:11,letterSpacing:'0.1em'}}>SELECT A PORT</div>)}
          {activeTab === 'compare' && <CompareTab ports={livePorts} vessels={vessels} />}
          {activeTab === 'alerts'  && <AlertsTab alerts={alertLog} homePort={homePort} />}
        </div>
      </div>

      <Ticker ports={livePorts} vessels={vessels} />
      <TimeSlider visible={tweaks.showTimeSlider} />

      {isMobile && (
        <button className="fab inspector" onClick={() => setInspectorOpen(o => !o)}>
          {inspectorOpen ? '▾' : '▴'} {tabs.find(t=>t.k===activeTab).l}
        </button>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweaks.theme} onChange={v=>setTweak('theme', v)}
            options={[{value:'auto',label:'Auto'},{value:'dark',label:'Dark'},{value:'light',label:'Light'}]} />
          <div style={{fontSize:9,color:'var(--dim)',marginTop:-4,marginBottom:6,letterSpacing:'0.05em',textTransform:'uppercase'}}>
            {tweaks.theme === 'auto' ? `Auto · now ${effectiveTheme} (07–19 light · 19–07 dark)` : ''}
          </div>
          <TweakRadio label="Density" value={tweaks.density} onChange={v=>setTweak('density', v)}
            options={[{value:'standard',label:'Std'},{value:'dense',label:'Bloomberg'},{value:'cartographic',label:'Carto'}]} />
          <TweakSelect label="Accent" value={tweaks.accent} onChange={v=>setTweak('accent', v)}
            options={[{value:'cyan',label:'Cyan AIS'},{value:'amber',label:'Amber'},{value:'green',label:'Green CRT'},{value:'magenta',label:'Magenta'}]} />
        </TweakSection>
        <TweakSection title="Map">
          <TweakSelect label="Map Style" value={tweaks.mapStyle} onChange={v=>setTweak('mapStyle', v)}
            options={[
              {value:'auto',label:'Auto (follows theme)'},
              {value:'dark',label:'Dark Nautical'},
              {value:'darkLab',label:'Dark + Labels'},
              {value:'light',label:'Light'},
              {value:'sat',label:'Satellite'},
            ]} />
          <TweakToggle label="Vessels" value={tweaks.showVessels} onChange={v=>setTweak('showVessels', v)} />
          <TweakToggle label="Track histories" value={tweaks.showTracks} onChange={v=>setTweak('showTracks', v)} />
          <TweakToggle label="Ports" value={tweaks.showPorts} onChange={v=>setTweak('showPorts', v)} />
          <TweakToggle label="PCI heatmap" value={tweaks.showHeatmap} onChange={v=>setTweak('showHeatmap', v)} />
        </TweakSection>
        <TweakSection title="Tools">
          <TweakToggle label="AIS panel" value={tweaks.showAisPanel} onChange={v=>setTweak('showAisPanel', v)} />
          <TweakToggle label="AIS replay slider" value={tweaks.showTimeSlider} onChange={v=>setTweak('showTimeSlider', v)} />
          <div style={{padding:'8px 0', borderTop:'1px solid var(--border)', marginTop:6}}>
            <button className="btn btn-ghost" style={{width:'100%', fontSize:10}} onClick={()=>setAisEditorOpen(true)}>
              ⚙ AIS WATCHLIST ({aisWl.watchlist.extra.length} extra)
            </button>
            <div style={{fontSize:9, color:'var(--dim)', marginTop:6, lineHeight:1.5, letterSpacing:'0.02em'}}>
              Subscribing: {aisWl.resolved.length} MMSIs ({vessels.length} fleet + {aisWl.watchlist.extra.length} extra)
            </div>
          </div>
          <div style={{padding:'8px 0', borderTop:'1px solid var(--border)', marginTop:6, display:'flex', gap:6}}>
            <button className="btn btn-ghost" style={{flex:1, fontSize:9}} onClick={()=>{
              if (confirm('Reset all custom vessels and revert deletions?')) { VesselCRUD.reset(); window.location.reload(); }
            }}>RESET FLEET</button>
            <button className="btn btn-ghost" style={{flex:1, fontSize:9}} onClick={()=>{
              if (confirm('Reset all custom ports and revert deletions?')) { PortCRUD.reset(); window.location.reload(); }
            }}>RESET PORTS</button>
          </div>
        </TweakSection>
        <TweakSection label="Alerts engine">
          <TweakSelect label="Home port" value={tweaks.homePort||'ESBCN'} onChange={v=>setTweak('homePort', v)}
            options={livePorts.map(p => ({value: p.locode, label: p.locode + ' · ' + p.name}))} />
          <TweakNumber label="ETA shift threshold" value={tweaks.etaShiftMin} unit="min" min={5} max={240} step={5} onChange={v=>setTweak('etaShiftMin', v)} />
          <TweakNumber label="PCI rise (2h)" value={tweaks.pciDelta2h} unit="pts" min={1} max={30} step={1} onChange={v=>setTweak('pciDelta2h', v)} />
          <TweakNumber label="Queue grow (1h)" value={tweaks.queueDelta1h} unit="vsl" min={1} max={10} step={1} onChange={v=>setTweak('queueDelta1h', v)} />
          <TweakNumber label="Speed drop" value={tweaks.speedDropKn} unit="kn" min={1} max={15} step={1} onChange={v=>setTweak('speedDropKn', v)} />
          <TweakNumber label="Dwell threshold" value={tweaks.dwellDays} unit="d" min={1} max={10} step={0.5} onChange={v=>setTweak('dwellDays', v)} />
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <button className="btn btn-ghost" style={{flex:1, fontSize:9}} onClick={()=>{
              if (window.AlertsEngine) window.AlertsEngine.reset();
              localStorage.removeItem('vt7.alerts.log.v1');
              window.location.reload();
            }}>CLEAR ALERTS</button>
          </div>
        </TweakSection>
      </TweaksPanel>

      {editor && (
        <EntityEditor
          kind={editor.kind}
          initial={editor.initial}
          isCustom={editor.isCustom}
          onSave={(e) => {
            if (editor.kind === 'vessel') ents.saveVessel(e); else ents.savePort(e);
            setEditor(null);
          }}
          onDelete={editor.initial ? () => {
            if (editor.kind === 'vessel') onDeleteVessel(editor.initial.mmsi);
            else onDeletePort(editor.initial.code);
            setEditor(null);
          } : null}
          onClose={() => setEditor(null)}
        />
      )}

      {aisEditorOpen && (
        <AisWatchlistEditor
          watchlist={aisWl.watchlist}
          onChange={aisWl.update}
          onClose={() => setAisEditorOpen(false)}
        />
      )}

      {portFullscreen && (
        <PortFullscreen
          port={livePorts.find(p => p.code === portFullscreen)}
          vessels={vessels}
          discovered={discovered}
          alerts={alertLog}
          onClose={() => setPortFullscreen(null)}
          onSelectVessel={(mmsi) => {
            setPortFullscreen(null);
            onSelectVessel(mmsi);
          }}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

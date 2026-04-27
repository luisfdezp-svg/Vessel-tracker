/* global L */
// ============================================================
// AIS STREAM SERVICE — wraps wss://stream.aisstream.io/v0/stream
//
// Two complementary modes (can be combined):
//   • Fleet mode  — subscribe by MMSI list (your tracked vessels)
//   • Discover    — subscribe by map bounding box, filter ShipType
//                   to PCC/PCTC/RoRo (70, 71, 72, 77) in-message
//
// Reconnects on close. Re-subscribes on bbox/mmsi change.
// ============================================================

// MID (Maritime Identification Digit) → ISO flag code.
// First 3 digits of MMSI = country of registration. Partial table —
// covers all major flags-of-convenience and PCC-fleet operators.
const MID_TO_FLAG = {
  201:'AL',202:'AD',203:'AT',204:'PT',205:'BE',206:'BY',207:'BG',208:'VA',209:'CY',210:'CY',
  211:'DE',212:'CY',213:'GE',214:'MD',215:'MT',216:'AM',218:'DE',219:'DK',220:'DK',224:'ES',
  225:'ES',226:'FR',227:'FR',228:'FR',229:'MT',230:'FI',231:'FO',232:'GB',233:'GB',234:'GB',
  235:'GB',236:'GI',237:'GR',238:'HR',239:'GR',240:'GR',241:'GR',242:'MA',243:'HU',244:'NL',
  245:'NL',246:'NL',247:'IT',248:'MT',249:'MT',250:'IE',251:'IS',252:'LI',253:'LU',254:'MC',
  255:'PT',256:'MT',257:'NO',258:'NO',259:'NO',261:'PL',262:'ME',263:'PT',264:'RO',265:'SE',
  266:'SE',267:'SK',268:'SM',269:'CH',270:'CZ',271:'TR',272:'UA',273:'RU',274:'MK',275:'LV',
  276:'EE',277:'LT',278:'SI',279:'RS',301:'AI',303:'US',304:'AG',305:'AG',306:'CW',307:'AW',
  308:'BS',309:'BS',310:'BM',311:'BS',312:'BZ',314:'BB',316:'CA',319:'KY',321:'CR',323:'CU',
  325:'DM',327:'DO',329:'GP',330:'GD',331:'GL',332:'GT',334:'HN',336:'HT',338:'US',339:'JM',
  341:'KN',343:'LC',345:'MX',347:'MQ',348:'MS',350:'NI',351:'PA',352:'PA',353:'PA',354:'PA',
  355:'PA',356:'PA',357:'PA',358:'PR',359:'SV',361:'PM',362:'TT',364:'TC',366:'US',367:'US',
  368:'US',369:'US',370:'PA',371:'PA',372:'PA',373:'PA',374:'PA',375:'VC',376:'VC',377:'VC',
  378:'VG',379:'VI',401:'AF',403:'SA',405:'BD',408:'BH',410:'BT',412:'CN',413:'CN',414:'CN',
  416:'TW',417:'LK',419:'IN',422:'IR',423:'AZ',425:'IQ',428:'IL',431:'JP',432:'JP',434:'TM',
  436:'KZ',437:'UZ',438:'JO',440:'KR',441:'KR',443:'PS',445:'KP',447:'KW',450:'LB',451:'KG',
  453:'MO',455:'MV',457:'MN',459:'NP',461:'OM',463:'PK',466:'QA',468:'SY',470:'AE',471:'AE',
  472:'TJ',473:'YE',475:'YE',477:'HK',478:'BA',501:'AQ',503:'AU',506:'MM',508:'BN',510:'FM',
  511:'PW',512:'NZ',514:'KH',515:'KH',516:'CX',518:'CK',520:'FJ',523:'CC',525:'ID',529:'KI',
  531:'LA',533:'MY',536:'MP',538:'MH',540:'NC',542:'NU',544:'NR',546:'PF',548:'PH',553:'PG',
  555:'PN',557:'SB',559:'AS',561:'WS',563:'SG',564:'SG',565:'SG',566:'SG',567:'TH',570:'TO',
  572:'TV',574:'VN',576:'VU',577:'VU',578:'WF',601:'ZA',603:'AO',605:'DZ',607:'KE',608:'IO',
  609:'BI',610:'BJ',611:'BW',612:'CF',613:'CM',615:'CG',616:'KM',617:'CV',618:'AQ',619:'CI',
  620:'KM',621:'DJ',622:'EG',624:'ET',625:'ER',626:'GA',627:'GH',629:'GM',630:'GW',631:'GQ',
  632:'GN',633:'BF',634:'KE',635:'AQ',636:'LR',637:'LR',638:'SS',642:'LY',644:'LS',645:'MU',
  647:'MG',649:'ML',650:'MZ',654:'MR',655:'MW',656:'NE',657:'NG',659:'NA',660:'RE',661:'RW',
  662:'SD',663:'SN',664:'SC',665:'SH',666:'SO',667:'SL',668:'ST',669:'SZ',670:'TD',671:'TG',
  672:'TN',674:'TZ',675:'UG',676:'CD',677:'TZ',678:'ZM',679:'ZW',701:'AR',710:'BR',720:'BO',
  725:'CL',730:'CO',735:'EC',740:'FK',745:'GF',750:'GY',755:'PY',760:'PE',765:'SR',770:'UY',
  775:'VE'
};
function midToFlag(mmsi) {
  const m = String(mmsi||'').replace(/\D/g,'');
  if (m.length < 3) return null;
  return MID_TO_FLAG[parseInt(m.slice(0,3),10)] || null;
}

window.createAisService = function createAisService({
  onPosition, onStatic, onStatus, onError, onLog, onDiscover
}) {
  let ws = null, on = false, msgCount = 0, key = '';
  let mmsis = [];
  let bbox = null;            // [[swLat, swLon],[neLat, neLon]] or null
  let discoverEnabled = false;
  let globalSearch = null;    // string query (lowercase name/mmsi/imo) or null
  let reconnectTimer = null, autoReconnect = true;
  let resubTimer = null;

  // Vehicles Carrier / RoRo ShipTypes per ITU-R M.1371
  // 70 Cargo (parent), 71 Cargo Hazardous A, 72 B (rare for PCTC); we focus 77 = vehicles carrier (some feeds)
  // PCC/PCTC detection. Two paths:
  //  1. STRICT type=77 (Vehicles Carrier per ITU-R M.1371-5) — definitive.
  //  2. type=70 or 79 (generic cargo) + name matches known PCC/PCTC operator pattern —
  //     because many car carriers still report Type 70 with operator-coded subcategory.
  // Plain Type 70 alone is too noisy (includes tankers, container ships, dry bulk).
  const PCTC_TYPES = new Set([77]);
  const PCTC_AMBIGUOUS_TYPES = new Set([70, 79]);
  const PCTC_NAME_RX = /\b(HOEGH|EUROCARGO|GRANDE|GLOVIS|MORNING|AURORA|HORIZON|TARGET|TRACER|TRANSPORTER|OSAKA|VIKING|SIRIUS|PROSPER|DELIVER|EXPLORER|TRIUMPH|TONSBERG|DON QUIJOTE|DON CARLOS|CARMEN|TRAVIATA|LOHENGRIN|MIGNON|TURANDOT|MANON|FAUST|FIDELIO|OBERON|OTELLO|FREEDOM|UECC|AUTO|LAKE|TARAGO|TIRRANNA|TITUS|ENERGY|EMERALD|ECO|GREEN|LAZULITE|ACE|LEADER|VICTORY|HIGHWAY|GENESIS|SAPPHIRE|TURQUOISE|JADE|CRYSTAL|BRILLIANT|DIAMOND|RUBY|TOPAZ|OPAL|PRECIOUS|PHOENIX|VENUS|ARIES|TAURUS|GEMINI|CETUS|ORION|PEGASUS|HERCULES|LIBRA|VIRGO|SAGITTARIUS|CAPRICORN|ATLAS|TITAN|CIPRESSO|LIGNANO|UCO\s)\b/i;
  const isPctcLike = (type, name) => {
    if (PCTC_TYPES.has(type)) return true;
    if (PCTC_AMBIGUOUS_TYPES.has(type) && name && PCTC_NAME_RX.test(name)) return true;
    return false;
  };
  const discovered = new Map(); // mmsi -> last static (so we know type before showing)

  const log = (m, k='g') => onLog && onLog(m, k);

  function buildSub() {
    // BoundingBoxes is required by AIS Stream. If user provided bbox, use it; else default broad EU+Med.
    const boxes = [];
    if (globalSearch) {
      // Global hunt: subscribe to the whole world to catch the named vessel anywhere
      boxes.push([[-90, -180], [90, 180]]);
    } else if (bbox) {
      boxes.push([[bbox[0][0], bbox[0][1]], [bbox[1][0], bbox[1][1]]]);
    } else {
      boxes.push([[25, -15], [65, 45]]);
    }
    const sub = {
      Apikey: key,
      BoundingBoxes: boxes,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    };
    // Only restrict by MMSI if we are NOT in discover/global mode AND we have a fleet list
    if (!discoverEnabled && !globalSearch && mmsis.length) sub.FiltersShipMMSI = mmsis;
    return sub;
  }

  function connect(apiKey, vesselMmsis) {
    if (apiKey) key = apiKey;
    if (vesselMmsis) mmsis = vesselMmsis.slice();
    if (!key) { onError && onError('Missing AISstream API key'); return; }
    disconnect();

    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch(e) {
      onError && onError('WebSocket failed: '+e.message);
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify(buildSub()));
      on = true; onStatus && onStatus({ on, msgCount });
      const mode = discoverEnabled ? 'discover bbox' : ('fleet '+mmsis.length+' MMSI');
      log('AIS connected · '+mode,'o');
    };

    ws.onmessage = (ev) => {
      msgCount++;
      const handle = (raw) => {
        try {
          const d = JSON.parse(raw);
          if (d.error || d.ERROR) { onError && onError(JSON.stringify(d)); return; }
          const tp = d.MessageType, mt = d.MetaData || {};
          const mmsi = String(mt.MMSI || '');
          if (!mmsi) return;

          const isFleet = mmsis.indexOf(mmsi) !== -1;

          // Derive flag from MMSI MID (first 3 digits → country code).
          // E.g. 636 = LR (Liberia), 538 = MH (Marshall Islands).
          const flag = midToFlag(mmsi);

          if (tp === 'PositionReport') {
            const p = d.Message && d.Message.PositionReport; if (!p) return;
            const pos = {
              mmsi,
              name: (mt.ShipName||'').trim() || null,
              flag,
              lat: p.Latitude, lon: p.Longitude,
              sog: p.Sog, cog: p.Cog,
              hdg: p.TrueHeading === 511 ? null : p.TrueHeading,
              st: p.NavigationalStatus,
              ts: Date.now(),
            };
            if (isFleet) {
              onPosition && onPosition(pos);
            } else if (globalSearch) {
              // Global hunt: emit anything whose name/mmsi matches (no type filter)
              const known = discovered.get(mmsi) || {};
              const merged = { ...known, ...pos };
              discovered.set(mmsi, merged);
              const nm = String(merged.name||'').toLowerCase();
              const im = String(merged.imo||'');
              if (nm.includes(globalSearch) || mmsi.includes(globalSearch) || im.includes(globalSearch)) {
                onDiscover && onDiscover(merged);
              }
            } else if (discoverEnabled) {
              // Only emit discover if we know it's a PCTC/RoRo
              const known = discovered.get(mmsi);
              if (known && isPctcLike(known.type, known.name)) {
                onDiscover && onDiscover({ ...pos, type: known.type, imo: known.imo, dest: known.dest, eta: known.eta });
              } else {
                // Stash position; once static arrives and confirms type, we'll emit
                discovered.set(mmsi, { ...(known||{}), pendingPos: pos });
              }
            }
          } else if (tp === 'ShipStaticData') {
            const sd = d.Message && d.Message.ShipStaticData; if (!sd) return;
            let eta = null;
            if (sd.Eta && (sd.Eta.Month || sd.Eta.Day)) {
              const now = new Date();
              let y = now.getFullYear();
              const mo = sd.Eta.Month||1, da = sd.Eta.Day||1, hr = sd.Eta.Hour||0, mi = sd.Eta.Minute||0;
              if (mo < now.getMonth()+1) y++;
              eta = String(da).padStart(2,'0')+'/'+String(mo).padStart(2,'0')+'/'+y+' '+String(hr).padStart(2,'0')+':'+String(mi).padStart(2,'0');
            }
            const stat = {
              mmsi,
              name: (mt.ShipName||'').trim() || (sd.Name||'').trim() || null,
              flag,
              imo: sd.ImoNumber, cs: sd.CallSign,
              dest: sd.Destination ? sd.Destination.trim() : null,
              eta, type: sd.Type,
              ts: Date.now(),
            };
            if (isFleet) {
              onStatic && onStatic(stat);
            } else if (globalSearch) {
              const prev = discovered.get(mmsi) || {};
              const merged = { ...prev, ...stat };
              discovered.set(mmsi, merged);
              const nm = String(merged.name||'').toLowerCase();
              const im = String(merged.imo||'');
              if (nm.includes(globalSearch) || mmsi.includes(globalSearch) || im.includes(globalSearch)) {
                onDiscover && onDiscover({
                  ...(merged.pendingPos || {}),
                  ...merged,
                });
              }
            } else if (discoverEnabled) {
              const prev = discovered.get(mmsi) || {};
              const merged = { ...prev, ...stat };
              discovered.set(mmsi, merged);
              if (isPctcLike(stat.type, stat.name)) {
                // Emit discovery (with cached pos if any)
                onDiscover && onDiscover({
                  ...(merged.pendingPos || {}),
                  ...stat,
                  // ensure mmsi/name fields prefer static
                  mmsi, name: stat.name,
                });
              }
            }
          }
          if (msgCount % 50 === 0) onStatus && onStatus({ on, msgCount });
        } catch(e) {/*swallow*/}
      };
      if (ev.data instanceof Blob) {
        const r = new FileReader();
        r.onload = () => handle(r.result);
        r.readAsText(ev.data);
      } else handle(ev.data);
    };

    ws.onerror = () => { onError && onError('WebSocket error'); };
    ws.onclose = (ev) => {
      const was = on; on = false;
      onStatus && onStatus({ on, msgCount });
      log('AIS closed (code '+ev.code+')','e');
      if (autoReconnect && was) {
        reconnectTimer = setTimeout(() => connect(), 5000);
      }
    };
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (resubTimer) { clearTimeout(resubTimer); resubTimer = null; }
    if (ws) { try { ws.close(); } catch(e){} ws = null; }
    on = false;
  }

  function resubscribe() {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(buildSub())); } catch(e) {}
  }

  function setVessels(list) {
    mmsis = list.slice();
    if (on) {
      // Debounced resub
      if (resubTimer) clearTimeout(resubTimer);
      resubTimer = setTimeout(resubscribe, 300);
    }
  }

  function setBBox(box) {
    // box: [[swLat,swLon],[neLat,neLon]] or null
    bbox = box;
    if (on && discoverEnabled) {
      if (resubTimer) clearTimeout(resubTimer);
      resubTimer = setTimeout(resubscribe, 800);
    }
  }

  function setDiscover(enabled) {
    discoverEnabled = !!enabled;
    if (!enabled) discovered.clear();
    if (on) {
      if (resubTimer) clearTimeout(resubTimer);
      resubTimer = setTimeout(resubscribe, 200);
    }
  }

  function setGlobalSearch(query) {
    const next = query ? String(query).toLowerCase().trim() : null;
    if (next === globalSearch) return;
    globalSearch = next || null;
    if (!globalSearch) {
      // Clear any non-fleet matches accumulated under global hunt
      // (keep nothing — caller resets discovered map separately if needed)
    }
    if (on) {
      if (resubTimer) clearTimeout(resubTimer);
      resubTimer = setTimeout(resubscribe, 200);
    }
    log(globalSearch ? ('Global hunt: "'+globalSearch+'"') : 'Global hunt: off', globalSearch?'o':'g');
  }

  function setAutoReconnect(v) { autoReconnect = v; }
  function status() { return { on, msgCount, discoverEnabled, globalSearch }; }

  return {
    connect, disconnect,
    setVessels, setBBox, setDiscover, setGlobalSearch,
    setAutoReconnect, status,
  };
};

// STORE is defined in data.js — do not redefine here.

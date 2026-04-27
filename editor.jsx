/* global React */
/* Editor modal for vessels and ports — used by app.jsx */

const EDITOR_E = React.createElement;

// ============================================================
// SHARED FORM PRIMITIVES
// ============================================================
function Field({ label, hint, children, span }) {
  return (
    <div style={{gridColumn: span === 2 ? '1 / -1' : 'auto'}}>
      <div style={{fontSize:8, letterSpacing:'0.18em', textTransform:'uppercase', color:'var(--dim)', fontWeight:600, marginBottom:4}}>
        {label}{hint && <span style={{color:'var(--muted)', marginLeft:6, letterSpacing:'0.05em', textTransform:'none', fontWeight:400}}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)',
  color:'var(--text)', fontFamily:'var(--mono)', fontSize:12,
  padding:'7px 9px', letterSpacing:'0.02em', outline:'none',
};

function TextInput({ value, onChange, placeholder, mono=true, type='text' }) {
  return <input type={type} style={{...inputStyle, fontFamily: mono?'var(--mono)':'var(--sans)'}}
    value={value ?? ''} onChange={e=>onChange(e.target.value)}
    placeholder={placeholder} spellCheck={false} autoComplete="off" />;
}

function NumInput({ value, onChange, step='any', min, max }) {
  return <input type="number" style={inputStyle} value={value ?? ''} step={step} min={min} max={max}
    onChange={e=>onChange(e.target.value === '' ? null : parseFloat(e.target.value))} />;
}

function SelectInput({ value, onChange, options }) {
  return (
    <select style={{...inputStyle, cursor:'pointer'}} value={value ?? ''} onChange={e=>onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ============================================================
// VESSEL EDITOR — minimalist. AIS feed fills the rest.
// ============================================================
function VesselForm({ initial, onChange, isEdit }) {
  const v = initial;
  const set = (k, val) => onChange({ ...v, [k]: val });
  return (
    <div>
      <div style={{
        padding:'10px 12px',
        background:'rgba(95,208,232,0.06)',
        border:'1px solid rgba(95,208,232,0.20)',
        fontSize:10,
        lineHeight:1.6,
        letterSpacing:'0.02em',
        color:'var(--text-2)',
        marginBottom:14,
      }}>
        <b style={{color:'#5fd0e8',letterSpacing:'0.1em'}}>QUICK ADD</b> — only <b>MMSI</b> is required.
        Name is optional (auto-filled from AIS once observed).
        Flag, type, position, speed, course and destination all populate from AIS.
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <Field label="MMSI" hint="9 digits, required">
          <TextInput
            value={v.mmsi}
            onChange={x=>set('mmsi',x.replace(/\D/g,'').slice(0,9))}
            placeholder="636017823"
          />
        </Field>
        <Field label="Name" hint="optional">
          <TextInput
            value={v.name}
            onChange={x=>set('name',x.toUpperCase())}
            placeholder="(auto from AIS)"
          />
        </Field>
      </div>

      <details style={{marginTop:14, fontSize:10, letterSpacing:'0.05em'}}>
        <summary style={{
          cursor:'pointer', color:'var(--dim)', padding:'6px 0',
          letterSpacing:'0.18em', textTransform:'uppercase', fontWeight:600,
        }}>
          ▸ Advanced (optional metadata)
        </summary>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)'}}>
          <Field label="IMO" hint="7 digits"><TextInput value={v.imo} onChange={x=>set('imo',x.replace(/\D/g,'').slice(0,7))} placeholder="9784521" /></Field>
          <Field label="Callsign"><TextInput value={v.cs} onChange={x=>set('cs',x.toUpperCase())} placeholder="D5KR2" /></Field>
          <Field label="Flag" hint="ISO2"><TextInput value={v.flag} onChange={x=>set('flag',x.toUpperCase().slice(0,3))} placeholder="LR" /></Field>
          <Field label="Type">
            <SelectInput value={v.type} onChange={x=>set('type',x)} options={[
              {value:'PCTC',label:'PCTC'},{value:'ConRo',label:'ConRo'},{value:'RoRo',label:'RoRo'},
              {value:'PCC',label:'PCC'},{value:'Cargo',label:'Cargo'},{value:'Tanker',label:'Tanker'},
            ]} />
          </Field>
          <Field label="Operator" span={2}><TextInput mono={false} value={v.operator} onChange={x=>set('operator',x)} placeholder="EUKOR Car Carriers" /></Field>
          <Field label="Capacity (CEU)" span={2}><NumInput value={v.ceu} onChange={x=>set('ceu',x)} step="100" min="0" /></Field>
        </div>
      </details>
    </div>
  );
}

// ============================================================
// PORT EDITOR
// ============================================================
function PortForm({ initial, onChange }) {
  const p = initial;
  const set = (k, val) => onChange({ ...p, [k]: val });
  const setTrend = (i, val) => {
    const t = (p.trend || [50,50,50,50,50,50,50]).slice();
    t[i] = parseInt(val) || 0;
    set('trend', t);
  };
  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
      <Field label="Code" hint="UN/LOCODE"><TextInput value={p.code} onChange={x=>set('code',x.toUpperCase().slice(0,5))} placeholder="ESBCN" /></Field>
      <Field label="Country" hint="ISO2"><TextInput value={p.country} onChange={x=>set('country',x.toUpperCase().slice(0,2))} placeholder="ES" /></Field>
      <Field label="Name" span={2}><TextInput mono={false} value={p.name} onChange={x=>set('name',x)} placeholder="Barcelona" /></Field>
      <Field label="Region">
        <SelectInput value={p.region} onChange={x=>set('region',x)} options={[
          {value:'W-MED',label:'W-MED — Western Med'},
          {value:'E-MED',label:'E-MED — Eastern Med'},
          {value:'ADR',label:'ADR — Adriatic'},
          {value:'STR',label:'STR — Gibraltar Str'},
          {value:'ATL',label:'ATL — Atlantic IB'},
          {value:'NSEA',label:'NSEA — North Sea / Channel'},
        ]} />
      </Field>
      <Field label="Latitude"><NumInput value={p.lat} onChange={x=>set('lat',x)} step="0.001" min="-90" max="90" /></Field>
      <Field label="Longitude"><NumInput value={p.lon} onChange={x=>set('lon',x)} step="0.001" min="-180" max="180" /></Field>
      <Field label="Berths"><NumInput value={p.berths} onChange={x=>set('berths',x)} step="1" min="0" max="20" /></Field>
      <Field label="PCI" hint="0–100"><NumInput value={p.pci} onChange={x=>set('pci',x)} step="1" min="0" max="100" /></Field>
      <Field label="Queue (vessels)"><NumInput value={p.queue} onChange={x=>set('queue',x)} step="1" min="0" /></Field>
      <Field label="Capacity (CEU/wk)" span={2}><NumInput value={p.ceu} onChange={x=>set('ceu',x)} step="100" min="0" /></Field>
      <Field label="PCI 7-Day Trend" hint="oldest → newest" span={2}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:4}}>
          {(p.trend || [50,50,50,50,50,50,50]).map((t, i) => (
            <input key={i} type="number" style={{...inputStyle, padding:'5px 4px', textAlign:'center', fontSize:11}}
              value={t} min="0" max="100" onChange={e=>setTrend(i, e.target.value)} />
          ))}
        </div>
      </Field>
    </div>
  );
}

// ============================================================
// EDITOR MODAL
// ============================================================
window.EntityEditor = function EntityEditor({ kind, initial, isCustom, onSave, onDelete, onClose }) {
  const empty = kind === 'vessel'
    ? { mmsi:'', imo:'', name:'', flag:'', cs:'', operator:'', type:'PCTC', ceu:0,
        lat:null, lon:null, sog:null, cog:null, hdg:null, st:null, dest:'', eta:'',
        track:[] }
    : { name:'', code:'', country:'ES', region:'W-MED', lat:41.0, lon:2.0,
        pci:50, trend:[50,50,50,50,50,50,50], queue:0, berths:2, ceu:5000 };

  const [draft, setDraft] = React.useState(initial ? { ...empty, ...initial } : empty);
  const [error, setError] = React.useState('');
  const isEdit = !!initial;

  const handleSave = () => {
    if (kind === 'vessel') {
      if (!draft.mmsi || draft.mmsi.length !== 9) { setError('MMSI must be 9 digits'); return; }
      if (!draft.name) draft.name = 'MMSI ' + draft.mmsi;
      if (!draft.track || !draft.track.length) draft.track = [[draft.lat, draft.lon]];
      // Mark as AIS-only on first creation (no commercial data attached).
      // Don't override if user is editing an existing vessel that already has metadata.
      if (!isEdit) draft._discovered = true;
    } else {
      if (!draft.code || draft.code.length < 3) { setError('Port code is required (3-5 chars)'); return; }
      if (!draft.name) { setError('Port name is required'); return; }
    }
    onSave(draft);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{isEdit?'EDIT':'NEW'} {kind === 'vessel' ? 'VESSEL' : 'PORT'}</div>
            <div className="modal-sub">
              {isEdit
                ? (isCustom ? 'Custom record · stored locally' : 'Override base record · reset to revert')
                : 'New custom record · saved to localStorage'}
            </div>
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {kind === 'vessel'
            ? <VesselForm initial={draft} onChange={setDraft} />
            : <PortForm   initial={draft} onChange={setDraft} />}
          {error && <div style={{marginTop:12, padding:8, border:'1px solid var(--red)',
            color:'var(--red)', fontSize:11, letterSpacing:'0.05em'}}>⚠ {error}</div>}
        </div>
        <div className="modal-foot">
          <div>
            {isEdit && onDelete && (
              <button className="btn btn-danger" onClick={() => {
                if (confirm(`Delete this ${kind}? ${isCustom?'Cannot be undone.':'Base record will be hidden until reset.'}`)) onDelete();
              }}>{isCustom ? '✕ Delete' : '✕ Hide base'}</button>
            )}
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>{isEdit?'Save':'Create'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// AIS WATCHLIST EDITOR (extra MMSIs panel)
// ============================================================
window.AisWatchlistEditor = function AisWatchlistEditor({ watchlist, onChange, onClose }) {
  const [extra, setExtra] = React.useState(watchlist.extra.join('\n'));
  const handleSave = () => {
    const list = extra.split(/[\s,;]+/).map(s=>s.trim()).filter(s=>/^\d{7,9}$/.test(s));
    onChange({ ...watchlist, extra: [...new Set(list)] });
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
        <div className="modal-head">
          <div>
            <div className="modal-title">AIS WATCHLIST</div>
            <div className="modal-sub">Extra MMSIs to subscribe (independent of fleet display)</div>
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <Field label="Extra MMSIs" hint="one per line — newline, comma, or space separated">
            <textarea
              style={{...inputStyle, minHeight:140, resize:'vertical', lineHeight:1.5}}
              value={extra} onChange={e=>setExtra(e.target.value)} spellCheck={false}
              placeholder="538008712&#10;636017823&#10;355998001"
            />
          </Field>
          <div style={{marginTop:10, fontSize:10, color:'var(--dim)', lineHeight:1.6, letterSpacing:'0.02em'}}>
            These MMSIs receive AIS updates but won't appear in your fleet list unless you also add them as vessels.
            Useful for monitoring competitor ships, charters, or one-off tracking without cluttering the fleet view.
          </div>
        </div>
        <div className="modal-foot">
          <div></div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

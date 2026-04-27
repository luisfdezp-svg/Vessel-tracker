# Vessel Tracker

Real-time AIS vessel & Mediterranean port-congestion monitoring console.

Tracks RoRo / car-carrier traffic via the [aisstream.io](https://aisstream.io) WebSocket feed, scores port congestion (PCI), manages a fleet, computes ETAs, and emits operational alerts (ETA windows, anchor drift, speed drops, congestion spikes, queue growth, dwell-time anomalies).

## Quick start

1. Open the deployed URL on any device (desktop, tablet, iPhone — Safari, Chrome, Firefox all work).
2. Get a **free API key** from [aisstream.io](https://aisstream.io) (signup → dashboard → copy key).
3. Click the **Tweaks** toggle in the toolbar → AIS connection → paste your key → **Connect**.
4. Wait 10–30s for the first AIS messages to arrive.

The key is stored in your browser's `localStorage` and never leaves your device. Each user needs their own key (free tier is per-user).

## Add to iPhone home screen

Safari → Share → **Add to Home Screen**. Launches in standalone mode (no browser chrome), looks and behaves like a native app.

## Operational features

- **Live AIS tracking** with auto-reconnect, fleet whitelist + bbox discovery modes
- **Port Congestion Index (PCI)** — composite metric of queue, dwell, berth saturation
- **Fleet manager** — track owned/chartered vessels by MMSI, persistent vessel-history (track, port-calls, dwell stats)
- **Alerts engine** — 6 rule types: ETA windows (96/48/24/12/6h), ETA shifts, anchor drift, speed drops, congestion spikes, queue growth, dwell anomalies
- **Port detail fullscreen** — KPIs, mini-map, queue/berths/inbound/alerts tabs per port
- **Mobile-aware** — bottom nav, swipeable sheets, touch-friendly controls

## Data sources

- **AIS positions, MMSI registry, course/speed/heading** → live from aisstream.io
- **Port metadata** (locations, berth counts, CEU capacity) → static dataset bundled in `data.js`
- **Port metrics** (PCI, dwell, queue) → derived in real-time from AIS proximity to port polygons

No backend required. Pure static site — index.html + .jsx + .js modules served as-is, transpiled in-browser by Babel standalone.

## Tech stack

- React 18.3 (UMD) + Babel standalone (in-browser JSX)
- Leaflet 1.9 for maps
- aisstream.io WebSocket feed
- LocalStorage persistence (no server-side state)

## File map

```
index.html              — entry; loads all scripts
app.jsx                 — main React app (~2300 LOC)
ais-service.js          — WebSocket client for aisstream.io
alerts-engine.js        — rule evaluator
port-metrics.js         — PCI calculation
vessel-history.js       — per-vessel persistent history
data.js                 — static port + vessel reference data
editor.jsx              — vessel/port editor modals
tweaks-panel.jsx        — settings panel component
```

## License

Private project. Not for redistribution.

# Vessel-tracker

Repositorio con dos apps web:
- **Vessel Tracker Pro** (`/vessel-tracker.html`) — seguimiento AIS/manual de buques.
- **Groupage Optimizer** (`/Groupage Optimizer.html`) — optimización de carga con exportaciones.

## Arquitectura
- Frontend estático (HTML/CSS/JS).
- Service Worker compartido: `/sw.js`.
- Android wrapper WebView en `/android-app`.

## Estructura relevante
- `/assets/css` y `/assets/js`: código extraído de los HTML principales.
- `/android-app`: proyecto Gradle para APK.
- `/docs/release-regression-checklist.md`: checklist mínima previa a release.
- `/scripts/smoke_checks.py`: smoke checks automáticos de repositorio.

## Build y release Android
1. El workflow `.github/workflows/android.yml` compila `:app:assembleRelease`.
2. Se usa **Gradle Wrapper** (`android-app/gradlew`).
3. `versionCode` y `versionName` se inyectan por variables de entorno CI.

## Política de secretos
No se versionan keystores ni credenciales.

Secrets obligatorios:
- `SIGNING_KEYSTORE_BASE64`
- `SIGNING_KEYSTORE_PASSWORD`
- `SIGNING_KEY_ALIAS`
- `SIGNING_KEY_PASSWORD`

Detalles de rotación: `android-app/keystore/README.md`.

## Estrategia Groupage (alineación de variantes)
- **Fuente principal editable:** `Groupage Optimizer.html` (+ assets en `/assets`).
- **Offline/autocontenida:** `Groupage-offline.html`.
- **Android asset:** `android-app/app/src/main/assets/groupage.html` (sincronizado en CI desde `Groupage-offline.html`).
- **Distribución legacy:** `Groupage-app.html`.

Antes de release, validar consistencia funcional con el checklist de `docs/`.

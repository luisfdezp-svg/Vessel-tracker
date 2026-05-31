# Groupage · proyecto Android

App WebView que envuelve `Groupage-offline.html` para distribución como
APK firmado. La app arranca en pantalla completa, carga el HTML desde
`app/src/main/assets/groupage.html` y funciona 100 % offline.

## Cómo obtener el APK

### Opción A — GitHub Actions (sin tocar nada local)

Cada push a `main` o `claude/**` que toque `android-app/`,
`Groupage-offline.html` o el workflow dispara la build.

1. Ve a **Actions → Build Android APK** en GitHub.
2. Abre el último run verde.
3. En *Artifacts* descarga `Groupage-APK.zip` → dentro está el `.apk`.

Para forzar una build manual:

- Actions → Build Android APK → **Run workflow** → (opcional) marca
  *Crear release en GitHub* para que el APK salga también en la pestaña
  Releases.

### Opción B — compilar local

Requisitos: Android Studio Hedgehog (o Android SDK 34 + JDK 17).

```bash
cd android-app
./gradlew :app:assembleRelease
# APK firmado → app/build/outputs/apk/release/app-release.apk
```

La firma de release en CI requiere secrets (ver `keystore/README.md`);
el keystore no se guarda en el repositorio.

## Instalar el APK

### Android 8.0 (Oreo) o superior

1. Descarga el `.apk` en el teléfono (email / Drive / USB).
2. Primera vez: Ajustes → Apps → *Acceso especial* → **Instalar apps
   desconocidas** → concede permiso al navegador/gestor que usaste.
3. Toca el `.apk` → *Instalar* → *Abrir*.
4. La app "Groupage" aparece en el launcher.

### Distribución por Play Store

- Requiere cuenta Google Play Console (25 USD una vez).
- Usar un keystore nuevo y guardarlo solo en GitHub Secrets (ver
  `keystore/README.md`).
- Subir el `.aab` (no `.apk`) — cambia `assembleRelease` por
  `bundleRelease`.

## Estructura

```
android-app/
├── app/
│   ├── build.gradle                 app-level (signingConfig, sdk, deps)
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/groupage.html     ← copia de Groupage-offline.html
│       ├── java/.../MainActivity.java
│       └── res/                     themes, strings, icon adaptativo
├── build.gradle                     root
├── settings.gradle
├── gradle.properties
└── keystore/
    └── README.md                    política de firma y rotación
```

## Actualizar la app al cambiar el HTML

El workflow de GitHub Actions sincroniza `../Groupage-offline.html` a
`assets/groupage.html` antes de compilar. Basta con hacer push del HTML
actualizado; el CI regenera el APK.

Si compilas local, copia el HTML manualmente:

```bash
cp ../Groupage-offline.html app/src/main/assets/groupage.html
./gradlew :app:assembleRelease
```

Incrementa `versionCode` en `app/build.gradle` en cada release para que
Android reconozca la actualización sobre una versión previa instalada.

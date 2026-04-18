# Keystore de firma (dev)

Este keystore `release.jks` firma el APK de **Groupage**.

## Credenciales (defaults)

- **Keystore password:** `groupage2026`
- **Key alias:** `groupage`
- **Key password:** `groupage2026`
- **Validez:** 10 000 días (≈ 27 años)
- **Algoritmo:** RSA 2048, SHA384withRSA

Son **valores por defecto para desarrollo/distribución privada**. Si vas a
publicar en Google Play:

1. Genera un nuevo keystore fuera del repo (no commitees passwords).
2. Guarda el keystore en un gestor seguro (1Password, Bitwarden, etc.).
3. Configura los GitHub Secrets `SIGNING_KEYSTORE_PASSWORD`,
   `SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD` en el repo (Settings →
   Secrets and variables → Actions). El workflow ya los lee por prioridad
   sobre los defaults.

## Regenerar

```bash
keytool -genkey -v \
  -keystore release.jks \
  -alias groupage \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass PASSWORD -keypass PASSWORD \
  -dname "CN=Groupage, OU=Dev, O=luisfdezp, L=-, ST=-, C=ES"
```

## Huella del certificado actual

```bash
keytool -list -v -keystore release.jks -storepass groupage2026 | grep 'SHA'
```

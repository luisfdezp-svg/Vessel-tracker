# Keystore de firma (seguridad)

El keystore **ya no se versiona en el repositorio**.
La firma del APK de **Groupage** se inyecta desde GitHub Secrets durante CI.

## Secrets requeridos en GitHub Actions

- `SIGNING_KEYSTORE_BASE64` → contenido base64 del `.jks`
- `SIGNING_KEYSTORE_PASSWORD`
- `SIGNING_KEY_ALIAS`
- `SIGNING_KEY_PASSWORD`

## Rotación recomendada

1. Genera el keystore fuera del repositorio.
2. Convierte a base64:
   ```bash
   base64 -w 0 release.jks > release.jks.b64
   ```
3. Actualiza los 4 secrets en GitHub.
4. Ejecuta el workflow Android manual con una build de prueba.

## Regenerar

```bash
keytool -genkey -v \
  -keystore release.jks \
  -alias groupage \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass PASSWORD -keypass PASSWORD \
  -dname "CN=Groupage, OU=Dev, O=luisfdezp, L=-, ST=-, C=ES"
```

## Verificar huella localmente

```bash
keytool -list -v -keystore release.jks -storepass PASSWORD | grep 'SHA'
```

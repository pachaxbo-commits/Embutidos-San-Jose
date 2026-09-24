# Actualizaciones Android de Embutidos San José

## Qué actualiza cada canal

- La web se publica mediante `main` → GitHub → Vercel. No usa este sistema.
- La APK Android consulta Firebase Hosting y puede descargar una APK completa.
- El actualizador se crea mediante carga dinámica únicamente cuando Capacitor confirma que el runtime es Android nativo. En navegador no consulta el manifiesto, no muestra botones y no invoca plugins Android.

La primera APK que contiene el actualizador debe instalarse manualmente encima de la versión actual. Desde la siguiente versión, los teléfonos podrán detectar nuevas APK desde la propia aplicación.

## Identidad que no debe cambiar

| Dato | Valor actual |
|---|---|
| Paquete / `applicationId` | `com.pachax.flow` |
| Certificado SHA-256 | `68:72:F7:AA:28:E3:C4:58:EC:44:9F:2D:14:DF:DC:E5:F6:4F:0A:C0:43:32:69:85:6F:59:BA:32:50:C2:8F:AE` |
| Keystore histórico | `%USERPROFILE%\.android\debug.keystore` (archivo local, nunca Git) |
| Alias histórico | `AndroidDebugKey` |
| Firebase Project ID | `pachax-flow` |
| Canal de manifiesto | `https://pachax-flow.web.app/updates/san-jose/update.json` |

El nombre del certificado no tiene que decir San José. Android exige el mismo paquete y el mismo certificado criptográfico; cambiar el keystore impediría actualizar las instalaciones existentes.

## Versión

La fuente de verdad Android está en `android/app/build.gradle`:

```gradle
versionCode 20
versionName "1.4.0"
```

Para cada publicación:

1. Incrementar siempre `versionCode` con un entero nuevo.
2. Cambiar `versionName` al nombre legible deseado.
3. Nunca reutilizar un `versionCode` ya publicado.

La detección se basa en `versionCode`, no en comparar el texto de `versionName`.

## Generar y revisar una APK

Desde la raíz del proyecto:

```powershell
npm ci
npm run typecheck
npm run test:updater
npm run build:android
npx cap sync android
Set-Location android
.\gradlew.bat assembleRelease
Set-Location ..
```

La salida habitual es `android/app/build/outputs/apk/release/app-release.apk`.

En esta aplicación, `assembleRelease` conserva deliberadamente la misma firma histórica que las APK distribuidas. En otra computadora, el `debug.keystore` predeterminado normalmente será diferente. No se debe publicar hasta que el script de preparación acepte la huella exacta.

Comprobación manual:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs android\app\build\outputs\apk\release\app-release.apk
```

La huella SHA-256 debe coincidir exactamente con la tabla anterior. No es suficiente que el alias tenga el mismo nombre.

## Preparar la publicación

Ejemplo opcional:

```powershell
npm run prepare:android-update -- --apk android/app/build/outputs/apk/release/app-release.apk --notes "Mejoras en ventas e impresión"
```

Ejemplo obligatorio:

```powershell
npm run prepare:android-update -- --apk android/app/build/outputs/apk/release/app-release.apk --notes "Actualización necesaria de seguridad" --mandatory --minimum-supported-version-code 20
```

El script:

- lee paquete, `versionCode` y `versionName`;
- rechaza otro paquete o un `versionCode` no superior;
- verifica el certificado con `apksigner`;
- calcula tamaño y SHA-256;
- copia la APK con nombre versionado a `dist/updates/san-jose/apk/`;
- genera `dist/updates/san-jose/update.json`;
- deja una copia revisable en `output/android/`;
- no despliega nada.

Revisar manualmente la APK y `update.json`. El SHA-256 puede comprobarse con:

```powershell
Get-FileHash dist\updates\san-jose\apk\*.apk -Algorithm SHA256
```

El hash, tamaño, versión y URL deben coincidir con el manifiesto.

## Publicar en Firebase Hosting

Solo después de aprobar la revisión:

```powershell
firebase use pachax-flow
firebase deploy --only hosting
```

Para preparar Android se usa `npm run build:android`; ese modo es el único que incluye el updater en el bundle que Capacitor copia a la APK. El comando normal `npm run build`, utilizado por Vercel, elimina incluso el chunk del updater.

Antes de publicar Firebase Hosting, ejecutar `npm run build` para producir la web y luego el script de preparación, que añade otra vez `dist/updates/san-jose/`. Este comando publica el contenido de `dist`, incluida la web generada. Vercel continúa siendo el canal web principal. La configuración da `no-store` a `update.json` y caché inmutable a las APK versionadas.

No sobrescribir una APK publicada con otro contenido bajo el mismo nombre. Preparar siempre un archivo nuevo.

## Qué ocurre en el teléfono

1. La APK consulta el manifiesto al iniciar, como máximo una vez cada seis horas, o al solicitar una búsqueda manual.
2. Si el `versionCode` remoto es mayor, muestra versión, tamaño y notas.
3. Descarga por HTTPS sin cargar el archivo completo en memoria y muestra progreso.
4. Comprueba tamaño, SHA-256, paquete, versión superior y certificado.
5. Si alguna comprobación falla, borra la APK y no abre el instalador.
6. Android puede pedir habilitar “Permitir desde esta fuente” para San José.
7. Se abre el instalador oficial; el usuario confirma. No existe instalación silenciosa.
8. Android instala encima de la app, por lo que conserva datos, sesión, IndexedDB, preferencias e impresora.

Si Play Protect muestra una revisión, se debe dejar que termine. Nunca desactivarlo ni intentar evitarlo.

Con operaciones pendientes de sincronización, la interfaz impide comenzar la descarga y recomienda terminar la sincronización. Incluso una actualización obligatoria puede posponerse mientras existan operaciones pendientes.

## Prueba real controlada

1. Respaldar el keystore histórico fuera de Git y confirmar su huella.
2. Instalar una APK A con el paquete y firma actuales; iniciar sesión y crear datos de prueba locales.
3. Compilar APK B con `versionCode` superior y la misma firma.
4. Ejecutar el script de preparación y revisar APK, URL, tamaño, hash y manifiesto.
5. Publicar Hosting solo en la prueba autorizada.
6. Abrir APK A, entrar en **Más → Acerca de y actualizaciones** y buscar manualmente.
7. Confirmar que muestra A como instalada y B como disponible.
8. Descargar, observar el progreso y habilitar el permiso de Android si lo solicita.
9. Confirmar la instalación oficial sin desinstalar A.
10. Abrir B y comprobar versión, sesión, datos, ventas pendientes, configuración Bluetooth e impresión.
11. Repetir con SHA incorrecto, archivo corrupto, sin red, cancelación y permiso desactivado. Ningún caso fallido debe abrir el instalador.

Para una prueba A=100/B=101 se necesita una rama o variante de laboratorio, porque Android no permite volver luego a un `versionCode` inferior sobre el mismo dispositivo. No publicar esos códigos artificiales en el canal real.

## Actualización obligatoria

`mandatory: true` retira el botón “Más tarde” cuando no hay trabajo pendiente. No elimina datos ni instala automáticamente. Si hay operaciones sin confirmar, se permite posponer para protegerlas.

## Rollback correcto

Android rechaza downgrades normales. Si la versión 20 tiene un problema:

1. recuperar el código estable anterior;
2. corregir lo necesario;
3. asignar `versionCode 21` (o cualquier entero superior al publicado);
4. preparar y publicar esa APK como una nueva actualización.

Nunca intentar volver a publicar 19 ni reemplazar el archivo de 20.

## Firebase actual

- Nombre visible: `Pachax-Flow`.
- Project ID: `pachax-flow`.
- Project Number: `790987434582`.
- Web App ID: `1:790987434582:web:58e7e196b72a451b96a9f7`.
- Sitio Hosting: `pachax-flow` (`https://pachax-flow.web.app`).
- No hay una Firebase Android App registrada ni `google-services.json`; Capacitor utiliza la configuración web dentro del WebView.
- Se encontraron Authentication, Firestore y Functions en uso; Hosting está configurado. El bucket está configurado, pero el código actual no importa Firebase Storage. Existe `measurementId`, pero el código no inicializa Analytics.

El nombre visible puede cambiarse después en Firebase Console: **Configuración del proyecto → General → Nombre del proyecto → Editar**, guardando solo `Embutidos San José`. No cambiar Project ID, número, Web App ID, auth domain, bucket, sitio Hosting, configuración web, paquete Android ni certificado.

## Protección del keystore

- Nunca añadir `.jks`, `.keystore`, contraseñas, cuentas de servicio ni `signing.properties` a Git.
- Mantener al menos dos respaldos cifrados y controlados fuera del repositorio.
- Registrar de forma segura quién custodia la clave y cómo recuperar el respaldo.
- Perder esta clave impediría publicar actualizaciones compatibles con los teléfonos existentes.
- Para aplicaciones futuras es recomendable una clave independiente por aplicación. No cambiar la clave actual de San José.

## Lista de prohibiciones

- No desinstalar como paso normal de actualización.
- No limpiar datos de la aplicación.
- No crear un keystore nuevo para San José.
- No cambiar `com.pachax.flow`.
- No aceptar URLs ingresadas por usuarios.
- No omitir las validaciones del script.
- No publicar sin incrementar `versionCode`.
- No desactivar Play Protect ni buscar instalación silenciosa.

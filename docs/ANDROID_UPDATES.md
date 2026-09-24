# Actualizaciones Android de Embutidos San José

## Qué actualiza cada canal

- La web se publica mediante `main` → GitHub → Vercel. No usa este sistema.
- La APK Android consulta Firebase Hosting y puede descargar una APK completa.
- El actualizador se crea mediante carga dinámica únicamente cuando Capacitor confirma que el runtime es Android nativo. En navegador no consulta el manifiesto, no muestra botones y no invoca plugins Android.

La versión 1.4.0 inicia una identidad de firma release definitiva. Debido al cambio desde la firma debug histórica de 1.3.2, esta primera migración exige desinstalar 1.3.2 e instalar 1.4.0 manualmente. Desde 1.4.0, todas las versiones deben usar exactamente la misma clave release y podrán instalarse encima.

## Identidad que no debe cambiar

| Dato | Valor actual |
|---|---|
| Paquete / `applicationId` | `com.pachax.flow` |
| Keystore definitivo | `%USERPROFILE%\.pachax\signing\pachax-san-jose-release.jks` (privado, nunca Git) |
| Alias definitivo | `pachax-san-jose` |
| Certificado SHA-1 definitivo | `CC:F0:3B:F5:09:E6:5F:1E:E3:D7:DA:8C:1F:12:9D:B9:59:0B:F5:E2` |
| Certificado SHA-256 definitivo | `C8:7F:3A:B0:00:CF:0A:5D:1F:B7:F6:93:C9:42:6D:2C:17:3F:8A:CD:7E:4E:03:8B:2A:6A:3C:E8:43:C3:38:2B` |
| Firma histórica 1.3.2 | `%USERPROFILE%\.android\debug.keystore`, alias `AndroidDebugKey`, solo respaldo |
| Firebase Project ID | `pachax-flow` |
| Canal de manifiesto | `https://pachax-flow.web.app/updates/san-jose/update.json` |

Android exige el mismo paquete y certificado para instalar una actualización encima. La ruptura entre 1.3.2 y 1.4.0 es intencional y ocurre una sola vez. No volver a cambiar la clave desde 1.4.0.

La clave definitiva fue creada el 24 de septiembre de 2026, vence el 14 de septiembre de 2066, utiliza RSA de 4096 bits y certificado `SHA256withRSA`.

## Crear la clave definitiva sin exponer secretos

Crear primero la carpeta privada y ejecutar `keytool` en una terminal interactiva. El comando no contiene contraseñas; `keytool` las solicitará sin escribirlas en Git ni documentación:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.pachax\signing"
keytool -genkeypair -v -keystore "$env:USERPROFILE\.pachax\signing\pachax-san-jose-release.jks" -storetype JKS -alias pachax-san-jose -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 14600 -dname "CN=Embutidos San Jose, OU=Android Release, O=PACHAX, C=BO"
```

Usar contraseñas fuertes y custodiadas. Copiar `android/signing.properties.example` a `android/signing.properties` y completar ese archivo local; está ignorado por Git. También se admiten `SAN_JOSE_KEYSTORE_PATH`, `SAN_JOSE_KEYSTORE_PASSWORD`, `SAN_JOSE_KEY_ALIAS`, `SAN_JOSE_KEY_PASSWORD` y `SAN_JOSE_CERTIFICATE_SHA256`.

Obtener SHA-1, SHA-256, fechas, algoritmo y tamaño sin revelar secretos:

```powershell
keytool -list -v -keystore "$env:USERPROFILE\.pachax\signing\pachax-san-jose-release.jks" -alias pachax-san-jose
```

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

`assembleRelease` falla de forma intencional si no existe la configuración privada release. Nunca cae a `signingConfigs.debug`. `assembleDebug` conserva el flujo debug normal.

Comprobación manual:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs android\app\build\outputs\apk\release\app-release.apk
```

La huella SHA-256 debe coincidir exactamente con `certificateSha256` en la configuración privada. No es suficiente que el alias tenga el mismo nombre.

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

1. La APK consulta el manifiesto de forma asíncrona una vez al crear una nueva sesión/cold start razonable, después de cargar la aplicación. No consulta de nuevo por volver desde WhatsApp, impresión o un pause/resume.
2. Si el `versionCode` remoto es mayor, muestra versión, tamaño y notas.
3. Descarga por HTTPS sin cargar el archivo completo en memoria y muestra progreso.
4. Comprueba tamaño, SHA-256, paquete, versión superior y certificado.
5. Si alguna comprobación falla, borra la APK y no abre el instalador.
6. Android puede pedir habilitar “Permitir desde esta fuente” para San José.
7. Se abre el instalador oficial; el usuario confirma. No existe instalación silenciosa.
8. Desde 1.4.0, Android instala encima de la app y conserva datos locales. La migración inicial desde 1.3.2 es la única excepción porque cambia la firma.

Si Play Protect muestra una revisión, se debe dejar que termine. Nunca desactivarlo ni intentar evitarlo.

Con operaciones pendientes de sincronización, la interfaz impide comenzar la descarga y recomienda terminar la sincronización. Incluso una actualización obligatoria puede posponerse mientras existan operaciones pendientes.

Si la actualización es opcional y se elige **Más tarde**, no vuelve a abrir el modal automáticamente durante esa sesión y deja un chip compacto **Nueva versión disponible**. Al tocarlo reabre el modal. El último manifiesto válido se conserva localmente para mantener el recordatorio si el siguiente inicio está temporalmente sin conexión; una búsqueda manual siempre consulta el servidor y omite ese respaldo.

La presentación automática espera si hay operaciones pendientes u otro diálogo abierto. La consulta y cualquier fallo de red nunca bloquean el login ni el panel.

## Migración única 1.3.2 → 1.4.0

Antes de desinstalar, en el mismo teléfono y con Internet:

1. Esperar a que desaparezca **Operaciones pendientes de validación** y a que el indicador muestre **Sincronizado**.
2. Confirmar que no haya ventas, cobros, gastos ni otras operaciones marcadas como pendientes de confirmación.
3. Cerrar la jornada/despacho que corresponda y revisar los datos desde Administración en otro dispositivo o en la web.
4. No desinstalar si aparece **Sin conexión**, **Sincronizando**, un error rojo o una operación rechazada sin revisar.
5. Anotar la impresora configurada (nombre, Bluetooth/MAC o IP y tamaño) porque su perfil local se pierde.

Al desinstalar se borran la sesión, caché Firestore/IndexedDB, cualquier escritura todavía no sincronizada, los trabajos de impresión pendientes, perfiles de impresora y preferencias locales. Firestore recupera ventas confirmadas, créditos, cobros, stock, lotes, rutas, despachos, cierres, clientes, productos, usuarios y configuración empresarial después de iniciar sesión. Firebase Authentication conserva la cuenta, no la sesión local.

## Prueba real controlada

1. Respaldar el keystore definitivo fuera de Git y confirmar su huella.
2. Migrar un teléfono de prueba de 1.3.2 a la nueva 1.4.0 siguiendo la lista anterior.
3. Compilar una APK B con `versionCode` superior y exactamente la misma firma definitiva.
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

- Respaldar exactamente `%USERPROFILE%\.pachax\signing\pachax-san-jose-release.jks` y las credenciales en un gestor seguro independiente.
- Nunca añadir `.jks`, `.keystore`, contraseñas, cuentas de servicio ni `signing.properties` a Git.
- Mantener al menos dos respaldos cifrados y controlados fuera del repositorio.
- Registrar de forma segura quién custodia la clave y cómo recuperar el respaldo.
- Si se pierde esta clave, las instalaciones existentes de San José dejarán de aceptar futuras APK firmadas con una clave distinta.
- La clave es exclusiva de Embutidos San José; no compartirla con otras aplicaciones PACHAX.

## Lista de prohibiciones

- No desinstalar después de completar la migración única 1.3.2 → 1.4.0.
- No limpiar datos de la aplicación.
- No crear otra clave ni reemplazar `pachax-san-jose-release.jks` después de distribuir 1.4.0.
- No cambiar `com.pachax.flow`.
- No aceptar URLs ingresadas por usuarios.
- No omitir las validaciones del script.
- No publicar sin incrementar `versionCode`.
- No desactivar Play Protect ni buscar instalación silenciosa.

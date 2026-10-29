# Fase 3F.1 — comandos de QA local

Esta verificación usa datos ficticios y Firebase Emulator. No ejecuta despliegues ni escribe en producción.

## Instalación y pruebas

Desde la raíz del repositorio:

```sh
npm ci --include=optional
npm run test:processing-ui-e2e
```

El E2E inicia Auth, Firestore y Functions Emulator bajo `demo-pachax-audit`, levanta Vite en modo `emulator` y usa cuentas y fixtures sintéticos. Playwright Chromium recorre la aplicación completa con Administración, Almacén y Distribución; prueba las cinco pestañas, conservación del borrador, aislamiento por almacén, bloqueo del módulo para distribuidores, tamaños de 360, 390, 768 y 1440 px, una revisión y el reenvasado de 2 kg en ocho sachets. También pierde la conexión después de que una revisión se persiste, comprueba el estado incierto con el mismo identificador y verifica la recuperación sin duplicar la revisión.

El test guarda capturas en el directorio temporal del sistema. Para comprobar la generación de documentos:

```sh
npm run test:document-resources
```

## Builds

```sh
npm run build:android
npm run build
```

`build:android` valida la configuración Android existente de Firebase y genera los assets web que se usarían para una futura compilación nativa; no crea una APK. `build` exige las seis variables Firebase reales de producción. No reemplazarlas con valores de Emulator para declarar aprobado un build de producción.

El build de QA se puede ejecutar con `npx vite build --mode emulator` y seis valores sintéticos de Emulator; su resultado no representa un build publicable.

## Alcance de la configuración de QA

El script `test:processing-ui-e2e` pasa un interruptor exclusivo al proceso del Emulator. El fixture y las credenciales de QA viven en `firebase/tests` y `scripts`; el harness no forma parte de la aplicación publicada. No incluir cuentas, claves ni datos reales en el harness.

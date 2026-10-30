# PR #3 — registro de aceptación

Fecha: 2026-10-30. Rama: `codex/sanjose-completion-20261030`.

## Circuitos y controles

La operación `releaseProcessingLot` exige membresía de Administración y autorización vigente del mecanismo de Calidad existente. Verifica elaboración confirmada, salida terminada por paquetes, fechas, procedencia, cantidades enteras, gramos y centavos conocidos, reservas, ubicaciones y balances. Persiste una aprobación vinculada al lote, batch, operación y responsable. Conserva `processingCommercialBlocked` y `processingByLocation`: despacho y venta siguen consumiendo segmentos históricos, nunca inventario tradicional por el simple hecho de liberar.

La edición genérica `updateLot` no puede cambiar fechas, identidad o costo de un lote derivado. La falta de stock de un lote autorizado debe informarse como stock insuficiente. Cuarentena, reservas, devoluciones derivadas, revisión y costo desconocido no se resuelven mediante la liberación genérica.

El reenvasado se probó usando `SANJOSE_PROCESSING_REPACK_ENABLED` y bucket, sin depender del switch exclusivo de Emulator. Cada operación sigue exigiendo reserva, revisión, evidencia verificada y autorización vigente. La configuración global no concede aptitud a un lote ni resuelve una disposición económica pendiente.

Los reportes consultan el período en servidor, conservan el alcance de almacén y completan sus páginas antes de publicar resultados. El recolector devuelve el conjunto completo o falla; no entrega resultados parciales. Deduplica documentos, descarta respuestas obsoletas y limita el informe a 10.000 registros. Pantalla, PDF, Excel e impresión comparten el mismo conjunto. El filtro de trazabilidad admite producto de origen o terminado.

## Pruebas ejecutadas

| Prueba | Evidencia |
| --- | --- |
| `test:processing-commercial-release` | Elaboración real de Emulator, rechazo sin Calidad y en cuarentena, escritura directa denegada, aprobación concurrente única, despacho, venta de ruta, retorno, cierre monetario, efectivo, QR, crédito, idempotencia y gramos/centavos exactos. Ejecutada también con Node 22.23.4. |
| `test:processing-derived-sale` | 82 comprobaciones aprobadas: costos, Resultado, créditos, QR, devoluciones, anulaciones, correcciones, cuarentena, cierres, reaperturas y concurrencia. |
| `test:processing-derived-dispatch` | 21 comprobaciones aprobadas: ubicación, varios lotes, cantidades parciales, transferencias, correcciones y concurrencia. |
| `test:processing-repack` | 39 comprobaciones aprobadas con configuración de servidor; masa, costo, fechas, evidencia, revocación, idempotencia y concurrencia. |
| `test:processing-evidence` | 8 comprobaciones aprobadas con Storage Emulator; permisos, contexto, bytes, huella SHA-256, generación y revisión. |
| `test:processing-reports` | Filtros, trazabilidad inversa, fecha boliviana, pesos desconocidos, deduplicación, fallo intermedio, cancelación y límite de 10.000. |
| `test:processing-ui-e2e` | Chromium y Android WebView: sesión sintética, reconexión, revisión/reenvasado, QR, navegación y tamaños 320/360/375/390/414/768/1440. 51 documentos reales de Firestore Emulator en pantalla y Excel descargado; PDF generado y acción de impresión. |
| Android nativo QA | Android 14 / API 34, WebView 113.0.5672.136. Paquete independiente `com.pachax.flow.qa`, firma debug. Login de Auth Emulator, sincronización, borrador tras recargar, apertura de turno y navegación de Administración/Almacén. No representa una actualización oficial sobre la APK 87. |
| Caja | `cashRefundClosure`: 12 aserciones aprobadas. `cashRefundConcurrency`: aprobada en Emulator vacío. Estas suites deben ejecutarse aisladas porque comparten identificadores de jornada. |
| Egresos 2.0 | 70 comprobaciones aprobadas. |
| Otras regresiones | Kardex, resumen por vendedor, exportación de créditos por ruta, contabilidad de egresos, disponibilidad física/comercial y navegación/tutoriales aprobadas. |

WebKit detectó el mínimo global de 320 px que excedía el ancho útil con scrollbar; se cambió el mínimo de `html, body` a cero sin ocultar overflow. El E2E completo de WebKit quedó aprobado en los siete anchos. La prueba distingue únicamente errores XHR de sesiones que el propio test interrumpió por desconexión o reemplazo de documento; los errores de sesiones nuevas siguen siendo fallos. WebKit en Windows no equivale a una prueba en iPhone físico.

Typecheck, lint focal, build Android con configuración Firebase autorizada y diff check se ejecutan antes del push final. El lint global registra 106 errores y cero advertencias: ninguno de sus archivos con error difiere de `origin/main`. La exclusión añadida cubre únicamente assets y compilaciones Android generados; no elimina reglas de código fuente.

## Publicación

No se han desplegado los cambios de este PR, integrado main ni publicado APK/OTA. La APK pública sigue en 1.4.67 (87). La configuración generada usada para la APK QA fue restaurada y su SHA-256 coincide con el respaldo original.

Antes de publicar: autorización de integración/despliegue, índice de período verificado READY, Functions/Rules compatibles, bucket restringido, responsables de Calidad autorizados mediante el mecanismo privilegiado, nueva APK oficial con código superior a 87, firma oficial y prueba de actualización/sincronización sobre la APK 87. No distribuir la APK `.qa` ni introducir sus datos sintéticos en producción.

Procedimiento de corte inicial y recuperación: [processing-commercial-cutover.md](processing-commercial-cutover.md). Los registros históricos duplicados manualmente requieren conteo y conciliación aprobada; no se ajustan automáticamente.

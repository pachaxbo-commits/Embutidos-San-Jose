# Consumo y correcciones de la candidata 1.4.67

## Evidencia de consumo

Monitoring, muestras de un minuto del 23/10/2026 hasta aproximadamente 30/10/2026 05:03 UTC. Las muestras corresponden a intervalos cerrados por su fin; se atribuyen al minuto anterior para evitar desplazar el límite diario.

El día 29 de octubre de America/Los_Angeles (cuota de Firestore, aún parcial al consultar) suma 171.617 lecturas: 121.617 por encima de las 50.000 gratuitas. Esto concilia el aviso de aproximadamente 122.000 lecturas excedentes. No equivale a una factura: el proyecto tiene Billing activo, base Native con freeTier en southamerica-west1. No se obtuvo exportación de costos de Billing.

El 29/10 entre 12:00 y 13:00 America/La_Paz (16:00–17:00 UTC) hay 55.273 lecturas: QUERY 55.055, LOOKUP 187, NOT_FOUND 31. Cloud Run registra 22 requests del processor, 10 de refresh de créditos, 2 de inicialización y 4 de diagnósticos. Las métricas no identifican consulta, pantalla o usuario. La búsqueda de Data Access logs para esa hora no devolvió entradas. No se atribuye el pico a un cliente o Function.

Datos originales conservados fuera del repositorio en G:/Emulator/firestore-consumption-minute.json, firestore-pacific-quota.json, spike-cloudrun-requests.json y firestore-consumption-summary.json. Ninguna investigación descargó colecciones comerciales ni creó movimientos productivos.

## Defecto y corrección

subscribeQuery de distributionRepository abre ventas con includeMetadataChanges. Antes ejecutaba getDocFromServer para cada venta anulada con derivedVoid en cada emisión, incluso con cashReceiptSnapshot ya incluido. Para una referencia y 101 emisiones eso solicitaba hasta 101 lecturas explícitas de corrección. Es un defecto comprobable, no la causa demostrada del pico QUERY.

Ahora las ventas con snapshot usan directamente el validador contable. Para ventas sin snapshot, una referencia de corrección comparte una suscripción viva dentro de la consulta/tenant. Las emisiones de ventas reutilizan la evidencia; un cambio, eliminación o error de permisos de la corrección invalida el valor. La primera evidencia requiere confirmación del servidor y no acepta solamente el cache local. Al salir de la consulta o quitar la referencia se libera el listener. Reconexiones de Firestore y cambios reales de evidencia pueden seguir generando lecturas facturadas.

Prueba focal: 101 accesos a una misma referencia -> una suscripción inicial, sin 100 getDocFromServer adicionales. También comprueba actualización, borrado, error, recuperación y unsubscribe. La conciliación histórica 0 efectivo/8 QR y los rechazos de evidencia inválida se mantienen en las pruebas de dominio existentes.

La mejora todavía no constituye una reducción medida en producción: requiere distribuir el cliente nuevo y comparar ventanas de uso equivalentes.

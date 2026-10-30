# Inicio de uso comercial de sacheteado

## Existencias anteriores

Administración y Almacén deben acordar una fecha y hora de corte, cerrar las rutas correspondientes y realizar un conteo físico por SKU, lote y ubicación. Registrar por separado granel, paquetes terminados, reservas y cuarentena. Contrastar con Kardex, ingresos y elaboraciones ya registradas.

El conteo debe identificar qué paquetes ya fueron registrados manualmente y si su granel de origen sigue incluido en el saldo contable. No ejecutar una nueva elaboración para representar paquetes históricos ya existentes: descontaría otra vez el origen. No borrar lotes ni compensar diferencias mediante ventas, cortesías o merma ficticias.

Conservar el acta de conteo y la conciliación aprobada. Cualquier ajuste inicial requiere el procedimiento contable autorizado y evidencia de cantidades y costos. Hasta resolver una diferencia, el inventario afectado permanece fuera del nuevo circuito. A partir del corte, registrar una sola elaboración por transformación física nueva.

## Producción nueva

1. Almacén registra los lotes de granel consumidos y los pesos reales de todos los destinos.
2. El servidor descuenta el origen y crea los lotes derivados con cantidades, gramos, centavos y procedencia.
3. Administración con autorización vigente de Calidad revisa los lotes terminados y registra el fundamento de aptitud en el detalle del historial.
4. `releaseProcessingLot` comprueba autorización, estado, fechas, origen, reservas, segmentos y balance físico antes de registrar la liberación. No modifica existencias ni elimina la protección contable del lote.
5. Despacho y venta consumen los segmentos históricos. Las devoluciones dañadas permanecen en cuarentena bajo su procedimiento especializado.

La autorización de Calidad se concede mediante el mecanismo privilegiado existente, con concedente distinto del beneficiario y vencimiento. Una membresía de Administración por sí sola no permite liberar producto. No se crean autorizaciones en producción como parte de las pruebas.

## Reenvasado

La configuración de servidor requiere `SANJOSE_PROCESSING_REPACK_ENABLED=true` y el bucket de evidencia restringido. La configuración no sustituye la reserva, revisión, evidencia verificada ni autorización de Calidad vigentes que valida la transacción. Las existencias resultantes mantienen su protección comercial; los casos de devolución o disposición económica sin política aprobada continúan bloqueados.

## Despliegue y recuperación

Desplegar y verificar el índice de período antes de habilitar los reportes nuevos. Publicar Functions y Rules compatibles antes del cliente que solicita liberaciones. Mantener los flags exclusivos de Emulator fuera de producción.

Ante una incidencia, impedir nuevas liberaciones o suspender el cliente nuevo mientras se conserva el backend compatible con segmentos para completar retornos y cierres. No eliminar `processingByLocation`, aprobaciones, gramos o costos para volver al circuito tradicional. Los clientes anteriores pueden seguir mostrando el lote protegido como bloqueado; esto es conservador y no justifica editar inventario. La APK oficial requiere una versión posterior a 1.4.67 (87), firma oficial y prueba de actualización.

# PR #40 · Publicación y reversión

## Contrato de rectificación

- Administración puede corregir una compra activa. La operación recibe la revisión que vio el usuario, calcula el total desde las líneas y compara el saldo con el libro de pagos. Actualiza egreso y obligación en una transacción y conserva un documento independiente con el antes/después, actor, fecha y motivo.
- Una compra con pagos puede corregir el importe si cubre todo lo ya pagado. El estado pagado o parcial y el saldo se recalculan. Proveedor, fecha y responsable quedan bloqueados mientras existan pagos activos. Método e importe de pagos históricos se gestionan como pagos separados en el libro de abonos.
- Una compra referenciada por movimientos, lotes o producción se bloquea en el servidor. Su corrección requiere identificar el lote, el consumo y los costos que se deben compensar. Una compra atribuida a una caja cerrada también se bloquea y requiere un asiento compensatorio en un período abierto. La PR no automatiza esos asientos.
- La búsqueda de referencias históricas a costos inspecciona los lotes de producción. Medir su latencia con un conjunto representativo antes de habilitar el flujo de forma general. Los históricos sin líneas mantienen su importe y no aportan peso al resumen.

## Publicación después de aprobación

1. Mantener la PR en borrador hasta cerrar o aceptar explícitamente la matriz de verificación.
2. Verificar el SHA de main y guardar el SHA, la revisión de Firebase y el despliegue web vigentes. Preparar la reversión desde esos valores.
3. Desplegar desde el mismo SHA la función processSanJoseOperation, las reglas de Firestore y el frontend. Publicar la función y las reglas antes de habilitar la acción en el frontend.
4. Validar la revisión activa de Firebase y el SHA de Vercel. Revisar recepción, reportes y operaciones pendientes. Usar datos sintéticos únicamente en el emulador.

No requiere backfill ni migración destructiva. Los documentos de rectificación se crean solo para operaciones nuevas.

## Reversión

1. Retirar el frontend nuevo e impedir que las reglas acepten nuevas solicitudes de rectificación. Comprobar que las solicitudes en cola estén resueltas antes de revertir la función.
2. Restaurar frontend y función al SHA anterior y las reglas a la revisión anterior aprobada. Conservar los documentos de auditoría y todos los pagos.
3. Revisar transacciones ya confirmadas y sus efectos. Revertir el software no revierte una compra corregida. Una reversión de negocio requiere otra rectificación autorizada y su propia evidencia.

## Safari iOS

La prueba de Safari iOS requiere acceso a un dispositivo o Mac con simulador. Si la descarga no guarda el archivo, puede usarse la acción independiente Compartir PDF cuando Safari admita compartir archivos. La alternativa comprobada es descargar el mismo cierre en Chrome o Edge de escritorio. No se certifica Safari a partir de WebKit de escritorio ni de una simple emulación de pantalla.

## Límites de verificación y Android

La rectificación consulta como máximo 251 abonos de la propia obligación y 251 lotes de producción históricos con campos proyectados, 101 cierres por consulta y un vínculo por cada colección de inventario. Una compra con más de 250 abonos, más de 250 lotes de producción históricos o más de 100 cierres candidatos requiere revisión contable. No se autoriza la escritura si la búsqueda quedó incompleta. El límite de producción es global al restaurante mientras los registros históricos no tengan índice inverso; ampliar el flujo sin ese bloqueo requiere un índice con cobertura verificada.

Antes de habilitar la función desplegar y esperar el estado listo del índice compuesto de cierres (ruta y fecha). Despliegue independiente: `firebase deploy --only firestore:indexes --project pachax-flow`. Verificación de solo lectura: `firebase firestore:indexes --pretty --project pachax-flow`; exigir `[READY] (distClosures) -- (routeId,ASCENDING) (dayKey,ASCENDING)` antes de desplegar backend/reglas. El índice está definido en `firebase/firestore.indexes.json` y corresponde a la consulta de cierres por ruta y rango de fecha en `rectifySupplierPurchase`.

La última lectura de Production de 2026-11-23 no encontró ese índice en el listado; por ello sigue siendo una condición de publicación y no debe habilitarse la rectificación del backend hasta que el despliegue independiente muestre READY. No requiere cambiar datos ni backfill.

Para la app Android se requiere compilar y distribuir un APK que incluya el método nativo savePdf. El selector de archivos del sistema permite elegir Descargas u otra carpeta visible. Compartir PDF se mantiene como acción independiente. El flujo web no requiere APK.

## QA final de publicación — 2026-11-23

- Android: se generó e instaló un APK debug QA `versionCode 115`, `versionName 1.4.95`, dirigido al proyecto sintético `demo-pachax-audit`. Un cierre sintético invocó el plugin `SanJoseDocumentPrint`: ACTION_CREATE_DOCUMENT abrió Descargas, guardó el PDF visible en `/sdcard/Download`, y Files/visor PDF lo abrió mostrando el contenido. Cancelar devuelve `saved:false`; repetir el nombre guarda una segunda copia con sufijo. La aplicación no solicita permisos de almacenamiento; Android SAF concede acceso al destino seleccionado. Compartir PDF abrió por separado el Android Sharesheet.
- Chrome Android: descarga verificada en Chrome del emulador, en origen localhost: el archivo aparece en Descargas y el visor PDF lo abre. Una descarga servida por HTTP desde `10.0.2.2` produjo la advertencia de descarga insegura; se canceló sin eludirla. Para Playwright Android la automatización es experimental y la API documenta que `Download.path()` falla cuando el navegador está conectado remotamente; por eso la existencia/apertura se verificó en Descargas y la interfaz de Android, no con el path de Playwright.
- Rectificación: regresión sintética de Firestore confirma que 251 lotes, 251 abonos y 101 cierres candidatos se bloquean con solicitud de revisión contable y sin escrituras parciales. Las compras vinculadas a inventario o cierre indican los IDs afectados y piden la compensación/asiento auditado correspondiente. Las compras parcialmente pagadas preservan abonos existentes y recalculan monto y saldo. No se automatiza ninguna compensación financiera.
- Safari iOS: no probado; no había dispositivo ni simulador iOS disponible. Compartir PDF sigue separado como alternativa.

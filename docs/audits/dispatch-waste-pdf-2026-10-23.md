# Despacho de Sacaba y error PDF — auditoría de solo lectura

Consulta realizada el 23/10/2026 a las 11:32 de Bolivia mediante la cuenta ya autorizada de Firebase CLI. Solo GET y Firestore runQuery; no operaciones ni escrituras de documentos. La consulta de dispatch_waste devolvió 83 movimientos, sin alcanzar su límite de 300. Los saldos siguientes corresponden al momento de lectura; la ruta sigue operando.

## Los 2,60 kg son nuevos

Despacho `disp_15e2c4a0-a1bd-4ecd-9e19-6a378d95435f`, ruta `route-sacaba`, Luciano Marcani. Creado 23/10/2026 07:20:06 Bolivia; responsable Almacen Central (warehouse). Estado `open`, sin documento de cierre al consultar.

| SKU | Normal | waste original | dispatchMerma original | Vendido nominal | Saldo ruta | Costo registrado como pérdida |
|---|---:|---:|---|---:|---:|---:|
| gra-viena | 63 kg | 1,54 kg | ausente en payload; 0 efectivo | 15 kg | 48 kg | Bs 53,21 |
| gra-chorizo-parrillero-precocido | 11 kg | 0,48 kg | ausente en payload; 0 efectivo | 0 kg | 11 kg | Bs 15,50 |
| gra-chorizo-parrillero-crudo | 21 kg | 0,58 kg | ausente en payload; 0 efectivo | 13 kg | 8 kg | Bs 21,25 |

Movimientos `dispatch_waste`: mismo dispatchId seguido de `__0`, `__2`, `__4`, respectivamente. Total 2,60 kg y Bs 89,96. La operación fuente es el mismo dispatchId y conserva los tres payloads antiguos con `quantity` nominal y `waste`; no guarda versión/build del cliente, por lo que no se puede identificar su versión exacta.

Lotes de las pérdidas registradas:

| SKU | Documento de lote | Código | Costo histórico por kg |
|---|---|---|---:|
| gra-viena | intake_764c1691-1724-4b09-8ef8-085dac5b0851__0 | 201026 | Bs 34,55 |
| gra-chorizo-parrillero-precocido | intake_5c13625c-995b-4c7c-b5d9-6b3dfa14a83a__0 | 151026 | Bs 32,30 |
| gra-chorizo-parrillero-crudo | intake_11c3f660-bed9-461e-8986-44d56cb8bfe7__0 | 141026 | Bs 36,63 |

La existencia central disminuyó por carga normal más waste; la ruta recibió solo carga normal. Si esas cantidades viajaron físicamente, la merma recuperada puede exceder el saldo registrado y volver a producir un sobrante. La protección nueva no modifica este despacho ya confirmado. Una rectificación requiere autorización, respaldo actualizado, revisión de ventas/correcciones posteriores y conciliación de los lotes originales. No se debe repetir el despacho ni añadir un ingreso de 2,60 kg.

Los lotes de carga normal son 211026 (19 kg) y 221026 (44 kg) para Viena, 201026 (11 kg) para precocido, y 211026 (5 kg) y 221026 (16 kg) para crudo. Son distintos de los lotes que el servidor descontó por waste, elegidos mediante FEFO por separado. Esa diferencia exige confirmar el origen físico antes de rectificar: no basta cambiar una etiqueta o sumar cantidad a la ruta.

Este caso no es `disp_daaf9f0e-b190-4b7b-8523-a3a9eef02e71` del 21/10, que llevaba 1,52 kg de Viena y 0,58 kg de precocido; tampoco es la rectificación de mortadela del 17/10.

## Prevención implementada

El servidor rechaza waste ambiguo distinto de cero antes de aplicar movimientos y pide actualizar la aplicación. Los clientes antiguos pueden continuar enviando cargas normales sin waste o con cero. La merma transportada usa dispatchMerma/normalQuantity/quantity. Las pérdidas reales requieren warehouseLoss con cantidad, motivo y confirmación explícita; mantienen dispatch_waste y su costo como pérdida, con clasificación física demostrada. Los registros antiguos no se reinterpretan.

## ERR-3427D7

Diagnóstico `8fb8e34161e587e4cc3da4360470ffda624ff8811f7338ddd9b58099af15db17`: Chrome/Windows, versión 1.4.57, build e6e6627557a6. Primera ocurrencia 22/10/2026 14:27:43 Bolivia; tres ocurrencias hasta 14:28:08.

URL: `https://embutidos-sanjose.vercel.app/assets/jspdf.es.min-5L0Kl_Is.js`.

El build e6e6627 se desplegó a las 13:30 de Bolivia; da38cdd lo sustituyó a las 14:05. El error ocurrió después de esa sustitución, antes de publicar 1.4.58 (15:17). Confirma una sesión de un build anterior que intentó cargar su dependencia diferida. La URL antigua devuelve actualmente HTTP 200 con Content-Type text/html en Vercel y Firebase, debido a la reescritura SPA; no es un módulo JavaScript válido.

Mediante `vercel curl`, con la autenticación ya autorizada, el mismo asset se recuperó en el despliegue inmutable original e6e6627: 399.593 caracteres de JavaScript jsPDF, sin HTML. La diferencia entre despliegue original y alias vigente demuestra el cambio de recursos entre versiones.

El diagnóstico solo contiene view=aplicación, mensaje y URL, sin callsite de exportación. No permite identificar el botón exacto pulsado. Reportes, despacho, cierre e ingresos compartían la importación diferida de jsPDF. No se encontró registro de service worker en el código.

Las librerías PDF/Excel ahora se cargan con la aplicación y quedan disponibles en sesiones abiertas. La prueba Chrome elimina el acceso a todos los assets posteriores y genera PDF de despacho/cierre/ingresos, PDF de reportes y Excel. La recuperación de otros fallos muestra un aviso y permite abrir otra pestaña, sin recargar la original ni reenviar operaciones. HTML se sirve sin caché; assets con hash conservan caché inmutable.

Los clientes ya abiertos antes de este hotfix no reciben código retroactivamente: deben conservar su pantalla de trabajo y abrir una pestaña nueva o actualizar cuando hayan guardado sus datos.

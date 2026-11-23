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

# Fase 3E.1 — revisión y disposición de producto inmovilizado

## Alcance implementado

`recordProcessingReview` registra una observación inmutable y actualiza únicamente el puntero/revisión del lote. No escribe balances, cantidades, reservas, costo histórico ni Kardex. La reserva continúa activa hasta una operación especializada posterior. `authorized_for_repack` autoriza solamente el siguiente procedimiento: no significa reenvasado realizado ni stock vendible.

La autorización de calidad se valida contra campos de la membresía leída por el servidor (`processingQualityAuthorized` y `processingQualityAuthorizationRef`). Un indicador enviado por el cliente no concede permisos. Hoy el esquema no incluye un flujo administrativo para otorgar esa autorización; hasta configurarla por un mecanismo privilegiado, las decisiones de calidad se rechazan. Almacén registra observaciones/mediciones en su ubicación, no puede declarar no aptitud ni aprobar una decisión. Distribuidores no pueden crear revisiones.

Las revisiones conservan, por separado, unidad y cantidad comercial inmovilizada, gramos históricos asignados, gramos medidos (`null` si no se pesó), diferencia informativa y costo histórico en centavos (`null` si desconocido). La diferencia entre peso asignado y medido no se convierte en merma o pérdida. La evidencia se guarda como referencias a evidencia existente, no como archivos enviados en el payload.

## Disposición económica propuesta — requiere autorización contable

El sistema conserva la contabilidad actual y el estado `pending_quarantine_disposition` hasta que la propietaria y su asesor contable aprueben una política. No se genera un segundo gasto ni se revierte automáticamente el COGS original.

| Escenario | Tratamiento propuesto | Control para evitar duplicación |
|---|---|---|
| Devuelto, en revisión | Mantener costo de venta original; costo asignado al retorno informativo; ningún ajuste de Resultado. | Reserva separada no vendible; sin movimiento económico automático. |
| Autorizado para reenvasado | En una sola operación futura, transferir únicamente masa medida y asignar su costo histórico a los nuevos lotes; agregar costos nuevos solo si no fueron ya registrados como gasto. | El costo recuperado no puede coexistir como COGS definitivo y activo de inventario sin el asiento de reversión aprobado. |
| Declarado no recuperable | Mantener en cuarentena y pendiente de disposición hasta que Administración apruebe el descarte físico y su efecto contable. | El costo de descarte debe reducir el activo/costo previamente reconocido una sola vez. |
| Diferencia entre masa histórica y medida | Mantener la diferencia documentada, sin denominarla pérdida hasta probar el destino físico. | No repartir gramos/costo por promedio ni crear existencias. |
| Costo histórico desconocido | Mantener `null` y mostrar costo no disponible. | No usar costo de catálogo ni cero. |

La ruta contable final necesita aprobación explícita antes de automatizar crédito al COGS, reconocimiento de inventario en cuarentena o pérdida por descarte. La aceptación sanitaria es independiente de esa decisión económica.

## Contrato de Fase 3E.2

`RepackOperationInput` es solo un contrato local, sin handler que lo ejecute. Exige IDs estables, revisión/reserva/lote, segmentos originales, unidad y cantidad comercial, peso real medido abierto, pesos netos de cada destino, presentaciones/SKU y lote nuevos, materiales, costos en centavos, autorización y evidencia. La validación de dominio exige conservación exacta en gramos enteros:

`peso abierto medido = peso recuperado en nuevos envases + descarte confirmado + otros destinos físicos documentados`.

El peso de salida se declara medido y no se deriva del nominal comercial. Las fechas nuevas no pueden exceder el vencimiento límite del origen en el contrato base. El servidor de la futura fase también tendrá que comprobar el SKU activo, vencimientos de todos los lotes, autorización sanitaria, costos no capitalizados previamente, agregados de reserva y concurrencia en la misma transacción.

## Estados y límites

Las acciones disponibles registran observaciones, inician revisión, solicitan información, autorizan el procedimiento futuro, declaran no recuperable o marcan la disposición económica pendiente. `resolved_specialized` no puede alcanzarse desde esta operación; requiere la transacción posterior. `resolveQuarantine`, liberación genérica, venta, despacho, modificación de costo y descarte siguen bloqueados para la mercadería derivada/inmovilizada.

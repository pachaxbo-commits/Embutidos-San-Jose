# Fase 3E.1 — revisión y disposición de producto inmovilizado

## Alcance implementado

`recordProcessingReview` registra una observación inmutable y actualiza únicamente el puntero/revisión del lote. No escribe balances, cantidades, reservas, costo histórico ni Kardex. La reserva continúa activa hasta una operación especializada posterior. `authorized_for_repack` autoriza solamente el siguiente procedimiento: no significa reenvasado realizado ni stock vendible.

La autorización de calidad se valida contra un registro del servidor separado de la aprobación económica. Un indicador enviado por el cliente no concede permisos. Almacén registra observaciones/mediciones en su ubicación; no puede declarar no aptitud ni aprobar una decisión. Distribuidores no pueden crear revisiones.

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

## Fase 3E.2 — reenvasado aislado a Emulator

`confirmProcessingRepack` consume la reserva `repack_pending` en una transacción única; no la libera a stock vendible. Usa `repackId` estable y la huella del contenido para impedir una segunda conversión o reutilización con otro payload. La misma lógica solo puede ejecutarse con Emulator y un interruptor de entorno del servidor. El payload cliente no activa ese interruptor. Los nuevos lotes quedan bloqueados comercialmente.

`RepackOperationInput` distingue lote tradicional de lote derivado. En lotes derivados el cliente envía selectores de segmentos; cantidades, gramos y centavos se vuelven a leer del lote/reserva dentro de la transacción. En lote tradicional no se inventan segmentos. La cantidad abierta debe caber en la reserva, el peso debe estar medido y el costo permanece `null` si no existe un costo histórico verificable. La reserva guarda los centavos al crearse para repartir los restos de una operación parcial de forma determinista. Para evitar solapar asignaciones de costo, un lote/ubicación solo admite una reserva activa de reenvasado.

La validación de dominio exige conservación exacta en gramos enteros:

`peso abierto medido = peso recuperado en nuevos envases + descarte confirmado + otros destinos físicos documentados`.

El peso de salida se declara medido y no se deriva del nominal comercial. El servidor comprueba SKU activo, lote de destino único, fecha original de elaboración y vencimiento no extendido, autorización de calidad vigente, evidencia asociada al lote/reserva/revisión/ubicación, agregados de reserva y concurrencia en la transacción. No hay descarte ni destinos parciales habilitados en esta fase. Los costos de envases son informativos y no generan otro gasto o capitalización.

La callable de autorización exige un custom claim privilegiado, una cuenta administrativa activa concedente y beneficiaria, impide autoasignación, limita vigencia a 90 días y registra concesión/revocación auditables. Rules bloquea escrituras directas. El proyecto no asigna ese claim a cuentas reales; la callable no concede permisos por sí sola a Administración ordinaria.

Las evidencias son referencias a registros de servidor. En Emulator solo se aceptan fixtures creados por herramientas administrativas de prueba. Fuera de Emulator el servidor necesita el bucket oficial configurado, confirma generación y metadatos, descarga el objeto y calcula SHA-256 real. No hay servicio/bucket de evidencias de producción configurado en esta fase, por lo que el reenvasado fuera de QA permanece bloqueado.

Las devoluciones de ventas y productos con disposición económica pendiente permanecen bloqueados para reenvasado. No se revierte COGS, no se crea activo económico nuevo y no se altera Resultado. No hay interfaz de reenvasado ni habilitación comercial real en esta fase.

## Estados y límites

Las acciones disponibles registran observaciones, inician revisión, solicitan información, autorizan el procedimiento futuro, declaran no recuperable o marcan la disposición económica pendiente. `resolved_specialized` no puede alcanzarse desde esta operación; requiere la transacción posterior. `resolveQuarantine`, liberación genérica, venta, despacho, modificación de costo y descarte siguen bloqueados para la mercadería derivada/inmovilizada.

# Auditoría forense: tocino de Ricardo, 17/10/2026

## Veredicto

**ERROR DEL SISTEMA CONFIRMADO, confianza alta.** Ricardo tiene tres ventas
confirmadas de 4 + 1 + 7 = **12 paquetes**. Los dos paquetes adicionales son una
venta de Administración que salió de central y conservó indebidamente el
`dispatchId` de Ricardo. El backend anterior sumó esa venta central al snapshot
del cierre. No hay evidencia de que Ricardo vendiera 14 ni de que falten dos
paquetes de tocino en su inventario.

La reapertura mencionada por la propietaria existe, pero pertenece a otro despacho,
de la jornada anterior. No es la causa de los dos paquetes identificados.

## Alcance y evidencia

- Producción consultada exclusivamente mediante GET autenticados de Firestore,
  metadatos de Cloud Functions y lectura de su archivo fuente desplegado.
- Lectura principal: 20/10/2026 11:03 Bolivia; consulta complementaria posterior.
- Main y origin/main al empezar: `0aa17deccfc4136b0284af4ddcd15c546188c683`.
- Android: 1.4.47 / 67. Árbol inicialmente limpio. Stash ajeno preservado.
- Ninguna escritura, reapertura, cierre, prueba ni despliegue en producción.
- Todos los horarios de este informe son de Bolivia, UTC−4.
- Snapshot completo bajo `tmp/tocino-audit/`, ignorado por Git; no se incorpora
  al repositorio porque contiene información ajena al incidente.

## A. Identificación

| Campo | Evidencia del cierre que presenta 15 / 14 / 3 |
|---|---|
| Jornada real | 17/10/2026 |
| Distribuidor registrado | Ricardo jimenes |
| RouteId | `route-sud` (Zona Sud) |
| DispatchId | `disp_675dc300-76b0-4e8d-a2d9-69af60e4a466` |
| ClosureId | `closure_disp_675dc300-76b0-4e8d-a2d9-69af60e4a466` |
| ProductId | `vac-tocino-ahumado-150` |
| Producto | Sachet Tocino ahumado, Sachet 150 g |
| Unidad | package (paquetes) |
| Precio de referencia | Bs 12,50 por paquete; una venta promocional usa Bs 11,43 |
| Lote | 040926 |
| LotId | `intake_5293128e-aca5-4470-b6e9-5b4790692a26__0` |
| Elaboración / vencimiento | 04/09/2026 / 04/11/2026 |
| Costo histórico por paquete | Bs 9,83, presente en las asignaciones |
| Despacho creado | 17/10/2026 08:08:50 |
| Recepción / createdAt del cierre | 17/10/2026 16:36:59 |
| Cierre final | 17/10/2026 16:47:32 |
| Estado despacho / cierre | closed / closed |
| Reapertura de este cierre | No existe evento ni operación de reapertura |

Las 15 unidades constan en la línea y asignación del mismo producto/lote.
No hay aumentos ni correcciones de tocino. Los dos aumentos del despacho son de
Viena, no de tocino. Otros productos llamados Tocino ahumado granel y tocino
prueba tienen otros IDs/unidades; no se mezclaron en esta suma.

## B. Ventas y movimientos concretos

En las cuatro ventas siguientes las cantidades original y efectiva coinciden; no tienen effectiveSnapshot,
anulación ni corrección. Las cuatro operaciones están confirmed. `operationId`
coincide con el ID de venta. No se encontraron operaciones rechazadas o queued
que incluyan este producto en la lectura efectuada.

| Hora 17/10 | Venta / operación | Cantidad | Origen registrado | Movimiento de tocino |
|---|---|---:|---|---|
| 08:38:49 | `sale_3b086ab7-5136-46ae-8a66-172d045fafcb` | 4 | Ricardo, route-sud | misma ID + `__0`: ruta −4, central 0 |
| 10:27:53 | `sale_19e8ca88-bfb2-4baa-8a80-17d2c9a94dcf` | 1 | Ricardo, route-sud | misma ID + `__0`: ruta −1, central 0 |
| 15:03:00 | `sale_0150d57a-6745-4e42-b8cb-e79ddd28fecf` | 7 | Ricardo, route-sud | misma ID + `__3`: ruta −7, central 0 |
| 09:07:29 | `sale_c28f1bb1-aefb-48ff-89fc-0dbcc277c3d0` | 2 | Administración, centralWarehouse | misma ID + `__1`: central −2, ruta 0 |

- Documentos comerciales de Ricardo: **12**.
- Reporte filtrado por Ricardo / Zona Sud / 17/10: **12**.
- Salidas reales por venta de su ruta: **12**.
- Consulta antigua únicamente por dispatchId: **14**, porque incluye la venta central.
- Total de esas cuatro ventas, incluyendo ambos orígenes: 14; no son 14 de Ricardo.
- Todas tienen dayKey 2026-10-17. La nota de la venta administrativa dice
  literalmente **“VENTA ING DANIEL 16-10-26”**, pero su timestamp y día registrado
  son el 17. La nota no permite reclasificar por sí sola fecha, caja u origen.

La venta de Administración contiene 2 tocinos (Bs 25), 1 chorizo criollo de 1 kg
(Bs 50), 0,5 kg de mortadela (Bs 22) y 0,5 kg de Viena (Bs 22,50): **Bs 119,50**
en efectivo. Sus asignaciones provienen de central. El payload ya contenía
sourceLocation centralWarehouse, routeId administracion y el dispatchId ajeno;
el backend de entonces conservó esa combinación incompatible.

## C. Primera divergencia y significado de CUADRA

Operación de recepción: `closure_d3369858-e279-4df9-905c-ccafa27537ba`.

| Fuente | Despachado | Vendido | Debía retornar | Recibido | Variación |
|---|---:|---:|---:|---:|---:|
| Payload enviado por la pantalla | 15 | **12** | 3 | 3 | 0 |
| Resultado de esa misma operación | 15 | **14** | 3 | 3 | 0 |
| distClosures.products guardado | 15 | **14** | 3 | 3 | 0 |

El backend anterior consultaba todas las distSales por dispatchId sin excluir
centralWarehouse ni exigir el origen correcto. Por eso sold = 4 + 1 + 7 + 2.
expectedReturn, en cambio, se obtuvo del balance real de ruta: **3**. Almacén
envió actualReturn = physicalReturn = **3**; no hay merma, no apto, faltante o
sobrante de tocino. variance = overage − shortage = **0**.

VarianceBadge recibe solamente variance. **CUADRADO verifica la recepción contra
el saldo físico de ruta, no una conciliación integral de despacho/ventas/orígenes.**
Por eso la incoherencia comercial pasó inadvertida. buildReconciliation en cliente
sí produce 15 − 12 = 3 con las ventas de Ricardo.

La operación monetaria `closure_cb88b678-7819-4d24-8c30-97ea894d6c61` conserva el
snapshot de productos anterior. Su payload también decía sold 12. No hay evidencia
de una actualización comercial posterior que haya creado esta diferencia.

Historial de cierres, PDF/hoja y ticket leen el sold persistido del cierre: pueden
seguir mostrando 14 aunque el reporte de ventas correctamente muestre 12. No se
aportó el archivo PDF original; se verificaron sus fuentes de datos en el código,
no un PDF histórico emitido ni la pantalla de un teléfono.

### Conciliación física

| Movimiento de la ruta | Paquetes |
|---|---:|
| Saldo anterior al despacho | 0 |
| `disp_675dc300-76b0-4e8d-a2d9-69af60e4a466__13` | +15 |
| Tres movimientos de venta identificados | −12 |
| Cortesías / ajustes / correcciones de tocino | 0 |
| Saldo antes de recepción | **3** |
| `closure_d3369858-e279-4df9-905c-ccafa27537ba__10` | −3 ruta / +3 central |
| Saldo de ruta tras el cierre | **0** |

Todos esos movimientos están activos, con asignaciones al lote 040926. El ledger
reconstruido no se vuelve negativo ni crea cantidades. No aparece una salida
adicional de 2 desde Ricardo. La venta administrativa tiene una salida separada
de 2 desde central, correctamente trazada como movimiento de inventario.

Como control actual (20/10, no saldo histórico), central tiene 153 paquetes tanto
en balance como en lotes y suma de centralDelta del ledger; Zona Sud tiene 12 en
balance, lotes y ledger. Son existencias de jornadas posteriores, no remanentes
que deban imputarse al cierre del 17.

### “Sin registro”

En este cierre no hay declaredReturns, declaredReturnMermas, returnDeclaredAt o
declaración equivalente de tocino en products. La recepción sí fue confirmada por
Almacén, responsable **DANIEL SEJAS**. El mecanismo permitía recepción sin
declaración digital previa. No hay reapertura de este cierre que la haya eliminado.
La evidencia disponible no permite reconstruir una declaración que nunca quedó
guardada; no se inventó ninguna. No causa los dos paquetes adicionales.

## D. Reapertura indicada en el audio

Es otro cierre: `closure_disp_7a913cf3-ea15-4a05-8089-ead84b8e06f0`, despacho
`disp_7a913cf3-ea15-4a05-8089-ead84b8e06f0`, creado el **16/10 a las 07:46:56**.
Su tocino fue **40 despachados / 40 vendidos / 0 retornados** antes y después.

1. 16/10 16:35:19: declaración digital (tocino 0).
2. 16/10 16:39:52: primera recepción.
3. 16/10 16:40:34: primer cierre.
4. 17/10 06:21:52: reapertura por Administración, operación
   `reopen_da1e76fd-6bba-48de-9eec-c50ada05b344`.
5. Motivo exacto: **“Incremento de cobro a sra Vanesa”**.
6. Se marcaron revertidos 18 movimientos anteriores de otros productos;
   **ninguno es de tocino**, porque no tenía retorno/faltante/sobrante de tocino.
7. 17/10 06:28:03: nueva recepción.
8. 17/10 06:31:08: nuevo cierre.
9. 17/10 08:08:50: se creó el despacho NUEVO de 15 tocinos del caso investigado.

**Influencia en los dos paquetes: NO**, según los documentos y movimientos.
Que la venta central tenga una nota con fecha 16 no la convierte en parte del
despacho anterior ni demuestra que la reapertura haya causado el cruce.

Hallazgo independiente de fechas: el snapshot anterior y el despacho conservan
dayKey 2026-10-16, pero la nueva recepción sobrescribió createdAt y dayKey del cierre
con 2026-10-17. Esto puede confundir la consulta por jornada; no modifica las
cantidades de tocino y no explica 12 frente a 14. No se modificó este documento
ni la regla de fechas en esta auditoría.

## E–F. Impacto y otros cierres

Stock físico: no se encontró descuadre de tocino atribuible a este incidente.
Stock virtual/ledger: concilia; error en la atribución comercial del snapshot.
Ventas: las tres de Ricardo y la venta central son registros distintos, no una
duplicación de movimientos de venta. No se autoriza concluir que la venta central
debió pertenecer a Ricardo o al día 16 solo por su nota.

Además de la venta de efectivo de Bs 119,50, una segunda venta administrativa,
`sale_5c42260c-bce0-483a-a5ab-dfc2f77d4346`, conserva el mismo dispatchId ajeno:
17/10 14:26:29, nota “VENTA EN PUERTA”, 1 chorizo criollo, **Bs 50 QR**. No contiene
tocino, pero contaminó el QR del cierre de Ricardo.

| Concepto | Cierre guardado | Documentos propios de Ricardo |
|---|---:|---:|
| Ventas efectivo | Bs 3.337,00 | **Bs 3.217,50** |
| Ventas QR | Bs 941,00 | **Bs 891,00** |
| Crédito generado | Bs 1.779,01 | Bs 1.779,01 |
| Cobros efectivo | Bs 132,50 | Bs 132,50 |
| Gastos efectivo | Bs 35,00 | Bs 35,00 |
| Claims | Bs 0 | Bs 0 |
| Efectivo esperado | Bs 3.434,50 | **Bs 3.315,00** |
| Efectivo declarado conservado | Bs 3.235,00 | Bs 3.235,00 |
| Declarado menos esperado | −Bs 199,50 | **−Bs 80,00** |

Las 36 ventas vinculadas por dispatchId incluyen 34 de la ruta y 2 de central.
No hay correcciones de estas ventas en distSaleCorrections. Los cobros de Bs 45 y
87,50 están en `col_06cebbe8-38bd-4eb2-83ac-29a34b6b7ec9` y
`col_96682e77-a68c-452c-9b80-45a87f324ac7`; los gastos de Bs 20 y 15, en
`expense_592d5d82-8643-4e4b-ac22-7eafd80cc1c1` y
`expense_d7d6dbaf-0936-45d0-83c9-5f6ea4f9c3ba`. Todos se verificaron dentro del
intervalo entre despacho y cierre, no usando movimientos de jornadas posteriores.

La diferencia analítica de Bs 80 es la que resulta de estos documentos y el
efectivo declarado. No prueba por sí sola una pérdida física de dinero ni quién
debe responder por ella. No se cambió ningún importe guardado.

En los 19 cierres leídos se encontraron otros dos despachos con ventas centrales
vinculadas y filas incompatibles: Luciano del 15/10,
`closure_disp_4fa44f65-744e-4d6a-8c77-2942e88cfa45`, y Hugo del 19/10,
`closure_disp_29d85492-ccf4-48be-b664-ea2348a6c588`. Requieren revisión propia antes
de atribuirles impactos; no se rectificó ninguno. No se usa la fórmula simple
cargado−vendido para declarar errores en filas con otros movimientos legítimos.

## G. Solución y pruebas

La causa está corregida para operaciones futuras por el commit **cc5d0e8** del
19/10: SellView no envía dispatchId de ruta para admin; el servidor lo elimina
para admin y excluye ventas centrales/otra ruta al consultar ventas del despacho.

Se verificó READ-ONLY el fuente de la Function ACTIVA processSanJoseOperation:
actualización 19/10/2026 17:41:19 Bolivia; contiene ambas protecciones.
SHA-256 de operations.cjs desplegado:
`6af84385f6813d66d9b62d00beb0810525c65385b58d033fb4cd44fe4d262cdd`.

No hace falta repetir ese fix ni desplegarlo de nuevo. Los snapshots históricos
siguen conservando lo que el sistema calculó entonces. Una eventual rectificación
debe mantener el original, autor, motivo y referencias de las dos ventas centrales;
rectificar únicamente la atribución/snapshot y sus derivados autorizados, sin
reabrir para mover stock, sin borrar ventas ni compensar dos paquetes. **Requiere
autorización separada de la propietaria.** También deberá verificarse la caja
administrativa de origen antes de cualquier rectificación financiera.

Control adicional propuesto, sin implementar en esta etapa: distinguir “recepción
cuadrada” de “conciliación integral verificada” y avisar de incompatibilidades entre
saldo de ruta y libro comercial. La conciliación debe incorporar saldo inicial,
aumentos, transferencias, devoluciones de clientes, cortesías y correcciones
auditadas. Un ajuste legítimo no debe bloquear indiscriminadamente un cierre;
cuando falte evidencia debe indicarse revisión pendiente, no ocultar la diferencia.

Prueba nueva: `firebase/tests/ricardoTocinoForensic.test.mjs`.
Ejecutar:

```powershell
firebase emulators:exec --project demo-pachax-audit --only firestore "node firebase/tests/ricardoTocinoForensic.test.mjs"
```

Diez escenarios PASS, mediante processCommand y Firestore Emulator:

1. Backend anterior, 15−12−3 = 0, snapshot coherente.
2. Causa real: venta central de 2 con dispatchId ajeno; payload sold12, resultado
   sold14/expected3/actual3/variance0. La salida adicional es central, no ruta.
3. Backend actual elimina dispatchId del admin y mantiene 12/3/3 y caja correcta.
4. Backend actual excluye también un documento legacy contaminado.
5. Revisión comercial 14→12 restaura stock y usa effectiveSnapshot.
6. Reapertura: marca el retorno anterior revertido, no lo duplica al recerrar y
   no mezcla las ventas anteriores con un despacho nuevo de la misma ruta.
7. Venta con dispatchId erróneo reproduce otra inconsistencia, no la causa real.
8. Distintos dayKey en un despacho no producen los dos paquetes de este caso.
9. Alteración comercial artificial sin stock reproduce la carencia de control
   integral, pero no se confundió con evidencia de producción.
10. Venta posterior a recepción bloqueada; cambio documental artificial posterior
    no reescribe el snapshot previo.

Además PASS: lint de la prueba, closure-regression (20), closure-audit y suites
frontend/backend de atribución de caja. Con los datos reales cargados en memoria,
reportSheets devolvió 7 + 1 + 4 = 12 en “Productos vendidos”; buildReconciliation
devolvió sold12/expected3; el snapshot histórico y VarianceBadge reprodujeron
sold14/expected3/CUADRADO. Sin cambios a código operativo, por lo que
no se construyó APK ni se alteró la OTA existente.

## H. Publicación

- Rama aislada: `codex/audit-ricardo-tocino-1710`.
- Contenido de la rama: este informe y reproducción forense; sin cambios runtime.
- Main/origin/main permanecen en `0aa17deccfc4136b0284af4ddcd15c546188c683`.
- Producción modificada: **NO**.
- Web/Android/Functions/Rules desplegadas en esta tarea: **NO**.

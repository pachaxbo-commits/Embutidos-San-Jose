# Rectificación autorizada del cierre de Ricardo del 17/10

Autorización: exclusivamente `closure_disp_675dc300-76b0-4e8d-a2d9-69af60e4a466`.
La auditoría anterior permanece en el commit cfa944d y en
`2026-10-20-ricardo-tocino.md`.

## Modelo

La operación `rectifyClosureAttribution` solo admite Administración activa. La
Function lee cierre, despacho y fuentes dentro de la transacción. Comprueba
estado closed, atribución central administrativa explícita, cantidades y valores
originales contra fuentes, cobros/gastos/claims del periodo histórico y dos
huellas SHA-256 obligatorias. No carga ni modifica stock.

Los campos originales de distClosures se conservan. Se añaden rectificationId y
rectification. El mismo registro versionado se guarda atómicamente en
distClosureRectifications, con original completo, conciliado completo, diferencias
por campo, IDs de fuentes, responsable, motivo, fecha y operationId.

La normalización presenta el conciliado; Historial permite alternar Original y
Conciliado. Reportes y PDF identifican RECTIFICADO y conservan la diferencia
original visible. Los documentos emitidos desde la vista Original se identifican
como ORIGINAL PRESERVADO. No se modifica distSales ni se traslada dinero de caja.

La misma operationId no vuelve a ejecutarse. Una segunda operación sobre el cierre
rectificado se rechaza. Tampoco se permite la reapertura automática de un cierre
rectificado: requiere revisión administrativa especializada para proteger el
snapshot y evitar movimientos de inventario innecesarios.

## Plan verificado READ-ONLY

| Campo | Original | Conciliado |
|---|---:|---:|
| Tocino vendido, paquetes | 14 | 12 |
| Viena granel 1 vendida, kg | 107,56 | 107,06 |
| Mortadela jamonada granel vendida, kg | 4,50 | 4,00 |
| Ventas efectivo, Bs | 3337,00 | 3217,50 |
| Ventas QR, Bs | 941,00 | 891,00 |
| Efectivo esperado, Bs | 3434,50 | 3315,00 |
| Diferencia, Bs | −199,50 | −80,00 |

Efectivo declarado: **3235,00, sin cambio**. Crédito: 1779,01, sin cambio.
Todo el resto de productos, cantidades físicas, faltantes, sobrantes y documentos
fuente queda intacto. Tocino: 15−12=3, retorno físico 3, faltante 0 y sobrante 0.

Original SHA-256:
`2200e270f83d35ba182a58fc1b086fd24468283a82101f6d8b72b421f239c613`.
Fuentes SHA-256:
`60339a9ad7d7ee1d8e117f5b2b2760fc119a3ac1ad9ea3c9bba81db6ac8a7bd2`.

## Ejecución controlada

`node scripts/rectify-ricardo-closure.cjs` solo lee y guarda un respaldo local
ignorado por Git. El modo `--execute`, autorizado expresamente por la propietaria,
crea exclusivamente la operación fija
`rectify-ricardo-20261017-attribution-v1`. Usa la cuenta propietaria autenticada de
Firebase CLI y la membresía administrativa activa de Administración San José;
no usa credenciales estáticas ni edita manualmente el cierre.

Antes de escribir exige las huellas anteriores, updateTime original exacto, cierre
closed, ausencia de operación/rectificación previa y resultado autorizado exacto.
La Function valida de nuevo atómicamente antes de aplicar el registro auditado.

Tras confirmación vuelve a leer el cierre y auditoría y compara los originales,
ventas, cobros, gastos, lotes, balances, movimientos, despachos y otros cierres.
El respaldo, plan y evidencia de ejecución quedan en
`output/audits/ricardo-rectification/`. Si detecta cambios concurrentes, los informa
y no afirma conservación sin revisar. No se reintenta una operación incierta.

## Pruebas

- Firestore Emulator con Security Rules: admin permitido; almacén, distribuidor,
  support, inactivo, anónimo y otro tenant bloqueados. Auditoría no admite
  escrituras directas, tampoco de admin.
- Backend también rechaza otro rol si se omiten Rules.
- Rectificación correcta, original íntegro, caja −80, doble ejecución protegida,
  precondiciones obsoletas rechazadas, stock/fuentes/otro cierre intactos.
- React real: Historial, badge, motivo, botones Original/Conciliado, 14/12 y
  etiquetas de documentos. Exportación respeta conciliado y original auditado.
- Regresiones de cierre, historial, reaperturas, reportes, distribución y
  documentos Android; typecheck, lint focalizado y build.

La versión prevista es 1.4.48 / 68. La ejecución histórica y su verificación se
informan separadamente del despliegue; publicar código no equivale a rectificar
el cierre.

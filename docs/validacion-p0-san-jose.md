# Validacion P0 — Demo Embutidos San Jose

Resultado de la fase de validacion y endurecimiento. Todo se ejecuto contra el
**emulador de Firebase**; no se toco produccion ni se desplegaron reglas.

## 1. Auditoria del offline

Estrategia de escritura de cada operacion critica:

| Operacion | API usada | Funciona sin conexion |
| --- | --- | --- |
| Venta de ruta | `writeBatch` + `batch.set` (+ `increment` en saldos) | Si |
| Venta a credito | mismo lote que la venta | Si |
| Creacion del receivable | `batch.set` dentro del lote de la venta | Si |
| Cobro | `writeBatch`: `set` del cobro + `set(merge)` del saldo | Si |
| Gasto | `writeBatch` + `set` | Si |
| Stock de ruta | `set(merge)` con `increment()` en el mismo lote | Si |
| Ledger `distStockMovements` | `set` con id determinista en el mismo lote | Si |
| Despacho y aumento de carga | `writeBatch` + `set` | Si |
| Retorno y cierre | `writeBatch` + `set(merge)` | Si |

**No se usa `runTransaction` en ningun punto del modulo de distribucion.** Las
transacciones requieren conectividad, por eso el modulo se apoya solo en lotes
e incrementos, que Firestore aplica al cache local y reenvia al reconectar.
`batch.commit()` no se espera: la interfaz avanza con el cache local.

> Nota sobre el comandero de restaurantes: ese modulo si usa `runTransaction`
> para el correlativo diario de pedidos, por lo que no puede crear pedidos sin
> conexion. Es comportamiento preexistente y no se modifico.

Idempotencia (verificada en el escenario E2E):

- cada operacion lleva un `operationId` que ademas es el id del documento;
- las lineas de ledger derivan ese id (`<operationId>__line0`), asi que un
  reenvio sobrescribe el mismo documento en vez de crear otro;
- un registro local de operaciones aplicadas evita repetir los `increment()`;
- el boton de confirmar se bloquea mientras se registra la venta.

**Limitacion documentada:** se asume **un dispositivo por distribuidor**. Los
saldos se mantienen con `increment()`, que es conmutativo, pero dos dispositivos
vendiendo el mismo stock de ruta a la vez podrian dejarlo en negativo, porque la
validacion de stock ocurre contra el cache local. Resolver eso exige validacion
en servidor (Cloud Function o transaccion), fuera del alcance de la demo.

## 2. Reglas en el emulador

`npm run test:rules` — **56 pruebas, 56 en verde**, positivas y negativas:

- ADMIN: catalogo, precios, ventas de cualquier ruta, venta directa, ledger.
- ALMACEN: despachos, movimientos, saldos, listado de personal. No puede
  registrar ventas de ruta ni editar precios.
- DISTRIBUIDOR: lee y escribe solo su ruta; crea venta, credito, cobro, gasto y
  cliente; cierra solo el estado de SU despacho. No lee otra ruta, no lista el
  ledger, no administra usuarios, no edita precios.
- Aislamiento entre empresas en ambos sentidos, incluida la suplantacion de
  `restaurantId` en el cuerpo del documento.
- Inmutabilidad: ventas, cobros, gastos y ledger no se editan ni se borran; la
  cuenta por cobrar solo admite mover saldo y estado.
- Perfil del tenant y mapa `users/{uid}`.

## 3. Escenario E2E ejecutado

Ejecutado en la interfaz real contra el emulador, con verificacion directa en
Firestore (`npm run inspect:demo`).

- Despacho Viena 20 kg + Chorizo 10 kg y aumento Viena +5 kg: central 100→75,
  ruta 25 y 10, ledger con `dispatch` y `dispatch_addition`, sin duplicados.
- Sin conexion (red de Firestore cortada + evento `offline`): venta Bs 288
  efectivo, venta Bs 159 a credito con cliente, cobro Bs 100 y gasto Bs 20.
  La interfaz respondio con el indicador "SIN CONEXION · N PENDIENTES".
- Recarga de la aplicacion sin conexion: los datos siguen ahi (venta del dia
  Bs 447, efectivo esperado Bs 368, credito Bs 159, cartera Bs 309, stock de
  ruta 19 y 7 kg).
- Al reconectar: exactamente 2 ventas, 1 credito nuevo, 1 cobro, 1 gasto y 9
  movimientos de ledger. Dos ciclos mas de perdida y recuperacion de conexion
  no insertaron nada nuevo.
- Triple toque sobre "Confirmar": una sola venta y un solo descuento de stock.
- Retorno 18.5 y 7 kg: Viena FALTANTE 0.5 kg, Chorizo CUADRADO. Central subio
  a 93.5 y 57 (solo lo fisicamente retornado); la ruta quedo en cero y el
  faltante ajusto unicamente la ruta.
- Caja: esperado Bs 368, declarado Bs 365, FALTANTE Bs 3. Despacho cerrado.
- Panel: Ventas Bs 447, efectivo Bs 288, credito Bs 159, cobrado Bs 100,
  9 kg, cartera Bs 309, gastos Bs 20, faltante Viena 0.5 kg, faltante de caja
  Bs 3. Los Bs 100 de cobranza no aumentan los Bs 447 de ventas.

## 4. Impresion Bluetooth

Auditoria de lo que existia (integracion previa):

| Pieza | Estado encontrado |
| --- | --- |
| `AndroidBluetoothSppAdapter` (Bluetooth clasico SPP sobre `cordova-plugin-bluetooth-serial`) | Completo: emparejados, conexion con timeout, envio por bloques, desconexion |
| `AndroidNetworkTcpPrinterAdapter` (LAN 9100) | Completo |
| Plantilla ESC/POS de recibo y cola de trabajos | Completas |
| Permisos Android 12+ (`PachaxBluetoothPermissionsPlugin`) | Completo; manifiesto declara BLUETOOTH_CONNECT y BLUETOOTH_SCAN |
| **Registro de los adaptadores en el motor** | **Faltaba** |
| **Persistencia de los perfiles de impresora** | **Faltaba** |

Consecuencia del hueco: `submitPrintRequest` caia siempre en el adaptador de
diagnostico y **devolvia exito sin imprimir nada**, y los perfiles configurados
se perdian al recargar la aplicacion.

Correcciones hechas (sin crear un motor nuevo):

- `printerBootstrap.ts` registra los adaptadores reales al arrancar y recupera
  los perfiles guardados;
- la pantalla de impresoras ahora persiste los perfiles;
- el ticket del distribuidor comprueba permisos Bluetooth, informa el resultado
  real y permite reintentar. Un fallo de impresion **no revierte ni duplica la
  venta**.

**Estado: integracion Bluetooth implementada / NO validada con hardware
fisico.** No hay impresora ni telefono disponibles en este entorno.

## 5. Limitaciones conocidas

1. **Sin prueba en Android real.** El APK compila (`app-debug.apk`) y los
   permisos estan declarados, pero no se instalo en un telefono: quedan sin
   verificar teclado, safe areas reales, boton fisico atras y modo avion del
   sistema operativo.
2. **Sin impresion fisica.** Ver arriba.
3. **Un dispositivo por distribuidor** para el stock de ruta.
4. **Preexistente, no introducido aqui:** crear un pedido en el comandero de
   restaurantes falla contra el emulador con
   `maximum of 1000 expressions to evaluate` en las reglas de `days/orders`.
   Se comprobo cargando las reglas de `main` en el emulador: **falla igual**.
   La regla `isValidOrderCreate` es demasiado costosa y conviene simplificarla,
   pero queda fuera del alcance de esta demo.

## 6. Comandos de validacion

```bash
npm run emulators
```

```bash
npm run seed:demo
```

```bash
npm run test:rules
```

```bash
npm run inspect:demo
```

`npm run seed:restaurant` siembra ademas un tenant sin `businessType` para
comprobar que la experiencia de restaurante no cambio.

# Demo Embutidos San Jose (businessType: mobile_distribution)

Guia operativa para preparar y ejecutar la demo. Todo lo que aparece aqui usa
datos reales de Firestore: no hay pantallas simuladas.

## 1. Activar el tipo de empresa en el tenant

1. Inicia sesion con el usuario administrador de la empresa.
2. Abre **Personalizar** (icono de configuracion del comandero).
3. En **Tipo de empresa** elige `Distribucion movil (rutas y distribuidores)` y
   pulsa *Aplicar tipo de empresa y recargar*.

Esto escribe `businessType`, `currencyCode` (BOB), `currencySymbol` (Bs) y el
tema claro rojo/amarillo en `restaurants/{id}`. Los tenants de restaurantes que
no tocan este campo siguen viendo exactamente el comandero de siempre.

## 2. Catalogo y rutas iniciales

En **Productos**, si el catalogo esta vacio aparece *Cargar catalogo y rutas
iniciales*: siembra los 22 SKU (16 al vacio + 6 a granel) y las rutas
`Zona Norte`, `Zona Sud`, `Sacaba` y `Venta directa / Impulsacion`.

Los precios sembrados son referenciales y se editan desde la misma pantalla.
La impulsacion no es un rol nuevo: es una ruta de tipo `direct`.

## 3. Usuarios internos

En **Usuarios** el administrador crea al personal con nombre, correo,
contrasena inicial, rol y ruta. La cuenta se crea en una instancia secundaria
de Firebase Auth (mecanismo que ya existia en PACHAX Flow), por lo que **la
sesion del administrador no se cierra** y no hay contrasenas en el codigo.

| Rol | Alcance |
| --- | --- |
| `admin` | Toda la empresa: panel, inventario, despachos, ventas, creditos, cobros, clientes, gastos, cierres, reportes, usuarios, precios y venta directa desde almacen |
| `warehouse` | Inventario central, despachos, aumentos, retornos, conciliacion fisica y cierre de la parte de almacen |
| `distributor` | Solo su ruta: Inicio, Vender, Creditos, Gastos y Cierre |

Sugeridos para la demo: Hugo Herbas (Zona Norte), Ricardo Jimenez (Zona Sud),
Lucio Marcani (Sacaba).

## 4. Escenario end-to-end de aceptacion

### A. Administracion
Abrir **Inicio**: KPIs del dia, tarjeta por distribuidor y conciliacion de producto.

### B. Almacen
1. **Inventario > Ingreso**: cargar stock central de `Salchicha tipo Viena`
   (granel) y `Chorizo parrillero crudo` (granel).
2. **Despachos > Nuevo**: ruta Zona Norte, distribuidor Hugo,
   Viena 20 kg y Chorizo 10 kg.
3. **Despachos > Aumentar**: Viena +5 kg.
   El despacho muestra `Carga inicial 20 · Aumentos 5 · Total 25`.

### C. Distribuidor (sin conexion)
Entrar como Hugo y activar el modo avion. La barra superior muestra
`SIN CONEXION · N PENDIENTES`.

1. Venta 1: Viena 6 kg a Bs 48 → **Bs 288**, efectivo.
2. Venta 2: Chorizo 3 kg a Bs 53 → **Bs 159**, credito con cliente demo.
3. Cobro de un credito anterior: **Bs 100** en efectivo.
4. Gasto: Gasolina **Bs 20**.

El stock de ruta baja al instante y la app sigue operando.

### D. Reconexion
Al volver la conexion el indicador pasa a `SINCRONIZANDO` y luego a
`SINCRONIZADO`. No se duplica nada: cada operacion lleva un `operationId`
estable que ademas es el id del documento.

### E. Retorno (almacen)
En **Cierre**, con Viena esperado 19 kg y Chorizo esperado 7 kg, registrar
retornado 18.5 y 7 → `FALTANTE 0.5 kg` en Viena, `CUADRADO` en Chorizo.
*Guardar retorno de almacen* devuelve al central solo lo fisicamente retornado.

### F. Caja
Efectivo esperado = 288 + 100 − 20 = **Bs 368**. Declarar Bs 365 →
`FALTANTE Bs 3`. *Cerrar ruta* guarda el arqueo y cierra el despacho.

### G. Panel
Ventas Bs 447 · efectivo Bs 288 · credito Bs 159 · cobrado Bs 100 ·
9 kg vendidos · faltante 0.5 kg de Viena · faltante de caja Bs 3.
El credito de Bs 159 queda en la cuenta del cliente.

Estas cifras estan cubiertas por la suite del motor de dominio:

```bash
npm run test:distribution
```

## 5. Reglas de negocio implementadas

- El almacen central nunca se descuenta dos veces: el despacho descuenta
  central y carga ruta; la venta de ruta solo descuenta ruta; el retorno
  devuelve a central solo lo retornado y el faltante ajusta unicamente la ruta.
- Ledger auditable en `distStockMovements` (ingreso, despacho, aumento, venta,
  retorno, ajuste, faltante, sobrante).
- El precio de venta queda congelado en la linea; el del catalogo es referencia.
- Los reportes no convierten paquetes ni sachets a kilos.
- Un cobro reduce el saldo del cliente y entra al arqueo, pero no suma a ventas.
- No se puede cobrar mas que el saldo pendiente ni dejar stock negativo.
- Una ruta sin despacho abierto no acepta ventas; una ruta cerrada se reabre
  solo desde administracion.

## 6. Desarrollo

`preview.html` (solo en `npm run dev`) monta el modulo de distribucion con un
selector de rol para revisar pantallas sin credenciales. No forma parte del
build de produccion.

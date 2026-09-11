# Embutidos San José — actualización funcional 1.2.0

Estado: versión 1.2.0 compilada y funciones, reglas e índices publicados en Firebase con la cuenta propietaria. La confirmación de operaciones fue comprobada en producción con los tres clientes existentes, sin crear ventas ni movimientos de stock.

## Funciones integradas

- Identidad exclusiva de Embutidos San José en acceso, navegación y nombre Android. Solo admite miembros activos de San José con rol Administración, Almacén o Distribuidor.
- CI obligatorio como código del cliente, control de duplicados, fotografía opcional comprimida, teléfono, dirección y referencia. Los registros antiguos conservan sus identificadores y deudas; se completa su CI al editarlos, sin inventar documentos de identidad.
- Ingresos con lote, elaboración, vencimiento, cantidad, responsable y hora. Stock físico separado del stock apto para vender. Se prioriza el vencimiento más próximo (FEFO).
- Existencia mínima configurable, avisos desde 14 días antes del vencimiento y visualización de vencidos. Los lotes vencidos o devueltos en cuarentena no se venden ni transfieren como mercadería apta.
- Historial de movimientos y de transferencias. Selección de productos disponibles, cantidad y unidad visibles. Administración puede dar de baja stock de un almacén y lote, con motivo.
- Almacenes internos con stock y usuarios propios; reciben transferencias y despachan a vendedores. Los retornos vuelven al almacén de origen conservando los lotes. Las diferencias quedan registradas.
- Precios protegidos: el vendedor utiliza el precio vigente; solo Administración puede modificarlo. El servidor vuelve a validarlo. No se cambia la unidad de un producto existente para conservar la coherencia histórica.
- Bloqueo de ventas a clientes con créditos pendientes de siete días o más, incluso si solicitan comprar al contado. Validación de todas sus deudas en el servidor, además del aviso en la app.
- Créditos y cobros con productos asociados y filtros de fecha/mes. QR separado del efectivo del arqueo y confirmación bancaria manual; incluye cobros de diferencias por cambios.
- Cambios y devoluciones con venta original, producto, cantidad, motivo y reemplazo. No se puede devolver más de lo vendido. La compensación primero reduce la deuda original y luego registra el reembolso; el importe original se conserva. Los productos recibidos quedan separados del stock vendible.
- Costo de producción configurable y costo histórico de los lotes consumidos en cada venta. Reportes de ventas netas, costos, margen, gastos, pérdidas y resultado. Las operaciones antiguas sin costo se identifican y no se presenta una ganancia falsa.
- Excel de 11 hojas con importes numéricos y encabezados inmovilizados. Reportes PDF y estados de cuenta por cliente con membrete y saldo total. En Android se pueden guardar/compartir con las aplicaciones disponibles y abrir el PDF para imprimir.
- Cola persistente de operaciones: ventas, cobros y gastos sin conexión quedan pendientes de validación; el servidor confirma una sola vez. Los cobros pendientes se muestran provisionalmente. Las operaciones rechazadas indican el motivo. Los comprobantes de venta definitivos esperan confirmación.
- Cierre y reapertura administrativos validados en servidor. Escrituras directas de stock, ventas, cobros y cierre financiero bloqueadas en las nuevas reglas. Validación transaccional de concurrencia para evitar stock negativo.
- Correcciones del encabezado y adaptación móvil mantenidas. La revisión visual completa todavía no ha comenzado.

## Separación y propiedad

La base se preservó antes de especializar el proyecto en G:/pachax-plataforma-base, con historial Git independiente, 229 archivos verificados y sin copiar los archivos .env. Esa copia usa un identificador Firebase de demostración para no operar sobre producción.

San José continúa en G:/pachax-comandero. Se conserva com.pachax.flow como identificador Android para permitir actualizar la instalación existente; el nombre visible es Embutidos San José. Cambiar ese identificador crearía una aplicación distinta.

La separación del código y de la interfaz ya está hecha. En la entrega contractual se debe completar el control de Firebase y demás servicios mediante cuentas del cliente, documentación, rotación de credenciales y retiro de accesos de PACHAX. No se ha revocado acceso durante el desarrollo ni se afirma que ese traspaso esté concluido.

El PDF contractual revisado v1.4 está en D:/OneDrive/Escritorio/PACHAX PROYECTOS/SAN JOSE. Conserva los términos solicitados: Bs 11.500 en dos pagos de Bs 5.750, plazo de 60 días, observaciones de 30 días, mes adicional de prueba, garantía de 60 días, confidencialidad, propiedad y entrega técnica, devolución del anticipo por falta de entrega y firmas corregidas.

## Verificación realizada

- TypeScript y compilación Vite aprobados.
- 55 pruebas de cálculo del dominio aprobadas.
- 24 comprobaciones de operaciones y reglas nuevas aprobadas mediante emuladores reales de Auth, Firestore y Functions. Incluyen precios, crédito vencido, concurrencia, idempotencia, lotes, cambios/devoluciones, retorno, cierre, reapertura, CI y rechazo de modificaciones no autorizadas.
- Flujo integrado aprobado con Administración, usuario de almacén interno y Distribuidor: despacho, carga adicional, venta, crédito, cobros, QR, desconexión/recarga/reconexión, declaración de retorno, recepción y cierre. Cinco tamaños de pantalla.
- 6 comprobaciones de exclusividad aprobadas.
- 7 módulos revisados en pantalla de 360 px sin errores de JavaScript ni desbordamiento horizontal.
- Descarga de Excel, PDF y estado de cuenta comprobada; revisión visual de páginas PDF y verificación de 11 hojas Excel, tipos numéricos y encabezados fijos.
- Auditoría npm de app y servidor sin vulnerabilidades reportadas tras actualizar dependencias.
- Compilación Android debug y firma verificadas. Versión 1.2.0, código 3; compatible con la firma anterior.

Las pruebas son locales y automatizadas. Falta comprobar impresión real y guardado/compartición en el teléfono de la cliente. La confirmación técnica de operaciones ya se comprobó en producción. No se presenta la prueba de software como comprobación de una impresora física.

## Activación productiva

La cuenta colaboradora gfabrigtrf@gmail.com no tenía permiso para modificar IAM. Se autorizó Firebase CLI con la cuenta propietaria pachax.bo@gmail.com y se publicaron las tres funciones: processSanJoseOperation, refreshSanJoseCredit e initializeSanJoseCredit.

Google necesitó unos minutos para propagar los permisos iniciales de Eventarc. Tras esa activación se confirmaron tres operaciones de consulta y actualización del resumen de crédito de clientes existentes. Una comprobación técnica enviada durante la propagación quedó cerrada como sustituida; no se crearon ventas, clientes, deudas ni movimientos de stock de prueba en producción.

Las reglas publicadas se compararon con el archivo local verificado y coinciden exactamente. Una lectura de clientes sin iniciar sesión fue rechazada con 403. Hay copia de las reglas anteriores en firebase/backup/firestore.rules.before-server-operations.

La validación de operaciones ahora usa Cloud Functions, además de Firestore. El servicio mensual debe considerar el consumo real de estos servicios de Firebase; no se fija un importe que ignore ese uso.

Evidencias: docs/qa-san-jose/production-activation.json y production-rules.json. Las pruebas comerciales completas y de los tres perfiles se realizaron en emuladores; la comprobación productiva se limitó a operaciones derivadas sin cambiar existencias ni deuda.

Para instalar, primero sincronizar la versión anterior y luego instalar el APK encima, sin borrar sus datos. Todos los usuarios deben actualizar: las reglas nuevas requieren el procesamiento seguro de la versión 1.2.0.

## Solicitud nueva: merma

Se añadió PX-18 al PDF v1.4, manteniendo el formato y el subrayado negro. Distingue la pérdida física del peso entregado que no se cobra; contempla trazabilidad de producto/lote, cantidades, responsable y costos sin duplicar descuentos. También se actualizó el documento para indicar CI como código único del cliente.

La merma por redondeo todavía no está implementada ni activada en el APK 1.2.0. Antes de modificar ventas se necesita confirmar: si el peso completo se entrega y descuenta del inventario, límite máximo de peso que no se cobra, regla exacta de redondeo, productos aplicables y perfil autorizado. No se ha supuesto que 5,100 kg o 5,400 kg puedan cobrarse automáticamente como 5 kg.

## Siguiente etapa

La propietaria debe definir la regla exacta antes de programarla. Por indicación posterior del responsable del proyecto, el rediseño responsive puede completarse mientras la merma queda pendiente, sin inventar un redondeo que altere inventario, cobro o ganancia.

## Rediseño responsive completado

Se optimizó la interfaz de Embutidos San José para teléfono y tablet. El catálogo y la venta presentan dos productos por fila en teléfono, permiten fotografía opcional y muestran existencia y unidad sin cargar las tarjetas con medidas comerciales. La presentación completa sigue disponible al indicar la cantidad.

Los selectores extensos de productos, almacenes, rutas, distribuidores, clientes, ventas, lotes y vendedores se sustituyeron por paneles propios con búsqueda y tarjetas. Despachos permite seleccionar varios productos y escribir la cantidad de cada uno dentro del mismo panel. Almacenes muestra existencias compactas y transferencias legibles. Cambios y devoluciones guía el proceso desde el cliente hasta la solución y muestra un resumen antes de confirmar.

El encabezado muestra la marca SJ, nombre de empresa y usuario sin recortes, con un indicador compacto de sincronización. La configuración de impresora Bluetooth ofrece búsqueda de equipos vinculados, prueba, guardado y estados visuales de conexión. Se conserva el perfil compatible con la impresora probada en BURGUERLAB: ESC/POS, CP850, 80 mm recomendado y corte parcial.

Validación: 55 pruebas de dominio, 24 de reglas/operaciones Firebase, 44 de impresión, exclusividad, exportaciones y flujo integral de los tres roles aprobados. Las capturas de control están en `docs/qa-san-jose`. El APK actualizado está en `D:\OneDrive\Escritorio\Embutidos-San-Jose-1.2.0.apk`.

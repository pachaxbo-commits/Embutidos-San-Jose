# Rediseño responsive - Embutidos San José

Documento de continuidad para conservar el alcance, las decisiones y el avance entre sesiones.

## Reglas aceptadas

- [x] Diseñar primero para teléfono Android y adaptar también a tablet.
- [x] Mantener las funciones y reglas de negocio existentes.
- [x] Sustituir selectores nativos extensos por paneles propios con búsqueda y selección clara.
- [x] Evitar textos truncados, palabras partidas, controles gigantes y desbordamientos.
- [x] Mantener navegación, permisos por rol y funcionamiento sin conexión.
- [x] Verificar cada bloque con typecheck, compilación y pruebas de regresión.
- [ ] Merma: pendiente de definición de la propietaria; no implementar reglas todavía.
- [x] Logo oficial recibido e integrado en app, tickets e identidad Android.

## Criterios visuales comunes

- [x] Encabezado compacto: nombre completo legible, rol y ubicación sin truncamientos innecesarios.
- [x] Estado de sincronización compacto mediante un escudo centrado, con estado accesible al tocarlo.
- [x] Títulos y acciones proporcionados en teléfono y tablet.
- [x] Modales con altura segura, encabezado fijo, contenido desplazable y acción final visible.
- [x] Selectores propios con búsqueda, tarjetas, estado seleccionado y cierre claro.
- [x] Textos con corte por palabras completas (`overflow-wrap` y saltos controlados).
- [x] Revisión en 360x800, 412x915 y tablet 768x1024.

## Fases

### 1. Base responsive compartida

- [x] Encabezado de empresa y usuario.
- [x] Indicador compacto de sincronización.
- [x] Navegación inferior sin etiquetas cortadas.
- [x] Pantallas, tarjetas, botones, formularios y modales compartidos.

### 2. Catálogo y venta

- [x] Productos en dos columnas en teléfono y cuadrícula adaptable en tablet.
- [x] Nombre completo, con palabras completas y alineación estable.
- [x] Mostrar existencia y unidad en la tarjeta, junto al precio operativo.
- [x] Foto opcional por producto; diseño consistente cuando no existe foto.
- [x] Alta y edición de producto con foto opcional.
- [x] Modal de cantidad con unidad, existencia y precio claramente ordenados.
- [x] Carrito y confirmación de venta responsive.

### 3. Despachos

- [x] Reemplazar selector nativo de productos por catálogo visual multiselección.
- [x] Permitir capturar cantidad por cada producto dentro del panel.
- [x] Mostrar solo stock disponible, unidad y disponibilidad.
- [x] Simplificar creación, aumentos y tarjetas del historial de despachos.

### 4. Almacenes y transferencias

- [x] Resumir cada almacén con indicadores útiles.
- [x] Presentar existencias en filas compactas y legibles.
- [x] Selector visual de productos y cantidades para transferencias.

### 5. Cambios y devoluciones

- [x] Flujo guiado: cliente -> venta por fecha -> producto vendido -> resolución.
- [x] Sustituir selectores nativos por paneles buscables y tarjetas.
- [x] Reducir campos visibles según el tipo de reclamo.
- [x] Mostrar resumen antes de confirmar.

### 6. Impresoras

- [x] Configuración guiada para Bluetooth genérico ESC/POS.
- [x] Buscar equipos vinculados, seleccionar, probar y guardar.
- [x] Estados visuales de buscando, conectado, correcto y error.
- [x] Mantener perfil 80 mm, CP850 y corte parcial compatible con BURGUERLAB.
- [x] Reimpresión desde historial.
- [x] Logo oficial monocromo en el ticket mediante imagen raster ESC/POS.

### 7. Auditoría completa

- [x] Revisar todos los módulos visibles por Administración.
- [x] Revisar perfiles Almacén y Distribuidor.
- [x] Comprobar ausencia de desbordamientos y selectores nativos con listas largas.
- [x] Ejecutar pruebas funcionales, Firebase, impresión y compilación Android.
- [x] Generar APK actualizado en el escritorio.
- [x] Preparar resumen final y lista de revisión manual para el cliente.

## Validación final del rediseño

## Fase 8 - Ajustes posteriores a revisión de cliente

- [x] Historial de ingresos de stock por producto, con fecha, hora, rol y usuario.
- [x] Ocultar identificadores técnicos en transferencias, movimientos y vistas operativas.
- [x] Usuarios agrupados por rol y desplegables; datos de cada usuario en segundo nivel.
- [x] Ruta solo para distribuidores y almacén solo para responsables de almacén.
- [x] Cambio directo de contraseña por Administración.
- [x] Almacenes y transferencias recientes desplegables.
- [x] Confirmación QR compacta mediante icono de verificación.
- [x] Medio de pago visible únicamente en devoluciones de dinero.
- [x] Eliminación segura de productos y gastos, con confirmación y trazabilidad.
- [x] Clientes ordenables por antigüedad.
- [x] Créditos con pendientes primero y pagos desplegables.
- [x] Logo oficial en acceso, cabecera, icono, pantalla de inicio y ticket térmico.
- [x] Verificación visual en móvil y tablet, pruebas y APK actualizado.

## Validación anterior

- 360 × 800, 412 × 915 y 768 × 1024: sin desbordamiento horizontal.
- 55 pruebas del dominio aprobadas.
- 24 comprobaciones de operaciones y reglas de Firebase aprobadas en emuladores.
- Reglas publicadas comparadas con el archivo local: idénticas; las tres funciones de San José están activas.
- 44 pruebas del motor y adaptadores de impresión aprobadas.
- Prueba integral aprobada con Administración, Almacén y Distribuidor, incluida operación sin conexión, QR, crédito y retorno.
- Siete módulos principales recorridos sin errores de pantalla ni desbordamiento.
- Excel, PDF general y estado de cuenta PDF generados correctamente.
- APK Android 1.2.0 compilado y copiado al Escritorio.

## Validación de la fase 8

- 360 × 800 y 768 × 1024: sin desbordamiento horizontal en los módulos actualizados; acceso revisado en tablet.
- 55 pruebas del dominio aprobadas.
- 30 comprobaciones de operaciones, permisos y Firebase Auth aprobadas en emuladores.
- Reglas y cuatro funciones de San José publicadas; la función de contraseña exige sesión válida.
- 45 pruebas del motor y adaptadores de impresión aprobadas, incluido logo monocromo ESC/POS.
- APK Android 1.2.1 compilado y copiado al Escritorio.

## Fase 9 - Roles, cierres e historial general

- [x] Inicio de Almacén limitado a alertas, productos y conciliación física.
- [x] Retirar Clientes e Impresoras de la navegación de Almacén.
- [x] Cierres desplegables con entregado, vendido, retorno esperado, devolución y diferencia.
- [x] Detalle financiero de cierres únicamente para Administración.
- [x] Ventas, gastos, cobros realizados y cierres privados por distribuidor.
- [x] Cartera de créditos global y compartida entre Administración y todos los distribuidores.
- [x] Cobro de una deuda permitido aunque la venta original pertenezca a otra ruta.
- [x] Fotos de producto sincronizadas entre dispositivos, con validación y decodificación compatible para Android WebView.
- [x] Explicación visible del orden: declaración, confirmación de Almacén y cierre final.
- [x] Estados de cierre traducidos a lenguaje operativo.
- [x] Opción activa resaltada dentro del menú Más.
- [x] Historial general de inventario por fechas, responsive y descargable en PDF.
- [ ] Simulacro integral separado: se ejecutará después de que el cliente pruebe esta actualización y autorice comenzar.

## Validación de la fase 9

- 360 × 800: Inicio de Almacén, menú Más, historial general, Créditos y Cierre sin desbordamiento horizontal.
- 768 × 1024: Inicio y catálogo de Distribuidor aprovechan el espacio de tablet sin miniaturizar la interfaz.
- Cartera global comprobada con una deuda creada en una ruta distinta a la del distribuidor conectado.
- Fotografía de producto recuperada desde Firestore en otro contexto de pantalla; imagen válida visible y archivo dañado oculto sin romper la tarjeta.
- 55 pruebas del dominio y 35 comprobaciones de operaciones, reglas y Firebase Auth aprobadas en emuladores.
- Reglas, índices y cuatro funciones de San José publicados; funciones verificadas en estado activo.
- APK Android 1.2.2, código 5, compilado y copiado al Escritorio.

## Fase 10 - Simulacro integral autorizado

- [x] Preparar Firebase Emulator y una semilla limpia sin datos de producción.
- [x] Administración: recorrer todas las secciones, acciones y permisos.
- [x] Almacén central e interno: recorrer todas las secciones, acciones y límites de acceso.
- [x] Distribuidor Zona Norte: recorrer todas las secciones, operación y cierre propios.
- [x] Distribuidor Zona Sud: comprobar independencia operativa y cartera global.
- [x] Productos, fotos, lotes, vencimientos, stock mínimo e historial.
- [x] Transferencias, despachos, aumentos, ventas, QR, créditos, cobros, gastos y reclamos.
- [x] Devolución declarada, confirmación física, cierre final y reapertura administrativa.
- [x] Reportes Excel/PDF, estado de cuenta e impresión ESC/POS.
- [x] Trabajo sin conexión, reintentos e idempotencia.
- [x] Reglas de Firebase, aislamiento por usuario y rechazo de operaciones no autorizadas.
- [x] Revisión visual en celular vertical, celular horizontal y tablet.
- [x] Corregir hallazgos y repetir todas las pruebas afectadas.
- [x] Publicar la corrección y generar el APK final del simulacro.

## Fase 11 · Soporte técnico y entrega limpia

- [x] Crear el rol Soporte sin acceso a información comercial.
- [x] Añadir configuración de empresa, tickets y reglas operativas.
- [x] Conectar las configuraciones con vencimientos, créditos, QR e impresión.
- [x] Implementar respaldo, vista previa y doble confirmación del restablecimiento.
- [x] Probar aislamiento de Firestore y el reinicio completo en el emulador.
- [x] Crear y verificar la cuenta real de Soporte.
- [x] Generar y copiar el APK 1.2.4 al Escritorio.

## Hallazgos iniciales de las capturas

- Las tarjetas de productos usan una sola columna y truncan nombre y descripción.
- El catálogo muestra presentación y peso aproximado en un lugar donde la existencia es más importante.
- El selector nativo de Android no sirve para listas operativas largas ni selección múltiple.
- El encabezado reserva demasiado ancho al texto `SINCRONIZADO` y corta identidad y contexto.
- Las listas de almacenes y despachos mezclan nombres largos con cantidades sin una cuadrícula estable.
- Cambios y devoluciones empiezan por una venta técnica y muestran identificadores internos; el flujo debe empezar por el cliente.
- Los formularios largos presentan demasiadas decisiones simultáneamente.

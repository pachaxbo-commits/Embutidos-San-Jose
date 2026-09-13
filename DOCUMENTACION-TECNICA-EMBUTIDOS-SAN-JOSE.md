# Documentación técnica — Embutidos San José

## Finalidad del repositorio

Este repositorio contiene la aplicación exclusiva de **Embutidos San José**, desarrollada y mantenida por **PACHAX**. La aplicación administra inventario por lotes y vencimientos, almacenes, transferencias, despachos, ventas, créditos y cobros, gastos, devoluciones, cierres de ruta, conciliación, reportes, usuarios, soporte e impresión térmica.

La interfaz, los permisos y las reglas de acceso están cerrados a Embutidos San José. No existe una pantalla para registrar empresas, cambiar de empresa ni activar categorías comerciales distintas.

La copia local principal preparada después de la limpieza está en `G:\Embutidos San Jose`.

## Identificadores técnicos conservados

Algunos nombres internos se conservaron para mantener compatibilidad con los datos existentes y evitar una migración riesgosa:

- `restaurantId` es la **clave técnica de empresa** usada desde el origen del esquema. En esta aplicación su único valor permitido es `sanjose`. No representa una opción visible ni implica que San José forme parte de un catálogo de restaurantes.
- La ruta de Firestore `/restaurants/sanjose` es el contenedor histórico de los datos de la empresa. Cambiarla exigiría migrar documentos, referencias y permisos sin aportar una mejora funcional.
- `TenantContext`, `TenantScopedEntity` y `useTenantMembers` son nombres técnicos para el límite de seguridad de los datos. El contexto está fijado a San José y rechaza cualquier identificador diferente.
- El proyecto Firebase conserva el identificador `pachax-flow` porque allí funcionan Authentication, Firestore y Cloud Functions. Es un identificador de infraestructura; el nombre visible de la aplicación es Embutidos San José.
- Android conserva `com.pachax.flow` y su misma llave de firma para que las próximas versiones puedan instalarse como actualización sobre la aplicación existente.
- Estos nombres técnicos no aparecen como opciones, marcas ni flujos para los usuarios.

## Componentes activos

- Aplicación web: React, TypeScript y Vite.
- Aplicación Android: Capacitor.
- Acceso y datos: Firebase Authentication y Firestore.
- Operaciones protegidas: Cloud Functions.
- Impresión: Bluetooth SPP para impresoras genéricas y conexión por red local.
- Exportaciones: PDF y Excel en español.

Los roles activos son Administración, Almacén, Distribuidor y Soporte. Las reglas limitan cada sección según su responsabilidad. Créditos es información compartida entre los distribuidores autorizados; ventas, gastos, despachos y cierres individuales mantienen el aislamiento correspondiente.

## Módulos retirados

Se eliminaron archivos sin acceso desde la aplicación actual relacionados con caja de restaurante, cocina, comandero, bot, catálogo anterior, pedidos anteriores, sesiones de caja, personalización por empresa, registro de empresas, paneles administrativos antiguos e impresión de comandas de cocina. También se retiraron vistas de prueba, archivos de previsualización y repositorios de datos sin uso.

Antes de eliminar cada grupo se verificó el árbol de importaciones desde `src/main.tsx` y `src/App.tsx`. El código compartido que sí usa San José —autenticación, sincronización, permisos, reportes, impresión y acceso a Firebase— se conservó.

## Respaldo anterior a la limpieza

El respaldo completo está fuera de este proyecto en:

`G:\PACHAX_BACKUPS\Embutidos-San-Jose-pre-limpieza-2026-09-13`

Incluye la copia de archivos, documentos retirados, APK anteriores y el historial Git completo. El archivo recuperable es `repositorio-completo.bundle`.

- Commit respaldado: `c0d8215368a061056c1262fe6cfcb238c20af6c9`
- SHA-256: `1669A8B2E6BEB7997E3E550EDB02DC6A37027A1ED64683F9055FC4A105D381CA`

Para recuperar el historial en otra carpeta:

```powershell
git clone "G:\PACHAX_BACKUPS\Embutidos-San-Jose-pre-limpieza-2026-09-13\repositorio-completo.bundle" "G:\Recuperacion-San-Jose"
```

## Comprobaciones realizadas

La validación se hizo con Firebase Emulator Suite, por lo que no modificó datos reales:

- Compilación TypeScript y Vite correcta.
- 58 pruebas del motor de distribución.
- Etiquetas y reportes en español e identificadores internos protegidos.
- 18 pruebas de acceso de Firestore.
- 59 pruebas de operaciones protegidas y permisos.
- Flujo completo con Administración, Almacén y Distribuidor: despacho, venta, QR, crédito, cobros, trabajo sin conexión, devolución y cierre.
- Cartera global y aislamiento entre distribuidores.
- Historial de cierres con detalle financiero solo para Administración.
- Historial general de inventario y descarga PDF para Administración y Almacén.
- Edición y eliminación segura de usuarios, conservando siempre una cuenta administrativa activa.
- Centro de Soporte sin información comercial y limpieza con doble confirmación.
- 165 combinaciones de pantallas, roles y tamaños sin desbordamiento horizontal.
- PDF y Excel de reportes, almacenes, inventario y estado de cuenta en español y sin identificadores internos.
- Impresión: 18 pruebas del motor, 8 de Bluetooth SPP y 20 de red local.

Los resultados y capturas están fuera del repositorio en `G:\PACHAX_QA_RESULTS\Embutidos-San-Jose`.

## Operación del proyecto

Instalar dependencias y compilar:

```powershell
npm install
npm run build
```

Ejecutar Firebase local para pruebas:

```powershell
npm run emulators
npm run seed:demo
npm run dev:emulator
```

Pruebas principales:

```powershell
npm run test:distribution
npm run test:reports
npm run test:access
npm run test:rules
```

Preparar Android:

```powershell
npm run build
npx cap sync android
```

Las reglas de `firebase/firestore.rules` deben probarse en el emulador antes de publicarlas. Renombrar la carpeta local o el repositorio de GitHub no cambia Firebase, Vercel, el identificador Android ni la firma de instalación.

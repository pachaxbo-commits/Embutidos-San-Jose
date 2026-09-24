# Checklist obligatoria: migración 1.3.2 → 1.4.0

Esta lista se completa en cada teléfono antes de desinstalar 1.3.2. Si cualquier respuesta es **no**, detener la migración.

- [ ] El teléfono tiene Internet estable.
- [ ] La aplicación muestra **Sincronizado**; no muestra **Sin conexión** ni **Sincronizando**.
- [ ] No aparece el aviso **Operaciones pendientes de validación**.
- [ ] No hay ventas, cobros, gastos u otras operaciones con **Pendiente de confirmación**.
- [ ] No existe un error rojo ni una operación rechazada sin revisar.
- [ ] La jornada o despacho activo quedó cerrado cuando corresponde.
- [ ] Administración verificó desde la web u otro equipo las últimas ventas, cobros, créditos, stock y cierre del usuario.
- [ ] Se anotó la impresora: nombre, Bluetooth/MAC o IP, tamaño 58 mm y demás opciones.
- [ ] Se conoce el usuario y contraseña para volver a iniciar sesión.

## Qué significa “sincronizado”

Una operación confirmada ya existe en Firestore y volverá a descargarse después de iniciar sesión. Una operación todavía en cola puede existir únicamente en el caché IndexedDB del teléfono. Desinstalar en ese estado la elimina permanentemente.

La comprobación no puede realizarse desde otra computadora: debe observarse también el estado local del mismo teléfono que se desinstalará. La revisión desde Administración es una segunda confirmación, no reemplaza el indicador local.

## Después de instalar 1.4.0

- [ ] Iniciar sesión y confirmar el rol, ruta/almacén y permisos esperados.
- [ ] Comparar las últimas ventas, cobros, créditos, stock y cierres con Administración.
- [ ] Volver a seleccionar/configurar la impresora y hacer una impresión de prueba.
- [ ] Confirmar que la aplicación informa versión 1.4.0 (código 20).

No distribuir ni instalar la nueva 1.4.0 hasta verificar su firma release definitiva con `apksigner`.

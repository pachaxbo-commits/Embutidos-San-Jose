# Continuidad de San José tras el fallo de historial

Fecha: 11/09/2026. Este documento permite retomar el proyecto si el chat original muestra mensajes antiguos.

## Proyecto correcto

San José permanece en G:/pachax-comandero. La copia PACHAX está en C:/PACHAX y ya es independiente. No intercambiar configuraciones ni aplicar cambios de la copia en San José automáticamente.

## Últimos acuerdos

- La clonación de PACHAX está terminada; su configuración de Firebase/GitHub nuevo y rediseño continuarán en un chat de C:/PACHAX, leyendo sus AGENTS.md y CONTEXTO.md.
- San José conserva su Firebase actual y su identificador Android actual por decisión del usuario. Su última entrega fue 1.2.5, reportes en español, con APK en D:/OneDrive/Escritorio/Embutidos San Jose 1.2.5 - Reportes en espanol.apk.
- Está pendiente retirar código de la antigua plataforma que San José no use, conservando funciones compartidas necesarias. No hacer borrados amplios: revisar dependencias, respaldar y probar. La clonación no realizó esta limpieza en el original.
- La cartera de créditos es global para Administración y distribuidores, aunque los créditos provengan de otras rutas. Ventas y cierres individuales siguen restringidos. No seguir las sugerencias antiguas del chat que proponían aislar la deuda por ruta: fueron corregidas por el usuario.
- Almacén trabaja con inventario, despacho, transferencias, retorno y conciliación de productos; no debe ver el panel financiero, clientes ni configuración de impresoras.
- La merma por redondeo está pendiente de definición comercial. No inventar límites ni redondeos.
- El usuario necesita avanzar con futuras observaciones del cliente, sin mezclar esta app con PACHAX. No se han recibido en este punto nuevas observaciones funcionales específicas posteriores a la clonación.

## Evidencia y estado

Consultar docs/IMPLEMENTACION-SAN-JOSE.md, docs/REDISENO-SAN-JOSE.md y docs/qa-san-jose para detalles y pruebas previas. Verificar siempre código actual frente a afirmaciones históricas; no asumir ausencia absoluta de errores.

En el chat original hay una inconsistencia del índice: expected ordinal 6264, got 6263. El historial visible puede quedar antiguo aunque el registro local conserve mensajes posteriores. No es un fallo de Firebase de San José.

Respaldo y diagnóstico: C:/Users/fabri/Documents/Codex-Recovery/2026-09-11-PACHAX/. MENSAJES-RECUPERADOS.md contiene los mensajes recuperables en formato legible. No subir la conversación completa a GitHub: puede contener información privada.

## Prompt de continuación

«Trabajaremos exclusivamente en Embutidos San José, G:/pachax-comandero. Lee docs/CONTINUIDAD-TRAS-FALLO-CHAT.md y los documentos de implementación. El chat anterior tiene un fallo de índice; consulta los mensajes recuperados solo si necesitas aclarar una decisión. No modifiques C:/PACHAX. Retomaremos las observaciones del cliente y la limpieza pendiente preservando toda funcionalidad compartida».

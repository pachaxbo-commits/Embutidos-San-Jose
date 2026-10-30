# Candidata San José: regresiones finales del 30/10/2026

Base: 67384e02ed9b90c454bab07f7e2fbc1b760c5330, rama codex/sanjose-integrated-release. Este informe acompaña las correcciones de pruebas y de preparación OTA de la fase 2. El SHA final se obtiene del commit que contiene este documento.

## Resultado

GO exclusivamente para integrar a main, sujeto a autorización humana. No se realizó merge ni publicación. 107 ejecuciones finales aprobadas: A 23, B 64, C 20. El alias test:error-diagnostics ejecuta el mismo archivo que test:post-close-react-render y no se repitió. Se incluyeron pruebas de dominio sin script npm y una prueba adicional de interfaz de merma.

Los primeros intentos con argumentos de Emulator mal citados en el lanzador Windows no ejecutaron suites y se reemplazaron por ejecuciones reales. No se repitieron las suites ya aprobadas. Los logs completos, comandos, fechas y códigos de salida están conservados en C:/Users/fabri/.codex/release-qa/67384e0 (results.json, retry-A.json, retry-BC.json, tail-results.json y final-results.json).

## Correcciones de esta fase

- Matriz de suscripciones: incorporar distExpenseGroups para Administración y Distribuidor, conforme a los permisos existentes.
- Mocks de cierres: incorporar las consultas de despachos cerrados y ventas atribuibles del repositorio actual.
- Mock de actualización de lote: incorporar la consulta/validación de reservas; los casos de reservas reales permanecen cubiertos en Emulator.
- Trazabilidad contable: verificar el rechazo de 0,1 kg de merma sin confirmación física y luego enviar una confirmación explícita del fixture. Se conservan las protecciones del backend.
- Clasificación de egresos: actualizar las expectativas de peaje, refrigerio y mantenimiento a Comercialización.
- Preparación OTA: exigir versionCode superior a 86. No se incrementó la versión de la app ni se generó APK/OTA.
- Quitar líneas vacías finales señaladas por diff check. No se reimplementaron los P1.

## Validación técnica e integración

Typecheck y ESLint pertinente pasaron. Build web aprobado con la configuración autorizada ya presente en .env.android, sin divulgar valores. Se validó también la configuración Firebase de los assets Android existentes, el appId com.pachax.flow y la ausencia de server.url remoto. Diff check pasó. Índices: JSON válido con 13 definiciones únicas; Rules y permisos se ejecutaron en Emulator. El emulador no demuestra que los índices estén desplegados en producción.

main d2efc21a0fc1546858c14f81a9652220f0635c56 es ancestro de la candidata; no hubo conflictos que resolver. PR #1 fue reportado MERGEABLE/CLEAN; el anterior mergeable:false no corresponde a un conflicto vigente. main no tiene protección ni rulesets activos según GitHub. Los checks de Vercel previos estaban aprobados; el estado del nuevo HEAD se consulta al entregar.

El build muestra advertencias de tamaño de bundle/imports dinámicos. El runtime local usado fue Node 24; Functions declara Node 22. No se hizo verificación de runtime desplegado ni acceso a datos reales.

## Compatibilidad y preparación Android

La candidata conserva la configuración nativa de 1.4.66 (86), minSdk 24, compile/targetSdk 36, mismo appId y plugins. Los contratos normales y documentos históricos fueron ejercitados por las regresiones. La compatibilidad visual del cliente antiguo es parcial: no conoce las nuevas reservas de elaboración y puede ofrecer cantidades que el backend rechazará por estar reservadas. No se debe usar ese cliente para operar los nuevos flujos.

Las ventas/logística derivadas requieren la autorización de Emulator; reenvasado queda bloqueado por defecto y requiere activación server-side más bucket y evidencia. Las suites verificaron los bloqueos fuera del contexto autorizado. No se consultó la configuración del despliegue de producción; antes de publicar debe comprobarse que no se habilitaron flags reales accidentalmente.

La configuración local de firma contiene los campos exigidos, una huella y un keystore existente; no se divulgaron claves ni se generó un paquete. Antes de publicar faltan: asignar versionCode >=87 y versionName nuevo, sincronizar assets del SHA final, construir con firma oficial, verificar paquete/certificado/hash, instalar sobre la APK oficial 1.4.66 en un dispositivo y probar actualización, arranque, login, documentos, impresión, permisos y operación. El Preview no cubre esa instalación.

## Reversión

Conservar los artefactos oficiales y snapshots de la versión anterior antes de una publicación autorizada. Si existen reservas, lotes procesados o registros de origen pendiente, no regresar a un backend que ignore esas restricciones: mantener las protecciones y corregir hacia adelante. Revertir presentación mediante un commit revisado cuando sea seguro; nunca borrar registros para forzar reversión. Una corrección Android posterior necesita versionCode mayor y el mismo certificado. No se ejecutó ninguna reversión ni migración de datos.

## Suites: resultado final por ejecución

| Grupo | Suite | Resultado | Log local |
|---|---|---|---|
| A | test:processing-domain | PASS (exit 0) | test_processing-domain.log |
| A | test:processing-review-domain | PASS (exit 0) | test_processing-review-domain.log |
| A | test:processing-ui | PASS (exit 0) | test_processing-ui.log |
| A | test:processing-ui-e2e | PASS (exit 0) | test_processing-ui-e2e.log |
| A | test:processing-availability | PASS (exit 0) | test_processing-availability_retry.log |
| A | test:processing-reservations | PASS (exit 0) | test_processing-reservations_retry.log |
| A | test:product-movement-history | PASS (exit 0) | test_product-movement-history.log |
| A | test:product-kardex | PASS (exit 0) | test_product-kardex.log |
| A | test:return-waste | PASS (exit 0) | test_return-waste.log |
| A | test:return-waste-emulator | PASS (exit 0) | test_return-waste-emulator_retry.log |
| A | test:quarantine | PASS (exit 0) | test_quarantine.log |
| A | test:quarantine-resolution | PASS (exit 0) | test_quarantine-resolution_retry.log |
| A | test:quarantine-permissions | PASS (exit 0) | test_quarantine-permissions_retry.log |
| A | test:intake-validation | PASS (exit 0) | test_intake-validation.log |
| A | test:intake-backend-dates | PASS (exit 0) | test_intake-backend-dates.log |
| A | test:today-intakes | PASS (exit 0) | test_today-intakes.log |
| A | test:processing-batches | PASS (exit 0) | test_processing-batches_retry.log |
| A | test:processing-derived-dispatch | PASS (exit 0) | test_processing-derived-dispatch_retry.log |
| A | test:processing-derived-sale | PASS (exit 0) | test_processing-derived-sale_retry.log |
| A | test:processing-review | PASS (exit 0) | test_processing-review_retry.log |
| A | test:processing-repack | PASS (exit 0) | test_processing-repack_retry.log |
| A | test:processing-evidence | PASS (exit 0) | test_processing-evidence_retry.log |
| A | test:processing-quality-auth | PASS (exit 0) | test_processing-quality-auth_retry.log |
| B | test:distribution | PASS (exit 0) | test_distribution.log |
| B | test:subscription-permissions | PASS (exit 0) | test_subscription-permissions_retry.log |
| B | test:closure-regression | PASS (exit 0) | test_closure-regression.log |
| B | test:closure-audit | PASS (exit 0) | test_closure-audit.log |
| B | test:closure-rectification | PASS (exit 0) | test_closure-rectification_retry.log |
| B | test:cash-refund-closure | PASS (exit 0) | test_cash-refund-closure_retry.log |
| B | test:cash-refund-concurrency | PASS (exit 0) | test_cash-refund-concurrency_retry.log |
| B | test:closure-rectification-view | PASS (exit 0) | test_closure-rectification-view.log |
| B | test:closure-history | PASS (exit 0) | test_closure-history.log |
| B | test:closure-queue | PASS (exit 0) | test_closure-queue.log |
| B | test:closure-lifecycle | PASS (exit 0) | test_closure-lifecycle_retry.log |
| B | test:legacy-sale-overlap | PASS (exit 0) | test_legacy-sale-overlap_retry.log |
| B | test:closure-lifecycle-ui | PASS (exit 0) | test_closure-lifecycle-ui.log |
| B | test:post-close-react-render | PASS (exit 0) | test_post-close-react-render_retry.log |
| B | test:sacheteado-navigation | PASS (exit 0) | test_sacheteado-navigation.log |
| B | test:closure-return-validation | PASS (exit 0) | test_closure-return-validation_retry.log |
| B | test:closure-route-switch | PASS (exit 0) | test_closure-route-switch_retry.log |
| B | test:admin-physical-sale | PASS (exit 0) | test_admin-physical-sale_retry.log |
| B | test:distributor-differences | PASS (exit 0) | test_distributor-differences.log |
| B | test:dispatch-return-merma | PASS (exit 0) | test_dispatch-return-merma_retry.log |
| B | test:dispatch-loss-compatibility | PASS (exit 0) | test_dispatch-loss-compatibility_retry.log |
| B | test:accounting-origin | PASS (exit 0) | accounting-origin-final.log |
| B | test:dispatch-merma-settlement | PASS (exit 0) | test_dispatch-merma-settlement.log |
| B | test:dispatch-sale-scope | PASS (exit 0) | test_dispatch-sale-scope.log |
| B | test:courtesy-quotes | PASS (exit 0) | test_courtesy-quotes_retry.log |
| B | test:quote-print | PASS (exit 0) | test_quote-print.log |
| B | test:quote-history | PASS (exit 0) | test_quote-history.log |
| B | test:quote-share | PASS (exit 0) | test_quote-share.log |
| B | test:seller-breakdown | PASS (exit 0) | test_seller-breakdown.log |
| B | test:seller-breakdown-export | PASS (exit 0) | test_seller-breakdown-export.log |
| B | test:route-labels | PASS (exit 0) | test_route-labels.log |
| B | test:rejected-operations | PASS (exit 0) | test_rejected-operations.log |
| B | test:update-lot-validation | PASS (exit 0) | test_update-lot-validation_retry.log |
| B | test:customer-purchases | PASS (exit 0) | test_customer-purchases.log |
| B | test:customer-history-emulator | PASS (exit 0) | test_customer-history-emulator_retry.log |
| B | test:customer-display-name | PASS (exit 0) | test_customer-display-name.log |
| B | test:credit-route-export | PASS (exit 0) | test_credit-route-export.log |
| B | test:luciano-rectification | PASS (exit 0) | test_luciano-rectification_retry.log |
| B | test:diagnostics-backend | PASS (exit 0) | test_diagnostics-backend_retry.log |
| B | test:diagnostics-emulator | PASS (exit 0) | test_diagnostics-emulator_retry.log |
| B | test:dispatch-correction | PASS (exit 0) | test_dispatch-correction.log |
| B | test:multi-lot-dispatch | PASS (exit 0) | test_multi-lot-dispatch_retry.log |
| B | test:collection-receipts | PASS (exit 0) | test_collection-receipts.log |
| B | test:collection-provisional | PASS (exit 0) | test_collection-provisional.log |
| B | test:confirmations | PASS (exit 0) | test_confirmations.log |
| B | test:sale-correction | PASS (exit 0) | test_sale-correction.log |
| B | test:qr-payment | PASS (exit 0) | test_qr-payment.log |
| B | test:qr-record-date | PASS (exit 0) | test_qr-record-date.log |
| B | test:qr-effective-verification | PASS (exit 0) | test_qr-effective-verification_retry.log |
| B | test:sale-price-correction | PASS (exit 0) | test_sale-price-correction_retry.log |
| B | test:selective-cleanup | PASS (exit 0) | test_selective-cleanup.log |
| B | test:offline-operations | PASS (exit 0) | test_offline-operations.log |
| B | test:offline-firestore | PASS (exit 0) | test_offline-firestore_retry.log |
| B | test:oct10-audit | PASS (exit 0) | test_oct10-audit.log |
| B | test:asof-credits | PASS (exit 0) | test_asof-credits.log |
| B | test:receivable-adjustments | PASS (exit 0) | test_receivable-adjustments_retry.log |
| B | test:audit-fixes-1420 | PASS (exit 0) | test_audit-fixes-1420.log |
| B | domain:cashMovementReconciliation.test.ts | PASS (exit 0) | domain_cashMovementReconciliation.test.ts.log |
| B | domain:cashOriginAttribution.test.ts | PASS (exit 0) | domain_cashOriginAttribution.test.ts.log |
| B | domain:customerCreditStatement.test.ts | PASS (exit 0) | domain_customerCreditStatement.test.ts.log |
| B | domain:customerFullHistory.test.ts | PASS (exit 0) | domain_customerFullHistory.test.ts.log |
| B | domain:productWarehouseLots.test.ts | PASS (exit 0) | domain_productWarehouseLots.test.ts.log |
| B | domain:stockAvailability.test.ts | PASS (exit 0) | domain_stockAvailability.test.ts.log |
| C | test:build-config | PASS (exit 0) | test_build-config.log |
| C | test:rules | PASS (exit 0) | test_rules_retry.log |
| C | test:access | PASS (exit 0) | test_access_retry.log |
| C | test:document-resources | PASS (exit 0) | test_document-resources.log |
| C | test:quote-document-text | PASS (exit 0) | test_quote-document-text.log |
| C | test:reports | PASS (exit 0) | test_reports.log |
| C | test:expense-categories | PASS (exit 0) | test_expense-categories.log |
| C | test:report-selection | PASS (exit 0) | test_report-selection.log |
| C | test:product-profit | PASS (exit 0) | test_product-profit.log |
| C | test:operating-result | PASS (exit 0) | test_operating-result.log |
| C | test:expense-review | PASS (exit 0) | test_expense-review.log |
| C | test:expense-presets | PASS (exit 0) | test_expense-presets.log |
| C | test:expense-auto-classification | PASS (exit 0) | expense-auto-final.log |
| C | test:expense-accounting | PASS (exit 0) | test_expense-accounting.log |
| C | test:expense2-emulator | PASS (exit 0) | test_expense2-emulator_retry.log |
| C | test:merma-report | PASS (exit 0) | test_merma-report.log |
| C | test:credits-and-expenses | PASS (exit 0) | test_credits-and-expenses.log |
| C | test:updater | PASS (exit 0) | test_updater.log |
| C | test:android-documents | PASS (exit 0) | test_android-documents.log |
| C | test:web-updater | PASS (exit 0) | web-updater-final.log |
| B | extra:closure-over-normal-merma-ui | PASS (exit 0) | closure-over-normal-extra.log |

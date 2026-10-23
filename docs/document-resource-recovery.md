# Dispatch loss compatibility and document resources

Legacy dispatch payloads used `waste` without identifying whether that quantity was physically transported or discarded. The server now rejects nonzero ambiguous `waste` before applying stock changes. Legacy ordinary loads with absent/zero waste remain supported. Transported extra weight uses `normalQuantity` plus `dispatchMerma`; actual warehouse disposal requires an explicit `warehouseLoss` quantity, reason and confirmation. Historical movements are not reclassified.

PDF and Excel engines load with the application so an open session retains them across deployments. A bootstrap resource-error notice offers the current application in another tab without reloading the original, changing drafts, or replaying operations. HTML is not cached; content-hashed assets remain immutable.

`test:dispatch-loss-compatibility` verifies rejection before stock changes, valid explicit losses, ordinary legacy loads and idempotency in Firebase Emulator with Security Rules. `test:document-resources` uses an isolated headless Chrome profile: it replaces later asset responses with SPA HTML, generates five document types from the already-loaded engines, reproduces an actual obsolete module import, and checks recovery at seven viewport widths.

Incident-specific production data and the read-only audit output are retained locally under `output/audit`, which is ignored by Git. No migration or rectification runs during deployment.

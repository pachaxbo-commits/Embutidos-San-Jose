# Supplier purchase dependency index

`rectifySupplierPurchase` must not scan every processing batch to discover whether a purchase is referenced by packaging or cost data. Processing batches now write a derived `sourceExpenseIds` array, and rectification performs an indexed `array-contains` lookup for the target expense. The existing lot and stock-movement checks remain scoped to that purchase.

The reverse lookup is enabled only when `restaurants/sanjose/distControl/supplierPurchaseDependencyIndex` has `status: "ready"` and `schemaVersion: 1`. Missing, stale, or in-progress state blocks rectification before any writes. New processing batches always populate the array.

## Safe rollout

1. Deploy the backend revision that writes `sourceExpenseIds` and keeps rectification gated. Do not run the backfill before this revision is active; otherwise an older backend could create batches without the new field during the scan.
2. Run a read-only inventory first:

   ```powershell
   node scripts/backfill-supplier-purchase-dependencies.cjs --project pachax-flow
   ```

3. Review the number of batches and references. Then run the transactional, resumable backfill explicitly:

   ```powershell
   node scripts/backfill-supplier-purchase-dependencies.cjs --project pachax-flow --apply --confirm-production pachax-flow
   ```

   The process marks the index `backfilling`, updates only the derived array on each batch in a transaction, verifies all pages again, and sets `ready` only after verification. If it stops early, rectification remains blocked and the same command can be rerun. Do not manually set the marker to `ready`.
4. Verify the marker and a sample of linked/unlinked batches with a read-only Admin SDK query before allowing financial rectifications.
5. Keep existing inventory, payment, and closure safeguards. This index does not authorize compensatory inventory or closed-cash operations.

The `sourceExpenseIds` field uses Firestore's automatic single-field array index; no composite index or client-readable rules are needed. The backfill has not been run against Production by this change.

# Accounting references with pending physical origin

This development is local only. It adds no migration, automatic production execution, public maintenance endpoint or deployment hook.

## Model

An allocation can have `originReferences`: exception ID, original stock movement, accounting lot ID, historical accounting unit cost, quantity, `physicalOriginConfirmed=false` and `basis=original_accounting_debit_only`. An absent physical certificate is not fabricated from a normal-load lot selection or FEFO.

`DistLot.pendingOrigins[location]` partitions existing stock; it is **not an additional quantity**. Confirmed plus pending equals the lot's physical quantity. Different exceptions and locations remain separate. A returned portion is reserved exclusively by quantity, not by quarantining the entire legitimate lot. Central sales and dispatches cannot consume that reserve, including with an explicit requested allocation. Route consumption can carry the accounting reference, with the uncertainty preserved.

`origin-traceability.cjs` implements quantity slicing, exact removal, restoration and FEFO allocation. It conserves references when allocations split between normal return, recoverable merma, non-sellable product, sales and corrections. Historical accounting cost travels with the reference; missing historical cost remains unknown rather than using today's product price/cost.

## Lifecycle

The existing UI and operation queue continue to drive declaration → warehouse receipt → administrative closure. No new daily warehouse form or approval step is introduced. Receipt reports physical quantity separately from available quantity and pending-origin reserve.

Stock transfers, sale correction, void, dispatch correction and reopen preserve the same references. A reopen removes the exact original reservation; consumed or changed reservations fail atomically. Partial customer returns remain quarantined under the existing customer-return flow and link the original sale's uncertainty without asserting a physical lot.

Quantity reconciliation still uses normal load + transported merma, effective sales and actual receipt. Only the supported, unambiguous sales reconciliation creates `dispatch_merma_sale`; it is cost of sale once, not a second loss. Unsupported physical differences remain rejected for review.

Availability projections, lot detail, closure summaries/documents, Kardex notes and merma reports expose the distinction. A pending reference taken by FEFO into the normal-return segment must not automatically certify the merma segment as available. Product/date/dispatch totals use the same conservative reintegration calculation. Documentary movements have zero inventory and economic deltas.

## Prepared maintenance operations

`scripts/lib/accounting-merma-rectification.cjs` is an offline Admin maintenance adapter, not a client operation or callable Function. Its default is a read-only transaction. No production invoker is included.

- `reclassify`: replace an active verified legacy loss by the original central debit plus the omitted route credit; change no central balance or central lot quantity; neutralize the loss once; preserve original source operation/sales/additions and link replacement/exception/history.
- `document_existing`: preserve the already executed correction, quantities, costs and sales. Add a zero-delta notice and documentary sidecars in the existing lot-history collection. Remaining stock receives pending-origin metadata only. Sidecars for consumed sale allocations are applied when a later permitted correction/void restores stock, without rewriting the original sale at documentation time.

Both modes reread dispatch, receipt, operations, effective sale corrections, additions, lots and balances inside the transaction. A route already received/closed stops before writes and needs a separate authorized plan; stale balances are not reused. Original and replacement uniqueness, quantity/cost matching, balance/lot consistency, positive quantities and same product are checked. A changed request cannot reuse a confirmed operation ID.

Execution additionally requires the explicit accounting-reference approval token and a callback that persists/verifies a private backup before writes. The transaction stores the audit snapshot, source links and actor/reason. Operational evidence must stay in ignored private output; never commit real snapshots or execution payloads.

## Authorization and deployment boundary

This implementation does not authorize production writes, maintenance execution, new Functions, Hosting, Vercel or Android publication. Before a later authorized execution, deploy and verify the reservation-aware backend and matching frontend **first**, then reread live declarations/receptions/closures/sales/balances. Never execute the new maintenance operation against the old backend: it would lose reservation metadata. Keep the new frontend coupled to that backend; old clients are protected from spending reserves by server-side validation.

No new Rules collection or composite index is needed: documentary records use existing protected lot history, and lookups use a single equality on sale ID. Current client Rules are unchanged. Resolving a pending physical origin is a separate explicit administrative decision; this change does not release existing reservations or quarantine automatically, and identity/cost edits of lots with active reserves are rejected.

## Verification

```powershell
firebase emulators:exec --project demo-pachax-audit --only firestore "node --experimental-strip-types firebase/tests/accountingOriginTraceability.test.mjs"
```

Synthetic tests cover backup/approval guards, idempotence, reserve-only availability, mixed-lot/FEFO splits, partial recovery, central sale protection, legitimate sales, corrections/voids, receipt → final closure → reopen, documentary sidecars and partial customer return. Private copies of operational snapshots are tested separately in the demo emulator, not embedded in this repository.

# Traceability release: compatibility and rollback

## Scope

The deployment changes `processSanJoseOperation` and the web presentation. No migration, corrective operation, inventory change, quarantine release or documentary maintenance is executed by deployment. Maintenance helpers are offline modules, not exported Functions or client operation handlers.

Only the validated traceability commit and minimal pure hashing/rounding primitives are integrated. Earlier experimental proportional planners and maintenance tools are not prerequisites and are not included in this release.

## Android 1.4.59 and stale web sessions

The Capacitor configuration uses embedded assets (`webDir=dist`, no remote `server.url`). Hosting does not update the UI inside an installed APK.

Existing operation payloads are unchanged: normal load plus dispatchMerma, additions, nominal sales, effective sale correction, normal-only distributor declaration, warehouse receipt and administrative closure remain supported. Legacy ambiguous nonzero `waste` remains rejected. No new client-supplied origin fields are trusted; the server derives reservations from its own stock and audit records.

Old clients remain transactionally safe: the server excludes central pending-origin quantities, preserves references through receipt/correction/void/reopen and rejects an oversell with an explicit reservation message. They cannot spend the reserved portion or produce negative stock. However, their embedded availability projection does not understand pendingOrigins and can overstate selectable stock or describe a received portion as sellable. **This is not full presentation compatibility.** Staff handling these exceptions must use the updated web interface or an updated APK before corrective maintenance is separately authorized.

A new APK may be prepared, signed and checked, but its publication requires explicit approval. Until then, preserve the official 1.4.59 OTA manifest and APK byte-for-byte during Hosting publication; do not run the OTA preparation script against a new APK in the directory being deployed.

## Rollout

1. Verify tests and code provenance; keep a private backup of the current Function source archive (including generation), metadata, Hosting version/release and official OTA files.
2. Deploy only `processSanJoseOperation` from the final integrated commit. Verify ACTIVE, source hash and archive content. Do not change Rules or indexes.
3. Publish that commit's frontend to the existing official Hosting/Vercel projects. Verify commit identity, assets and the preserved OTA. Cached/embedded clients remain subject to server safeguards; do not silently treat their UI as reservation-aware.
4. No production test sales or maintenance commands. Use emulator regressions for state-changing checks and read-only post-deploy checks.
5. Reread the actual routes and all relevant source documents before proposing maintenance. Any confirmed receipt/closure stops the open-route operation; do not reopen automatically.

## Rollback procedure

Before rollback, inspect read-only whether any pendingOrigins or traceability sidecars have been created. If none exist, restore the privately archived previous Function source to a temporary isolated rollback directory and deploy only that Function; promote/release the previously captured Hosting and Vercel versions. Preserve OTA files.

If any pending-origin quantities or sidecars exist, **do not restore the old stock engine**, which does not enforce or propagate reservations. Keep the reservation-aware backend and roll forward with a fix, or temporarily revert presentation only while maintaining server-side enforcement and clear staff guidance. Never delete exception records or adjust inventory to make a rollback possible.

Git rollback must preserve history and other work: use a reviewed revert/fix commit, not reset/force-push. No rollback is performed automatically by this release. Android downgrades are not a rollback mechanism; any later Android fix uses a higher versionCode and the same official certificate.

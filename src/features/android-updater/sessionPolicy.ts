import type { AndroidUpdateManifest } from './updateManifest'

export function hasPendingKnownUpdate(installedVersionCode: number | null, manifest: AndroidUpdateManifest | null): boolean {
  return installedVersionCode !== null && Boolean(manifest && manifest.versionCode > installedVersionCode)
}

export function canPresentAutomaticUpdate(input: { postponedThisSession: boolean; pendingOperations: boolean; anotherDialogOpen: boolean }): boolean {
  return !input.postponedThisSession && !input.pendingOperations && !input.anotherDialogOpen
}

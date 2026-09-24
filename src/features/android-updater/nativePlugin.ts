import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface InstalledAndroidVersion {
  packageName: string
  versionCode: number
  versionName: string
  certificateSha256: string
}

export interface DownloadProgressEvent {
  bytesDownloaded: number
  totalBytes: number
  percent: number
}

export interface DownloadResult {
  filePath: string
  sizeBytes: number
}

export interface VerifyResult extends InstalledAndroidVersion {
  filePath: string
  sha256: string
  verified: boolean
}

interface SanJoseUpdaterNativePlugin {
  getInstalledVersion(): Promise<InstalledAndroidVersion>
  checkInstallPermission(): Promise<{ granted: boolean }>
  requestInstallPermission(): Promise<{ opened: boolean }>
  downloadUpdate(options: { url: string; expectedSizeBytes: number }): Promise<DownloadResult>
  cancelDownload(): Promise<{ cancelled: boolean }>
  verifyApk(options: { filePath: string; expectedSha256: string; expectedVersionCode: number }): Promise<VerifyResult>
  installApk(options: { filePath: string }): Promise<{ opened: boolean }>
  deleteUpdate(options: { filePath: string }): Promise<{ deleted: boolean }>
  addListener(eventName: 'downloadProgress', listener: (event: DownloadProgressEvent) => void): Promise<PluginListenerHandle>
}

export const SanJoseUpdaterNative = registerPlugin<SanJoseUpdaterNativePlugin>('SanJoseUpdater')

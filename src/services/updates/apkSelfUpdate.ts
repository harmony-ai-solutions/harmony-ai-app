/**
 * apkSelfUpdate — the optional Android in-app APK self-update (plan 7-10 §8).
 *
 * Sideload-channel only (see `config/appChannel`). Flow:
 *   1. download the APK from the manifest URL to the app cache dir (RNFS);
 *   2. ask the native `SoulbitsApkInstall` module whether installs are allowed;
 *   3. if not, signal {@link INSTALL_PERMISSION_REQUIRED} so the caller can
 *      offer the "install unknown apps" settings page;
 *   4. otherwise launch the system installer for the cached file.
 *
 * iOS has no such flow (platform-forbidden) — the caller links to the portal
 * INSTALLATION instructions instead. The user-confirmation UI lives in the
 * caller (UpdatePrompt); this module is the mechanism.
 */

import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ApkSelfUpdate]');

/** Sentinel thrown when the app must first be granted install permission. */
export const INSTALL_PERMISSION_REQUIRED = 'install_permission_required';

interface ApkInstallNativeModule {
  canInstall(): Promise<boolean>;
  installApk(path: string): Promise<boolean>;
  openInstallSettings(): Promise<boolean>;
}

function nativeModule(): ApkInstallNativeModule | undefined {
  return NativeModules.SoulbitsApkInstall as ApkInstallNativeModule | undefined;
}

/** True when the native installer bridge is present (Android build). */
export function isApkSelfUpdateSupported(): boolean {
  return Platform.OS === 'android' && nativeModule() != null;
}

/**
 * Download + install an APK update. Rejects with
 * {@link INSTALL_PERMISSION_REQUIRED} when the install permission is missing
 * (call {@link openInstallPermissionSettings} then retry).
 */
export async function startApkSelfUpdate(url: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('In-app updates are Android-only');
  }
  const mod = nativeModule();
  if (!mod) {
    throw new Error('SoulbitsApkInstall native module is unavailable');
  }

  const dest = `${RNFS.CachesDirectoryPath}/soulbits-update-${Date.now()}.apk`;
  log.info(`Downloading update → ${dest}`);
  const result = await RNFS.downloadFile({ fromUrl: url, toFile: dest }).promise;
  if (result.statusCode !== 200) {
    throw new Error(`download failed (HTTP ${result.statusCode})`);
  }

  if (!(await mod.canInstall())) {
    throw new Error(INSTALL_PERMISSION_REQUIRED);
  }

  log.info('Launching the system installer');
  await mod.installApk(dest);
}

/** Open the per-app "install unknown apps" settings page. */
export async function openInstallPermissionSettings(): Promise<void> {
  await nativeModule()?.openInstallSettings();
}

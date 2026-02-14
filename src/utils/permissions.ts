import { Platform, PermissionsAndroid, Linking } from 'react-native';
import { createLogger } from './logger';

const log = createLogger('[Permissions]');

export enum PermissionResult {
  GRANTED = 'granted',
  DENIED = 'denied',
  NEVER_ASK_AGAIN = 'never_ask_again',
}

export const PERMISSIONS = {
  RECORD_AUDIO: 'android.permission.RECORD_AUDIO' as const,
  CAMERA: 'android.permission.CAMERA' as const,
} as const;

/**
 * Check if a specific permission is already granted
 * Returns true if granted, false otherwise
 * Returns true on iOS as a no-op (permissions handled differently or not required for current needs)
 */
export async function checkPermission(permission: string): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const isGranted = await PermissionsAndroid.check(permission as any);
    log.debug(`Check permission ${permission}: ${isGranted}`);
    return isGranted;
  } catch (error) {
    log.error(`Error checking permission ${permission}:`, error);
    return false;
  }
}

/**
 * Request a specific permission from the user
 * Returns a PermissionResult
 */
export async function requestPermission(permission: string): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return PermissionResult.GRANTED;
  }

  try {
    log.info(`Requesting permission: ${permission}`);
    const result = await PermissionsAndroid.request(permission as any);

    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      log.info(`Permission ${permission} GRANTED`);
      return PermissionResult.GRANTED;
    } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      log.warn(`Permission ${permission} NEVER_ASK_AGAIN`);
      return PermissionResult.NEVER_ASK_AGAIN;
    } else {
      log.warn(`Permission ${permission} DENIED`);
      return PermissionResult.DENIED;
    }
  } catch (error) {
    log.error(`Error requesting permission ${permission}:`, error);
    return PermissionResult.DENIED;
  }
}

/**
 * Convenience method combining check + request
 * Returns true if permission is granted or user grants it
 * Returns false if user denies or has denied permanently
 */
export async function checkAndRequestPermission(permission: string): Promise<boolean> {
  const isGranted = await checkPermission(permission);
  if (isGranted) {
    return true;
  }

  const result = await requestPermission(permission);
  return result === PermissionResult.GRANTED;
}

/**
 * Open the app's settings page in Android/iOS system settings
 * Useful when user needs to manually enable a permanently denied permission
 */
export async function openAppSettings(): Promise<void> {
  try {
    log.info('Opening app settings');
    await Linking.openSettings();
  } catch (error) {
    log.error('Error opening app settings:', error);
  }
}

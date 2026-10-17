/**
 * deviceName — the human-readable device name shared by the connect-session
 * sign-in flow and the Account Settings identity card.
 *
 * This is the canonical extraction of ConnectSessionService's private
 * `defaultDeviceName` (react-native-device-info `getModel()`, trimmed, with a
 * `"Soulbits <platform>"` fallback). The Account Settings "This device · <name>"
 * row reads it so the name shown to the user is byte-for-byte the name the app
 * announces to the cloud when it creates a connect session.
 *
 * NOTE: `ConnectSessionService` is frozen recent work (owner review in flight),
 * so it still carries its own private copy of this derivation. A follow-up
 * should point it at this module and delete that copy — the two bodies are
 * intentionally identical today.
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

/** The device platform sent to the backend (valid: android | ios | web). */
export function devicePlatform(): 'android' | 'ios' | 'web' {
  return Platform.OS === 'web' ? 'web' : (Platform.OS as 'android' | 'ios');
}

/**
 * Best-effort human device name; falls back to `"Soulbits <platform>"`.
 * Never throws — a `getModel()` failure falls through to the platform label.
 */
export async function getDeviceDisplayName(): Promise<string> {
  const platform = devicePlatform();
  try {
    const model = await DeviceInfo.getModel();
    if (model && model.trim().length > 0) {
      return model.trim();
    }
  } catch {
    // fall through to the platform label
  }
  return `Soulbits ${platform}`;
}

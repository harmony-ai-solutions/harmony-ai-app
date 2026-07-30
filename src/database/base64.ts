/**
 * Base64 Utilities
 * 
 * Utilities for encoding/decoding base64 strings in React Native.
 * Used for converting captured binary data (audio, images) to base64 for storage,
 * and creating data URLs for display in React components.
 */

/**
 * Convert Uint8Array to Base64 string
 * React Native compatible implementation
 * 
 * Used for converting captured audio/images to base64 for storage
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i;
  
  for (i = 0; i < bytes.length; i += 3) {
    const byte1 = bytes[i];
    const byte2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const byte3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    
    const encoded1 = byte1 >> 2;
    const encoded2 = ((byte1 & 3) << 4) | (byte2 >> 4);
    const encoded3 = ((byte2 & 15) << 2) | (byte3 >> 6);
    const encoded4 = byte3 & 63;
    
    result += base64Chars[encoded1] + base64Chars[encoded2];
    result += i + 1 < bytes.length ? base64Chars[encoded3] : '=';
    result += i + 2 < bytes.length ? base64Chars[encoded4] : '=';
  }
  
  return result;
}

/**
 * Create data URL from base64 string
 * Used for image/audio display in React components
 */
export function createDataURL(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Convert Base64 string to Uint8Array
 * Portable implementation (no Buffer/atob/TextDecoder dependency).
 * Inverse of uint8ArrayToBase64.
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const reverseLookup: Record<string, number> = {};
  for (let i = 0; i < 64; i++) {
    reverseLookup[base64Chars[i]] = i;
  }

  // Strip padding to compute decoded length
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const byteLength = (b64.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;

  for (let i = 0; i < b64.length; i += 4) {
    const c1 = b64[i];
    const c2 = b64[i + 1];
    const c3 = b64[i + 2];
    const c4 = b64[i + 3];

    const v1 = reverseLookup[c1];
    const v2 = reverseLookup[c2];
    const v3 = c3 === '=' ? 0 : reverseLookup[c3];
    const v4 = c4 === '=' ? 0 : reverseLookup[c4];

    const triple = (v1 << 18) | (v2 << 12) | (v3 << 6) | v4;

    bytes[byteIndex++] = (triple >> 16) & 0xFF;
    if (c3 !== '=') {
      bytes[byteIndex++] = (triple >> 8) & 0xFF;
    }
    if (c4 !== '=') {
      bytes[byteIndex++] = triple & 0xFF;
    }
  }

  return bytes;
}

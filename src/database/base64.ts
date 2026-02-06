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

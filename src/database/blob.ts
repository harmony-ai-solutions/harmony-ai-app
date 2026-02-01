/**
 * BLOB Utilities
 * 
 * Utilities for handling BLOB data from react-native-sqlite-storage.
 * SQLite BLOBs are returned as base64 strings on iOS and as raw strings on Android.
 */

/**
 * Convert BLOB data from SQLite to Uint8Array
 * Handles the different formats returned by react-native-sqlite-storage
 */
export function blobToUint8Array(blob: any): Uint8Array | null {
  if (!blob) {
    return null;
  }
  
  // Already a Uint8Array
  if (blob instanceof Uint8Array) {
    return blob;
  }
  
  // ArrayBuffer
  if (blob instanceof ArrayBuffer) {
    return new Uint8Array(blob);
  }
  
  // Array-like object (has length and numeric indices)
  if (typeof blob === 'object' && 'length' in blob && typeof blob.length === 'number') {
    const arr = new Uint8Array(blob.length);
    for (let i = 0; i < blob.length; i++) {
      arr[i] = blob[i];
    }
    return arr;
  }
  
  // String (could be base64 on iOS or raw bytes on Android)
  if (typeof blob === 'string') {
    // Check if it looks like base64
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(blob)) {
      return base64ToUint8Array(blob);
    }
    
    // Treat as raw string (Android case)
    const arr = new Uint8Array(blob.length);
    for (let i = 0; i < blob.length; i++) {
      arr[i] = blob.charCodeAt(i) & 0xff;
    }
    return arr;
  }
  
  console.warn('[blobToUint8Array] Unknown blob format:', typeof blob, blob);
  return null;
}

/**
 * Convert Base64 string to Uint8Array
 * Manual implementation since atob is not available in React Native
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Remove whitespace and padding
  const cleanBase64 = base64.replace(/\s/g, '');
  
  // Base64 character set
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  
  // Calculate output length (accounting for padding)
  let paddingCount = 0;
  if (cleanBase64.endsWith('==')) paddingCount = 2;
  else if (cleanBase64.endsWith('=')) paddingCount = 1;
  
  const outputLength = (cleanBase64.length * 3 / 4) - paddingCount;
  const bytes = new Uint8Array(outputLength);
  
  let byteIndex = 0;
  for (let i = 0; i < cleanBase64.length; i += 4) {
    // Get 4 base64 characters
    const char1 = base64Chars.indexOf(cleanBase64[i]);
    const char2 = base64Chars.indexOf(cleanBase64[i + 1]);
    const char3 = base64Chars.indexOf(cleanBase64[i + 2]);
    const char4 = base64Chars.indexOf(cleanBase64[i + 3]);
    
    // Decode to 3 bytes
    if (char1 !== -1 && char2 !== -1) {
      bytes[byteIndex++] = (char1 << 2) | (char2 >> 4);
      
      if (char3 !== -1 && byteIndex < outputLength) {
        bytes[byteIndex++] = ((char2 & 15) << 4) | (char3 >> 2);
        
        if (char4 !== -1 && byteIndex < outputLength) {
          bytes[byteIndex++] = ((char3 & 3) << 6) | char4;
        }
      }
    }
  }
  
  return bytes;
}

/**
 * Convert Uint8Array to Base64 string
 * React Native compatible implementation
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
 * Convert BLOB data to data URL for image display
 */
export function blobToDataURL(blob: any, mimeType: string): string | null {
  const bytes = blobToUint8Array(blob);
  if (!bytes) {
    return null;
  }
  
  const base64 = uint8ArrayToBase64(bytes);
  return `data:${mimeType};base64,${base64}`;
}

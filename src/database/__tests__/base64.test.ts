import {
  uint8ArrayToBase64,
  base64ToUint8Array,
  createDataURL,
} from '../base64';

describe('uint8ArrayToBase64', () => {
  it('encodes known byte sequences', () => {
    expect(uint8ArrayToBase64(new Uint8Array([]))).toBe('');
    // 'hello' -> aGVsbG8=
    expect(uint8ArrayToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe(
      'aGVsbG8=',
    );
    // [1,2,3] -> AQID
    expect(uint8ArrayToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });
});

describe('base64ToUint8Array', () => {
  it('decodes a known base64 string', () => {
    expect(Array.from(base64ToUint8Array('aGVsbG8='))).toEqual([
      104,
      101,
      108,
      108,
      111,
    ]);
    expect(Array.from(base64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });

  it('handles padding variations', () => {
    // 'M' -> TQ==
    expect(Array.from(base64ToUint8Array('TQ=='))).toEqual([77]);
    // 'Ma' -> TWE=
    expect(Array.from(base64ToUint8Array('TWE='))).toEqual([77, 97]);
  });

  it('round-trips through uint8ArrayToBase64 for arbitrary bytes', () => {
    const inputs = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([255]),
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array(Array.from({ length: 64 }, (_, i) => i % 256)),
    ];

    for (const bytes of inputs) {
      const encoded = uint8ArrayToBase64(bytes);
      const decoded = base64ToUint8Array(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    }
  });
});

describe('createDataURL', () => {
  it('builds a data URL from base64 and mime type', () => {
    expect(createDataURL('AQID', 'image/png')).toBe(
      'data:image/png;base64,AQID',
    );
  });
});

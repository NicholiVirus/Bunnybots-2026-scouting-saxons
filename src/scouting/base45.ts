/**
 * Base45 (RFC 9285): bytes → characters of the QR "alphanumeric" set, which QR
 * codes store more densely than base64 (used by EU COVID certificates).
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const INDEX = new Map(ALPHABET.split('').map((c, i) => [c, i]));

export function base45Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let x = bytes[i] * 256 + bytes[i + 1];
      const c = x % 45;
      x = (x - c) / 45;
      const d = x % 45;
      const e = (x - d) / 45;
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e];
    } else {
      const x = bytes[i];
      const c = x % 45;
      const d = (x - c) / 45;
      out += ALPHABET[c] + ALPHABET[d];
    }
  }
  return out;
}

export function base45Decode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 3) {
    const chunk = s.slice(i, i + 3);
    const v = chunk.split('').map((ch) => {
      const n = INDEX.get(ch);
      if (n === undefined) throw new Error(`Invalid base45 character "${ch}"`);
      return n;
    });
    if (v.length === 3) {
      const x = v[0] + v[1] * 45 + v[2] * 45 * 45;
      if (x > 0xffff) throw new Error('Invalid base45 triplet');
      out.push(x >> 8, x & 0xff);
    } else if (v.length === 2) {
      const x = v[0] + v[1] * 45;
      if (x > 0xff) throw new Error('Invalid base45 pair');
      out.push(x);
    } else throw new Error('Invalid base45 length');
  }
  return Uint8Array.from(out);
}

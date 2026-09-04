/** Encoding helpers for the canonical form. All integers are big-endian. */

export class ByteWriter {
  private chunks: Uint8Array[] = [];

  ascii(s: string): this {
    this.chunks.push(new TextEncoder().encode(s));
    return this;
  }

  /** String with a u8 length prefix. NFC-normalized before encoding. */
  str8(s: string): this {
    const b = new TextEncoder().encode(s.normalize("NFC"));
    if (b.length > 0xff) throw new RangeError(`str8 too long: ${b.length} > 255`);
    this.chunks.push(Uint8Array.of(b.length), b);
    return this;
  }

  /** String with a big-endian u16 length prefix. NFC-normalized before encoding. */
  str16(s: string): this {
    const b = new TextEncoder().encode(s.normalize("NFC"));
    if (b.length > 0xffff) throw new RangeError(`str16 too long: ${b.length} > 65535`);
    this.chunks.push(Uint8Array.of(b.length >> 8, b.length & 0xff), b);
    return this;
  }

  u32(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
      throw new RangeError(`u32 out of range: ${n}`);
    }
    this.chunks.push(Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff));
    return this;
  }

  /** i128 big-endian two's complement, 16 bytes. */
  i128(v: bigint): this {
    const MIN = -(2n ** 127n);
    const MAX = 2n ** 127n - 1n;
    if (v < MIN || v > MAX) throw new RangeError(`i128 out of range: ${v}`);
    let u = v < 0n ? v + 2n ** 128n : v;
    const out = new Uint8Array(16);
    for (let i = 15; i >= 0; i--) {
      out[i] = Number(u & 0xffn);
      u >>= 8n;
    }
    this.chunks.push(out);
    return this;
  }

  raw(b: Uint8Array): this {
    this.chunks.push(b);
    return this;
  }

  finish(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const fromHex = (h: string): Uint8Array => {
  if (h.length % 2 !== 0) throw new RangeError("hex string has an odd length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

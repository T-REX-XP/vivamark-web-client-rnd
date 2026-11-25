/** Independent bounded decoder of the statically recovered mode-1 RES format. */
export function validateImageResource(bytes: Uint8Array) {
  const fail = (message: string): never => { throw new Error(`Invalid RES: ${message}`); };
  if (!(bytes instanceof Uint8Array) || bytes.length < 0x457 || bytes.length > 300_000) fail('file size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const width = view.getUint16(0x44, true), height = view.getUint16(0x46, true);
  if (width < 1 || height < 1 || width > 360 || height > 360) fail('dimensions exceed 360×360 or are empty');
  const constants: [number, number][] = [[0,0x30335552],[4,0x00010300],[8,1],[12,0],[16,0],
    [0x14,0x18],[0x18,0x30],[0x1c,0x00540001],[0x20,0],[0x24,0x3c],[0x28,0x00500001],
    [0x2c,0],[0x30,0x100],[0x34,0x50],[0x38,0x400],[0x40,0x24010000],[0x4c,0x450]];
  for (const [at, expected] of constants) if (u32(at) !== expected) fail(`header constant at ${at.toString(16)}`);
  for (let at = 0x50; at < 0x450; at++) if (bytes[at]) fail('nonzero reserved header');
  const payloadBytes = u32(0x48);
  if (payloadBytes !== bytes.length - 0x450 || payloadBytes < height * 4) fail('payload length');
  // Kept independent of the encoder's shared CRC helper.
  const checksum = (start: number, end: number) => {
    let crc = 0;
    for (let at = start; at < end; at++) {
      crc ^= bytes[at] << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
    return crc;
  };
  if (view.getUint16(0x3e, true) !== checksum(0x450, bytes.length)) fail('payload CRC');
  if (view.getUint16(0x3c, true) !== checksum(0x3e, 0x50)) fail('header CRC');
  const rgba = new Uint8ClampedArray(width * height * 4);
  let expectedOffset = height * 4;
  for (let y = 0; y < height; y++) {
    const descriptor = u32(0x450 + y * 4), offset = descriptor & 0x1fffff, length = descriptor >>> 21;
    if (!length || offset !== expectedOffset || offset + length > payloadBytes) fail('row bounds, overlap, or gap');
    let at = 0x450 + offset, end = at + length, x = 0;
    const pixel = (word: number) => {
      if (x >= width) fail('row output overflow');
      const p = (y * width + x++) * 4, r = word >>> 11, g = (word >>> 5) & 63, b = word & 31;
      rgba[p] = (r << 3) | (r >>> 2); rgba[p+1] = (g << 2) | (g >>> 4); rgba[p+2] = (b << 3) | (b >>> 2); rgba[p+3] = 255;
    };
    while (at < end) {
      const tag = bytes[at++], count = tag & 127;
      if (!count || x + count > width) fail('RLE count');
      if (tag & 128) {
        if (at + 2 > end) fail('truncated repeat');
        const word = bytes[at] * 256 + bytes[at+1]; at += 2;
        for (let i = 0; i < count; i++) pixel(word);
      } else {
        if (at + count * 2 > end) fail('truncated literal');
        for (let i = 0; i < count; i++) { pixel(bytes[at] * 256 + bytes[at+1]); at += 2; }
      }
    }
    if (x !== width) fail('row output underflow');
    expectedOffset += length;
  }
  if (expectedOffset !== payloadBytes) fail('trailing unreferenced bytes');
  return { width, height, rgba, payloadBytes, crc16: view.getUint16(0x3e, true) };
}

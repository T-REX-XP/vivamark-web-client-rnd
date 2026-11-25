import { crc16 } from './crc16.mjs';

/** BmpConvert mode 1 reconstruction; byte-matched against 31 native ARM64
 * emulation fixtures. No physical badge validation.
 * Input is Canvas-style top-to-bottom RGBA bytes. Alpha is discarded by this mode.
 */
export function encodeImageRes(rgba, width, height) {
  if (!Number.isInteger(width) || width < 1 || width > 65535 ||
      !Number.isInteger(height) || height < 1 || height > 65535 ||
      rgba.length !== width * height * 4) throw new RangeError('Invalid image dimensions or RGBA length');
  const rows = [];
  let payloadSize = height * 4;
  for (let y = 0; y < height; y++) {
    const pixels = new Uint16Array(width);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[x] = ((rgba[p] & 0xf8) << 8) | ((rgba[p + 1] & 0xfc) << 3) | (rgba[p + 2] >> 3);
    }
    const row = [];
    const word = v => row.push(v >> 8, v & 255);
    for (let i = 0; i < width;) {
      let repeat = 1;
      while (i + repeat < width && repeat < 127 && pixels[i + repeat] === pixels[i]) repeat++;
      if (repeat >= 3) {
        row.push(0x80 | repeat); word(pixels[i]); i += repeat;
      } else {
        const start = i++;
        while (i < width && i - start < 127) {
          // Native lookahead stops at the 127-pixel literal window. A repeat
          // crossing that boundary is intentionally absorbed into literals.
          if (i + 2 < width && i + 2 - start < 127 &&
              pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2]) break;
          i++;
        }
        row.push(i - start);
        for (let j = start; j < i; j++) word(pixels[j]);
      }
    }
    if (row.length > 0x7ff || payloadSize > 0x1fffff) throw new RangeError('RES row descriptor limit exceeded');
    rows.push(Uint8Array.from(row)); payloadSize += row.length;
  }
  const output = new Uint8Array(0x450 + payloadSize);
  const view = new DataView(output.buffer);
  // Constants written by br28_bmp_to_res @ 0x11108..0x1116c.
  output.set([0x52,0x55,0x33,0x30,0x00,0x03,0x01,0x00,0x01,0x00,0x00,0x00]);
  view.setUint32(0x14, 0x18, true);
  view.setUint32(0x18, 0x30, true);
  view.setUint32(0x1c, 0x00540001, true);
  view.setUint32(0x24, 0x3c, true);
  view.setUint32(0x28, 0x00500001, true);
  view.setUint32(0x30, 0x100, true);
  view.setUint32(0x34, 0x50, true);
  view.setUint32(0x38, 0x400, true);
  view.setUint32(0x40, 0x24010000, true);
  view.setUint16(0x44, width, true);
  view.setUint16(0x46, height, true);
  view.setUint32(0x48, payloadSize, true);
  view.setUint32(0x4c, 0x450, true);
  let offset = height * 4;
  rows.forEach((row, y) => {
    view.setUint32(0x450 + y * 4, (row.length << 21) | offset, true);
    output.set(row, 0x450 + offset); offset += row.length;
  });
  view.setUint16(0x3e, crc16(output.subarray(0x450)), true);
  view.setUint16(0x3c, crc16(output.subarray(0x3e, 0x50)), true);
  return output;
}

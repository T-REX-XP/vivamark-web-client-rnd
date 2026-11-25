// Reconstructed from bluetooth/tool/ParseHelper.java. No hardware validation.
export const UUIDS = Object.freeze({
  service: '0000ae00-0000-1000-8000-00805f9b34fb',
  write: '0000ae01-0000-1000-8000-00805f9b34fb',
  notify: '0000ae02-0000-1000-8000-00805f9b34fb',
});

function byte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(name);
  return value;
}

export function encodePacket({ opcode, sequence, data = new Uint8Array(), command = true,
  needsResponse = true, status = 0, xmOpcode }) {
  byte(opcode, 'opcode'); byte(sequence, 'sequence'); byte(status, 'status');
  if (opcode === 1) byte(xmOpcode, 'xmOpcode');
  const payload = Uint8Array.from(data);
  const length = payload.length + (command ? 1 : 2) + (opcode === 1 ? 1 : 0);
  if (length > 65535) throw new RangeError('payload too large');
  const out = new Uint8Array(length + 8);
  out.set([0xfe, 0xdc, 0xba, (command ? 0x80 : 0) | (command && needsResponse ? 0x40 : 0),
    opcode, length >>> 8, length & 255]);
  let pos = 7;
  if (!command) out[pos++] = status;
  out[pos++] = sequence;
  if (opcode === 1) out[pos++] = xmOpcode;
  out.set(payload, pos);
  out[out.length - 1] = 0xef;
  return out;
}

// Auth packets are raw 5/17-byte records and must be routed separately before
// feeding RCSP bytes here. Notification boundaries are not frame boundaries.
export class RcspDecoder {
  constructor(maxBody = 65535) { this.buffer = new Uint8Array(); this.maxBody = maxBody; }
  push(bytes) {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer); joined.set(bytes, this.buffer.length); this.buffer = joined;
    const frames = [];
    while (this.buffer.length >= 3) {
      if (this.buffer[0] !== 0xfe || this.buffer[1] !== 0xdc || this.buffer[2] !== 0xba) {
        this.buffer = this.buffer.slice(1); continue;
      }
      if (this.buffer.length < 7) break;
      const b = this.buffer, length = b[5] * 256 + b[6], command = !!(b[3] & 0x80);
      const min = (command ? 1 : 2) + (b[4] === 1 ? 1 : 0);
      if (length < min || length > this.maxBody) { this.buffer = b.slice(1); continue; }
      if (b.length < length + 8) break;
      if (b[length + 7] !== 0xef) { this.buffer = b.slice(1); continue; }
      let pos = 7;
      const status = command ? undefined : b[pos++];
      const sequence = b[pos++], xmOpcode = b[4] === 1 ? b[pos++] : undefined;
      frames.push({ command, needsResponse: !!(b[3] & 0x40), opcode: b[4], status,
        sequence, xmOpcode, data: b.slice(pos, length + 7), raw: b.slice(0, length + 8) });
      this.buffer = b.slice(length + 8);
    }
    return frames;
  }
}

export function wallpaperDimension(kind, size = 360) {
  if (!['width', 'height'].includes(kind)) throw new RangeError('kind');
  // App encoding is a sum of two bytes, NOT uint16. Restrict to representable values.
  if (!Number.isInteger(size) || size < 0 || size > 510) throw new RangeError('size');
  return Uint8Array.of(0xaa, 0xf0, kind === 'width' ? 0x45 : 0x46,
    Math.max(size - 255, 0), Math.min(size, 255), 0x55);
}

export const deviceInfoQuery = sequence => encodePacket({ opcode: 3, sequence,
  data: Uint8Array.of(255, 255, 255, 255, 0) });

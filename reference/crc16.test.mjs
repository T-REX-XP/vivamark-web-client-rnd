import assert from 'node:assert/strict';
import { crc16, crc16BigEndian } from './crc16.mjs';

const text = new TextEncoder().encode('123456789');
assert.equal(crc16(new Uint8Array()), 0);
assert.equal(crc16(new Uint8Array(), 0xabcd), 0xabcd);
assert.equal(crc16(null, 0xabcd), 0); // Java wrapper, distinct from empty input.
assert.equal(crc16(text), 0x31c3); // CRC-16/XMODEM published check value.
assert.equal(crc16(text, 0xffff), 0x29b1); // CRC-16/IBM-3740 check.
assert.equal(crc16(Uint8Array.of(0xff)), 0x1ef0);
assert.equal(crc16(Uint8Array.from({ length: 256 }, (_, i) => i)), 0x7e55);
assert.deepEqual(crc16BigEndian(text), Uint8Array.of(0x31, 0xc3));

// Independent transcription of the 16 table entries and two nibble updates
// recovered from the native function, compared with the bitwise implementation.
const nativeTable = [0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5,
  0x60c6, 0x70e7, 0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad,
  0xe1ce, 0xf1ef];
function recoveredNibbleCrc(bytes, crc) {
  for (const byte of bytes) {
    crc = (nativeTable[(byte >>> 4) ^ ((crc & 0xf000) >>> 12)] ^ (crc << 4)) & 0xffff;
    crc = (nativeTable[(byte & 0xf) ^ ((crc & 0xf000) >>> 12)] ^ (crc << 4)) & 0xffff;
  }
  return crc;
}
for (const seed of [0, 1, 0x1234, 0x8000, 0xffff]) {
  for (let byte = 0; byte < 256; byte++) {
    const bytes = Uint8Array.of(byte);
    assert.equal(crc16(bytes, seed), recoveredNibbleCrc(bytes, seed));
  }
  for (let cut = 0; cut <= text.length; cut++) {
    assert.equal(crc16(text.subarray(cut), crc16(text.subarray(0, cut), seed)), crc16(text, seed));
  }
}
console.log('CRC16 vectors, serialization, nibble equivalence, and incremental checks passed.');

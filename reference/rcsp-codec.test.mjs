import { strict as assert } from 'node:assert';
import { encodePacket, RcspDecoder, wallpaperDimension, deviceInfoQuery } from './rcsp-codec.mjs';
const hex = s => Uint8Array.from(s.split(' ').map(b => parseInt(b, 16)));
// Independent wire fixtures derived from ParseHelper's field offsets.
const width = hex('fe dc ba c0 ff 00 07 00 aa f0 45 69 ff 55 ef');
assert.deepEqual(encodePacket({opcode:255, sequence:0, data:wallpaperDimension('width')}), width);
assert.deepEqual(deviceInfoQuery(0x12), hex('fe dc ba c0 03 00 06 12 ff ff ff ff 00 ef'));
const response = hex('fe dc ba 00 ff 00 02 00 00 ef');
const decoder = new RcspDecoder();
assert.equal(decoder.push(width.slice(0, 2)).length, 0);
assert.equal(decoder.push(width.slice(2, 10)).length, 0);
let frames = decoder.push(Uint8Array.from([...width.slice(10), ...response]));
assert.equal(frames.length, 2); assert.equal(frames[1].status, 0);
assert.equal(frames[1].sequence, 0); assert.equal(frames[1].command, false);
// Embedded terminator in data is ordinary data, not an end-of-frame marker.
const dataFrame = hex('fe dc ba 80 01 00 04 22 1b ef 01 ef');
frames = new RcspDecoder().push(dataFrame);
assert.equal(frames[0].xmOpcode, 27); assert.deepEqual(frames[0].data, Uint8Array.of(239, 1));
// Recover after noise, impossible lengths and a damaged end marker.
const damaged = width.slice(); damaged[damaged.length - 1] = 0;
frames = new RcspDecoder(1024).push(Uint8Array.from([0, 1, ...damaged, ...response]));
assert.equal(frames.length, 1); assert.equal(frames[0].command, false);
assert.throws(() => wallpaperDimension('width', 511));
assert.throws(() => encodePacket({opcode:1, sequence:0}));
console.log('RCSP wire fixtures, fragmentation, concatenation and resynchronization passed');

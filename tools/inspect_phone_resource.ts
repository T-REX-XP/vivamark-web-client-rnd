/** Read-only inspection of a locally pulled original-app resource. No BLE. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateImageResource } from '../app/src/lib/resource-validation';
import { encodeImageRes } from '../reference/image-res.mjs';

const path = process.argv[2] ?? 'artifacts/hardware/phone-TEST.RES';
const bytes = new Uint8Array(readFileSync(path));
const decoded = validateImageResource(bytes);
const encoded = encodeImageRes(decoded.rgba, decoded.width, decoded.height);
const mismatch = bytes.findIndex((value, index) => value !== encoded[index]);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const report = {
  source: 'Existing original Android app-owned TEST.RES pulled read-only; device acceptance not observed',
  sha256: sha256(bytes),
  fileBytes: bytes.length,
  width: decoded.width, height: decoded.height,
  magic: Buffer.from(bytes.subarray(0, 4)).toString('ascii'),
  formatFlagsHex: Buffer.from(bytes.subarray(0x40, 0x44)).toString('hex'),
  dataOffset: view.getUint32(0x4c, true),
  payloadBytes: decoded.payloadBytes,
  payloadCrc16Hex: decoded.crc16.toString(16).padStart(4, '0'),
  headerCrc16Hex: view.getUint16(0x3c, true).toString(16).padStart(4, '0'),
  independentValidation: 'All constants, reserved bytes, dimensions, both CRCs, row ranges, RLE tokens and exact pixel counts passed',
  reencodedBytes: encoded.length,
  reencodedSha256: sha256(encoded),
  reencodingByteIdentical: encoded.length === bytes.length && mismatch === -1,
  firstMismatch: mismatch,
  hardwareUploadObserved: false,
};
writeFileSync('artifacts/hardware/phone-resource-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.reencodingByteIdentical) process.exitCode = 1;

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeImageRes } from './image-res.mjs';
const root = new URL('../artifacts/image-fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const digest = b => createHash('sha256').update(b).digest('hex');
const library=new URL('../artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so', import.meta.url);
if(existsSync(library))assert.equal(digest(readFileSync(library)), manifest.library_sha256);
else console.log('Native library excluded from publication; checking all retained fixture hashes and outputs. Regeneration requires local R&D inputs.');
let failed = 0;
for (const f of manifest.fixtures) {
  const rgba = readFileSync(new URL(f.name + '.rgba', root));
  const native = readFileSync(new URL(f.name + '.res', root));
  assert.equal(digest(rgba), f.rgba_sha256);
  assert.equal(digest(native), f.res_sha256);
  const js = encodeImageRes(rgba, f.width, f.height);
  const mismatch = native.findIndex((byte, i) => byte !== js[i]);
  if (native.length !== js.length || mismatch !== -1) {
    failed++;
    console.error(`${f.name}: native ${native.length} bytes / JS ${js.length} bytes; first mismatch ${mismatch}`);
  }
}
assert.equal(failed, 0, 'Native image fixture differences');
console.log(`Native ARM64 / JavaScript image conversion matched byte-for-byte for ${manifest.fixtures.length} fixtures.`);

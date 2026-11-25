import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAuthChallenge, deriveAuthResponse } from './jieli-auth.mjs';

test('rejects invalid challenge representation, size and packet type', () => {
  for (const bad of [null, [], new Uint8Array(16), new Uint8Array(18)]) {
    assert.throws(() => deriveAuthResponse(bad), TypeError);
  }
  const responsePacket = new Uint8Array(17);
  responsePacket[0] = 1;
  assert.throws(() => deriveAuthResponse(responsePacket), RangeError);
  assert.throws(() => deriveAuthResponse(new Uint8Array(17), new Uint8Array(15)), TypeError);
});

test('returns independent deterministic response and preserves caller buffers', () => {
  const challenge = Uint8Array.from({ length: 17 }, (_, i) => i === 0 ? 0 : i - 1);
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const savedChallenge = challenge.slice();
  const savedKey = key.slice();
  const first = deriveAuthResponse(challenge, key);
  const second = deriveAuthResponse(challenge, key);
  assert.equal(first.length, 17);
  assert.equal(first[0], 1);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.deepEqual(challenge, savedChallenge);
  assert.deepEqual(key, savedKey);
  first.fill(0xff);
  assert.deepEqual(deriveAuthResponse(challenge, key), second);
});

test('uses all supplied key bytes, including nonzero-offset typed array views', () => {
  const challenge = new Uint8Array(17);
  const backing = new Uint8Array(30).fill(0xff);
  const key = backing.subarray(7, 23);
  key.fill(0);
  const baseline = deriveAuthResponse(challenge, key);
  assert.deepEqual(baseline, deriveAuthResponse(challenge, new Uint8Array(16)));
  for (let i = 0; i < 16; i++) {
    const changed = key.slice();
    changed[i] = 1;
    assert.notDeepEqual(deriveAuthResponse(challenge, changed), baseline, `key byte ${i}`);
  }
  assert.notDeepEqual(baseline, deriveAuthResponse(challenge));
});

test('challenge generation fills only 16 random bytes and keeps prefix zero', () => {
  let calls = 0;
  const challenge = createAuthChallenge({
    getRandomValues(view) {
      calls++;
      assert.equal(view.length, 16);
      assert.equal(view.byteOffset, 1);
      view.fill(0xa5);
      return view;
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(challenge, Uint8Array.from([0, ...Array(16).fill(0xa5)]));
  assert.throws(() => createAuthChallenge(null), TypeError);
});

test('matches 552 original ARM64 function outputs retained from Unicorn', () => {
  const report = JSON.parse(fs.readFileSync(new URL('../artifacts/auth-native-vectors.json', import.meta.url), 'utf8'));
  assert.equal(report.sourceSha256, 'ef9d3c61b0f970522490e6e9b46ca3f467206306ce55c42e8fd763c383318fdb');
  assert.equal(report.nativeEntryVirtualAddress, '0x12c0');
  assert.equal(report.vectorCount, 552);
  assert.equal(report.matchedCount, 552);
  assert.equal(report.vectors.length, 552);
  assert.deepEqual(report.mismatches, []);
  for (const row of report.vectors) {
    const response = deriveAuthResponse(Uint8Array.from(Buffer.from(row.challenge, 'hex')), Uint8Array.from(Buffer.from(row.linkKey, 'hex')));
    assert.equal(Buffer.from(response).toString('hex'), row.response, row.label);
  }
});

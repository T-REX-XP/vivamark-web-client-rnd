// ARM64 translation: 552 vectors matched original instructions in Unicorn.
// No badge handshake/hardware validation. See docs/auth-validation.md.
// Source: libjl_bluetooth.so SHA256 ef9d3c61b0f970522490e6e9b46ca3f467206306ce55c42e8fd763c383318fdb
// Regenerate with python tools/generate_auth_reference.py from repository root.
const hex = value => Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
const BIAS = hex("77f156247e471b86bd708e1e3b73160364ac285ac9b337c50a10b7a3bab197463d05dc666ef69af80d589567c6aaabeca0689b96d4ebbf434936e96a89d8c38a946399bc7bbec122bb5c71d51f92575d8f44411d51e64017fbfd193234b8612aca236fda39f7a2017fd631e7de8004dd2c5982afa8e00fcda1123e30d11cd03a33722e4f9002130675ce87c2efb2ad7d3815e1529f7a6c2f27c4e281a9cf8dc0d7dfff6076148c5e5509e408c74220fcd25091d94c629ee8b9a6f91a00210bfa359c4e4b6948cb0ec8a45bea8407b418f4ae6bdba7cc3f8b4a0c3c25e5544d4583ed11f0b05393f27426b59d6d7cf32df156247e471b86bd708e1e3b731603b6ac285ac9b337c50a10b7a3bab1974688");
const EXP = hex("012de293be4515ae780387a4b838cf3f08670994eb26a86bbd18341bbbbf72f74035489c512f3b55e3c09fd8d3f38db1ffa73edc8677d7a611fbf4ba92916483f133efda2cb5b22b88d199cb8c841d14819771ca5fa38b573c82c4525c1ce8a004b4854af61354b6df0c1a8edee039fc209b244ea9989eabf260d06ceafac7d900d41f6e43bcec5389fe7a5d49c932c2f99af86d16db599644e9cde646428f0ac1ccb965b0d2c6ac1e4162292e0e7450025ac3257b8a2a5bf0060d476f709d7e10ce1227d54c4fd679306836757de4ed806a9037a25e76aac57f3dafa5e51961fd4d7cb70beead4b22f5e7732321c805e166ddb3586963560fa1319517073a28");
const LOG = hex("8000b00960efb9fd10129fe469baadf8c038c2654f0694fc19de6a1b5d4ea88270ede8ec72b315c3ffabb6474401ac25c9fa8e411a21cbd30d6efe2658da320f20a99d8498059cbb228c63e7c5e173c6af245b876627f757f496b1b75c8bd55479dfaaf63ea3f111caf5d1177b9383bcbd521eebaeccd63508c88ab4e2cdbfd9d050593f4d62340a4888b5564c2e6b9ed23d3c0313fb9751754a917123be762a5ff9d4550bdc37311674d777a7e607dba42f46f3614567e30ca23b1c8518041d29a08fb25ad8a67eee8d534ba19ac10e7a49a52c81c4c7362b7f439533f26c686df00228cedd9bea5e997c1486cfe542b840782d3ae9641f92907d396fe08930");
const DEFAULT_LINK_KEY = hex("06775f87918dd423005df1d8cf0c142b");
const FIXED_SEED = hex("112233332211");

function requireBytes(value, length, name) {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${name} must be a Uint8Array of length ${length}`);
  }
}

// Native key expansion 0x17bc..0x18bc. 17 subkeys of 16 bytes.
function schedule(key) {
  const keys = new Uint8Array(272);
  keys.set(key);
  const ring = new Uint8Array(17);
  ring.set(key);
  for (const byte of key) ring[16] ^= byte;
  for (let round = 1; round <= 16; round++) {
    for (let i = 0; i < 17; i++) ring[i] = (ring[i] << 3) | (ring[i] >>> 5);
    for (let i = 0; i < 16; i++) {
      keys[round * 16 + i] = ring[(round + i) % 17] + BIAS[round * 16 + 15 - i];
    }
  }
  return keys;
}

// Literal arithmetic translation of 0x1924..0x1aac.
function diffuse(state) {
  const r = new Uint32Array(31);
  r[16] = state[0];
  r[17] = state[1];
  r[3] = state[2];
  r[4] = state[3];
  r[6] = state[4];
  r[20] = state[5];
  r[7] = r[17] + r[16] * 2;
  r[16] = r[17] + r[16];
  r[17] = r[4] + r[3] * 2;
  r[21] = state[6];
  r[22] = state[7];
  r[5] = r[4] + r[3];
  r[3] = state[8];
  r[4] = state[9];
  r[19] = r[20] + r[6] * 2;
  r[23] = r[20] + r[6];
  r[24] = r[22] + r[21] * 2;
  r[25] = r[22] + r[21];
  r[22] = state[12];
  r[20] = r[4] + r[3] * 2;
  r[26] = state[13];
  r[27] = r[4] + r[3];
  r[3] = state[14];
  r[4] = state[15];
  r[6] = state[10];
  r[21] = state[11];
  r[30] = r[26] + r[22] * 2;
  r[26] = r[26] + r[22];
  r[8] = r[4] + r[3] * 2;
  r[22] = r[4] + r[3];
  r[1] = r[5] + r[19] * 2;
  r[28] = r[21] + r[6] * 2;
  r[21] = r[21] + r[6];
  r[4] = r[22] + r[30] * 2;
  r[6] = r[21] + r[20] * 2;
  r[3] = r[21] + r[20];
  r[21] = r[22] + r[30];
  r[30] = r[26] + r[8] * 2;
  r[13] = r[28] + r[27];
  r[20] = r[23] + r[24] * 2;
  r[23] = r[24] + r[23];
  r[24] = r[25] + r[7];
  r[22] = r[16] + r[17] * 2;
  r[2] = r[13] + r[30] * 2;
  r[7] = r[25] + r[7] * 2;
  r[25] = r[24] + r[1];
  r[27] = r[27] + r[28] * 2;
  r[5] = r[19] + r[5];
  r[8] = r[8] + r[26];
  r[28] = r[25] + r[2] * 2;
  r[2] = r[2] + r[25];
  r[25] = r[23] + r[6] * 2;
  state[1] = r[2];
  r[2] = r[21] + r[22];
  r[16] = r[17] + r[16];
  r[19] = r[2] + r[25] * 2;
  r[2] = r[2] + r[25];
  r[17] = r[8] + r[27];
  state[3] = r[2];
  r[2] = r[5] + r[7] * 2;
  r[1] = r[24] + r[1] * 2;
  state[2] = r[19];
  r[13] = r[30] + r[13];
  r[8] = r[8] + r[27] * 2;
  r[19] = r[17] + r[2] * 2;
  r[17] = r[17] + r[2];
  r[2] = r[16] + r[20] * 2;
  state[5] = r[17];
  r[17] = r[4] + r[3];
  r[16] = r[20] + r[16];
  state[4] = r[19];
  r[19] = r[17] + r[2] * 2;
  r[17] = r[17] + r[2];
  r[2] = r[21] + r[22] * 2;
  state[7] = r[17];
  r[17] = r[13] + r[1] * 2;
  r[13] = r[13] + r[1];
  r[1] = r[6] + r[23];
  state[9] = r[13];
  r[13] = r[1] + r[2] * 2;
  state[8] = r[17];
  r[17] = r[2] + r[1];
  state[10] = r[13];
  r[13] = r[16] + r[8] * 2;
  r[8] = r[8] + r[16];
  r[16] = r[3] + r[4] * 2;
  state[13] = r[8];
  r[8] = r[7] + r[5];
  state[12] = r[13];
  r[13] = r[8] + r[16] * 2;
  r[8] = r[16] + r[8];
  state[0] = r[28];
  state[6] = r[19];
  state[11] = r[17];
  state[15] = r[8];
  state[14] = r[13];
}

// Native 0x18c4..0x1d00. Operations wrap modulo 256 on each byte store.
function cipher(block, key, modified) {
  const state = block.slice();
  const original = block.slice();
  const keys = schedule(key);
  for (let round = 0; round < 8; round++) {
    if (modified && round === 2) {
      for (let i = 0; i < 16; i++) {
        state[i] = (0x9999 & (1 << i)) ? state[i] ^ original[i] : state[i] + original[i];
      }
    }
    for (let i = 0; i < 16; i++) {
      const isXor = !!(0x9999 & (1 << i));
      state[i] = isXor ? state[i] ^ keys[round * 32 + i] : state[i] + keys[round * 32 + i];
      state[i] = isXor ? EXP[state[i]] : LOG[state[i]];
      state[i] = isXor ? state[i] + keys[round * 32 + 16 + i] : state[i] ^ keys[round * 32 + 16 + i];
    }
    diffuse(state);
  }
  for (let i = 0; i < 16; i++) {
    state[i] = (0x9999 & (1 << i)) ? state[i] ^ keys[256 + i] : state[i] + keys[256 + i];
  }
  return state;
}

/** Pure static translation of getEncryptedAuthData for valid 17-byte challenges.
 * JNI function 0x2160 calls function_E1test -> 0x12c4.
 * Differentially matched 552 native-emulated vectors; no badge handshake tested.
 */
export function deriveAuthResponse(challenge, linkKey = DEFAULT_LINK_KEY) {
  requireBytes(challenge, 17, 'challenge');
  if (challenge[0] !== 0) throw new RangeError('challenge prefix must be 0x00');
  requireBytes(linkKey, 16, 'linkKey');
  const random = challenge.slice(1);
  const stage = cipher(random, linkKey, false);
  for (let i = 0; i < 16; i++) stage[i] = (stage[i] ^ random[i]) + FIXED_SEED[i % 6];
  // Native 0x151c..0x15dc: alternating subtract/xor with explicit constants.
  const changedKey = Uint8Array.from([
    linkKey[0] - 0x17, linkKey[1] ^ 0xe5, linkKey[2] - 0x21, linkKey[3] ^ 0xc1,
    linkKey[4] - 0x4d, linkKey[5] ^ 0xa7, linkKey[6] - 0x6b, linkKey[7] ^ 0x83,
    linkKey[8] ^ 0xe9, linkKey[9] - 0x1b, linkKey[10] ^ 0xdf, linkKey[11] - 0x3f,
    linkKey[12] ^ 0xb3, linkKey[13] - 0x59, linkKey[14] ^ 0x95, linkKey[15] - 0x7d,
  ]);
  const response = new Uint8Array(17);
  response[0] = 1;
  response.set(cipher(stage, changedKey, true), 1);
  return response;
}

/** Produce the raw 00 || random16 auth challenge, without invoking native rand(). */
export function createAuthChallenge(randomBytes = globalThis.crypto) {
  if (!randomBytes || typeof randomBytes.getRandomValues !== 'function') {
    throw new TypeError('A crypto.getRandomValues provider is required');
  }
  const challenge = new Uint8Array(17);
  randomBytes.getRandomValues(challenge.subarray(1));
  return challenge;
}

"""Translate the recovered auth arithmetic and extract tables. Does not execute ELF code."""
from pathlib import Path
import hashlib, re
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM

target = Path('artifacts/extracted/native/lib/arm64-v8a/libjl_bluetooth.so')
with target.open('rb') as stream:
    elf = ELFFile(stream)
    def read(address, length):
        for seg in elf.iter_segments():
            if seg['p_type'] == 'PT_LOAD' and seg['p_vaddr'] <= address < seg['p_vaddr'] + seg['p_filesz']:
                offset = address - seg['p_vaddr']
                return seg.data()[offset:offset + length]
        raise ValueError(hex(address))
    lines = []
    for insn in Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(read(0x1924, 0x1ab0 - 0x1924), 0x1924):
        op = insn.op_str
        if insn.mnemonic == 'ldrb':
            m = re.fullmatch(r'w(\d+), \[x0(?:, #(0x[0-9a-f]+|\d+))?\]', op)
            assert m, op
            lines.append(f'  r[{m[1]}] = state[{int(m[2] or "0", 0)}];')
        elif insn.mnemonic == 'strb':
            m = re.fullmatch(r'w(\d+), \[x0(?:, #(0x[0-9a-f]+|\d+))?\]', op)
            assert m, op
            lines.append(f'  state[{int(m[2] or "0", 0)}] = r[{m[1]}];')
        elif insn.mnemonic == 'add' and op.startswith('w'):
            m = re.fullmatch(r'w(\d+), w(\d+), w(\d+)(?:, lsl #(\d+))?', op)
            assert m, op
            factor = f' * {1 << int(m[4])}' if m[4] else ''
            lines.append(f'  r[{m[1]}] = r[{m[2]}] + r[{m[3]}]{factor};')
        elif insn.mnemonic in ('add', 'cmp'):
            pass  # x9/x15 loop bookkeeping, performed by cipher() below
        else:
            raise ValueError(f'{insn.address:x}: {insn.mnemonic} {op}')
    constants = { 'BIAS': read(0x9b8, 272), 'EXP': read(0xac8,256), 'LOG': read(0xbc8,256),
                  'DEFAULT_LINK_KEY': read(0xa790,16), 'FIXED_SEED': read(0xa7a0,6) }

header = '''// ARM64 translation: 552 vectors matched original instructions in Unicorn.
// No badge handshake/hardware validation. See docs/auth-validation.md.
// Source: libjl_bluetooth.so SHA256 DIGEST
// Regenerate with python tools/generate_auth_reference.py from repository root.
const hex = value => Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
'''.replace('DIGEST', hashlib.sha256(target.read_bytes()).hexdigest())
for name, value in constants.items():
    header += f'const {name} = hex("{value.hex()}");\n'
header += '''
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
'''
body = '''}

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
'''
Path('reference/jieli-auth.mjs').write_text(header + '\n'.join(lines) + '\n' + body, encoding='utf-8')
print('Wrote reference/jieli-auth.mjs; native implementation was not executed.')

# Native Jieli authentication extraction

Status: the handshake is recovered from Java; the native response calculation has a complete translation in [jieli-auth.mjs](../reference/jieli-auth.mjs). **All 552 differential vectors match execution of the original ARM64 instructions in Unicorn.** An Android app session and physical badge handshake remain untested. See [auth-validation.md](auth-validation.md) for the evidence and limits.

## Artifact and recovery method

Source: `artifacts/extracted/native/lib/arm64-v8a/libjl_bluetooth.so`, extracted from the supplied arm64 split APK.

SHA-256: `ef9d3c61b0f970522490e6e9b46ca3f467206306ce55c42e8fd763c383318fdb`.

REA opened the ELF, but native decompilation was unavailable on the configured Windows host. Recovery used pyelftools to read ELF segments, relocations and tables, and Capstone for offline ARM64 disassembly. The full `.text` disassembly is retained in [auth-disassembly.txt](../artifacts/auth-disassembly.txt). A later differential check executed only the original cipher function in an isolated Unicorn ARM64 emulator, with allocation and TLS modeled. JNI and Bluetooth were not invoked. Addresses below are ELF virtual addresses before ASLR relocation.

The JNI method registration table begins at `0xa730`. ELF `R_AARCH64_RELATIVE` relocations bind the following methods on `com/jieli/bluetooth/impl/RcspAuth`:

| Java native method | Function VA | Interpretation |
|---|---:|---|
| `nativeInit(): boolean` | `0x1f08` | Saves JVM/object references and checks initialization |
| `getRandomAuthData(): byte[]` | `0x1fb4` | Returns `00` followed by 16 low bytes from native `rand()` calls |
| `setLinkKey(byte[]): int` | `0x20c0` | Copies exactly 16 bytes into the link key; returns 0 for valid length and 3 for null/other length |
| `getEncryptedAuthData(byte[]): byte[]` | `0x2160` | Returns `01` followed by the response transform of input bytes 1..16 |

The native function does not safely validate all challenge lengths; the Java path filters valid authentication packets. The reference JavaScript deliberately requires exactly 17 bytes and the `00` challenge prefix.

## Wire handshake

Source: `com/jieli/bluetooth/impl/RcspAuth.java`, especially `startAuth`, `handleAuthData`, `getAuthOkData`; activation is in `com/jieli/bluetooth/impl/rcsp/RcspOpImpl.java`.

Authentication uses **raw characteristic data**, separate from `FE DC BA ... EF` RCSP framing:

1. App sends `00 || random16`.
2. Badge sends `01 || response16`. App derives the expected response from its original challenge and compares all 17 bytes.
3. If equal, app sends `02 70 61 73 73` (`02` + ASCII `pass`).
4. Badge sends its own `00 || random16` challenge. App replies with `01 || response16` calculated for that challenge.
5. Badge sends `02 70 61 73 73`. The Java app then marks authentication complete.

The handler is stateful: once the app has verified the first response, it accepts a peer challenge in that phase or the final `pass`. Do not invent a second RCSP wrapper around these packets. The first challenge is retried at two-second intervals, at most twice after the initial send; subsequent authentication progress also uses a two-second timeout. These are app timer values, not measured badge limits.

`JBmanager.initjl()` explicitly sets `useDeviceAuth=true`; a web implementation should implement this handshake before device information or upload commands. There is no claim here that the badge firmware rejects unauthenticated packets: that requires runtime evidence.

## Default constants

| Purpose | VA | Bytes |
|---|---:|---|
| Mutable 16-byte default link key | `0xa790` | `06 77 5f 87 91 8d d4 23 00 5d f1 d8 cf 0c 14 2b` |
| Fixed six-byte seed | `0xa7a0` | `11 22 33 33 22 11` |
| Key expansion bias bytes, 272 bytes | `0x9b8` | Extracted verbatim by generator |
| First substitution table, 256 bytes | `0xac8` | Extracted verbatim by generator |
| Second substitution table, 256 bytes | `0xbc8` | Extracted verbatim by generator |

No app-side call changing the connection link key was found in the exported `com.neo` classes. The SDK exposes such an API, so a runtime or another integration can change it; this report does not establish all possible firmware keys.

## Response calculation

JNI at `0x2160` calls PLT entry `0x2440`, resolved to exported `function_E1test` at `0x12c0`, a branch to `0x12c4`. Its four inputs are fixed seed, 16 challenge bytes, link key, and output buffer. This is distinct from exported `function_E21`; do not substitute that similarly named function for authentication.

The calculation recovered from `0x12c4..0x162c` is:

```text
R = challenge[1:17]
S = blockTransform(R, linkKey, modified=false)
for i in 0..15:
    S[i] = ((S[i] XOR R[i]) + fixedSeed[i mod 6]) mod 256
K2 = mutate(linkKey)
S = blockTransform(S, K2, modified=true)
response = 01 || S
```

`mutate` applies the following operations, with byte wrapping:

```text
[ -17, XOR E5, -21, XOR C1, -4D, XOR A7, -6B, XOR 83,
  XOR E9, -1B, XOR DF, -3F, XOR B3, -59, XOR 95, -7D ]
```

All numbers in that list are hexadecimal. These constants are visible at `0x151c..0x15dc`.

### Block transform

The native implementation is a SAFER-like byte cipher, not a call to standard AES, HMAC, or WebCrypto. The algorithm identity is an analyst description; use the recovered operations and tables rather than selecting a standard cipher by name.

Key expansion (`0x17bc..0x18bc`) forms 17 subkeys of 16 bytes. Subkey zero is the input key. A 17-byte ring consists of the key followed by XOR parity of all key bytes. For each round 1..16, rotate each ring byte left three bits, select 16 ring bytes starting at the round index, then add reverse-ordered bias bytes from `BIAS[round*16 .. round*16+15]` modulo 256.

The transform (`0x18c4..0x1d00`) performs eight rounds. Positions selected by bitmask `0x9999` are indices 0, 3, 4, 7, 8, 11, 12, 15.

1. Only for `modified=true`, before round index 2 (the third round), mix in the block's original input: XOR at selected positions, addition elsewhere.
2. Mix subkey `2*round`: XOR at selected positions, addition elsewhere.
3. Substitute selected positions through the first table; substitute other positions through the second table.
4. Mix subkey `2*round+1`: addition at selected positions, XOR elsewhere.
5. Apply the recovered linear byte diffusion at `0x1924..0x1aac`.

After eight rounds, mix subkey 16 using XOR at selected positions and addition elsewhere. Every byte store wraps modulo 256. The JavaScript diffusion function is a literal transcription of the native register arithmetic, preserving its order and final byte writes.

## Reference usage and validation boundary

```js
import { createAuthChallenge, deriveAuthResponse } from '../reference/jieli-auth.mjs';

const challenge = createAuthChallenge();
const expectedResponse = deriveAuthResponse(challenge);
// Send challenge raw; compare expectedResponse to the peer response.
// Respond to a later peer challenge with deriveAuthResponse(peerChallenge).
```

The browser challenge generator uses `crypto.getRandomValues` instead of reproducing native `rand()`. The observed protocol transmits random bytes explicitly, so matching a particular native PRNG sequence is not implied by the code. Acceptance of independently generated challenges still needs device verification.

Reproduce the port from the extracted ELF:

```powershell
python tools/generate_auth_reference.py
node --check reference/jieli-auth.mjs
node --test reference/jieli-auth.test.mjs
```

Five passing unit tests cover API validation, deterministic results, input/output buffer independence, influence of all 16 supplied key bytes, nonzero-offset typed-array views, the challenge generator's random-byte span, and all 552 retained native-emulated vectors.

For input `00 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f`, the original native function under emulation and the JavaScript both produce `01 e5 80 7e 88 7b de 07 63 0b 4d 0e 71 5b 3e 89 91`. This is an **emulated native vector**, not a captured badge packet. The mutual-authentication handshake still requires hardware verification, including notification boundaries, timer behavior, firmware key selection, and peer acceptance.

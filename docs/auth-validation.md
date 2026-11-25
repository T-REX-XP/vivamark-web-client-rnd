# Authentication: native differential validation

## Result

**552 / 552 JavaScript responses match execution of the shipped ARM64 response function. No mismatches.**

The test executes original machine instructions from `libjl_bluetooth.so`, rather than comparing two translations of the cipher. Native responses are retained in [auth-native-vectors.json](../artifacts/auth-native-vectors.json), and replayed in [jieli-auth.test.mjs](../reference/jieli-auth.test.mjs).

This validates the response calculation for the tested inputs under emulation. It does not validate an end-to-end badge connection, the full JNI lifecycle, badge firmware behavior, image uploads, filesystem writes, or recovery after a lost connection. No Bluetooth operations or badge writes were performed by this harness.

## Original code identity

| Field | Value |
|---|---|
| APK library | `artifacts/extracted/native/lib/arm64-v8a/libjl_bluetooth.so` |
| SHA-256 | `ef9d3c61b0f970522490e6e9b46ca3f467206306ce55c42e8fd763c383318fdb` |
| Entry | `function_E1test`, ELF VA `0x12c0` (branch to `0x12c4`) |
| Native caller | JNI `getEncryptedAuthData`, VA `0x2160` |
| Emulator | Unicorn 2.1.4, ARM64 |
| ELF reader | pyelftools 0.33 |
| Disassembler used during extraction | Capstone 5.0.9 |

The harness checks the exact library digest before running. It loads the original ELF segments at an arbitrary mapped base and applies relative relocations. Native code derives each 16-byte response from the six-byte fixed seed, 16-byte random challenge and 16-byte link key. The harness prepends the `01` response marker, matching the observed JNI wrapper.

## Modeled boundaries

The harness [emulate_auth.py](../tools/emulate_auth.py) models only:

- `malloc`: a bounded emulated heap returns one allocation, poisoned with `A5` bytes to detect accidental reliance on zero-initialized allocation.
- `free`: a no-op within the per-call bounded heap.
- Thread-local storage: `TPIDR_EL0` and the stack-canary slot.
- A sentinel caller return address.

The original library's arithmetic, byte substitution, key scheduling, diffusion, loops, stack loads/stores and stack-canary comparison execute in Unicorn. Unexpected external calls and native stack-canary failure raise an error. Each call has a two-second emulation deadline and a one-million-instruction cap; completion requires reaching the sentinel and exactly one native allocation.

The JNI methods, Android runtime, native random-number generator and Bluetooth APIs are not executed. Passing explicit key bytes into the cipher verifies custom-key handling but does not prove a particular badge uses the default key.

## Coverage

The 552 vectors comprise:

| Cases | Count |
|---|---:|
| Repeated challenge bytes `00`, `01`, `7F`, `80`, `FE`, `FF` | 6 |
| Ascending and descending challenge bytes | 2 |
| A high bit isolated in each of 16 challenge bytes | 16 |
| An inverted byte isolated in each of 16 default-key positions | 16 |
| Deterministic random challenges with the default key | 256 |
| Deterministic random challenges with independent random keys | 256 |
| Total | 552 |

The deterministic Python seed is `0x564956414d41524b`. The report records every challenge, key and emulated response. A representative native vector is:

```text
challenge: 00000102030405060708090a0b0c0d0e0f
link key:  06775f87918dd423005df1d8cf0c142b
response:  01e5807e887bde07630b4d0e715b3e8991
```

## Reproduce

Use the project-local virtual environment; dependencies are not installed globally:

```powershell
python -m venv .venv-native
.\.venv-native\Scripts\python.exe -m pip install unicorn==2.1.4 pyelftools==0.33 capstone==5.0.9
.\.venv-native\Scripts\python.exe tools/emulate_auth.py
node --test reference/jieli-auth.test.mjs
```

The harness compares all freshly emulated responses against the JavaScript module through Node and fails on any mismatch. The JavaScript tests also replay the retained native vectors without requiring Python or Unicorn. Replaying stored vectors is a regression check; rerunning the Python harness independently executes the original ARM64 code.

## Remaining hardware proof

Before enabling upload, connect to the real badge, subscribe to notifications, complete both directions of the recovered challenge/response handshake, and require the final `02 70 61 73 73` marker. Record the complete timestamped TX/RX exchange and the firmware/model identity. A correct response calculation alone cannot prove that notification framing, connection initialization, firmware keys or timeout behavior match a physical device.

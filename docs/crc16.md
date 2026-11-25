# Recovered Jieli CRC16

## Result

The file-transfer checksum is **CRC-16/XMODEM** when called with seed zero:

| Property | Value |
| --- | --- |
| Width | 16 bits |
| Polynomial | `0x1021` (`x^16 + x^12 + x^5 + 1`) |
| Initial state | Caller-supplied; file-transfer code uses `0x0000` |
| Input reflection | false |
| Output reflection | false |
| Final XOR | `0x0000` |
| Check for ASCII `123456789`, seed zero | `0x31c3` |
| Result | 16-bit number; Java exposes a signed `short` |

The checksum accepts the previous result as its seed, so a large file can be processed incrementally. Do not reset the seed at each file-read boundary when computing a whole-file checksum.

## Static evidence

Examined `artifacts/extracted/native/lib/arm64-v8a/libjl_crc.so`, extracted from the supplied APKS ARM64 split. SHA-256:

`593ba761757c6c818424c0d9268223287b188eef1f096ad26cd09849e82a1ffa`

No native code was executed. Evidence below comes from offline ELF parsing with pyelftools and ARM64 disassembly with Capstone using `tools/inspect_elf.py`.

- Exported C++ symbol `_Z5CRC16PKvjt` starts at virtual address `0x7f4`, size 72 bytes. Arguments are data pointer, byte count, and 16-bit seed.
- At `0x7fc`, the function references the 16-entry halfword table at VA `0x5e0`. The little-endian decoded entries are:

  ```text
  0000 1021 2042 3063 4084 50a5 60c6 70e7
  8108 9129 a14a b16b c18c d1ad e1ce f1ef
  ```

- At `0x800`, `ldrb` reads each input byte unsigned. At `0x80c`–`0x81c`, the high input nibble XORs the high CRC nibble to index that table, then the CRC shifts left four bits. At `0x820`–`0x82c`, the low input nibble repeats the operation. There is no reflection or final XOR.
- At `0x834`, the accumulator is returned directly. Only its low 16 bits belong to the C++ return type and Java `short`.
- The `JNI_OnLoad` registration table at VA `0x8c48` has relocations to name `crc16` at `0x639`, signature `([BS)S` at `0x63f`, and wrapper function at `0x904`. The class string is `com/jieli/jl_rcsp/util/CryptoUtil`.
- JNI wrapper `0x904` passes the Java seed in `w3` through to CRC argument `w2` at `0x958`; the array length and byte elements are obtained before the CRC call at `0x960`. No byte swap is applied to the result.
- `artifacts/decompiled/com/jieli/jl_rcsp/util/CryptoUtil.java` publicly returns zero for a null array before invoking native code. An empty non-null array preserves the seed. The native wrapper itself handles a null array as a zero-length call, but the public Java API intercepts null first.

## Wire byte order and scope

Byte order is chosen by the command serializer, not by the CRC algorithm:

- `StartLargeFileTransferParam.getParamData()` serializes `[fileSize:4 BE][crc16:2 BE][hash...]`. For checksum `0x31c3`, the checksum bytes are `31 c3`.
- `TransferTask` computes the whole-file checksum incrementally from seed zero over file bytes.
- In its optional per-chunk checksum branch (`param.appHasCrc16 && param.a`), `TransferTask` computes CRC from seed zero over the **chunk data**, then forms `[chunkSequence:1][crcHigh:1][crcLow:1][chunkData...]`. The sequence byte and checksum bytes are excluded from that checksum calculation.

These behaviors are observed in decompiled source, not a captured badge session. Whether a specific badge negotiates the optional chunk checksum remains a device/runtime question.

## Reference and verification

Browser-compatible implementation: `reference/crc16.mjs`. It returns an unsigned integer and includes `crc16BigEndian()` for serialization. It deliberately matches the public Java null-array behavior.

Run:

```powershell
node reference/crc16.test.mjs
```

Passed: zero/empty input, seeded empty input, null-wrapper behavior, `123456789` with seeds `0000` and `ffff`, unsigned `ff`, all byte values, big-endian serialization, all 256 one-byte values under five seeds against an independent transcription of the extracted native nibble algorithm, and incremental processing at every split of the check string. Additional vector values were cross-checked with Python standard-library `binascii.crc_hqx` (`ff` → `1ef0`; bytes `00..ff` → `7e55`). These tests validate the reference implementation against static recovery; they do not constitute hardware upload verification.

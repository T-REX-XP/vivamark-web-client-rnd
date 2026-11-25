# Native image converter differential validation

The browser RES encoder now matches the shipped ARM64 mode-1 converter
**byte-for-byte on all 31 retained fixtures**. This is offline execution
evidence, stronger than the earlier encoder/decoder structural tests. A physical
badge has not been written or tested by this work.

## Executed target and containment

Target: `libjl_bmp_convert.so`, SHA-256
`70c859271d153093b379356102ae32257f5ea36558b9775756660db21958a5f4`, extracted
from the supplied APKS native split. Entry point `br28_bmp_to_res`, ELF virtual
address `0x10D88`, executes in Unicorn 2.1.4 ARM64 on the host. The entry point
receives the same BGRA input and pack flag 1 selected by the Java/JNI mode-1
path documented in [image-format.md](image-format.md).

`tools/emulate_image.py` loads ELF executable/data segments into emulated memory,
supplies separate input/output/heap/stack/TLS pages, and executes the actual
RGB565 conversion, vector/scalar loops, `Rle_Encode`, both `Crc16` calculations,
row descriptors and packed header construction. PLT imports `Rle_Encode` and
`Crc16` are redirected to the library's own functions. Only libc
`malloc`, `free`, `memcpy`, `memset` are replaced with emulated-memory operations;
any other import aborts. The process does not load this ARM64 library into the
host as native code, run the Android APK, access Bluetooth, connect to a badge,
or perform file/flash writes through the target library.

Each invocation has a 60-second emulation timeout and 100-million instruction
limit. The harness requires the emulated PC to reach its return sentinel and
checks the output size before reading it. The harness does not call JNI or the
file wrapper; Java's RGBA-to-BGRA rearrangement is reproduced on the host.

## Test coverage and retained evidence

`artifacts/image-fixtures/manifest.json` records the library hash and, for each
fixture, its dimensions, RGBA input SHA-256, native RES output SHA-256 and output
size. The corresponding `.rgba` inputs and actual native `.res` outputs are
retained alongside it. `reference/image-native.test.mjs` verifies these hashes
and compares the full native output against `encodeImageRes`, including every
fixed header byte, length, row descriptor, pixel/RLE byte and CRC.

The 31 cases cover:

- One opaque red pixel: verifies RGB565 byte order and minimal header/payload.
- Solid runs of lengths 2, 3, 8, 9, 16, 17, 126, 127, 128, 129, 254, 255,
  256 and 360: repetition threshold, packet limit, vector/scalar paths and tails.
- Varying colors/alpha over three rows with widths 7, 8, 9, 16, 17, 127, 128
  and 360: vector boundaries, RGB565 quantization, discarded alpha and row reset.
- Three-pixel runs shifted to offsets 0, 1, 2, 125, 126 and 127 in a 360-pixel
  row: literal/repeat transitions around a full literal packet.
- Solid 360x360 image and a 360x360 RGB gradient with varying alpha: full-size
  conversion, all row offsets/lengths and complete file checksums.

The full-size native outputs are 5,784 bytes for the solid image and 54,875
bytes for the gradient. These are measured fixture outputs, not estimates for
arbitrary user images.

## Defect found and corrected

The first differential run found two mismatches: repeats beginning at pixels
125 and 126 of a 127-pixel literal window. The original JavaScript encoder
looked ahead beyond that window and emitted a repeat packet. Native
`Rle_Encode` stops scanning at the literal-window limit and absorbs the partial
run into literals. Native output was three bytes longer in these two cases.

`reference/image-res.mjs` now limits lookahead to the native 127-pixel window.
The corrected encoder passed all 31 byte comparisons. The original structural
round-trip tests also pass; this demonstrates why structural decoding alone
was insufficient to establish exact native behavior.

## Reproduce

With the shared analysis venv already provisioned with `unicorn`, `pyelftools`
and `capstone`:

```powershell
.venv-native/Scripts/python.exe tools/emulate_image.py --fixtures artifacts/image-fixtures
node reference/image-native.test.mjs
node reference/image-res.test.mjs
```

Expected native comparison output:

```
Native ARM64 / JavaScript image conversion matched byte-for-byte for 31 fixtures.
```

Bun can run the same `.mjs` comparison scripts. Fixture regeneration runs only
the offline emulator; the comparison tests read retained local artifacts and do
not contact any device.

## Practical limits

This establishes conversion equivalence for the listed inputs and entry-point
configuration. It does not prove equivalence for every possible image, all
other converter modes, Android image decoding/color-management differences,
or firmware acceptance of arbitrary display dimensions. The browser's crop,
resize and color-decoding behavior is outside the native fixture comparison.
The tested full-size dimension is 360x360; choose the badge's confirmed display
dimensions before preparing an upload.

Image equivalence does not establish authentication, transfer state-machine
correctness, filesystem backend selection, successful display activation or
flash safety. Those require their own evidence. In particular, a `system==0`
badge still needs host-side FAT filesystem handling; this encoder does not make
a raw image write to an assumed flash offset valid.

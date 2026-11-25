# Still-image format: mode 1 / BR28 packed RES

Status: reconstructed from ARM64 instructions, then **byte-for-byte validated
against the shipped converter running in an offline emulator on 31 fixtures**.
See [image-validation.md](image-validation.md) for execution scope, fixture
hashes and a corrected RLE boundary defect. A physical badge remains untested.
The browser module is [reference/image-res.mjs](../reference/image-res.mjs).

## Source identity and exact dispatch

Native library: `artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so`,
SHA-256 `70c859271d153093b379356102ae32257f5ea36558b9775756660db21958a5f4`.
Source APK and bundle identity are documented in the main protocol report.

Java `com/neo/blooth/ui/BBaseActivity.conver` passes algorithm **1** to
`com/jieli/bmp_convert/BmpConvert.bitmapConvert`. `BmpConvert` loads the image
using `Bitmap.Config.ARGB_8888`, writes top-to-bottom pixels to an intermediate
file in **B,G,R,A byte order**, then calls native
`bmpConvert_native(algorithm, path, width, height, outputPath, ConvertParam)`.

JNI registration is explicit: at `JNI_OnLoad` VA `0x5a6ac`, the method table at
`0x64070` has relocation entries naming `bmpConvert_native`, its full JNI
signature, and exported native `bmpConvert` VA `0x5a0f0`. The mode-1 branch at
`0x5a250..0x5a26c` calls PLT `0x5a8f0`, resolved by `.rela.plt` to
`br28_bmp_to_res_path` VA `0x117ac`. This wrapper checks the input file size is
`width*height*4`, then calls `br28_bmp_to_res` VA `0x10d88` with pack flag **1**.
It first calls with null output to determine size, then again with output memory.
Mode 1 does not use `ConvertParam.format` in its dispatch branch.

These identities matter: the shipped library also supports BR23, BR35,
unpacked output, alpha formats, JPEG and ETC compression. Their presence does
not mean the VivaMark still-image path selects them.

## Pixel representation

`br28_bmp_to_res`, scalar loop `0x10f34..0x10f64`, converts each BGRA pixel to:

```
rgb565 = ((R & 0xF8) << 8) | ((G & 0xFC) << 3) | (B >> 3)
output bytes = [rgb565 >> 8, rgb565 & 0xFF]
```

Pixel words are therefore **big-endian RGB565**, despite the little-endian
ARM64 host and little-endian container fields. Alpha is discarded. Rows retain
their input order; the native loop does not flip them. There is no BMP file
header in the intermediate `.bin` input. The browser reference takes ordinary
Canvas RGBA bytes and directly produces the same RGB565 byte ordering.

## Per-row RLE and row directory

The converter calls `Rle_Encode` at VA `0x13534` separately for each row, with
unit size 2 bytes and repeat threshold 3. Tags count **pixels**, not bytes.

| Tag | Following bytes | Interpretation |
| --- | --- | --- |
| `01..7F` | `count*2` literal bytes | Copy `count` RGB565 pixel words |
| `81..FF` | One 2-byte pixel word | Repeat word `tag&0x7F` times |

Native repeat emission starts when a run reaches three identical pixels. Runs
and literal packets are capped at 127 pixels. RLE is reset at every row.
There is no row terminator: compressed row size is stored in its descriptor.
The reference encoder follows this packet policy, including native lookahead
stopping at the 127-pixel literal window; repeats crossing that boundary may be
absorbed into literals. The retained native fixtures cover those edge cases.

The image payload starts with `height` little-endian 32-bit descriptors,
followed by concatenated compressed rows. Each descriptor is constructed at
`0x11018..0x1102c`:

```
descriptor = (compressedRowByteLength << 21) | rowOffset
rowOffset = offset from the start of the image payload
```

The first row offset is `height*4`. Bits 0..20 hold the offset and bits 21..31
hold compressed byte length. Enforce offset <= `0x1FFFFF` and row length <=
`0x7FF`; silently truncating these values corrupts the format.

Example: one red pixel (`F8 00`) becomes row bytes `01 F8 00`. A one-row
directory is `04 00 60 00`, i.e. offset 4 and length 3. The complete image
payload is `04 00 60 00 01 F8 00`. A run of 127 black pixels is `FF 00 00`.

## Packed RES container

Pack flag 1 adds a **0x450-byte** header area. The RLE image payload starts at
absolute file offset `0x450`. Numeric fields in this table are little-endian.
Native writes are at `0x11088..0x1116c`.

| File offset | Size | Value / meaning |
| --- | --- | --- |
| `00` | 4 | ASCII `RU30` (`52 55 33 30`) |
| `04` | 8 | Fixed bytes `00 03 01 00 01 00 00 00` |
| `0C` | 4 | Zero |
| `10` | 4 | Zero |
| `14` | 4 | `0x18` |
| `18` | 4 | `0x30` |
| `1C` | 4 | `0x00540001` |
| `20` | 4 | Zero |
| `24` | 4 | `0x3C` |
| `28` | 4 | `0x00500001` |
| `2C` | 4 | Zero |
| `30` | 4 | `0x100` |
| `34` | 4 | `0x50` |
| `38` | 4 | `0x400` |
| `3C` | 2 | Header CRC16, over bytes `[0x3E,0x50)` |
| `3E` | 2 | Image payload CRC16, over bytes `[0x450,EOF)` |
| `40` | 4 | Fixed image-format word `0x24010000` |
| `44` | 2 | Width |
| `46` | 2 | Height |
| `48` | 4 | Image payload byte length, including row directory |
| `4C` | 4 | Payload file offset `0x450` |
| `50` | `0x400` | Zero bytes |
| `450` | variable | Image payload (row directory + compressed rows) |

The semantic names of fixed header fields beyond dimensions/offsets/CRCs are
unknown; preserve constants rather than inventing meanings. The packed file's
total length is `0x450 + payloadLength`.

The library's own `Crc16` at `0x139b4` starts at zero, uses the nibble table at
`0x8f20` (`0000,1021,2042,3063,...`), and processes the high nibble first.
It is CRC-16/XMODEM (poly `0x1021`, no reflection or xorout). Both RES CRC fields
are stored **little-endian** by native `strh`, whereas the large-file transfer
protocol puts its CRC fields in **big-endian** order.

## Reference use and verification

```js
import { encodeImageRes } from './reference/image-res.mjs';
const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
const res = encodeImageRes(image.data, image.width, image.height);
// Save as TEST.RES, or pass to the confirmed device's file-transfer backend.
```

Choose the display dimensions using device information / the UI evidence; this
encoder preserves its input dimensions and does not crop, scale or apply a
circular mask. It also does not authenticate or transfer files.
The reference accepts integer width/height in `1..65535` to match the stored
16-bit dimensions, and enforces the row descriptor's 11-bit length and 21-bit
offset bounds. The native wrapper checks only `width*height*4` input size;
its vector loops do not impose a visible width alignment requirement. These
format bounds are not proof that badge firmware supports arbitrary dimensions.

Run `node reference/image-res.test.mjs`. Structural tests check a fixed one-pixel payload,
127-pixel run boundaries, all container dimensions/lengths/CRCs and independent
RLE decoding of a 368x368 color image. They prove internal structural agreement
with the reconstructed format. Separately,
`node reference/image-native.test.mjs` compares all bytes against 31 actual
native ARM64 converter outputs, including solid colors, gradients, alpha and
runs crossing 127 pixels. Neither test establishes physical badge compatibility.
Test one upload only through the confirmed backend and validated transfer flow.

Reproduce the static evidence without executing the APK:

```powershell
python tools/inspect_elf.py artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so bmpConvert
python tools/inspect_elf.py artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so br28_bmp_to_res
python tools/inspect_elf.py artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so Rle_Encode
python tools/inspect_elf.py artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so Crc16
```
Focused native disassembly is retained in
[`artifacts/image-disassembly.txt`](../artifacts/image-disassembly.txt).


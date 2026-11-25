# Web feature parity and validation gates

## Current browser scope

The local Bun UI implements unified multilayer artwork composition, editable original-app transparent stickers, text, multiple images, transforms, undo/redo, a browser library, project import/export, PNG/RES export, slideshow preview, bounded animated GIF/video preview and WebM preview export. Still-image upload uses a scoped transaction without a backup or pre-upload download. Resource validation, transfer checksums and device completion determine normal upload success. Readback is an optional diagnostic. The owner reported a displayed physical upload on 2026-11-25. Native device AVI conversion remains unavailable. See [upload status and usage](image-upload.md).

The public diagnostic query method exposes three exact read-only requests after authentication: target information (`03`, `FF FF FF FF 00`), external-flash information (`D6`, empty parameters), and free space (`1A`, `0C 00`). Its allowlist checks both opcode and parameters. `uploadImageResource(bytes, options)` creates an exclusive private session for the fixed system-1 still-image transaction; only that session can answer corresponding filesystem transfer requests. There is no public arbitrary write, format, deletion, language, time, playback or dimension-setting method.

`app/src/lib/diagnostics.ts` exports:

- `DiagnosticsClient({ log?, timeoutMs? })`, with `connectBrowser()`, `connectSimulator()`, `queryDeviceInfo()`, `queryExternalFlash()`, `queryFreeSpace()`, `disconnect()` and exact-allowlisted `query(opcode, data)`.
- `connected`, `authenticated` and `simulated` status properties. Log entries include direction, timestamp, hex bytes and an explicit simulator flag.
- `FrameParser`, a bounded framing parser; `AuthMachine`, the raw mutual authentication state machine; and `assertReadOnlyQuery` for the transport policy.

Browser connection subscribes to notifications before sending authentication. GATT writes are serialized, split into conservative 20-byte pieces, and use the characteristic's advertised write mode. This is a test starting point, not a measured badge transfer limit. Queries correlate responses by opcode and sequence with bounded pending count and timeouts. Disconnect and malformed input fail pending operations. The simulator uses synthetic replies and the same candidate auth implementation; it is not an independent firmware implementation or evidence of badge interoperability.

## APK features versus browser reconstruction

| APK feature | Source evidence | Browser implementation boundary |
| --- | --- | --- |
| Single picture selection/editing and circular crop | `SingleActivity`, `BBaseActivity`, `ImageUtil`, sticker classes | Still-image composition and local preview are feasible. Match crop and background intent; browser JPEG decoding/encoding need not be byte-identical to Android. |
| Still-image `TEST.RES` conversion | `BBaseActivity.conver`, `BmpConvert` mode 1 | Local reference encoder and independently bounded resource decoder exist. Check native validation evidence separately; local preview is not upload acceptance. |
| Multiple-picture sequence | `MutlActivity`, `VideoToAviConverter.convertImageListToTwoAxisMP4` | APK builds preview MPEG-4 plus device MJPEG AVI from ordered pictures, with per-image duration choices 1–5. A set of independent RES files is not equivalent. No browser AVI writer/transfer is provided. |
| Video and GIF selection/conversion | `VidoActivity`, `BaseActivity`, `VidoToGifCover`, `VideoToAviConverter` | Requires a separate media pipeline and device validation. Browser MediaRecorder output is not established as compatible AVI. No video upload support is claimed. |
| Animated media dimensions and codec | `VideoToAviConverter` FFmpeg command strings | Several active converters crop/scale to **368×368**, use MJPEG for device output, and emit 8 or 15 fps depending on method. These differ from still-image 360×360. Do not apply the RES decoder to animated files or assume one universal size. |
| Playback, language, time and dimension controls | `CMDUtil`, `JBmanager` | APK performs writes; current diagnostics allowlist deliberately excludes them. |
| File upload and selection of filesystem backend | `WatchOpImpl`, `FatFsWatch`, `RcspWatch`, `TransferTask` | Fixed system-1 still-image transaction implemented without backup or required readback; device-confirmed completion is success. Exact readback is optional. System-0 host FAT/raw flash is unavailable. |

The table describes decompiled shipped code. It does not establish that every shipped method is reachable on every badge. See [protocol](ble-protocol.md), [filesystem branches](file-transfer.md) and [image format](image-format.md).

## Resource validation gates

`app/src/lib/resource-validation.ts` independently parses `RU30` mode-1 resources. It does not call the encoder or its CRC helper. It enforces fixed header constants and zero reserved bytes, exact file/payload lengths, maximum 300,000 bytes, dimensions 1–360 per axis, both CRC-16/XMODEM fields, descriptor bounds, contiguous non-overlapping row data, and exact decoded pixel count on each row. It rejects zero RLE counts, truncated packets, overflow, underflow and unreferenced trailing bytes. It returns RGBA pixels for an actual decoded preview. This restricted supported format intentionally rejects other RES variants.

Before claiming physical compatibility, require all of the following evidence:

1. Confirm physical badge model/firmware and live GATT properties; authenticate and retain a timestamped transcript.
2. Retain successful target/flash capability responses and confirm the selected filesystem backend. Do not infer backend support from a simulator fixture.
3. Compare generated resources with the shipped converter and validate structural/pixel results independently.
4. Implement and test the chosen backend's complete flow, including requested file ranges, capability-dependent CRC, device completion status, cancellation, space errors and disconnect recovery.
5. Compare a known-good Android transaction, perform a hardware upload, verify the displayed image and persistence after reconnection, and document the supported firmware.

Passing local tests, reaching 100% transport progress, or receiving a successful GATT write is insufficient to pass these gates.

## Local proof

Run `bun test app/src/lib/safety.test.ts`. Tests cover denied writes and altered query parameters, framing split/join and malformed input, mutual auth sequencing and rejection, synthetic response correlation, timeout/disconnect behavior, write serialization, valid resource pixel decoding, and CRC-valid malformed resource rejection. No hardware upload is performed by these tests.

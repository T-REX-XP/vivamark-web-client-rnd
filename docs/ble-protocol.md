# VivaMark BLE protocol extraction

Extracted on 2026-11-23 from `VivaMark_2026.03.12.20-25_apkcube.apks`.

Follow-up validation on the same date: [native authentication](auth-validation.md) matched 552 cases, [native image conversion](image-validation.md) matched 31 fixtures, an [actual phone resource](phone-evidence.md) decoded and re-encoded identically, and [physical badge read-only diagnostics](live-badge-validation.md) succeeded. The Bun UI is documented in the root README. The browser still-image transaction is implemented without backup or required readback. The owner reported a displayed physical upload on 2026-11-25; independent hardware byte verification and recovery remain unverified. Directory browsing succeeded on hardware; the existing picture is TEST1.RES. See [current upload status](image-upload.md).

## Result and implementation status

The Android app sends Jieli RCSP packets over BLE, authenticates the connection, converts still pictures to a Jieli resource named `TEST.RES`, and creates that file through the Jieli watch filesystem API. A JPEG/PNG cannot simply be written to the BLE characteristic.

Recovered: BLE UUIDs, command framing, authentication state machine, app custom commands, image preprocessing, upload entry point, capability-dependent file transfer, and native CRC. JavaScript authentication and mode-1 resource encoding have the follow-up differential validation linked above. Physical authentication and diagnostic queries succeeded; no successful browser resource upload or recovery is claimed.

Read with:

- [File transfer and filesystem branches](file-transfer.md)
- [Native authentication findings](auth-native.md)
- [Image resource format](image-format.md)
- [CRC16](crc16.md)
- [Web Bluetooth platform requirements](web-bluetooth-platform.md)
- [Browser implementation plan](web-app-plan.md)

## Artifact identity and evidence

| Item | Value |
|---|---|
| APKS SHA-256 | `fa7d1eb28481837da36ca7551d7651895670b639dfe39c4713ab7763166ac326` |
| Base APK SHA-256 | `c7317d7559108438e0f01069c95f933a74dcfc537c7e521ca1dd7e25264b31d7` |
| Package | `com.neo.blooth` |
| Version | `2026.03.12.20-25` / code `1225` |
| Android minimum / target | 21 / 35 |
| APKS members | `base.apk`, `split_config.arm64_v8a.apk`, `APKCube.txt` |
| Decompiled scope | `com.neo.*` and `com.jieli.*`, 1,117 top-level files including nested classes |
| Engine | JADX headless MCP 0.7.1 JAR; Java 21.0.8 |
| Signature verification | Not performed |

REA declarations evidence: `ev_1d68432f5af2b8cb0f443c91173821672854d3d66c92595d01c72a4dde0d32f4` (summary `ev_30bc580c5be8b31db22bc8a60c5ec24ad6f7c8da66b238f019f75e1ed494fca5`). App class search: `ev_4262c24215822636a7b094e05c258128633e0d485a4be71ca8b5f011582ffb6d`. Conversion method: `ev_c2678ceee5b040fae8faceec80ba320a2b71d905a8fab782c88a64eb8334458c`.

Complete retained REA records are in [rea-evidence.json](../artifacts/rea-evidence.json). Bulk Java source was exported independently through the same shipped JADX JAR by [DumpApk.java](../tools/DumpApk.java). It is decompiler output, not original source. The export reported zero JADX errors but included warnings and does not prove semantic equivalence. Native library disassembly uses pyelftools and Capstone because the configured REA service has no available ARM64 ELF decompiler on this Windows host.

## BLE transport

| Role | UUID |
|---|---|
| Service | `0000ae00-0000-1000-8000-00805f9b34fb` |
| App writes to badge | `0000ae01-0000-1000-8000-00805f9b34fb` |
| Badge notifications | `0000ae02-0000-1000-8000-00805f9b34fb` |
| Android notification descriptor | `00002902-0000-1000-8000-00805f9b34fb` |
| App device-name match | exact `VivaMark` |

Sources: [BluetoothConstant.java](../artifacts/decompiled/com/jieli/bluetooth/constant/BluetoothConstant.java), [Content.java](../artifacts/decompiled/com/neo/blooth/Content.java), [JBmanager.java](../artifacts/decompiled/com/neo/blooth/rcsp/JBmanager.java).

`JBmanager.initjl()` uses BLE priority 0, multiple devices, reconnect, timeout 2,000 ms, MTU option 509 and `useDeviceAuth=true`. These are Android settings, not measurements of the badge and not values to copy into browser ATT writes. Check live characteristic properties for the supported GATT write procedure. Subscribe before authentication.

## Authentication before RCSP

The active controller uses `com.jieli.bluetooth.impl.RcspAuth`, backed by `libjl_bluetooth.so`. The APK also includes a separate `com.jieli.jl_rcsp.impl.RcspAuth` backed by `libjl_auth.so`; do not mix their implementations merely because their class names match.

The Java-observed exchange uses raw records on the BLE stream, **without** RCSP `FE DC BA` framing:

1. App sends `00 || random[16]` (17 bytes, generated natively).
2. Badge sends `01 || transform(appRandom)[16]` (17 bytes). The app calculates and compares all 17 bytes.
3. App sends success marker `02 70 61 73 73` (`02` + ASCII `pass`).
4. Badge can send its own `00 || random[16]`; app responds with `01 || transform(badgeRandom)[16]`.
5. Badge sends `02 70 61 73 73`; only then does the app mark authentication complete and initialize RCSP.

The state machine can receive the final pass marker after step 3 without seeing step 4. Follow the actual incoming messages. Initial challenge retries: two retries at 2,000 ms intervals; after progress, a 2,000 ms authentication timeout. Failures include 40977 timeout, 40978 user stop, 40979 failed data send or challenge comparison.

Sources: [RcspAuth.java](../artifacts/decompiled/com/jieli/bluetooth/impl/RcspAuth.java), [RcspOpImpl.java](../artifacts/decompiled/com/jieli/bluetooth/impl/rcsp/RcspOpImpl.java). See [native findings](auth-native.md) for the challenge transform. Native functions and lookup constants must be translated or reused through a suitable implementation; sending `pass` alone does not reproduce the observed client handshake.

## RCSP packet layout

All multibyte lengths below are big-endian. Exact source: [bluetooth/tool/ParseHelper.java](../artifacts/decompiled/com/jieli/bluetooth/tool/ParseHelper.java), `convert2BasePacket()` and `packSendBasePacket()`; integer encoding in [CHexConver.java](../artifacts/decompiled/com/jieli/bluetooth/utils/CHexConver.java).

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | 3 | `FE DC BA` |
| 3 | 1 | flags: bit 7 command=1 / response=0; bit 6 response requested |
| 4 | 1 | opcode |
| 5 | 2 | body length N, BE; excludes prefix/header/trailer |
| 7 | N | body |
| 7+N | 1 | `EF` |

Command body: `sequence:u8 || parameters`. Response body: `status:u8 || sequence:u8 || responseParameters`. Opcode `01` has an additional `xmOpcode:u8` after sequence, before parameters, in both directions. Total packet size is N+8. There is no general frame CRC in this packer; file transfer can add its own CRC fields.

Typical flags are `C0` command needing response, `80` command without response and `00` response. Match responses by opcode and sequence. Sequence occupies one byte. Do not mistake an `EF` inside payload data for the final marker: use the declared length. Buffer split notifications and multiple packets in one notification. Authentication records need separate routing before normal RCSP decoding.

Response status codes from [StateCode.java](../artifacts/decompiled/com/jieli/bluetooth/constant/StateCode.java):

| Status | Meaning |
|---|---|
| 0 | Success |
| 1 | Failure |
| 2 | Unknown command |
| 3 | Busy |
| 4 | No resource |
| 5 | CRC error |
| 6 | Entire-data CRC error |
| 7 | Parameter error |
| 8 | Response data over limit |

The reference [codec](../reference/rcsp-codec.mjs) encodes both packet directions and decodes a stream, including opcode 1. It contains no filesystem uploader.

## Initialization and device information

After successful authentication, `RcspOpImpl` requests all target information with opcode `03`, parameters `FF FF FF FF 00` (32-bit all-fields mask, platform byte zero). Sequence 0 example:

```text
FE DC BA C0 03 00 06 00 FF FF FF FF 00 EF
```

Responses use SDK attribute parsing; preserve the raw response before decoding. Sources: [GetTargetInfoParam.java](../artifacts/decompiled/com/jieli/bluetooth/bean/parameter/GetTargetInfoParam.java), [GetTargetInfoCmd.java](../artifacts/decompiled/com/jieli/bluetooth/bean/command/GetTargetInfoCmd.java), `RcspOpImpl.f()` and [ParseHelper.java](../artifacts/decompiled/com/jieli/bluetooth/tool/ParseHelper.java). RCSP opcode `D1` settings MTU is an application-layer exchange and does not grant JavaScript access to ATT MTU negotiation.

The app also initializes its watch filesystem, sends its language preference, and synchronizes the time (`JBmanager.onConnection`). These calls are observed app behavior, not proof that each is essential for a static image upload. Query the filesystem capability before choosing the upload backend described in [file-transfer.md](file-transfer.md).

## VivaMark custom controls

These are parameters inside RCSP custom opcode `FF`; they are not standalone BLE writes. Source: [CMDUtil.java](../artifacts/decompiled/com/neo/blooth/util/CMDUtil.java), [CustomCmd.java](../artifacts/decompiled/com/jieli/bluetooth/bean/command/custom/CustomCmd.java), [CustomParam.java](../artifacts/decompiled/com/jieli/bluetooth/bean/parameter/CustomParam.java).

| Purpose | Custom parameters |
|---|---|
| Width 360 | `AA F0 45 69 FF 55` |
| Height 360 | `AA F0 46 69 FF 55` |
| Playback count 2 | `AA F0 43 02 44 55` |
| English language | `AA F0 E9 02 EA 55` |
| Chinese language | `AA F0 E9 00 EA 55` |

Width/height use two additive bytes, **not** a uint16: `max(size-255,0)` followed by `min(size,255)`, each cast to a byte. For 360: 105+255. The app passes 360; do not extrapolate arbitrary device resolutions from this encoding.

Example width command, sequence 0:

```text
FE DC BA C0 FF 00 07 00 AA F0 45 69 FF 55 EF
```

Minimal success response with no payload, same opcode and sequence (derived fixture, not captured):

```text
FE DC BA 00 FF 00 02 00 00 EF
```

For the animated path the app chains playback count -> width -> height. The still-image `conver()` path goes directly to upload after conversion; do not assert that these animation settings are mandatory for still images.

## Still image pipeline

Observed call chain:

```text
SingleActivity upload button
 -> BBaseActivity.conver(imagePath)
 -> BmpConvert.bitmapConvert(1, imagePath, .../TEST.RES)
 -> createBigFile() -> upload(TEST.RES)
 -> getWatchSysLeftSize()
 -> WatchManager.createWatchFile(TEST.RES, true, progressListener)
```

Gallery selection uses Glide circle crop, then center crop to 360x360; `ImageUtil.saveBitmapToFile()` writes a JPEG at quality 100. The converter decodes this into Android ARGB_8888, then writes an intermediate, row-major **B,G,R,A** byte stream, four bytes per pixel, before calling the native converter.

Mode 1 is `TYPE_701N_RGB`, also named deprecated `TYPE_BR_28`. Mode 3 (`TYPE_701N_RGB_NO_PACK`) and mode 9 (`TYPE_701N_JPEG`) exist but are not used by this still-image call. Therefore neither raw RGB565 nor a JPEG renamed `.RES` is established as equivalent to mode 1. The native library is `libjl_bmp_convert.so`, Java version declaration `1.6.0` / code 10605. See [image-format.md](image-format.md).

Sources: [SingleActivity.java](../artifacts/decompiled/com/neo/blooth/ui/SingleActivity.java), [BBaseActivity.java](../artifacts/decompiled/com/neo/blooth/ui/BBaseActivity.java), [BmpConvert.java](../artifacts/decompiled/com/jieli/bmp_convert/BmpConvert.java), [ImageUtil.java](../artifacts/decompiled/com/neo/blooth/util/ImageUtil.java).

The app checks free space when available and rejects oversized files. UI success is `OnFatFileProgressListener.onStop(0)`, not simply 100% written. File activation and FAT versus RCSP transfer behavior must follow the selected backend; see the dedicated transfer document.

## Validation boundary

Static extraction answers what this APK attempts to send. The follow-up physical probe confirmed AE00-scoped GATT properties, mutual authentication, firmware/capability response, system-1 filesystem selection and 360x360 display. Outstanding evidence is the original-app upload transcript, transfer interruption/recovery, backup/restore, final displayed picture and reconnect persistence after a browser-created replacement. The diagnostic probe's 20-byte transport writes worked; that does not establish file-transfer throughput or limits. Browser support restrictions are documented separately with primary-source links.

Keep a known-good Android upload's timestamped TX/RX and generated `TEST.RES` as comparison fixtures. For exact image equivalence, compare decoded pixel input as well as final resource bytes: browser and Android JPEG encoding can differ even when the visible picture matches.

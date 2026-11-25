# Connected Android phone: read-only evidence status

On 2026-11-23, wireless ADB pairing and read-only inspection succeeded after an initial unsuccessful USB connection attempt. **The installed app exactly matches both supplied APK digests, and its existing 360×360 `TEST.RES` passes independent validation and byte-identical decode/re-encode.** No badge upload or firmware acceptance was observed.

## Observed phone evidence

The already-running application is `com.neo.blooth`, version `2026.03.12.20-25`, version code `1225`. The installed package is non-debuggable; `run-as` access to private app files was denied. No app launch or installation was performed.

On-device SHA-256 hashes match the local extracted APKs exactly:

| Installed artifact | SHA-256 |
|---|---|
| `base.apk` | `c7317d7559108438e0f01069c95f933a74dcfc537c7e521ca1dd7e25264b31d7` |
| `split_config.arm64_v8a.apk` | `bed9f82eea1777fde20488eb504c57b5eb9c1a783088aa6e3cb8e980db09460b` |

The app's own external files directory contains an existing generated resource, `emoji/TEST.RES`, dated 2026-11-20. It was pulled read-only to `artifacts/hardware/phone-TEST.RES`; no phone file was modified. This resource is not a firmware image.

| Resource property | Observed value |
|---|---|
| Size | 200,538 bytes |
| SHA-256 | `c29f5460027b62d8f380a6395dd9cafe564c696705452413f587cd28034455c7` |
| Magic | `RU30` |
| Dimensions | 360×360 |
| Format bytes at `0x40` | `00 00 01 24` |
| Payload offset / bytes | `0x450` / 199,434 |
| Header CRC16 / payload CRC16 | `41c1` / `a1e6` |
| Independent structural validation | Passed every constant, reserved-byte, length, row-range, RLE-count and CRC check |
| Decode to RGBA, then JS re-encode | Byte-identical, including header, descriptors, compression and both CRCs |

Reproduce the local inspection with `bun tools/inspect_phone_resource.ts`. Its metadata-only report is retained at `artifacts/hardware/phone-resource-validation.json`.

One latest generated JPEG in the same app-owned directory and same timestamp minute was pulled as `artifacts/hardware/phone-source-candidate.jpg` (43,039 bytes; SHA-256 `14bfde4cc3d87d699db0f70f129d53d35fd81b506df09f5d86f6086340d29779`). It is a **candidate** input to the resource conversion; matching timestamps alone do not establish correspondence. No broad photo-library access or screenshot collection occurred. Phone-derived resource/image/log files are excluded from Git by `artifacts/hardware/*`.

App-UID-scoped logcat contained app refresh/scanning messages but no captured authentication, initialization, flash-backend selection or upload exchange in the bounded buffer examined. Only relevant app messages were saved, with Bluetooth MAC addresses redacted. This is a bounded absence, not proof no historical upload occurred.

An existing `TEST.RES` and a structurally valid converter output do not establish successful badge upload, persistence, flash backend, available space, or recovery behavior. Those remain unverified.

## Tool provenance

Google's [official Platform-Tools page](https://developer.android.com/tools/releases/platform-tools) links to `https://dl.google.com/android/repository/platform-tools-latest-windows.zip`. The archive was downloaded and extracted locally under `tools/vendor/`, with no global installation, PATH edit, driver installation or REA configuration change.

The executable reports:

```text
Android Debug Bridge version 1.0.41
Version 37.0.3-16887417
```

The ADB host daemon started on its normal local port. Two `adb devices -l` queries returned only `List of devices attached`, with no device, unauthorized or offline rows. A read-only Windows present-device inventory also showed no matching ADB/Android/MTP phone interface. No phone serial identifiers were retained.

## Initially unavailable evidence

Before wireless pairing, the following were unavailable. Installed package identity and existing app-owned resources have since been observed as documented above; badge protocol traffic remains unobserved:

- Installed `com.neo.blooth` version and APK digest.
- Existing app process and app-specific log messages.
- Existing app-owned `TEST.RES` or other converted resources.
- Badge model/firmware information reported by the app.
- Any captured authentication, initialization or upload exchange.

No app launch, badge operation, settings change, log clearing, snoop enablement or app installation was attempted. The badge has not been written by this investigation.

The user can unlock the phone, confirm a USB data connection and USB debugging, and reconnect it. If ADB subsequently lists `unauthorized`, the phone's USB debugging authorization prompt must be accepted before read-only inspection can continue.

## Wireless connection follow-up

At the user's request, a connection was attempted to the supplied private-network endpoint. TCP access succeeded and ADB mDNS identified it as an `_adb-tls-connect._tcp` service, but `adb connect` failed and no device became available. A same-host legacy `_adb._tcp` announcement on port 5555 actively refused a connection.

The observations were consistent with missing host pairing for Android wireless debugging. When the user opened the pairing dialog, ADB mDNS advertised one matching `_adb-tls-pairing._tcp` endpoint. The user-provided code was sent to `adb pair` over stdin; it was not written to a file or retained in evidence. Pairing succeeded, and the original wireless connection endpoint then connected successfully. No app or badge data was read during the earlier failed connection attempts.

# VivaMark Studio

A local Bun + React app for composing digital badge artwork and validating the recovered VivaMark protocol.

GitHub Actions validates and deploys the static app to GitHub Pages. See [deployment and reference review](docs/github-pages.md) for setup, project-path previews and the publication boundary.

```powershell
bun install
bun run dev
```

Open [VivaMark Studio](http://127.0.0.1:3000/). A project-local Bun 1.4.5 is pinned to avoid an older Bun/React JSX bundler incompatibility. The server listens on this computer only; images and saved projects stay local.

The UI has one layer editor for images, text and original transparent sticker overlays. Select elements on the canvas or in the Layers panel; drag, resize, rotate, reorder, duplicate, hide or delete them. Multiple images and stickers remain independently editable and are embedded in saved/exported projects. There are no separate editing tabs or inspiration presets. Connection and upload stay on the artwork screen. Local PNG/RES export, slideshow previews, GIF/video trimming and WebM preview export are also available; device AVI conversion is not implemented.

**Still-image upload follows the original transfer flow without backup or readback requirements.** The app validates the resource and transfer checksums, then reports success after complete byte coverage and the badge's successful completion message. The owner confirmed a physical upload displayed correctly. Byte-for-byte readback remains an optional diagnostic because firmware support varies. See [upload usage and validation boundary](docs/image-upload.md).

Validation now includes:

- 552 authentication outputs matched against actual ARM64 instructions under emulation.
- 31 native image fixtures matched byte-for-byte; differential testing found and fixed an RLE boundary defect.
- A real app-generated 360×360 RES from the connected phone passed independent validation and re-encoded identically.
- The physical badge authenticated and answered read-only queries: device-managed filesystem, 360×360, 8 MiB flash. [Live evidence](docs/live-badge-validation.md).

Run `bun run test`, `bun run typecheck` and `bun run build`. Tests include native fixtures, independent RES parsing, malformed packets/resources, auth states, read-only policy, timeouts and disconnect handling. Browser checks exercised editing, undo, saving, GIF import/WebM export, RES export and the explicitly synthetic simulator. The live probe did not perform any resource or settings writes.

Private phone and radio captures are ignored under `artifacts/hardware/`. Shared native fixtures and sanitized capability evidence are retained for reproducibility. [Phone evidence](docs/phone-evidence.md), [authentication validation](docs/auth-validation.md), [image validation](docs/image-validation.md).

## Protocol extraction

Protocol and image-upload documentation extracted from the supplied VivaMark Android APK bundle. Start with [BLE protocol](docs/ble-protocol.md), then [file transfer](docs/file-transfer.md) and the [browser implementation plan](docs/web-app-plan.md).

| Area | Result |
|---|---|
| BLE service/write/notify | AE00 / AE01 / AE02 |
| Transport | Jieli RCSP frames, sequence-correlated commands/responses |
| Authentication | Raw challenge/response exchange; 552 native differential cases matched and live mutual authentication succeeded |
| Still image | 360x360 app preprocessing; Jieli mode-1 packed `TEST.RES` |
| CRC | Native CRC-16/XMODEM recovered |
| Upload | Watch API; device capability selects device-managed transfer or host-managed FAT |
| Hardware validation | Read-only connection and capabilities verified; resource transfer/recovery pending |

Additional analysis: [authentication](docs/auth-native.md), [resource encoding](docs/image-format.md), [CRC](docs/crc16.md), [browser requirements](docs/web-bluetooth-platform.md).

`reference/` contains browser-compatible protocol primitives and tests. The native-derived authentication and still-image implementations have differential validation; see each document's verification boundary. The system-0 FAT backend still requires filesystem implementation work. The observed badge selects system 1; this does not make untested transfer/recovery safe.

The original local R&D checkout retains extracted APKs, native libraries, decompiled Java and raw REA reports. These are excluded from the publication snapshot. The [SHA-256 manifest](artifacts/extraction-manifest.json) records provenance. `tools/` contains export and inspection utilities; regenerating native fixtures requires the original local inputs.

Run all reference tests from PowerShell:

```powershell
Get-ChildItem reference -Filter '*.test.mjs' | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Failed: $($_.Name)" } }
```

Successful local and diagnostic checks do not establish acceptance of newly uploaded resources, display correctness after replacement, or recovery after interruption.

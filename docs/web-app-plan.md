# Building a browser uploader from this extraction

## Deliverable boundary

This repository now supplies a local Bun editor and diagnostic UI, extraction evidence and reference primitives. Authentication and image encoding have native differential validation; physical authentication and read-only queries succeeded. It is not yet a badge-validated web uploader: the still-image transaction is implemented without backup or readback requirements; the owner reported a successful displayed upload, while independent byte verification and recovery remain unverified; see [current upload status](image-upload.md). See the root README and [live badge evidence](live-badge-validation.md).

## Suggested implementation order

1. Connect using [Web Bluetooth requirements](web-bluetooth-platform.md), service AE00, write AE01 and notification AE02. Capture raw timestamped hex. Handle disconnects explicitly and serialize writes.
2. Implement the raw authentication state machine in [ble-protocol.md](ble-protocol.md), using [native authentication findings](auth-native.md). Validate against a real Android/badge exchange before enabling file writes.
3. Send the opcode 03 information query. Parse watch capability opcode D6 and initialize the appropriate filesystem. Do not select the convenient transfer path without checking the device's reported system.
4. Initially accept a known-good `TEST.RES` copied from an Android conversion. This isolates image encoding from BLE/file-transfer debugging. Then implement the browser-side [resource encoder](image-format.md), with byte fixtures from the Android converter.
5. Implement the actual upload state machine in [file-transfer.md](file-transfer.md). Acknowledge device requests, honor requested file offsets and negotiated block sizes, apply [CRC16](crc16.md), and wait for the backend's final success.
6. Validate one small image on the physical badge, reconnect and verify persistence. Add image selection/crop/preview and progress only after the protocol path succeeds.

## Reference modules

- `reference/rcsp-codec.mjs`: UUID constants, packet encoding, stream decoding, target-information request, app width/height payloads.
- `reference/rcsp-codec.test.mjs`: manually derived wire fixtures; split/coalesced notification tests and resynchronization.
- `reference/jieli-auth.mjs`: candidate native authentication transform and raw challenge generation.
- `reference/image-res.mjs`: experimental mode-1 RES encoder accepting Canvas RGBA bytes.
- `reference/crc16.mjs`: recovered CRC implementation and big-endian wire serialization.

The native analysis documents state each module's validation limitations. Authentication API tests and resource structural/CRC/color tests do not establish native byte-for-byte equivalence.

Run the frame verification with `node reference/rcsp-codec.test.mjs`.

Example connection code (call from a user click; this opens GATT and subscribes, it does not authenticate or upload):

```js
import { UUIDS } from './reference/rcsp-codec.mjs';

const device = await navigator.bluetooth.requestDevice({
  filters: [{ name: 'VivaMark' }],
  optionalServices: [UUIDS.service],
});
const server = await device.gatt.connect();
const service = await server.getPrimaryService(UUIDS.service);
const tx = await service.getCharacteristic(UUIDS.write);
const rx = await service.getCharacteristic(UUIDS.notify);
rx.addEventListener('characteristicvaluechanged', event => {
  const v = event.target.value;
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
  // First route raw authentication records. After auth, feed an RcspDecoder.
  console.log('RX', bytes);
});
await rx.startNotifications();
// Inspect tx.properties; select a supported write method and queue every write.
// GATT subscription is now ready for the authentication state machine.
```

Start with a conservative 20-byte BLE transport fragment only as a hardware-testing choice. This is separate from RCSP frame size, file block size and RCSP D1 settings. Never blindly retry an upload command when part of its frame may already have reached the badge.

## Architecture

```text
Image selection/crop
    -> BGRA pixel buffer -> Jieli mode-1 RES encoder
    -> selected watch filesystem / pull-driven transfer
    -> RCSP commands, responses and sequence correlation
    -> serialized BLE fragmentation/write queue
    -> Web Bluetooth

Notifications -> auth router OR RCSP stream decoder
              -> response correlation and device-command dispatch
              -> filesystem/transfer state machine
```

For a system-0 native FAT badge, a JavaScript reimplementation must also preserve filesystem allocation/metadata behavior. An Android helper can be an intermediate implementation option, but it would not meet a pure browser-only requirement. Reusing an ARM64 Android `.so` directly in a browser is not possible; a portable implementation or source compiled to WebAssembly is needed.

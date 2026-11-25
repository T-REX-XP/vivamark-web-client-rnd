# Web Bluetooth implementation constraints

Checked against upstream documentation on 2026-11-23. These are browser/platform requirements, separate from the APK-derived badge protocol. They do not establish that a physical VivaMark badge accepts a particular transfer.

## Deployment and browser support

Use HTTPS in production. Web Bluetooth requires a secure context and permission from the user; feature-detect `navigator.bluetooth` before showing connection controls. The API is unavailable in Web Workers. An embedded cross-origin app also needs the appropriate `bluetooth` Permissions Policy and iframe allowance. [MDN API overview](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

Target Chrome or Edge on Windows first, then Chrome on Android and macOS. Current MDN compatibility data lists Chrome/Chromium support, no Firefox or Safari support, no Android WebView support, and Linux support disabled by default. Do not promise ordinary Safari/iPhone support. Feature detection and a real device test remain necessary on every supported browser/OS combination. [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Bluetooth.json)

## Device selection and service permission

The application accepts either observed name, `VivaMark` or `D40(BLE)`, or an
advertisement containing the AE00 service UUID. On 2026-11-25 the badge's retained
BLE identity was discovered as `D40(BLE)` with no advertised service UUIDs.
The old exact-`VivaMark` filter hid it. A connection to that exact identity passed
mutual authentication and returned the same system-1, 8 MiB, 360×360 capabilities;
no resource writes occurred. See [sanitized live evidence](../artifacts/discovery-alias-readonly.json).
AE00-scoped characteristic lookup and authentication remain mandatory after selection.

Call `navigator.bluetooth.requestDevice()` directly from a Connect button's click handler. A user gesture is required. If filtering by name or using `acceptAllDevices: true`, put the badge's required service UUIDs in `optionalServices`; choosing a device alone does not grant access to every service. A service filter can hide devices that do not advertise that UUID even when they expose it after connection. During discovery, an all-devices chooser with explicit optional service UUIDs is useful. Queue GATT operations instead of issuing concurrent reads/writes. Chrome's `chrome://bluetooth-internals` helps inspect services, characteristics and descriptors. [Chrome implementation guide](https://developer.chrome.com/docs/capabilities/bluetooth)

```js
// Invoke from a user gesture. Replace with APK-derived UUIDs.
const device = await navigator.bluetooth.requestDevice({
  acceptAllDevices: true,
  optionalServices: [SERVICE_UUID],
});
const server = await device.gatt.connect();
const service = await server.getPrimaryService(SERVICE_UUID);
```

## Receive and transmit

Attach a `characteristicvaluechanged` listener and await `startNotifications()` before sending a command that may trigger a reply. This method enables notifications/indications for the selected characteristic. Feed received bytes into the badge protocol parser; whether a notification equals a complete RCSP message is a protocol question, not a browser guarantee. Copy the relevant DataView range when retaining bytes. [MDN notifications](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/startNotifications)

Use `writeValueWithResponse()` when the characteristic supports the GATT write property. Its response belongs to the GATT operation; the application still needs the badge's protocol-level success response. [MDN write with response](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/writeValueWithResponse)

Use `writeValueWithoutResponse()` only when supported and appropriate for the extracted transport. Await each promise; add the protocol's flow control and acknowledgement handling rather than treating promise resolution as file acceptance. [MDN write without response](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/writeValueWithoutResponse)

## Chunking and MTU

The browser exposes no JavaScript `requestMtu()` or negotiated-MTU property. The specification assigns MTU negotiation to the user agent on connection. A write larger than 512 bytes is rejected by the API; 512 is an attribute-value ceiling, **not** a portable single-packet payload size. Implement separate RCSP framing and BLE transport fragmentation, using the badge's receiver behavior as evidence. A conservative 20-byte transport chunk is a proposed starting point for hardware testing, not a measured VivaMark requirement. Do not automatically retry a partly transmitted file or increase chunk size without knowing how the device handles duplicates and incomplete frames. [Web Bluetooth specification](https://bluetooth.spec.whatwg.org/)

## Proposed hardware verification

1. Record badge model/firmware, browser/OS, service UUIDs and characteristic properties.
2. Subscribe to replies and verify a harmless device-information query before uploading.
3. Log timestamped TX/RX hex, protocol sequences, acknowledgements and byte offsets.
4. Upload one small known image, verify its appearance, then reconnect and verify persistence.
5. Test disconnect, timeout, rejection and cancellation; never equate bytes written with upload success.
6. Compare the successful web transcript to an Android-app capture if authentication, image conversion or transfer completion remains ambiguous.

This checklist is an implementation proposal. It has not been run against a badge.

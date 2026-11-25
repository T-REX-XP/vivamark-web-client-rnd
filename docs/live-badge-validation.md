# Physical VivaMark: read-only BLE validation

On **23 November 2026 at 12:33 Europe/Madrid** (11:33 UTC), the host connected to
the user's physical VivaMark, completed mutual authentication using the
recovered JavaScript calculation, and received successful responses to all
three exact diagnostic queries. No resource upload, deletion, formatting,
playback/settings command, raw flash write or firmware update was sent.

This validates the authentication and diagnostic wire protocol on this badge.
It does not establish that picture uploads or recovery from interrupted writes
are safe. Resource writes remain outside this probe.

## Scope and evidence identity

The first 20-second advertisement-only scan saw 52 peripherals but no VivaMark
while the Android connection was occupied. After the user disconnected the
original app, another 20-second scan found exactly one advertising device named
`VivaMark`, RSSI −64 dBm. It advertised no service UUIDs. The host has an Intel
Wireless Bluetooth adapter with Windows PnP status OK.

The probe then enumerated GATT, subscribed to notifications, authenticated,
sent its three fixed queries, and disconnected through the Bleak client context
manager. It did not operate the phone or disconnect another host.

Private detailed transcript: `artifacts/hardware/host-readonly-probe.json`,
SHA-256 `e6a4a401f9f6f483e42baed5ed2f5882c302ed587dce638d1d370d5a4f0109c2`.
The private report includes raw target-info attributes and is ignored by Git.
Do not publish it: target-info includes addresses and an authentication-key
attribute. This report intentionally omits addresses, serials, license and keys.

A sanitized retained fixture is
[`artifacts/live-badge-readonly.json`](../artifacts/live-badge-readonly.json).
It preserves non-identifying capabilities and selected firmware attributes;
MAC/license/auth-key data is omitted. The fixture contains the private report's
hash to bind these observations to that capture.

## Observed GATT layout

| Service | Characteristic | Properties |
| --- | --- | --- |
| `0000AE00-0000-1000-8000-00805F9B34FB` | `AE01` | Write without response |
| `0000AE00-0000-1000-8000-00805F9B34FB` | `AE02` | Notify |
| `0000AE30-0000-1000-8000-00805F9B34FB` | `AE01`,`AE03` | Write without response |
| `0000AE30-0000-1000-8000-00805F9B34FB` | `AE02`,`AE04` | Notify |
| `0000AE30-0000-1000-8000-00805F9B34FB` | `AE05` | Indicate |
| `0000AE30-0000-1000-8000-00805F9B34FB` | `AE10` | Read, write |

Generic Access `1800`/Device Name `2A00` is also present; it was not used for
application commands. Critically, **AE01 and AE02 occur under two services**.
Resolve them specifically within **AE00**, then retain characteristic objects;
a global UUID-only lookup is ambiguous. The probe used the AE00 characteristic
objects, notification subscription before the initial challenge, and explicit
write-without-response calls in chunks no larger than 20 bytes.

The absence of an advertised AE00 UUID explains why name filtering plus
`optionalServices:[AE00]` is appropriate for Web Bluetooth. A filter requiring
AE00 in advertisements could miss this badge.

## Authentication observed

The physical exchange completed this full sequence:

1. Host sent raw17-byte `00 + random16` challenge.
2. Badge returned17-byte `01 + response16`; it exactly matched the recovered
   `deriveAuthResponse` calculation.
3. Host sent `02 70 61 73 73` (`pass`).
4. Badge sent its own17-byte `00 + random16` challenge.
5. Host sent its calculated17-byte `01 + response16`.
6. Badge returned `02 70 61 73 73`.

The calculation ran through `tools/probe_auth_bridge.mjs`, which imports the
same `reference/jieli-auth.mjs` already checked against552 native ARM64 vectors.
The probe rejected a mismatched response before proceeding. This capture adds
physical interoperability evidence to the native differential calculation
evidence; it is not a simulated handshake.

## Read-only RCSP responses

Only these command/parameter combinations were sent after authentication:

| Opcode | Parameters | Observed status |
| --- | --- | --- |
| `03` | `FF FF FF FF 00` |0 |
| `D6` | Empty |0 |
| `1A` | `0C 00` |0 |

### Filesystem and display (`D6`)

Sanitized response payload:

```
00 80 00 00 00 80 00 00 01 00 00 00 01 00 00 10
00 04 57 30 30 32 01 00 01 68 01 68
```

| Field | Measured value |
| --- | --- |
| Flash bytes |8,388,608 (8MiB) |
| FAT bytes |8,388,608 (8MiB) |
| System |1 |
| System status |0 |
| Watch version code |0 |
| Block size |256 |
| Cluster field |16 |
| Match-version string |`W002` |
| Receive MTU field |256 |
| Screen |360×360 |

The actual `system=1` plus external-flash support reported in target-info means
the recovered `WatchOpImpl` selects **RcspWatch / device-managed filesystem**
for this badge, rather than the native host-side FAT backend. This is the
backend-selection condition demonstrated by the original Java source. The
probe did not execute its file-transfer state machine or validate write safety.
The receive MTU field is an application-protocol capability; it is not a direct
measurement of Web Bluetooth's permissible ATT write size.

### Free space (`1A 0C00`): corrected unit interpretation

Response payload is `00 00 00 0E 18`: operation result0 and unsigned32-bit
value`0xE18`, decimal3608. **The wire value is KiB, not bytes.**

Source proof: `com/jieli/jl_rcsp/watch/rcsp/RcspWatch.java`,
`getWatchSysLeftSize`, returns
`((long) ExternalFlashIOCtrlResponse.getSize()) *1024`.
`WatchOpImpl.getWatchSysLeftSize` forwards that backend callback to the UI,
which compares it to the actual local file length in bytes.

Thus the measured free space is **3608KiB =3,694,592 bytes**, about3.52MiB.
`app/src/lib/diagnostics.ts::parseFreeSpace` was corrected to return bytes,
and the simulator now emits2048KiB for its synthetic2MiB free-space example.
The previous parser returned an unscaled integer; simply labelling that result
as bytes would have understated free space by1024 times.

### Target-info firmware attributes (`03`)

The target-info payload is LTV: one-byte length including type, one-byte type,
then `length−1` data bytes. Using the original
`jl_rcsp/tool/datahandles/ParseHelper.parseTargetInfo` field meanings:

| Attribute | Raw non-identifying data | Interpretation |
| --- | --- | --- |
|0 |`20` |Protocol version `V_2.0` |
|5 |`00 01` |Firmware version code1 /`V_0.0.0.1` |
|6 |`0C` |SDK type12 |
|7 |`1B 34` |Boot version code`0x1B34`; SDK renders`1.11.3.4` |
|10 |`01 35 00 56` |Default Jieli VID1494, UID field`0x0135`, product ID`0x0056` |
|12 |`6A 6C 5F 76 38` |Project code`jl_v8` |
|13 |`01 10 02 1C` |First receive-MTU field272; communication-MTU field540 in parser |
|19 |`34 04` |External-flash transfer support bit5 is set; device-config support bit2 of second byte is set |
|21 |`00 00 00 07` |Packet CRC16 support, get-file-by-name-with-device and small-file contacts bits set |

These are device-reported fields, not a verified marketing model or chip
identification. For this transfer investigation, the useful findings are
external-flash support, positive device-managed backend selection, and packet
CRC capability. The packet CRC negotiation command itself was not sent.

## Reproduction and checks

`tools/probe_badge.py` defaults to advertisement scanning only. Its optional
`--read-only` mode is restricted to the above mutual-authentication records and
exact three queries. There is no arbitrary opcode/data input, resource command,
settings command or upload method. Unexpected authentication/framing, missing
service/characteristic, query error, or timeout terminates the session.

```powershell
# No connection or GATT writes:
.venv-native/Scripts/python.exe tools/probe_badge.py --timeout 20

# Authentication + fixed diagnostic queries; only when the badge is available:
.venv-native/Scripts/python.exe tools/probe_badge.py --timeout 20 --read-only --output artifacts/hardware/host-readonly-probe.json

# Offline tests (no device connection):
.venv-native/Scripts/python.exe tools/probe_badge_test.py
bun test app/src/lib/safety.test.ts
```

The scanner duration is bounded to 1..60 seconds. Notification subscription necessarily
configures the BLE CCCD, and authentication/queries necessarily write AE01;
"read-only" here means no modification of badge resources, flash or settings.
The two offline Python guardrail tests pass. The Bun safety suite passes
18 tests / 183 assertions, including the actual D6/free-space fixture and
32-bit unsigned KiB conversion without bitwise overflow.

The host probe uses Bleak3.1.0 installed only in `.venv-native`. Its scanner,
service enumeration, notification and explicit write-response APIs follow the
[official scanner documentation](https://bleak.readthedocs.io/en/latest/api/scanner.html)
and [official client documentation](https://bleak.readthedocs.io/en/latest/api/client.html).

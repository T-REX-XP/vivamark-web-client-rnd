# VivaMark image file transfer

This document describes static observations in `artifacts/decompiled/`, extracted
from base APK SHA-256 `c7317d7559108438e0f01069c95f933a74dcfc537c7e521ca1dd7e25264b31d7`.
The APK was not executed and no badge response or radio capture was available.
Integer fields below are big-endian unless stated otherwise. Payload offsets
exclude the RCSP transport header, status byte and command sequence number.

## Actual application entry point

`com/neo/blooth/ui/BBaseActivity.java` converts a still image with
`BmpConvert.bitmapConvert(1, input, output, listener)` to a local `TEST.RES`.
It queries free space through `WatchManager.getWatchSysLeftSize`, then calls
`WatchManager.createWatchFile(path, true, listener)`. If the space query fails,
the Java UI still attempts upload. Successful `onStop(0)` is its success condition.
The application does not pass JPEG/PNG bytes directly to the BLE characteristic.

`WatchManager` extends `com/jieli/jl_rcsp/impl/WatchOpImpl`, whose
`handleRcspInit` selects a backend from the device's external-flash information:

| Device capability | Backend | Consequence for a browser implementation |
| --- | --- | --- |
| `system == 0` | `watch/fatfs/FatFsWatch` | Host-side FAT filesystem via native `libjl_fatfs.so`, with raw flash reads/writes over RCSP. A simple large-file upload is not equivalent. |
| `system != 0` | `watch/rcsp/RcspWatch` | Device-managed filesystem and `task/TransferTask`; detailed below. |

Both branches require `DeviceInfo.isSupportExternalFlashTransfer()`. It is
unknown which branch the user's physical badge advertises. Do not select the
large-file branch merely because the app ships its code. The separate
`com/jieli/bluetooth/impl/rcsp/task/CreateFileTask` is not the task selected by
this UI's `WatchManager` call.

## Discover the filesystem backend first

RCSP opcode `0xD6` (214), `GetExternalFlashMsgCmd`, has no parameters.
Its response payload is parsed by
`jl_rcsp/model/cmdHandler/ExternalFlashCmdHandler.java`:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | Flash size |
| 4 | 4 | FAT size |
| 8 | 1 | `system`, backend selector |
| 9 | 1 | System status |
| 10 | 2 | Watch version code |
| 12 | 2 | Block size |
| 14 | 2 | Cluster |
| 16 | 2 | Length `N` of version-list text |
| 18 | N | Comma-separated version-list text |
| 18+N | 2 | Receive MTU, when present |
| 20+N | 2 | Screen width, when present |
| 22+N | 2 | Screen height, when present |

The decompiled parser contains control-flow/type warnings; the field read
offsets above are visible, but a real response must validate the layout before
depending on optional fields. These are application protocol limits, distinct
from the BLE ATT write size.

## Device-managed filesystem (`system != 0`)

Source: `jl_rcsp/watch/rcsp/RcspWatch.java`,
`jl_rcsp/task/TransferTask.java`,
`jl_rcsp/model/cmdHandler/LargeFileTransferCmdHandler.java`.

The UI's `true` argument bypasses the packed-resource validation performed when
false. `RcspWatch` sets `TransferTask.Param.useFlash = true`, selects the online
flash storage's `devHandler`, and transfers the file as follows:

1. Compute native CRC16 over the whole converted file, initial seed zero.
2. Send external-flash insert-start, opcode `0x1A`, payload
   `02 01 <file-size:u32> <path-bytes>`. For the still-image path the remote
   filename is `/TEST.RES`; the path here has no added NUL terminator.
3. After its successful response, send prepare-environment opcode `0x21`,
   payload `00` (`ENV_TRANSFER_LARGE_FILE`).
4. If device information is absent or declares packet CRC support, send
   opcode `0x27` (39), payload `00 <devHandler:u32> 01`. This declares host
   per-packet CRC support; the response's operation-specific `hasCrc16` byte
   determines whether packet CRC is enabled. If the device declares no support,
   skip negotiation and omit packet CRC.
5. Send start-large-transfer opcode `0x1B`: payload
   `<file-size:u32> <whole-file-crc:u16> <temporary-path-bytes>`.
   The field named `hash` in `StartLargeFileTransferParam` is actually this
   temporary pathname. Java generates eight lowercase hex digits from
   Java `String.hashCode(filename + lastModifiedMilliseconds)`, followed by
   `.tmp` and one NUL byte. It is not a cryptographic file hash.
6. Require successful RCSP status and a positive response payload
   `<transfer-mtu:u16>`. This limits file data bytes per transfer packet.
7. Wait for device pull commands (`0x1D`). Never stream the entire file merely
   because the start command succeeded. Serve each requested range as below.
8. Respond to filename requests (`0x20`) as below.
9. On device stop command (`0x1C`), save its reason byte, respond with status
   zero using the device's sequence number and no command parameters, then
   finish only if reason is zero. Stop reasons: 1 write failure, 2 data over
   limit, 3 CRC failure, 4 insufficient space; other values are failure.

The `RcspWatch` success path reports completion and reloads directory information.
It does not explicitly send insert-end or set-current-watch after the transfer:
`WatchProgressHandler.onStop` directly completes for `RcspWatch`. Do not add
those writes to the supposedly identical sequence without device evidence.

### Pull and file-data packets

Device opcode `0x1D` payload is exactly:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | Operation byte (retained by parser; task does not branch on it) |
| 1 | 2 | Requested buffer byte count |
| 3 | 4 | Absolute file offset |

Read `min(requestedCount, fileSize-offset)` bytes. Divide this range into chunks
of at most the start response's transfer MTU. Index chunks starting at zero
**for each pull**, wrapping as an unsigned byte if needed. Each outgoing chunk
is RCSP `DataCmd` opcode `0x01`, with extended opcode `0x1D`:

```
extended-opcode = 1D
data parameters = <chunk-index:u8> [<chunk-crc:u16>] <file-bytes>
```

The extended opcode is inserted by the RCSP packet builder, outside
`DataParam.getParamData()`. A serializer must not forget it or add it twice.
The chunk CRC, when negotiated, covers only that chunk's file bytes, seed zero.
It does not cover the chunk index, extended opcode or RCSP header.
`DataCmd` is a command without protocol response; the task sends queued chunks
sequentially, advancing after transport-send success. That callback is not a
device acknowledgment. After a range, wait for another pull or stop.

Example of a pull payload requesting 4096 bytes at offset 512:
`00 10 00 00 00 02 00`. If the negotiated transfer MTU is 512, it produces eight
data chunks with indices `00` through `07`. Actual BLE writes may split each
serialized RCSP frame further; they do not change these transfer indices.

The Java task suppresses repeated pulls for the same offset during a short
time window (`max(bytesRead*10/transferMtu,10)` milliseconds), and uses a
waiting-for-data timeout. A browser should support requested offsets rather
than assuming monotonically increasing offsets, and should abort cleanly on
disconnect or invalid/out-of-range requests.

### Filename request

Device opcode `0x20` is answered as an RCSP response with the same sequence
number. For the application's short ASCII filename, response parameters are:

```
54 45 53 54 2E 52 45 53 00 00    # TEST.RES followed by two zero bytes
```

The SDK uses GBK for short names (stem <9 bytes, extension including dot <5
characters); ASCII is identical. Longer names are prefixed with ASCII `\\U`
(`5C 55`), encoded UTF-16LE, then terminated by two zero bytes. Illegal filename
characters are stripped. For non-flash transfers the SDK appends a three-digit
rename counter after conflicts; flash transfers do not increment that counter.
Source: `model/command/file_op/LargeFileTransferGetNameCmd.java`.

## Host FAT filesystem (`system == 0`)

Sources: `watch/fatfs/FatFsWatch.java`, `watch/fatfs/FatFsBluetoothImp.java`,
`jl_fatfs/FatFileSystem.java`, `watch/WatchProgressHandler.java`.

The sequence is resource-update-start (`0x1A`, `07 01`), insert-start
(`02 01 size path`), native `createFatFile(path,true,...)`, insert-end
(`02 00`), resource-update-end (`07 00`). Native code performs filesystem
allocation, deletion/replacement and metadata writes. Java exposes those native
read/write callbacks over RCSP, but does not reveal the full FAT algorithms.
Porting just the callbacks is insufficient to implement this backend safely.

External-flash operations share RCSP opcode `0x1A`:

| Operation | Payload | Meaning |
| --- | --- | --- |
| `00` | `00 flag offset:u32 data...` | Raw flash write, no RCSP response |
| `01` | `01 flag offset:u32 size:u16` | Raw flash read, response `result:u8 data...` |
| `02` | `02 01 size:u32 path...` / `02 00` | Insert file start/end |
| `03` | `03 00` | Query current watch |
| `03` | `03 01 path...` | Set current watch (available API, not an observed post-upload UI call) |
| `06` | `06 01` / `06 00` | Write protection start/end flag |
| `07` | `07 01` / `07 00` | Resource update start/end |
| `08` | `08 mode crc:u16` | Query write result; result byte then optional size:u16 |
| `0B` | `0B 00 path...` | File info; result:u8, size:u32, optional crc:u16 |
| `0C` | `0C 00` | Free space; result:u8, free KiB:u32 (multiply by1024 for bytes) |

For raw reads/writes, flag bit zero set means more data; clear means final.
Write-result mode zero checks the write CRC; mode one participates in the newer
device receive-buffer flow control and returns available size. A successful
RCSP status does not by itself prove successful flash operation: check the
operation result byte too. Java's native filesystem requests absolute flash
offsets; these are not image-file offsets.

## Remaining limits and validation

- CRC implementation is native `libjl_crc.so` through `util/CryptoUtil.crc16`.
  Native analysis recovered MSB-first polynomial `0x1021`, no reflection or
  final XOR; with seed zero this is CRC-16/XMODEM. The standard ASCII test
  `123456789` produces `0x31C3`. See [native CRC evidence](crc16.md).
- The converted `TEST.RES` format is native `libjl_bmp_convert.so`. A renamed
  PNG/JPEG is not a substitute. See [the reconstructed mode-1 image format](image-format.md)
  and its experimental JavaScript encoder; this document specifies transfer.
- Authentication, device-info initialization, RCSP framing and BLE write
  fragmentation must be implemented before this state machine.
- No live upload, display activation, timing tolerance or error recovery has
  been verified against hardware. First capture the `0xD6` response and compare
  one official-app upload trace before writing flash from a new implementation.

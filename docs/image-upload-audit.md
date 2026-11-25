# Image upload: second source audit

Scope: the **system1 / RcspWatch** path actually selected by the physical badge's
read-only D6 response. This audit performed no hardware I/O. References below
are exact line numbers in the retained `artifacts/decompiled/` Java tree for
base APK SHA256 `c7317d7559108438e0f01069c95f933a74dcfc537c7e521ca1dd7e25264b31d7`.
Some JADX output carries control-flow/type warnings; observed live query
evidence remains separate from static source observations.

## Prerequisites that must not be guessed

- `jl_rcsp/impl/WatchOpImpl.java:55`: exact watch storage indices are **{3,6}**.
  Index5 is a valid generic flash storage, but is not in this watch selection.
  `watch/rcsp/RcspWatch.java:767` walks online storages and returns the first
  matching watch index; `:664` uses its **devHandler**, not its index, in
  `TransferTask.Param`. A browser can reject multiple matching online storages
  instead of making an ambiguous selection.
- `impl/OnFileBrowseCallbackImpl.java:238`: storage discovery sends opcode07
  `GetSysInfoCmd`, parameters **FF00000004** (public function FF, attribute2
  mask4). `model/parameter/GetSysInfoParam.java:28` serializes function then
  u32BE mask; `model/command/sys/GetSysInfoCmd.java:11` defines opcode7.
  The response begins functionFF followed by ordinary length/type/value attrs.
  `OnFileBrowseCallbackImpl.java:252` selects attr2 and converts it to storages.
- `model/device/DevStorageInfo.java:45`: legacy attr2 data starts with online
  bitmask, then u32BE handles for indices0,1,2,3,5 at byte offsets1,5,9,13,17;
  line-in index4 consumes no handle. Optional byte21 is reuse flag.
- `DevStorageInfo.java:27` and `:69`: if attr2 starts FF, byte1 is version;
  version0 contains nested LTV records. Nested type1 is concatenated storage
  states. `DevStorageState.java:23`: offline state is `00 index` (2 bytes),
  online is `01 index handle:u32BE` (6 bytes). Unknown future versions must not
  be interpreted as legacy storage data.
- Target03 capability attr19 first byte bit5 indicates external-flash transfer:
  `model/response/ExpandFunc.java:82`. Attr21's u32BE bit0 indicates packet CRC
  support, and bit1 get-file-by-name-with-device:
  `tool/datahandles/ParseHelper.java:452`. Missing attributes do not establish
  either capability. The physical badge reported attr19=`3404`, attr21=`00000007`.

New browser helper `app/src/lib/upload-capabilities.ts` parses these exact
formats and rejects missing, malformed or ambiguous inputs. Its focused tests
cover the actual sanitized target attrs, unsigned handles, legacy/v0 layouts,
offline states, unknown versions and multiple online watch targets.

## Exact creation order and transfer parameters

Source `jl_rcsp/task/TransferTask.java`:

1. `:378..415`: compute CRC16/XMODEM over the **entire converted RES file**,
   seed0, preserving CRC across read blocks. This is neither the RES internal
   payload CRC nor the image pixels' CRC.
2. `:254..263`, `:601..614`: with `useFlash=true`, send opcode1A parameters
   **02 01 size:u32BE pathBytes**; app path is `/TEST.RES`, no added NUL.
   `util/CommandBuilder.java:160` and
   `model/parameter/ExternalFlashIOCtrlParam.java:155` establish the serialization.
3. On insertion response, `:489..505`: opcode21 parameters **00**, prepare
   large-file environment. The system1 upload does not first invoke the
   separate resource-update-start `1A0701` used by the host-FAT path.
4. If packet CRC capability is present, `:225..250`: opcode27 (hex; decimal39)
   parameters **00 devHandler:u32BE 01**. The response payload is **00 crcFlag**,
   not a generic operation-result byte followed by the flag. `crcFlag==1`
   enables packet CRC. See `model/command/file_op/DeviceExtendParamCmd.java:118`
   and `model/cmdHandler/DeviceExtendParamCmdHandler.java:44`.
5. `:267..309`, `:617..645`: opcode1B payload
   **size:u32BE fileCRC:u16BE temporaryPathBytes**. Java temp path is eight
   lowercase hex digits from Java `String.hashCode(filename+mtimeMilliseconds)`
   plus `.tmp` plus one NUL. The field called `hash` holds this pathname, not a
   cryptographic digest. Avoid reusing a constant temp pathname across files.
6. Start response contains **transferMTU:u16BE**. Require status0 and positive
   bounded MTU. This MTU counts file bytes per data chunk, independent of ATT
   write fragmentation. `:638..645` arms the waiting timer only after success.
7. Wait for device pulls; do not send unsolicited whole-file data.

Insertion status nuance: `TransferTask.java:603` uses
`tool/BooleanRcspActionCallback.java:15`, whose `hasResult` returns0.
`CustomRcspActionCallback.java:45` still checks RCSP status, but this callback
does **not** inspect the nested flash result. Other external-flash paths use
`WatchBase.ExternalFlashIOCtrlBooleanResult` to inspect that result. A browser
should require status0 and an explicit successful operation result if supplied,
and fail on malformed responses rather than proceeding with an invalid file.

## Pull/response semantics: important differences

| Incoming command | Host action required by source |
| --- | --- |
|1D pull | **No status response.** `LargeFileTransferOpCmd` extends `CommandWithParam` (`model/command/file_op/LargeFileTransferOpCmd.java:8`). Serve data through opcode01/xm1D. |
|20 filename | Respond using the device's sequence, status0, final filename bytes. `TransferTask.java:532..542`. `TEST.RES` is ASCII followed by **two NUL bytes**. |
|1C stop | Read reason, respond same sequence status0 with **no parameters**, then finish only for reason0. `TransferTask.java:162..172`. |
|1E device cancel | Respond same sequence status0 with **no parameters**, release task and report cancellation. `:182..188`. |

Pull payload is **operation:u8 requestCount:u16BE absoluteOffset:u32BE**
(`model/parameter/LargeFileTransferOpParam.java:31`). The task does not branch
on the operation byte; it uses count and offset. `TransferTask.java:690..741`
reads `min(count,fileSize−offset)` and splits the range into file-byte chunks
of at most transferMTU. Each range resets its chunk index to0. Data serialization:

```
RCSP opcode01, no response requested, xmOpcode1D
data = chunkIndex:u8 [chunkCRC:u16BE] fileBytes...
```

Chunk CRC is enabled only if host+device negotiate support. It is a fresh
seed0 CRC over this chunk's file bytes; it excludes index, xmOpcode and header.
`TransferTask.java:727..737`. The RCSP packet builder separately inserts
xmOpcode (`tool/datahandles/ParseHelper.java:215`); do not omit or duplicate it.

`TransferTask.java:458..480` sends chunks serially through local transport
completion callbacks, then arms a20-second waiting timer. While producing a
pull response it removes that timer (`:675`); a20-second global timer counting
all fragmented GATT writes is not the same SDK behavior. Repeated same-offset
pulls within a short window are suppressed (`:665..673`), but valid retransmitted
offsets must be supported after that window. Browser bounds/coverage checks are
appropriate; reaching100% sent is not a completion signal.

Stop reason mapping `TransferTask.java:555..580`:0 success,1 write error,
2 limit error,3 CRC error,4 insufficient space, other values error.
`task/TaskBase.java:28` sets waiting timeout to20000ms. `TransferTask.cancel`
at`:205` sends **opcode1E with empty parameters**, expects a protocol response,
then releases/callbackCancel. It is not `1A0200` and not a generic flash reset.
Cancellation does not promise rollback of an already started replacement.

## Completion, activation and post-upload metadata verification

`watch/rcsp/RcspWatch.java:531` completes its listener on transfer finish.
`watch/WatchProgressHandler.java:156` directly forwards completion for RcspWatch;
it does not send insertion-end or set-current-watch for this system1 create.
`impl/WatchOpImpl.java:98` reloads the folder before reporting final UI success.
Do not automatically append the host-FAT sequence's `1A0200` or `1A0700`, or
an unobserved settings/activation command, to this system1 flow.

Source-backed metadata check: `RcspWatch.java:327..352`, `getWatchFileSize`,
sends **opcode1A, parameters0B00+pathBytes** and checks both RCSP status and
flash result. `model/cmdHandler/ExternalFlashCmdHandler.java:161..169` parses:

```
result:u8 size:u32BE [whole-file CRC:u16BE]
```

Thus a7-byte successful file-info payload provides an independent remote size
and file CRC to compare with the exact uploaded RES. Do not read its size as
KiB: the KiB conversion belongs only to free-space query0C. Require exact file
size and CRC match before claiming verified upload. A5-byte response has no CRC
evidence; an absent CRC is not a matching CRC0.

## Backup/current-resource and full readback are real APIs

Current-resource path query exists in `watch/WatchBase.java:224`:
**opcode1A payload0300**. `ExternalFlashCmdHandler.java:133` parses successful
parameters as result byte followed by UTF8 pathname (trimmed by Java). The
source API resolves that path through the browsed directory; it is not proof
that the currently displayed asset is always named`TEST.RES`.

Whole-file reading is separate from raw flash reads:
`task/GetFileByNameTask.java:52` selects the modern read-by-device/name form
when target attr21 bit1 is set (the physical badge reports this bit). Exact
serialization is `model/command/file_op/ReadFileFromDeviceCmd.java:119`:

```
opcode24 (hex; decimal36), requires response
02 devHandler:u32BE offset:u32BE nameLength:u8 nameBytes
```

For ASCII names the source uses GBK, which is identical byte-for-byte and adds
**no NUL**. Start offset0 for a full backup. Filename argument's accepted path
form must still be checked on hardware; do not silently substitute a guessed
current file. The original API supports a path/name string, not a hardcoded
raw flash offset.

Start response payload is **operation:u8 totalSize:u32BE**, parsed from byte1
by `model/cmdHandler/ReadFileFromDeviceCmdHandler.java:45`. Data arrives as
opcode01/xm24 and, for the modern path, contains
**absoluteOffset:u32BE rollingCRC:u16BE fileBytes**.
`task/GetFileTask.java:325..367` checks contiguous offsets and updates CRC with
the preceding CRC as seed. This CRC is **cumulative**, unlike upload's
per-chunk CRC. `GetFileTask.java:77` defaults `useCrc=true`; only the deprecated
name-only fallback disables it (`GetFileByNameTask.java:45`).

Device opcode24 with payload**80 returnCode** ends reading. The host responds
same sequence/status0 with payload**80** (echo operation), not an empty body;
`GetFileTask.java:110..123`. Payload81reason is read cancellation and response
echoes81. Verify stop code0, exact total bytes and all rolling CRCs before
accepting a backup/readback; `GetFileTask.java:397..412` rejects lost data.
No data-chunk responses are sent. A full readback can validate the actual file
bytes, whereas metadata CRC alone provides a smaller integrity check.

These APIs establish a credible implementable backup/readback path. This audit
did not run it or prove restore/recovery. Downloading the currently referenced
asset and downloading`/TEST.RES` address different questions if their paths
differ. Preserve both if the application intends to replace the latter.

## Subsequent physical preflight: metadata incompatibility found

At12:54 Europe/Madrid on23 November2026, after the user disabled phone
Bluetooth, a bounded read-only probe authenticated and confirmed the actual
storage response:

```
07 response: FF 16 02 08 00000000 00000000 00000000 00000003 00000000
```

The legacy storage mask is08: index3 online, **devHandler3**. The full payload
is retained in `artifacts/upload-preflight-readonly.json` and covered by a
parser regression test. This is a measured handler, not an index-as-handle
default; they happen to have the same numeric value on this device.

The exact file-info query `1A 0B00/TEST.RES` did **not** return the SDK's expected
file metadata. The physical capture contains two responses for the same
sequence4:

1. RCSP status0, parameters `FF002F544553542E524553EF` (inner resultFF with
   path-like echoed bytes, length12).
2. RCSP status1, empty parameters.

The private report's raw receive events retain both; its correlated responses
array retains the first matching response only. Neither response supplies a
valid file size/CRC. Do not label this a missing file with a guessed result
code or continue as though a backup exists. No file upload or opcode24 read
was attempted in that probe.

The source-backed named-read24 start response independently supplies total
size. A future bounded read probe could obtain its size from that response,
enforce a strict size cap, verify cumulative packet CRC and exact successful
stop, and independently decode the complete RES before treating it as a backup.
That does not require inventing another opcode, but it is a distinct step from
the metadata query and must not be reported as already verified.

### Authorized fixed named-read bootstrap result

At12:57 Europe/Madrid, a separate explicitly authorized read-only probe tested
that bootstrap using confirmed handle3, offset0 and the exact name`/TEST.RES`:

```
TX FEDCBAC024001471020000000300000000092F544553542E524553EF
```

The badge authenticated, confirmed the same online storage, then replied to
opcode24/sequence71 with **RCSP status1 and parameters02**. It supplied no size,
file data or stop notification. The probe stopped immediately and disconnected;
no upload, flash write or resource change occurred. Sanitized evidence is
`artifacts/named-read-proof.json`; the private raw transcript SHA256 is
`cfdcfc33773bee40cfc1e631548a9a8feb9929440b53a24d492c4027169c006d`.

This demonstrates that the device's advertised attr21 named-read bit is not
sufficient to establish acceptance of this operation/path. It does not by
itself distinguish an unsupported read implementation from an unaccepted name
form or missing file. The actual SDK's contacts/format named-read callers pass
bare filenames (`CALL.TXT`, `WMEM.BIN`), while the watch UI's open-file API
uses a browsed directory cluster. No guessed path variants or cluster reads
were attempted. The fixed`/TEST.RES` backup path remains unverified and the
browser must surface the real failure rather than imply a saved backup.

The probe implementation is `tools/probe_read_image.py`, with offline guardrail
tests in `tools/probe_read_image_test.py`. It can send only the fixed named
read and the successful-stop80 acknowledgment beyond the existing fixed
diagnostics/authentication records; it has no resource-writing operation.

The first basename probe found no advertising badge. A bounded retry after
the owner disabled phone Bluetooth reached one VivaMark at 2026-11-23
12:06 UTC. Authentication and storage checks succeeded; the source-grounded
bare `TEST.RES` request also returned **status 1, parameters `02`**, before
any file size or bytes. `artifacts/basename-read-proof.json` now records this
actual rejection. No resource write occurred. The slash-path evidence remains
in its separate artifact. Neither name form provides a validated backup on
this firmware, so the browser must block replacement. The rejection's cause
is not established.

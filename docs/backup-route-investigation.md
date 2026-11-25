# Backup failure: use the watch's browsed-cluster route

Current implementation: the owner requested removal of the backup requirement.
Pre-upload backups and directory reads have been removed. The audited directory/
cluster route below now serves only post-upload readback. A live root-directory
probe subsequently succeeded and found TEST1.RES at cluster 661, with no TEST.RES;
see artifacts/root-browse-proof.json. The investigation below records how the
original failed backup API differed from the watch-file API.

Finding: the original watch UI's **openWatchFile** operation does not use the
name-based opcode24 operation that the browser initially tried. It first looks
up a file in its directory cache and then reads by the file's returned cluster.
The next evidence-producing step is a bounded read-only root directory listing,
not removal of the browser's backup gate or another guessed filename encoding.

This investigation performed no hardware calls. The accompanying probe tool is
prepared and offline-tested only; hardware results must be assessed separately.
All line references below are in `artifacts/decompiled/com/jieli/` from the
supplied APK. Source support does not establish physical firmware acceptance.

## Actual watch path

`jl_rcsp/watch/rcsp/RcspWatch.java`:

- `:542` `openWatchFile(path,callback)` calls `a(path)` to find a file record.
- `:791..817` extracts only the basename and performs a **case-insensitive**
  comparison against children of the current browsed folder. Thus a source
  API accepting a path does not imply that its wire-level read accepts a path.
- Once a file record is found, `:685..697` constructs
  `GetFileByClusterTask.Param(storage.devHandler,0,file.cluster,"byte_array_stream")`.
- `:465..488` `listWatchList` fills that folder cache through
  `FileBrowseManager.loadMore`; the watch is initialized by listing storage.

In contrast, `GetFileByNameTask` is used elsewhere for contacts/format backup
files such as `CALL.TXT` and `WMEM.BIN`. Its presence in the SDK and a target
capability bit do not prove that this badge accepts reads of `TEST.RES` by name.
The observed status1 from the browser is an actual failure before image upload,
not evidence that a resource has been changed.

## Optional current-resource pathname query

`jl_rcsp/watch/WatchBase.java:224..238` `getCurrentWatchInfo` sends
`CommandBuilder.buildExternalFlashGetCurrentWatchMsgCmd`.
`jl_rcsp/util/CommandBuilder.java:136` serializes **opcode1A parameters0300**.
The expected reply is RCSP status0 and flash result0 followed by UTF8 pathname:
`model/cmdHandler/ExternalFlashCmdHandler.java:133..145`. Java trims that path
and resolves its basename against the same browsed folder cache.

This query identifies the selected resource when the firmware implements it.
It does not itself download bytes or provide a cluster. A malformed/unsupported
reply must not be interpreted as a filename. **0301+path is a different,
resource-selecting operation and is outside this read-only probe.**

For an upload replacing `TEST.RES`, locating the current selected resource and
locating `TEST.RES` are separate questions if the names differ. Preserve that
distinction in backup UX and evidence.

## Source-backed root directory listing

`jl_filebrowse/FileBrowseManager.java:585` creates a root folder for online
storage. `jl_filebrowse/bean/File.java:24` gives root cluster0, nameROOT.
`Folder.getClusterArray` returns `[0]` for that root. `FileBrowseManager.java:294`
starts pagination at current child count+1, so an empty cache starts at1.
The default page size is10 (`FileBrowseManager.h`).

`FileBrowseManager.java:770` converts that folder to `PathData`.
`jl_filebrowse/bean/PathData.java::toData` serializes:

| Payload offset | Size | Field | First root page for this badge |
| --- | --- | --- | --- |
|0 |1 |Path type |00 folder |
|1 |1 |Requested record count |0A (10) |
|2 |2 |Start index, BE |0001 |
|4 |4 |Storage handler, BE |00000003, as actually queried |
|8 |2 |Length of path bytes, BE |0004, **not** cluster count1 |
|10 |4 per cluster |Path cluster array, BE |00000000 root |

`jl_rcsp/tool/filebrowse/FileBrowseOperatorImpl.java:104` sends
`CommandBuilder.buildSendPathDataCmd(PathData)`, resulting in opcode0C
`StartFileBrowseCmd` with response requested. Its complete parameters are:

```
00 0A 00 01 00 00 00 03 00 04 00 00 00 00
```

For probe sequence72, the full RCSP frame is:

```
FE DC BA C0 0C 00 0F 72 00 0A 00 01 00 00 00 03 00 04 00 00 00 00 EF
```

Path type01 is a file/playback path in `FileBrowseManager`, not the directory
read requested here. The probe fixes type00 and performs no folder traversal,
playback request, deletion, formatting or resource write.

### Listing reply stream and completion

`jl_rcsp/model/cmdHandler/FileBrowseCmdHandler.java:41..60` accepts the start
response's total-file count in0,1,2 or4 parameter bytes. Require successful
RCSP status; do not treat that count as the number of data bytes to receive.

`jl_rcsp/impl/OnFileBrowseCallbackImpl.java:158..167` forwards **opcode01 with
xmOpcode0C** as directory bytes. Those bytes are concatenated until the browse
stop; they are not image data and contain no named-read offset/CRC header.
`FileBrowseOperatorImpl.java:61` returns `dataHasPacket=false`, so the RCSP data
wrapper is already removed. Do not strip another9-byte packet header from the
directory data. Individual FileStruct records may cross notification or RCSP
data packet boundaries.

The device finishes the page with **opcode0D**, one reason byte.
`OnFileBrowseCallbackImpl.java:209..221` treats reason0 as successful page with
more entries and reason1 as successful end-of-directory. It sets status0 and
responds using the unchanged reason parameter. Therefore the ACK is same
sequence/status0 and **echoes reason0 or1**, not an empty body. Reasons other
than0/1 are not successful directory-read completion; reason2 is associated
with the file/playback path. Data packets themselves receive no ACK.

`FileBrowseManager.java:363..398` parses the accumulated records, verifies
storage index against the current folder, and marks whether more pages remain.
For a bounded first probe, stop after one page even if reason0 says more exists.
Only a later expressly scoped pagination implementation should request more.

### Exact FileStruct record format

`jl_filebrowse/bean/FileStruct.java::parse`:

| Record offset | Size | Field |
| --- | --- | --- |
|0 |1 |Flags: bit0 is file; **bit1 clear means UTF16LE**, set means GBK; bits2..6 storage index |
|1 |4 |File/directory cluster, BE |
|5 |2 |File number/index, BE |
|7 |1 |Filename byte lengthN |
|8 |N |Name bytes in the indicated encoding; no assumed terminator |

A real file match requires file=true, storage index3, unambiguous basename
`TEST.RES` (SDK comparison is case-insensitive), and its actual returned
cluster. A folder namedTEST.RES is not a file match. The listing record contains
**no file size or file CRC**; those must come from the read-start/data protocol.
Do not guess a cluster from file number, storage index or storage handler.

## Actual watch read-by-cluster request

Only after a verified listing produces the intended file's cluster, the exact
watch read operation is source-backed:
`jl_rcsp/task/GetFileByClusterTask.java:48` creates
`ReadFileFromDeviceCmd.StartWithClusterParam(handler,offset,cluster)`.
`model/command/file_op/ReadFileFromDeviceCmd.java:92` writes:

```
opcode24, requires response
01 devHandler:u32BE offset:u32BE cluster:u32BE
```

For this badge, handler is the separately queried3, offset0, and cluster must
be the returned file record. This payload is13 bytes and differs from the
18/19-byte name-based requests. Start response is **01 size:u32BE** with RCSP
status0 (`ReadFileFromDeviceCmdHandler.java:45`). Treat that size as authoritative
within a strict bound, not as permission to allocate an unbounded buffer.

`GetFileTask` is shared with named reads. It defaults CRC checking on (`:77`).
Device opcode01/xm24 parameters contain **offset:u32BE cumulativeCRC:u16BE
fileBytes**. Require contiguous offsets from0, cumulative CRC16/XMODEM from seed0
and exact final byte count. Device24 parameters8000 signal success; respond
same sequence/status0 with80, then verify full resource structure/CRCs. A failed
read-start status or absent data is not a successful backup. Complete backup
bytes must be retained privately before any resource-writing flow is allowed.

## Prepared bounded probe

`tools/probe_browse_images.py` performs only the first directory page. It reuses
the existing authentication/diagnostic implementation via a narrow
`browse_root=True` hook. Before sending0C, it requires the exact measured online
index3/handler3 storage response. Bounds: requested count10, directory data4096
bytes, at most256 receive frames,20-second scan and60-second session deadline.
Unknown storage, record truncation, duplicate clusters, unexpected encodings,
failed status or stop reason terminates the probe. It does not issue opcode24,
file-name variants or resource-writing commands.

It writes a private raw transcript to`artifacts/hardware/root-browse-full.json`
and a separate no-MAC report to`artifacts/root-browse-proof.json`. Record names
still belong to the user; review that report before publishing it.

Offline checks pass:

```
.venv-native/Scripts/python.exe tools/probe_browse_images_test.py
.venv-native/Scripts/python.exe tools/probe_badge_test.py
```

The four browse tests cover exact serialization including the16-bit path byte
length, GBK/UTF16LE records, storage/truncation/flood rejection and the correct
stop ACK. No test contacts hardware. Run the probe only when the intended badge
is available; failure to advertise or enumerate AE00 is a connection blocker,
not evidence about the directory/read command itself.

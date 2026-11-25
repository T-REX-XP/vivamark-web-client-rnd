# Physical transfer-start rejection — 2026-11-25

The exported browser session at 14:44 UTC authenticated successfully, reported system 1 / W002 / 360×360, and accepted these requests in order:

| Command | Outcome |
| --- | --- |
| `1A 0C00`, free space | 3,540 KiB available |
| `1A 0201 00003CCE /TEST.RES`, replacement preparation | Status 0, operation result 0 |
| `21 00`, prepare large-file environment | Status 0 |
| `27 00 00000003 01`, packet CRC negotiation | Status 0, CRC enabled |
| `1B 00003CCE 171C e243c0b0.tmp\0`, start transfer | Status 1, no additional result bytes |

No pull request or resource-data packet occurred. Preparation had already succeeded, so this is not evidence that the filesystem was unchanged. The original Android SDK defines status 1 as `STATUS_FAIL`, distinct from busy (3), CRC error (5) and parameter error (7). Its exact internal reason is unavailable in this response. The temporary path, size/CRC endianness and request order agree with the retained `TransferTask` and `StartLargeFileTransferParam` sources. Do not change those fields or introduce automatic replacement retries based on this generic status.

The app sent task cancellation immediately after rejection, but disconnected after 510 ms without receiving its acknowledgement. Earlier command replies in the same trace took 797–1,439 ms. The cleanup cutoff was therefore shorter than the observed response latency. Cancellation now allows up to 5 seconds, matching the client's normal command timeout, before closing the failed session. A regression test delays cancellation acknowledgement by 650 ms and checks that upload does not settle early, send image data, or repeat replacement/start commands.

The error now explains that transfer start was rejected before image bytes were sent. A fresh hardware test is still required to establish whether the original failure was transient device state. The subsequent browser discovery and independent 8-second Windows scan found no badge; neither attempted another resource write. Private raw report: `D:/Downloads/vivamark-diagnostics.json`; scan: `artifacts/hardware/upload-issue-scan.json` (excluded from publication).

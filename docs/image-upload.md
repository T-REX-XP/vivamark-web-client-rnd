# Still-image uploads

Open http://127.0.0.1:3000 and prepare artwork in the unified Layers editor. **Connect badge** connects in place; **Connect to upload** connects and opens the preview without leaving Artwork. Press **Upload image** in the preview. There is no backup, file-read prerequisite, persistence callback or acknowledgment checkbox. **Try simulator** on the optional diagnostics page exercises the flow without physical writes.

## Transaction

1. Independently validate the 360×360 RU30 resource and its internal CRCs and row bounds.
2. Authenticate and check target capabilities, system-1 filesystem, selected storage and free space.
3. Follow the APK's insertion, preparation, CRC negotiation and large-file transfer sequence. Serve requested ranges with bounded offsets and packet sizes.
4. Require device success and complete byte coverage before reporting **Image uploaded** and 100% progress. A successful browser GATT write alone is not sufficient.

Readback is optional: `uploadImageResource(bytes, {verifyReadback: true})` browses the root directory, resolves TEST.RES (or the measured TEST1.RES alias), downloads the resource and compares every byte. Only that mode returns `verified: true`. Diagnostic failure remains an error for that explicit request. The normal UI does not issue these reads or label device-confirmed uploads as readback-verified.

Diagnostics remain read-only. Raw flash, formatting, deletion, settings, animation uploads and system-0 FAT remain unavailable. Cancellation does not promise rollback.

## Physical evidence — 2026-11-23

Authentication, system-1 capabilities and root directory browsing succeeded. The complete root listing contains `TEST1.RES` at cluster 661, with no `TEST.RES` entry. Earlier named-file read attempts for TEST.RES failed; those reads are no longer upload prerequisites. See [directory evidence](../artifacts/root-browse-proof.json) and [cluster read source audit](backup-route-investigation.md).

On 2026-11-25 the owner confirmed that the uploaded picture was shown on the physical badge, while the extra readback failed with an invalid start response/size. The UI now reports the successful transfer without requiring this unsupported diagnostic. This is owner-reported display acceptance; independent byte-for-byte hardware verification, reconnect persistence and interruption recovery remain unverified.

## Checks

`bun run test`, `bun run typecheck` and `bun run build` pass. Integration tests prove the default upload issues no directory/file reads, retains the connection after device-confirmed completion and works without browser storage. Explicit readback mode still checks exact bytes and rejects corrupted data. Native comparisons retain 552 authentication vectors and 31 image fixtures.

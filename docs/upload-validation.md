# Upload implementation checks — 2026-11-25

- `bun run test`: 85 application tests, 1,002 assertions, zero failures. Reference checks also pass: CRC/RCSP fixtures, 552 native authentication vectors, 31 byte-exact native image fixtures and resource round trips.
- `bun run typecheck` and `bun run build`: pass.
- Python read-only probe guardrails: eight tests pass.
- Default uploads now stop successfully after full byte coverage and the badge's completion acknowledgment, with `verified: false`. No backup or directory/file reads occur. Explicit `verifyReadback: true` still requires exact readback; tests cover the measured TEST1.RES alias and corrupted packets.
- The browser completed the new default flow on a 31,983-byte multilayer image and reported **Simulation complete**, with no false claim of readback verification. Current capture: `.impeccable/review/layers/upload-complete.jpg`.
- Unified editor checks exercised canvas sticker dragging, one-step undo/redo, rotation, duplication/deletion, independent image import, ordering/hiding, direct text editing, keyboard movement and project export/reimport. Desktop/mobile captures are under `.impeccable/review/layers/`; mobile had no document horizontal overflow.
- Design detector ran once. Existing font and palette/type-ramp advisories remain; no broad styling changes were made outside the upload extension.
- Historical named-file READ24 TEST.RES returned status 1. The subsequent read-only directory listing succeeded and found TEST1.RES at cluster 661, with no TEST.RES. No physical resource or settings write was attempted. Evidence: [directory](../artifacts/root-browse-proof.json), [earlier named read](../artifacts/basename-read-proof.json).
- Discovery regression: the retained badge BLE identity was advertising `D40(BLE)`, without AE00 in advertising data. The exact-VivaMark browser filter excluded it. Both observed names and the advertised AE00 service are now accepted; a live identity-matched read-only connection authenticated and confirmed unchanged capabilities. Browser mocks check the discovery options and subscription/authentication ordering. Evidence: [factory-name connection](../artifacts/discovery-alias-readonly.json).

The owner reported that a physical upload displayed correctly on 2026-11-25. Independent hardware byte comparison, reconnect persistence and interruption recovery remain unverified. See [usage and transaction boundary](image-upload.md).

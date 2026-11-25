# VivaMark Studio

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User requested a local Bun app first. Browser UI implementation is delegated to the agent; React and TypeScript are implementation choices.

## Users
The badge owner has a VivaMark badge and an Android phone running the original app.

## Product Purpose
Port the Android badge application's editing features to a browser and validate its reconstructed protocol before permitting device uploads.

## Operating Context
Local development on Windows. Web Bluetooth runs in the browser. Physical authentication and read-only capabilities were observed: system-1 filesystem, 360×360 display. The root directory was read successfully and contains TEST1.RES. Uploads have no backup requirement, as requested; directory/cluster reads are used only for post-upload verification. Android hardware is available for a captured transaction comparison.

## Capabilities and Constraints
Image composition, text/stickers, gallery/history, multiple-image and video workflows from the APK. File conversion and transfer must be gated by concrete evidence. Do not send malformed resources or undocumented raw flash writes to the badge. No assertion of recoverability or hardware safety without evidence. Local-only deployment is confirmed.

## Evidence on Hand
Supplied APK bundle, extracted app/Jieli Java, ARM64 native libraries, protocol reports, 552 native auth vectors, 31 native image fixtures, physical read-only transcripts and a simulator-tested upload transaction. No successful physical replacement or recovery procedure is established.

## Product Principles
Device integrity precedes upload convenience. Preview and inspect offline. Keep validation evidence distinct from physical badge acceptance. Show unavailable device operations clearly.

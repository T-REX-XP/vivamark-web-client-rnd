---
name: VivaMark Studio
description: Local badge artwork editing with inspectable resource evidence.
colors:
  green: "#173c35"
  ink: "#233f36"
  muted: "#61726b"
  line: "#dce4dd"
  paper: "#f9fbf8"
  workspace: "#eef3ee"
  white: "#ffffff"
  orange: "#e9a25a"
  focus: "#b7712a"
  green-hover: "#295248"
  nav-active: "#35594a"
  pass-bg: "#e9f2e2"
  pass-text: "#3e693a"
  warning-bg: "#f8eddb"
  warning-text: "#845d23"
  error-bg: "#f8e8e0"
  error-text: "#823f29"
typography:
  headline:
    fontFamily: "Inter, \"Segoe UI\", Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.75px"
  title:
    fontFamily: "Inter, \"Segoe UI\", Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    letterSpacing: "-0.2px"
  body:
    fontFamily: "Inter, \"Segoe UI\", Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: "Inter, \"Segoe UI\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  diagnostic:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  field: "6px"
  control: "8px"
  panel: "14px"
  circle: "50%"
  modal: "16px"
spacing:
  compact: "8px"
  control-gap: "9px"
  field-gap: "12px"
  group: "24px"
  workspace-inline: "42px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.green}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.green}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  properties:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.panel}"
    padding: "24px"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "13px 15px"
  upload-review:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.modal}"
    padding: "28px"
    width: "min(600px, calc(100vw - 32px))"
  tag-pass:
    backgroundColor: "{colors.pass-bg}"
    textColor: "{colors.pass-text}"
    rounded: "5px"
    padding: "4px 7px"
---

# Design System: VivaMark Studio

## Overview

**Creative North Star: "Label studio"**

Label studio is the user-selected, code-led world: a forest-green tool rail, pale green work surface, white properties, and a warm orange circular artwork proof. The atmosphere is calm and practical, with compact controls and enough open space to inspect the artwork.

Editing remains the visual center. Resource evidence sits beside export, and status colors describe the actual validation state. Native conversion equivalence, structural validity, and physical badge acceptance remain visibly distinct.

**Key Characteristics:**

- Forest-green navigation and pale green workspace.
- Circular artwork proof with a separate decoded RGB565 view.
- Compact, labeled controls in softly rounded white panels.
- Visible focus, restrained state changes, and evidence-specific status.

This document describes the implemented local Bun/React app in `app/src/main.tsx`, `app/src/ImageUploadPanel.tsx`, `app/src/LayersPanel.tsx`, `app/src/editor.ts`, and `app/public/style.css`. The chosen HTML sketch is `.impeccable/mocks/decision/assigned.html`; it is a direction reference, not an approved raster comp. Base editor captures are `.impeccable/review/desktop.jpg`, `user-1280.jpg`, and `mobile.jpg`; they predate the unified Layers editor. Current Layers captures are `.impeccable/review/layers/desktop.jpg`, `mobile.jpg`, `mobile-controls.jpg`, and `hit-bounds.jpg`. `upload-complete.jpg` captures default simulator completion before the later hit-test and scroll fixes; it remains scoped evidence for that upload state. Interaction details below are extracted from the implementation.

## Colors

The palette combines forest greens and pale paper tones with warm artwork and quiet semantic states. Frontmatter is the normative token source.

### Primary

- **Forest Green** (`green`): rail, primary actions, brand mark, and headings. The deeper green anchor makes the pale editing area feel like a physical sample book.
- **Warm Orange** (`orange`): default artwork and an available artwork swatch; it is content color, not the primary control color.

### Neutral

- **Workspace Green** (`workspace`): uninterrupted working background.
- **White** (`white`): header, controls, and property panels.
- **Paper** (`paper`): the CSS paper primitive; use only where the existing source assigns it.
- **Green Ink**, **Muted Green**, and **Divider Green** (`ink`, `muted`, `line`): text hierarchy and quiet separation.
- **Amber Focus** (`focus`): keyboard focus outline.

Pass, warning, and error pairs support readable status messages. These are semantic colors, not additional brand accents.

**The Evidence Rule.** A positive status names its evidence: local validation, simulation, device-confirmed transfer, or optional byte readback; none establishes interruption recovery.

## Typography

**Display and Body Font:** Inter, with Segoe UI, Arial, and sans-serif fallbacks. There is no bundled or imported font file; rendered type depends on installed fonts.

**Label/Mono Font:** UI monospace with Consolas fallback, reserved for logs, packets, and technical values.

The interface uses a single familiar sans family, modest weight contrasts, and short labels. Headings are compact rather than monumental.

- **Headline:** page heading, with responsive size adjustments described below.
- **Title:** panel headings; smaller subheadings use 14px at weight 650.
- **Body:** explanations and buttons; explanatory body text generally uses line-height 1.5–1.7.
- **Label:** fields and compact controls. Hint text uses 12px; status tags use 11px.
- **Diagnostic:** timestamped protocol rows, with smaller code details.

## Layout

The desktop shell has an 80px white header and a 216px forest-green left rail. The workspace starts after the rail, has 40px vertical / 42px horizontal padding, and a maximum width of 1800px. The main editor uses `minmax(380px, 1fr) 300px` columns with a 34px gap. The proof is a 360px circle; the properties panel uses 24px padding. Device, library, and motion views reuse the same shell and panel language.

At widths of at least 1600px, workspace padding becomes 44px / 56px, the property column 320px, the editor gap 48px, and the proof 390px. At 1250px and below, the rail is 190px and the proof 310px. At 970px and below, the rail collapses to a 74px icon rail and the proof becomes 280px; accessible navigation names remain available. At 760px and below, the header is 68px, navigation becomes a horizontal scrolling row with labels, workspace padding is 26px / 19px, and editor/motion panels stack. Footer actions become a two-column grid with project export spanning both columns. Preserve normal document scrolling and the independently scrollable original-image row in Slideshow. The Artwork editor has no inspiration/preset strip or editing tabs. Add image, Add text, and Add sticker share one toolbar; the unified Layers list and selected-element properties occupy the right panel. On desktop (at least 761px), this panel scrolls within `calc(100dvh - 210px)` and its layer list within 205px. On mobile, properties follow the canvas in document flow, and the layer list scrolls within 260px.

The native upload dialog is at most 600px wide, inset by 16px on narrow viewports, and scrolls within a maximum height of viewport height minus 40px. It uses 28px padding, reduced to 22px on mobile. Its circular review proof is 120px on desktop and 100px on mobile.

Spacing is compact within controls and generous between task groups. Use borders to separate toolbar, property groups, evidence, and export without wrapping every region in a card.

## Elevation & Depth

Panels are flat white surfaces on the pale workspace. The circular proof carries the strongest shadow (`0 14px 28px #233f3619, 0 2px 4px #173c3512`); it represents the physical badge. The toast has a temporary raised shadow. The selected layer row uses a pale green fill, without elevation. Avoid spreading the badge shadow to ordinary panels. The upload modal is the deliberate elevated exception: `0 18px 64px #10291f44` over a translucent `#112c2570` native backdrop.

Buttons change background, color, and border over 160ms; library previews change background over 200ms. There is no decorative page entrance. Reduced-motion preference removes transitions.

## Shapes

Controls use soft 8px corners, fields 6px corners, property and general panels 14px corners. The native upload dialog uses 16px corners; its success receipt uses 8px corners. Slideshow original-image choices, badge previews, swatches, and the brand mark are circular. Borders are fine, low-contrast separators; selected layers and circular image choices strengthen their border rather than changing geometry.

## Components

### Buttons

Primary actions are forest green with white text, secondary actions white with green text and a fine border, and quiet actions transparent. Standard buttons have 10px / 14px padding, a 42px minimum height, 14px semibold labels, and an 8px radius. Compact controls use smaller padding and a 32px minimum height. Disabled controls use opacity 0.43 and a not-allowed cursor. Focus is a 2px amber outline offset by 4px. Keep visible text or an explicit accessible name on icon controls.

### Inputs / Fields

Labels sit above pale fields with an 8px gap. Text fields have a thin green-gray border, 6px radius, and 10px / 11px padding. Focus strengthens the border and retains the amber outline. Range controls show their current value alongside the label, using tabular numerals. Layer transforms also use labeled number fields. Circular swatches mark selection with an external green outline.

### Navigation

The green rail uses muted pale-green labels, a lighter green hover, and a filled green active row with white text. Active icons use warm gold. Maintain the visible selection and accessible name as the rail collapses; mobile restores text labels in the horizontal row.



### Connection Control

The header **Connect badge** action starts the browser connection in place and keeps the current screen open. After connection it becomes **Disconnect badge**, or **Disconnect simulator** for a simulated connection. Disconnect clears the connection details without navigating. Diagnostics are an optional manually opened page, not an intermediate step required to connect or upload.

### Chips / Status

Small softly squared tags pair concise text with neutral, green pass, or amber pending backgrounds. Errors are inline messages with warm red text and a pale red surface. Do not communicate validation solely through color.

### Cards / Containers

Properties and secondary views use flat white panels with 14px corners. Internal dividers divide related settings. Library tiles present circular artwork on pale green square wells; labels remain outside the image well. Empty states retain a clear action and short explanatory text.

### Circular Proof and Resource Inspection

Artwork fills a circular canvas. Layer changes update the proof directly, with a move cursor and a visible canvas keyboard-focus ring. A selected element has a white-backed green dashed outline; this is editor-only UI and is excluded from PNG export, library thumbnails, RES encoding, and upload review. The decoded RGB565 inspection view is explicitly selectable. Place current structural checks beside export, indicate incomplete work while encoding, and keep transfer status visibly separate from local structural validity.

Original-image JPEGs used by Slideshow and PNG overlays in the Add sticker picker are original supplied Android app artwork from `assets/<filename>` in `artifacts/extracted/base.apk` (SHA-256 `c7317d7559108438e0f01069c95f933a74dcfc537c7e521ca1dd7e25264b31d7`). They are sourced assets, not generated images. Provenance metadata records this origin without altering decoded pixels.

### Unified Layers Editor

The toolbar exposes **Add image**, **Add text**, and **Add sticker**, plus Undo/Redo. A sticker picker appears on demand; there are no editing tabs and no inspiration section. Images, text, and stickers stay independent instead of flattening into a shared background. Each raster layer embeds its image data; stickers embed a PNG with transparent padding trimmed while preserving its visible alpha pixels. Imported images retain embedded source data in the supported image formats. Text remains editable text. Save/open/exported projects retain layer data, order, visibility, opacity, and transforms.

The Layers list displays topmost elements first with thumbnail or text icon, layer name and kind, selected-state fill, and a visibility checkbox with a 44px target. The list includes a selectable legacy **Base image** when present and a **Background** row. Canvas click selects the top eligible element using rotated bounds. Raster bounds use the loaded image’s actual aspect ratio and scale, so empty space above or below a wide sticker does not steal selection from an underlying element. Alpha holes inside the raster’s rectangular bounds are not tested per pixel. Drag moves the selected element; arrow keys nudge it by 1px, or 10px with Shift. Delete/Backspace removes the selected element while the canvas is focused. If Undo removes the selected element, selection returns to Background rather than leaving stale element properties.

Selected-element properties expose name or text content, size, X/Y position, rotation, opacity, and text color. Actions offer **Move up**, **Move down**, **Duplicate**, **Delete layer**, and **Replace image** for raster layers. Duplicate is offset slightly from its original. The editor limits composition to 30 elements. Legacy Base image retains zoom, position, rotation and removal controls; Background offers color swatches, custom color and camera import. These contextual controls replace the earlier separate image/text/sticker editing modes.

### Image Upload Review

The upload entry point is a green primary editor action: **Connect to upload**, **Upload image**, or **Simulate upload**, depending on connection state. PNG and RES downloads remain secondary actions. Mobile places upload across the footer grid's full width. **Connect to upload** connects from the current Artwork screen and opens the same preview dialog after a successful connection. It snapshots the prepared resource before connecting. Both the header connection control and footer show **Connecting…** and disable duplicate connection attempts. Device view offers the same prepared-image review as an optional destination reached through navigation or **View upload checks**.

A single native `<dialog>` opened with `showModal()` contains the preview and upload action. Its title names the task, and its subtitle distinguishes the synthetic simulator from the supported system-1 badge filesystem. Review uses a copied resource snapshot: a decoded 360 × 360 circular preview, artwork name, target `TEST.RES`, byte count, CRC, and shortened SHA-256 with the full fingerprint in its title. Editing behind the modal cannot silently change these reviewed bytes.

The primary **Upload image** action is available after resource validation and connection; simulation uses **Simulate image upload**. There is no acknowledgment checkbox, previous-image backup step, backup persistence, or backup download. Fingerprint calculation is informational and does not delay the action. Errors and lost connections disable upload. Close and Escape dismiss only while idle; the close control is disabled during transfer, with a separate **Cancel transfer** action.

Busy state uses a polite live region, named stages, a progress bar, and byte counts. The default flow covers prerequisites, preparation, checksum negotiation, transfer, and device completion. Keep the badge powered and the tab open until the transfer finishes. Byte coverage alone is not completion: the badge must confirm successful transfer.

Default physical success is **Image uploaded** / **Badge confirmed upload**, after complete byte coverage and successful device completion. Simulation uses **Simulation complete** / **Simulated upload completed** and explicitly says no physical badge changed. Byte-for-byte readback is an optional diagnostic (`verifyReadback`), not a requirement of ordinary upload; the default flow does not issue the unsupported `0x0C`/`0x24` readback commands. Only a result that actually passed readback uses **Image upload verified** / **Uploaded file matches the prepared image**. An unsupported diagnostic readback must not turn an otherwise successful displayed upload into a default-flow failure.

The owner has reported an image uploaded and displayed on the physical badge. Independent physical byte verification remains unproven. The UI still asks the owner to check the badge's appearance. Error copy asks the owner to reconnect before retrying. Animated uploads remain unavailable.

## Do's and Don'ts

### Do:

- Do keep artwork and decoded resource previews clearly identified.
- Do use the green primary action, white secondary action, and transparent quiet action consistently.
- Do label pending, simulated, and verified states with text as well as color.
- Do preserve the original app artwork pixels and record their source provenance.
- Do retain visible keyboard focus and the reduced-motion preference.
- Do preserve the reviewed resource snapshot, direct upload action, staged progress, cancellation, and device-confirmed completion.
- Do keep images, text, and stickers independently selectable and editable in one Layers panel.
- Do reserve verified byte-readback copy for a readback that actually passed.
- Do connect and disconnect in place; let diagnostics remain an optional navigation destination.

### Don't:

- Don't describe local validation or simulator success as successful physical badge transfer.
- Don't equate bytes sent with device completion, or device completion with independent byte verification.
- Don't export the selected-element outline or flatten editable elements when adding a new layer.
- Don't add a decorative entrance sequence to the editor.
- Don't apply monospace to ordinary editor labels or headings.
- Don't substitute a marketing hero for the working artwork editor.

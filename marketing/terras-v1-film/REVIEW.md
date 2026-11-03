# REVIEW — Terras ERP v1.0 film

Output: `marketing/terras-v1.mp4` (1920x1080, 30 fps, 37.5 s, 2.8 MB) and `marketing/terras-v1.gif` (960 px, 12 fps, 3.1 MB) embedded at the top of the README, linking the MP4.

## Creative calls
- Storyline A, "One order, one thread" (see STORYLINES.md). B (paper floor) needed a photo of a real paper form; C (trace it back) became S10 of this film.
- Every screen is a rebuild of the real Classic (XP) UI from terras-ui tokens (title-bar gradient, table head, status chip families, Tahoma), checked against logged-in screenshots of the local app. Rebuilt at ~2.5x so text clears 28 px.
- All values are demo data ("PT DEMO GARMEN", SO-2026-10-00042, lot numbers). The local DB holds real customers, so no real screen is shown. The QR codes and the Code128 barcode are real encodings of the demo values.
- Features shown are real; the numbers are illustrative.
- No music: no HeyGen sign-in and no local MusicGen. SFX only, from the bundled set, each placed so its measured peak lands one frame after its picture.

## Measured vs looked at
- `check`: no errors. Kept warnings: the department ticker in S2 rolls faster than reading speed on purpose (texture under "Six departments."); "Terras ERP" letters counted as 9 words; the S6→S7 carried lot chip overlaps its target during the handoff; Studio duplicate-image warning for the mark used twice.
- Rendered audio measured, not heard: hits at 0.42, 9.48, 10.17, 14.03, 19.5-20.4, 23.11, 27.74, 28.68, 34.16 s, all within 1-2 frames of their pictures; -20 LUFS integrated, true peak -5.1 dB, no clipping. Quiet by design for SFX-only; normalise if a music bed is added.
- Looked at: beat sheets, all 10 seams, end card, one GIF frame. Not checked at phone width: the README is read on desktop; the window rows are dense for a phone.

## Weakest shot
S3→S4 seam: the window's sections pop in on the cut instead of building. With more time: build the BOM-entries and MO panes as the blue folds into the title bar.

## Renders need
Tahoma resolved through `local("Tahoma")`: re-render on a machine with Tahoma installed (any Windows box) or the type falls back.

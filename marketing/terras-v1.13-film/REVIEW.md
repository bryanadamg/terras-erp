# REVIEW — Terras ERP v1.13 film, "One day at the mill"

Output: `marketing/terras-v1.13.gif` (960 px, 12 fps, 5.0 MB, looping) at the top of the README. 40 s, rendered 1920x1080 at 30 fps; silent by request (README GIF only).

## Creative calls
- Storyline B (see STORYLINES.md): one day, hour by hour, only features shipped after v1.0, ending on "The whole mill. One system." A (walk a lot back) and C (paper ↔ system match cuts) not built.
- Home stage is the real Dashboard > Floor: `assets/floor.js` is FloorView.tsx's layout and pixel painting ported 1:1, driven by film time (demo mill: 6 stores, covering/warping, 48 looms, dyeing/setting/packing).
- Every screen rebuilt from the app's `en` strings and theme tokens (Receive Goods, Drawing-in / Tying-in, the loom card's tuner picker, Log WO multi-lot, BAG LABEL, KARTU PICKING, Loading deck 🖨SJ chip, Export Excel). Icons are the app's Bootstrap Icons. QR codes and the Code128 barcode are real encodings of the demo codes.
- All data is demo ("PT DEMO GARMEN", PO-2026-11-0118, Sari / Budi / Pak Darto). Numbers are illustrative.
- VAT-inclusive pricing left out: on screen it is only a 9 px "(excl. …)" hint; the breakdown lives on the printed PO.
- The 17:00 Surat Jalan print stamp is on `dev` (3ee2fcf4), not in v1.13.0: release it before publishing the film, or swap that beat.
- The spreadsheet in S8 is a plain grid with the deck's columns; the real export's column set and filename weren't checked.

## Measured vs looked at
- `check`: no errors. Kept warnings: dropdown menus and tooltips under their read floor (they flick open as the cursor picks, like the real app); text under 28 px on dense screens (labels, sub-labels, paper prints), fine on desktop, not for phone width; the BAG LABEL header 2.0 s vs a 2.6 s floor (the lot number and weight are the read); two GSAP counter proxies without a baseline; contrast warnings on the S3 toggles are the base text under the selected overlay; `local("Tahoma")` font (render on a Mac/Windows box with Tahoma).
- Looked at: QA frames, beat sheets, every seam. Fixed blank cut frames on S1→S2, S3→S4, S4→S5, S8→S9; clipped S3 toggles; first-frame hide states.
- Sound: none, by request (the film only ships as a GIF).

## Weakest shot
S4 (10:00 tuning): the loom card is mostly empty body during prep. With more time: show a second loom card running beside it so the floor reads as busy.

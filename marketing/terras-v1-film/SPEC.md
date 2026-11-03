# SPEC — Terras ERP v1.0 launch film (storyline A)

GOAL:    a textile-mill owner watching the README sees one order travel the whole floor and leaves thinking "it covers everything, and every lot is traceable".
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps. README gets a looping GIF cut-down linking the MP4.
TIME:    36 s x 30 = 1080 frames. No music (no source); SFX only, peaks 1 frame after picture.

LOOK:    the product's own Classic (XP) medium, rebuilt at 2.2x its 11 px app scale.
         ground A (workspace) #ece9d8 flat, no texture; ground B (type beats) solid #0058e6; ground C (paper prints) #ffffff with 1 px #000 rules.
         window chrome: title bar linear-gradient(to right,#0058e6,#08a5ff), 52 px tall, radius 12 px top; table head linear-gradient(#ffffff,#d6d3ce); border #7f9db9.
         ink #1a1a1a on A/C, #ffffff on B. Accent XP green #2d7a2d only on: VERIFIED/DISPATCHED chips, payoff line word, end-card CTA.
         status chips: terras family colours (blue #dce4f5/#3a5faa, amber #fff3cd/#b8860b, green #d4edda/#27713a), radius 3 px.
         display face Tahoma Bold, titles 96 px (8.9% of height), tracking -1%; body Tahoma 28-34 px; codes Consolas 28 px.
         shadow on windows 0 18px 40px rgba(0,0,40,0.28); no grain, no vignette.
OBJECTS: SO row (PO#/customer/item/size chip/qty chips/status), Production Run window with BOM entries + MO tree,
         Kartu Kerja paper card with QR, phone scanner (390 px wide mock of the real /scanner chrome), loom card (title bar, efficiency %, beam chip),
         dye bath panel (volume, ratio, dose rows in grams), A6 carton label (QR + barcode, N.W./G.W.), shipment row with status chip,
         genealogy chain of lot chips, the real Terras mark (assets/terras-mark.svg).
         All values are demo data (customer "PT Demo Garmen"), never the local DB's real customers.
MOTION:  enter expo.out 0.5 s (15 f); move/camera power2.inOut 0.5 s; exit power3.in 0.25 s (8 f);
         titles: per-word blur 6px→0 + opacity, 0.13 s each, 0.07 s apart, no translate, dead still after landing.
         stagger rows 0.06 s. Motion blur on root.

SHOTS:
  S1  0.0-3.0   hook: SO row at 2.2x on ground A; "10,000 Yd" chip punches to 2x; title "10,000 yards. Navy. Friday." | pop on punch | the qty chip grows into ground B
  S2  3.0-6.0   tension, ground B: "Six departments." then "One order." words land; six department names flash as a ticker under it (one at a time, 0.25 s) | whoosh | iris closes onto a window title bar
  S3  6.0-8.0   reveal: XP window title bar wipes open across frame reading "Terras ERP" with the mark | riser tail | the window body becomes the Production Run window
  S4  8.0-12.0  plan: Production Run window: BOM entry NAVY with S/M/L/XL qty; click Create; MO tree builds: FG MO + one shared GREIGE MO (badge "shared") | click, pops | GREIGE MO row expands into a WO row with a printer icon, print → S5
  S5  12.0-15.5 scan: paper Kartu Kerja slides in (ground C); phone enters from right, its viewfinder frames the QR, ping; phone screen flips to "Log output 48.6 kg" | ping, click | phone screen pushes into loom card
  S6  15.5-18.5 weave: loom card "L1 07" RUNNING, efficiency counts 0→92.4%, beam chip BM- mounted | pop | lot chip GRG- drops out and carries into S7
  S7  18.5-22.0 dye: Dyeing Orders bath panel: volume fills 0→1,200 L, ratio 1:10, three dose rows compute grams | key ticks | bath panel tile carries to label printer
  S8  22.0-25.0 pack: A6 carton label prints out of a slot (ground C): PU-20261028-0007, NAVY L-72 (70-74), N.W. 25.4 kg | printer ticks | label shrinks onto a shipment row
  S9  25.0-28.5 verify: shipment SHP-00042 row: STAGED (blue) → VERIFIED by "Rina" (green) → DISPATCHED (green); title "Checked twice. Then it ships." | click, pop x2 | dispatched chip punches → S10
  S10 28.5-32.0 payoff: genealogy unrolls right-to-left: PU- ← DYE- ← GRG- ← BM- ← YRN- with connecting rules; title "Every lot, traced back" ("traced" in green) | riser→impact on last chip
  S11 32.0-36.0 end card on ground A: mark scales in with fill rising (0.6 s), wordmark "Terras ERP" wipes in, "v1.0", CTA chip "docker compose up -d" held 2.5 s | impact

BANNED:  dark navy void; glow/bloom/particles; blue mesh gradients; glass cards; cream paper + serif; three cards in a row; KPI grids;
         title over a dimmed screenshot; logo docked in a corner; everything fading and sliding up; titles drifting after landing;
         invented features or numbers presented as real (all figures are demo, the features are real); real customer names.
QA:      t=1.0 SO row readable, qty chip large; t=4.5 "One order." ground B; t=7.0 title bar "Terras ERP"; t=10.5 MO tree with shared greige;
         t=14.0 phone over QR; t=17.5 loom 92.4%; t=21.0 dose grams; t=24.0 carton label legible; t=27.5 DISPATCHED green;
         t=31.0 full genealogy chain; t=35.0 end card with CTA.

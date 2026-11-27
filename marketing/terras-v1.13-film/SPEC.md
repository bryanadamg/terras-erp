# SPEC — Terras ERP v1.13 film, "One day at the mill" (storyline B)

GOAL:    a mill owner sees one ordinary day go by, hour by hour, and every hand on the floor lands in one system:
         they leave thinking "the whole mill runs on it, and it keeps getting better" (all features shown shipped after v1.0).
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps. README gets a looping GIF cut-down linking the MP4.
TIME:    39 s x 30 = 1170 frames. SFX only until a music bed is signed in for (HeyGen catalog); then 0.14-0.2 under the hits.

LOOK:    the product's own Classic (XP) medium, rebuilt at ~2.4x its 11 px app scale (same as the v1.0 film).
         ground A (workspace) #ece9d8 flat; ground B (claim) solid #0058e6; ground C (paper prints) #ffffff, 1 px #000 rules.
         home stage: the real Dashboard > Floor pixel-art canvas (FloorView.tsx painting ported 1:1: #d6e2f6/#cfdcf2 checker,
         navy #003080 rooms, blue #3a8cff→#0058e6 machine bands, green #3a9a52→#25733a store bands, belts #b8c8e4 with #f28c28 dashes).
         window chrome: title bar #0058e6→#08a5ff, 56 px; table head #ffffff→#d6d3ce; field border #7f9db9.
         layout: every station = hour column on the left (x 110-470) + the real screen on the right (x 520-1810).
         hour: Tahoma Bold 120 px #0058e6; its line Tahoma Bold 52 px ink, max 7 words. codes Consolas 28 px.
         accent XP green #2d7a2d only on: Confirm/Log/Mount buttons (the product's own), printed SJ chip, "One system", end-card CTA.
         chips: the app's tint families (blue #dce4f5/#3a5faa, amber #fff3cd/#b8860b, green #d4edda/#27713a, grey #eae8e2/#c8c6be).
         shadow on windows 0 18px 40px rgba(0,0,40,0.28); no grain, no vignette.
OBJECTS: floor plan (6 stores in a 2-column rail, lanes: COVERING+WARPING / LOOMS / DYEING+SETTING+PACKING);
         Receive Goods dialog; Drawing-in / Tying-in dialog; loom card with tuner picker; Log WO dialog with multi-lot list;
         A6 bag label; A4 Kartu Picking; Loading deck table with the 🖨SJ chip; a plain spreadsheet grid; the Terras mark.
         All values demo ("PT DEMO GARMEN", PO-2026-11-0118, people Sari / Budi / Pak Darto). Labels quoted from the app's `en` strings.
MOTION:  enter expo.out 0.45 s; camera power2.inOut 0.5 s; exit power3.in 0.25 s; zoom-through power3.in 0.35 s.
         hour: per-character blur 6→0 0.13 s, 0.05 s apart; its line per word 0.07 s apart; dead still after landing.
         cursor 72 px, enters from off-frame, its click causes the change on the same frame. Motion blur on root.

SHOTS:
  S1  0.0-3.5   dawn: floor window, every machine grey; "06:00" lands; machines switch on lane by lane (prep → looms → finishing);
                line "The mill wakes up." | pop as the looms light | camera pushes into YARN STORE, zoom-through
  S2  3.5-8.0   receive: Receive Goods — PO-2026-11-0118; Surat Jalan "SJ/KMT/1123"; line 2's warehouse picker changes
                "Same as receipt" → "COVERING STORE"; click Confirm Receipt | click | line "Yarn in. Each line to its own store." |
                carry: a lot chip leaves the receipt and carries to S3
  S3  8.0-12.0  beams: Drawing-in / Tying-in; row 1 Sari · Drawing-in (Rumus) · 4,800 ends; row 2 "Pak Darto" typed name ·
                Tying-in (Sambungan) · 4,800; click Mount | click | "08:00" "Every beam, with who drew it in." | morph into loom card
  S4  12.0-15.5 tuning: loom card L1-07 DRAW-IN; picker "Who is tuning?" → Budi Santoso; Tuning button enables, click → strip TUNING,
                note "▶ Start Run" | click, pop | "10:00" "Tuning logged with its tuner." | whip right
  S5  15.5-20.0 log: Log WO: WO-WV-0118-03 — MO-0118-02; Actual Qty Produced counts to 186.4 kg; "Lots to Consume" two beam lots
                ticked, "take" chips, "drawing 186.4"; click Log Completion → A6 BAG LABEL slides in, GRG-20261127-0007, 186.4 kg |
                click, tick | "13:00" "Two beams in. Label out." | the label paper becomes the paper world
  S6  20.0-23.5 picking: A4 KARTU PICKING, Daftar Koli / Carton Checklist; five carton rows re-sort by "Lokasi / Location" |
                soft ticks | "15:00" "Picked in shelf order." | blur swap onto the deck
  S7  23.5-27.5 deck: Loading deck; SHP-00118 row, Surat Jalan chip "🖨SJ" grey, tooltip "Surat Jalan not printed yet";
                click Print Surat Jalan → chip green "printed 17:04" | click, pop | "17:00" "Unprinted Surat Jalan? Flagged." |
                cursor clicks Export Excel → iris from the click
  S8  27.5-31.0 export: spreadsheet grid builds row by row with the deck's columns | ticks | "18:00" "The day, in Excel." |
                pull back: the sheet shrinks into the floor window
  S9  31.0-35.0 claim: floor plan, all lanes running (the looms run three shifts); "The whole mill." "One system." ("One system" green) |
                riser → impact on "One system" | colour flood to ground A
  S10 35.0-39.0 end card: mark fills up, "Terras ERP" wipes in, chip "v1.13", CTA "docker compose up -d" held 2.5 s

BANNED:  dark navy void; glow/bloom/particles; mesh gradients; glass cards; cream paper + serif; three cards in a row; KPI grids;
         title over a dimmed screenshot; logo docked in a corner; a clock docked in a corner (the hour lives in the left column);
         every station entering the same way; titles drifting after landing; invented UI or features; real customer names;
         VAT breakdown on the receive screen (it exists only on the printed PO).
QA:      t=1.0 floor plan grey + "06:00"; t=3.0 lanes running; t=6.5 line 2 warehouse "COVERING STORE"; t=10.5 both beam rows filled;
         t=14.5 TUNING strip + Budi; t=18.8 bag label legible; t=22.5 Lokasi column sorted; t=26.0 green SJ chip;
         t=30.0 spreadsheet rows; t=33.5 "One system" green over a running floor; t=38.0 end card with CTA.

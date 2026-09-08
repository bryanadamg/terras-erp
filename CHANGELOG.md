# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Version bumps are derived from [Conventional Commits](https://www.conventionalcommits.org/)
on `main`:
- `fix:` → PATCH
- `feat:` → MINOR
- `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer → MAJOR
- `chore:` / `refactor:` / `style:` / `perf:` / `docs:` / `test:` → no bump (unless the diff it
  describes is user-facing, in which case use `feat`/`fix` instead)

## [Unreleased]

## [0.26.0] - 2026-09-08

### Added
- Dyeing and Setting orders tabs rebuilt as a work-order list with an expandable supervisory row per order, matching the rest of the app's list views instead of their prior bespoke layout

### Changed
- The sign-in screen now uses the shared Terras login component, keeping look and behavior consistent with other Terras apps
- Create Run is now a shared action button, and its modal is modeless so it can stay open while working the rest of the screen

### Fixed
- The sign-in screen showed a white band at the bottom on any UI scale below 100% — its viewport now lines up with the app's zoom
- Work queue's clipped order codes now pop out in full on hover instead of staying truncated
- Work queue reports the real substrate requirement in the item's own unit instead of a raw beam-slot count, for beam-gated rows too

## [0.25.0] - 2026-09-07

### Added
- Staged material can be returned from a work order line — the exact reversal of staging, so material picked to the wrong line no longer has to be consumed just to leave it. Beams are refused on purpose: a warp is a loom resource pegged to the work center, not the WO, and comes off through beam dismount instead
- Dyeing Kartu Kerja prints the weighed dye doses computed from the actual bath volume, alongside the planned g/L sheet
- Dyeing rate modal is modeless, so it can stay open while working the rest of the screen

### Changed
- Dyeing bath volume is taken when the dyeing run starts, not at completion, and the planned volume set when the work order was cut carries through as its default — doses calculate off the real bath the floor filled instead of a rate applied after the fact
- A dyed batch produces one output lot instead of two
- A dyeing run's status derives from its work order instead of being tracked independently, so the two can no longer disagree about whether a bath is done
- Manufacturing Orders list and toolbar now use the shared list/toolbar primitives, matching the rest of the app

### Fixed
- The floor scanner's material check used a `line.is_percentage` field the schema does not have, so it silently fell back to the wrong formula for every percentage-based BOM line and disagreed with the MO page; both now share one calculation
- Editing a work order after output has been logged against it no longer silently orphans that output — its work center, routing step, input/output locations and qty (below what's logged) are frozen once a completion exists; cancel and cut a new one instead
- A rejected lot pushes updated MO progress (good vs. rejected totals) to other clients, not just a status ping — progress bars no longer kept showing the rejected qty as done
- Manufacturing order code uniqueness is checked before creation instead of relying on the database to reject a clash, so two planners proposing the same code get a clean error instead of a 500
- Bulk mark-printed on work orders enforces the same work-center scope as the single-WO route, so a weaving-scoped user can't mark dyeing cards printed by batching the request
- A printed MO renders the BOM/recipe it was actually built against (snapshotted at creation) instead of the live BOM, which may have changed since
- Work order delete broadcasts to other clients so the row disappears everywhere, not just for whoever deleted it
- Logging an MO completion broadcasts the resulting stock and work order events, so other open screens pick up the change
- Work queue no longer reports a work order as waiting on an earlier routing step — that gate was already dropped from the completion route, but the queue verdict still showed it as blocked
- Automatic MO/work order status transitions (e.g. reopening a closed order on a lot reject) are recorded in the audit log with before/after values, and MO/work order audit entries use one consistent entity-type spelling
- Manufacturing order list rows no longer remount when paging, and the unreachable BLOCKED status chip is gone
- Navigating to a work order uses the router instead of a full page reload

## [0.24.0] - 2026-09-06

### Added
- Dyeing machine monitor grid (Engineering nav), mirroring the weaving monitor's loom cards for dyeing vessels
- Dyeing machine efficiency is measured in yards against reel speed (RPM × yards/rev × lines ÷ wall-clock minutes) — a different formula from weaving's, since a dyeing vessel's throughput unit is yards on the reel, not picks on a loom
- PR material pull sheet's beam lines show warp ends alongside the other beam specs

### Fixed
- A QC-rejected piece and a split lot both now trace back to the lot they were cut from; a backfill migration repairs genealogy for lots split or rejected before this fix
- Bag and beam labels print the lot's current remaining weight instead of a frozen completion quantity

## [0.23.0] - 2026-09-05

### Added
- Packaging Types master page tracks the boxes the plant stocks, with a tare weight per type; a custom box is weighed at pack time instead of carrying a default nobody means
- Packing an order picks the packaging type per carton, and each carton snapshots the tare and gross weight (net + box) it was packed with, so a later tare correction never rewrites an already-printed label
- Gross weight prints on carton labels and the Surat Jalan alongside net weight, since the carrier bills on the gross figure
- Packing order form takes a sampled unit weight for the cloth actually being run, overriding the item master's estimate (taken at style development) for that order's alt-unit conversion
- Packing progress shows a pieces bar and a kilos bar side by side, since a light run can read 100% of pieces at 96% of kilos and packers need to see the real gap

### Fixed
- Clicking a pack section's caption no longer fires whichever action button (+, All/None, pin) happens to sit in it; the packing modal is also wider so the carton grid stops scrolling sideways

## [0.22.0] - 2026-09-04

### Added
- Weaving can be staged by scanning a beam's own printed label instead of only the bag it travels in, so a beam separated from its bag — or re-mounted onto a different one — can still be staged correctly
- New Packing Order's Sales Order picker is searchable instead of a long plain dropdown
- New Packing Order's order-line badges are a checkbox picker, so multiple lines can be selected at once instead of one at a time
- Quarantine packing shows the work order that produced each lot as its own column
- Stock on-hand grid gained a WO column split out from the MO column, and clicking a lot's MO/WO chip filters the grid to that order

### Changed
- Quarantine packing grid splits Item and Sales Order into their own columns instead of combining them
- Stock on-hand grid's search bar and MO/WO columns are wider, and the search placeholder now mentions WO

## [0.21.0] - 2026-09-03

### Added
- Packing orders now target and fulfil on pieces packed rather than kilos weighed. A carton's piece count is the planned quantity — kg is only its estimate — so `qty_target`/`qty2` and progress are driven off the alt count, cartons split by the piece count per box instead of dividing a kg figure, and completions count packed pieces straight from the cartons. A creation-time check rejects a target that contradicts the stated alt count (e.g. a target authored in kg that doesn't match the piece count beside it) instead of silently packing to the wrong figure
- Packing order list shows a pack progress bar per order, in the same thin-bar-plus-qty-line style as the Sales Order table's MO progress cell
- New Lot modal's item field is a searchable picker instead of a plain dropdown
- Manual lot creation can post an opening quantity at a chosen location, instead of only creating an empty lot

### Fixed
- Sales order line quantity is read in the item's stock UOM everywhere packing touches it, instead of the line's raw yards — a line authored in yards was being packed as if it were already in the stock unit
- Packing from a Quarantine deep link inherits the sales order line's alt selling unit again; the linked SO could be SENT (partially shipped) and fall outside the open-orders list the picker searched, so the order — and the alt unit it carries — silently went unmatched
- Shared action buttons (modal close, print, pager) no longer submit the form they're rendered inside, now that they're explicitly typed as buttons rather than defaulting to submit

## [0.20.0] - 2026-09-03

### Added
- Production quantity formula is configurable per size (or a single `*` rule for every size) instead of hardcoded, seeded with the existing formula so nothing changes until it's edited. It can be edited from Settings > General or, without leaving the run, from the Production Run modal's own modeless dialog
- Dye Recipe list shows a colour swatch chip for the recipe's colour code and its derived colour variant, so recipes read like the Color Library instead of a bare code
- Color Variants and Combo Library pages gained a swatch grid view (alongside the existing list), with colour and family chips, multi-colour band swatches for compound mill codes, and slimmer list columns to make room

### Fixed
- A dye recipe's colour variant chip is derived from its linked Color record instead of matched against the MO's attribute values, so a recipe whose own attributes disagree with its Color library entry now shows the right variant instead of none or a wrong one
- Color Variants defaults to the list view again (the swatch grid had become default) and remembers whichever view was last chosen
- Production Output and Fulfilment bars on the Sales Order table top-align in their cell instead of centering, so they line up with neighbouring rows instead of drifting when a cell wraps

## [0.19.0] - 2026-09-02

### Changed
- A sales order now states the size that was ordered without naming a recipe, and the BOM is picked on the Production Run. One item can own several BOMs and sizes live on the BOM, so the size dropdown stayed empty until a recipe was chosen — which made sales take a shop-floor decision at order entry, on an item whose recipes they cannot tell apart. The size list is now the union of every candidate recipe's sizes, and the planner resolves the chosen size against the BOM they pick. A measurement in cm only shows while a single recipe owns the line, since two recipes can call the same size 60 cm and 67 cm. A line that does name its recipe still carries it, and pre-fills the Production Run exactly as before
- The Production Output column measures how much has been produced rather than how many work-order steps are ticked. Work orders are created by hand as dispatch decisions, so the step denominator was authored after the fact and the bar read 0% for the many orders carrying no work orders at all. The bar now folds in the pegged component orders behind the line — greige, warp beams — weighted one share per BOM level, so four warp beams don't outvote the cloth; the tooltip breaks out each component's own share, and the step list survives only to name the stage the floor is on

## [0.18.1] - 2026-09-01

### Fixed
- Material availability is netted per size instead of pooling every size into one figure. Sized components are made and lotted per size — 67 cm M cloth cannot be cut for XL — but an XL requirement matched against the M rolls on hand, so a run was planned short of the fabric it actually needed. Booking Stock and the Production Run material requirements bucket the same way and list one row per size; the pull sheet and the requirement row name the size, and the lots offered against a row are only that size's lots. Stock whose size was never recorded stays substitutable, and is handed to the sizes that need it rather than shown in full on every row
- Staging moves the whole lot that was picked instead of clipping it to the step's remaining shortfall — a 12.5 kg lot staged against a 12.4 kg step left 0.1 kg of the same lot behind in the store, which is not a state the floor can act on. A staging claim now also dies with its work order, so surplus left on the line by a finished run is the next order's material instead of stranded
- A sales-order line's alternative unit can be changed after the line is added. The Alt Unit column could only ever be set while drafting a new line, so reopening an order to correct it did nothing
- A sales-order line's base quantity and its alternative count stay locked to the unit factor in both directions, so a line can no longer read "600 Yd" beside "6 Gross x144 Yd = 864 Yd". Lines saved before the lock existed are flagged where they disagree rather than silently rewritten — only a human knows which figure was ordered
- The brand wordmark font is vendored into the repo instead of pulled from Google Fonts at build time, where a single network timeout failed the whole Docker image build

## [0.18.0] - 2026-08-31

### Added
- The live-event bus now logs every event it publishes, so a client that reconnects after a drop replays what it missed instead of just picking up wherever the feed resumes
- Each screen now subscribes only to the live-event topics it actually reads, instead of receiving (and discarding) every event that fires anywhere in the app
- A manufacturing-order completion or rejection now pushes its full progress (qty, status, percent) on the socket event, so the board updates in place instead of triggering a refetch
- Settings > Database shows live-event bus health — connected clients, queue depth, drops, publish latency, uptime — so a degraded feed is visible instead of inferred from user reports
- App chrome shows a "LIVE UPDATES OFF" badge once the socket has been down for a few seconds, so a stalled board reads as stale rather than quiet

### Fixed
- `/ws/events` now authenticates its handshake and filters every event by the connecting user's permissions — previously any authenticated socket received every live event regardless of what that user could view
- Users holding a legacy broad permission (granted before the view-permission split) no longer go dark on live updates for the views that permission still covers
- One client on a stalled connection can no longer hold up event delivery to every other client on the same worker — sends now queue per-connection, and a backed-up client is dropped and left to reconnect instead of blocking the broadcast loop

## [0.17.0] - 2026-08-30

### Added
- Packed cartons carry their size, shade, combo and attributes forward from the lot that fed them, printed on the carton label and shown wherever a carton is listed
- Packing refuses a carton that would straddle two sizes — a box holds one size, so its label can name it — and warns before the split happens rather than minting an unlabelled carton
- The pick readiness board names the item and variant (shade/size/combo) behind every order line, not just the order total

### Fixed
- A quarantine claim now takes only a packing order's still-open quantity (target minus packed), instead of locking a lot's whole quantity for the life of the order — a fulfilled order that never formally closes no longer keeps released stock greyed out
- Confirming a quarantine disposition no longer re-sorts the row out from under the cursor or rewrites its decision date — a no-op re-confirm leaves `quarantine_status_at` alone, and the page holds its arrangement until the next real reload

## [0.16.0] - 2026-08-30

### Added
- On-hand finished goods netted away by a production run are now reserved to that sales order (a new `stock_reservations` table), so the next order's netting no longer claims the same pile of stock a second time
- Booking Stock shows reserved qty alongside on-hand and incoming, and its "how is this calculated" modal documents where the number comes from
- The Lot page gains type tabs (classified by the producing work center), a category tree filter mirroring Stock On-Hand, and a searchable Item filter
- Stock On-Hand and the Lot page show a lot's colour swatch consistently, falling back to the Colors attribute value's hex when the lot itself has none

### Changed
- Beam dismount is now weigh-and-relot only — every dismount strips and weighs the remnant into a new lot instead of leaving a plain unmount path; the loom's beam picker accepts a scanned lot number to mount directly, and a freshly dismounted leftover's label prints automatically
- Stock On-Hand and the Lot table both move variant chips into their own Attributes column (off Item), and Stock On-Hand's Ends column now reads the lot's own ends and sits next to Item
- The Lot table's Item column (renamed from Product), WO/MO/PR column widths, and classic-theme header gradient are aligned with Stock On-Hand; MO/PR table headers migrate onto the shared `lvThead`/`lvTh` primitive

### Fixed
- `BatchConsumptionResponse.manufacturing_order_id` accepts null — packing-sourced consumption rows peg to a packing order instead of an MO and were 500ing lot trace

## [0.15.0] - 2026-08-29

### Added
- The in-app Docs help section is rebuilt on the login screen's brand theme, with content updated to match current features
- Booking Stock's calculation panel gains a modeless "how is this calculated" explainer with English/Indonesian tabs
- Packing now supports logging a loose reject directly at pack time; the redundant Qty to Pack field is removed
- The pick-list planner can uncheck suggested cartons before creating a pick list, instead of taking every suggestion as-is

### Changed
- Shipment loading-deck rows get a per-row Stage action, and Reopen/Confirm Dispatch are promoted to row action buttons for verified shipments
- A shipment's carton load is now verified by scanning cartons instead of ticking manual checkboxes
- Pick list cartons get their own checkbox and package-number columns
- Administrators can now self-verify a shipment they staged themselves
- Pick lists move to Staged immediately, and the print modal now captures delivery-note details
- BOM, Combo Library, and Colors Variant row actions (Edit/Delete/Rename) are consolidated into a single ⋯ menu; the BOM expanded view's component table uses the shared sub-table styling and its print action is icon-only

### Fixed
- The BOM expand-row frame is visible again, the BOM code chip is truncated instead of overflowing, and the unused Start Production Run action is removed
- The CodeChip clip-popout no longer overflows the viewport on long codes
- Carton expectations no longer go stale after `box_index` was added
- The boot/loading skeleton now matches the real sidebar's colors and brand icon
- The in-app docs reading pane uses a light surface instead of the dark brand gradient

## [0.14.0] - 2026-08-27

### Added
- Packing orders show color and SO chips on the table, resolved from the order's finished-good variant and linked sales order

### Changed
- The shared WO/MO/PR lot column splits into three sortable columns (WO / MO / PR), narrowed and truncated with the shared chip popout on overflow; the WO list's variant chips move into their own column off Product
- A lot's colour swatch resolves through one shared fallback chain, falling back to the MO's Colors attribute hex when the WO has none, and no longer doubles the colour chip when its code and name match
- Native title tooltips are parked up front so they never stack with the custom tooltip layer, and the classic theme's tooltip switches from yellow to blue
- Pick list's coverage bar uses the shared ProgressBar component instead of a hand-rolled bar
- Packing order detail panel is wider and chips the carton's lot code

### Fixed
- A lot staged to a work order is now reserved to that WO instead of remaining pickable by any other WO drawing on the same item — staged material could otherwise be double-committed
- Staging and consumption posted batch stock under the wrong (empty) variant key instead of the lot's actual variant, which missed the balance row and reported "Insufficient stock, Current: 0.0" for a lot the picker could see on hand
- Packing an explicit box list across multiple lots split a physical box into a separate carton at every lot boundary, so 3 boxes over 6 lots minted 6 packed units instead of 3; they now merge back into one packed unit
- Quarantine's claimed-lot indicator no longer shows a doubled tooltip

## [0.13.0] - 2026-08-27

### Added
- Avatars now render from Dicebear pixel-art recipes instead of hand-drawn sprites, with a rebuilt picker on shared chrome that shows a hover-to-try-on preview and a mouth colour slot; roles get a default avatar template so a fresh executive account doesn't roll a party hat, seeded onto Administrator and Manager
- The sidebar user button forms into a staff ID card around the user's avatar once their username is confirmed, and the login screen shows the signed-in user's own avatar and is branded as the Terras suite rather than a generic ERP login
- Scheduled recurring database backups
- Pack cartons are entered as count x qty each instead of one row per box, with a plus button to add lines

### Changed
- Settings is now entered from the sidebar avatar pill instead of a separate nav item; the settings shell is viewport-sized so it stops resizing between tabs, and panels lay out in columns instead of one full-bleed stack
- `/stock-on-hand` is consolidated into `/stock`, closing the deprecated desktop stock-entry route
- Scanner entry screen reworked onto the shared mobile scan-terminal chrome
- Application name editing is restricted to admins
- Routing's work-center code column is wider so nested codes stop wrapping

### Fixed
- Quarantine's "claimed by an open packing order" lock and the packing lot picker now scope by colour variant instead of item+location alone — one colour's open packing order no longer greys out or offers every other colour of the same finished good
- Tooltip layer raised above the modal tier; the sidebar ID card's double tooltip is replaced with a glimmer hover; the login form no longer echoes every label and button on it as one giant tooltip at narrow widths

## [0.12.0] - 2026-08-26

### Added
- Packing orders and pack events record which packing machine was used, selectable per order and per scan event
- Cartons can be packed and labeled in the sales order's alt selling unit instead of only the item's stock UOM, with the conversion carried through the packing card, the packed-unit label, and the scanner flow
- Every packed carton now requires a weighed net weight from the packer's scale before it can be logged — a carton could previously print a label with a blank N.W. line and an empty net-weight barcode; kg-based items can instead derive net weight from qty when there's nothing to weigh
- Machine output reports break packing output down per packer, from the account that actually logged the completion, not just per work order
- Setting work orders can now stage scanned bag lots as input, matching the existing dyeing flow — setting output also mints its own `SET-` traceable lot so `BatchConsumption` genealogy doesn't dangle with a null output batch on a bag-fed setting step

### Changed
- BOMDesigner and BOMAutomator's groupbox chrome is now the shared `LegendPanel` used elsewhere in the app instead of a hand-rolled notched fieldset
- The weaving monitor boxes each WO run as its own card section, with Performance, Targets, and MO Completion Projection nested inside it as subsections instead of each sitting at the same level as the run header

### Fixed
- The Log Packing button now states why it's disabled instead of just sitting greyed out, and box-count parsing is aligned with the rest of the packing flow
- LegendPanel's legend chip no longer gets clipped by its container's border or edge, and containers whose first LegendPanel had no room above it now have top padding
- The New Lot modal is modeless like every other batch modal

## [0.11.0] - 2026-08-25

### Added
- Leftover warp stripped and weighed off a beam at dismount re-lots into its own trackable lot (`parent_batch_id` pegs it to the parent beam), instead of staying merged into a batch-less pool the next loom couldn't pick by lot; the scale-vs-system difference writes off against the retiring parent beam, not the new lot. The weaving monitor's Beams tab can also mount a beam directly, not just dismount.

### Fixed
- The WO leftover-beam button now reads the loom's actual beam mounts instead of the dead batch-less-pool endpoint, which could only ever 400 once warp stayed lotted for its whole life on the loom; `POST /work-orders/{id}/leftover-beam` is removed.
- Classic-theme buttons missing the `xp-btn` hover class now get a consistent hover state across the app.

## [0.10.0] - 2026-08-24

### Added
- Weaving Monitor has a running-only filter, backed by a toned idle `ToggleChip` variant

### Changed
- Weaving Monitor loom cards are rounded, a loom running several WOs pages them in one tile instead of stacking a card per WO, and cards lift on hover; the machine drill-in modal's window chrome now matches the loom's status color, its tab strip is pane-toned and full-bleed, and its run cards are boxed
- Work Queue's expanded row uses the shared sub-table primitives instead of a hand-rolled table
- Stock On Hand's attribute badges and the UOM conversion badges render through the shared `Chip` primitive
- `TreeSelect`'s trigger, panel and rows are rounded onto `BUTTON_RADIUS`, matching every other control
- The sidebar and mobile header show the app icon instead of brand text, with a hover animation, and the sidebar's brand block is joined to the app header as one top band; the System Admin button picks up the standard radius too
- Remaining hand-rolled view shells (Colors, BOM, and others) are rounded onto the shared frame radius, and every page shell settles on one title-bar height
- Hand-rolled font stacks are consolidated onto shared typography constants (`modernFont`, `CODE_FONT`)

### Fixed
- The custom tooltip no longer stays open when the pointer moves into a nested `data-no-tip` zone
- Classic checkboxes and toggle chips have consistent hover ring/glow styling

## [0.9.0] - 2026-08-24

### Added
- Color variants — the values of the `Colors` system attribute — have their own endpoints (`POST`/`PUT`/`DELETE /colors/variant-values`), scoped to that one attribute, which is what makes `color_variant.create/edit/delete` a real grant. The tab used to post straight at `/attributes/{id}/values`, so a role ticked Color Variant Create saw an enabled button and got "Missing permission: attribute.create" on submit; the only way to unblock it was plant-wide attribute power over Materials, Combo, Wash Bath and every other value list
- A `docker-compose.dev.yml` overlay runs the stack with hot reload — `uvicorn --reload` over a bind-mounted `backend/app` and `next dev` Fast Refresh — so a code change no longer needs `up -d --build`. Dev images tag `:dev` and the deploy workflow passes no `-f`, so production is untouched

### Changed
- Every page, dialog and print frame wears one shared title bar. Seven page shells each hand-declared the same classic/modern pair and four more kept inline copies, so the blue gradient lived in eleven places; with it in one place, opening a dialog can dim the page chrome behind it the way a real window loses focus, while dialogs keep a literal gradient so they never dim themselves
- Buttons and inputs render from one shared face with four tones, dropping 70+ local `xpBtn`/`xpInput` copies, and all 16 print modals share one footer and one window close button
- Tab strips are all the shared `Tabs` component — the manufacturing page and the MO expanded row had a second style of their own — and the active tab's underline now animates in on hover
- Corner radii are concentric: `WINDOW_RADIUS` for window and dialog frames, `SECTION_RADIUS` inside them, `BUTTON_RADIUS` for controls. Form sections were rounder than the dialogs containing them, which reads as a section escaping its frame. Scrollbar thumbs, the searchable-select trigger and the view shell itself follow the same tokens
- Form section headers are flat blue with the label alone; the circled step numbers implied an order the fields don't have
- Form errors render through one shared `FormError` banner instead of three hand-rolled copies, and the user form modal is `xl` with its fields paired two-up instead of one long column
- The Colors page is reachable by a role holding only `color_variant.*`. Both the section and the tab gate on any of the page's grants, and the page hides whichever tab the user has no grant for — a variant-only role could previously reach `/colors` by URL but never see it in the nav
- Adding a color variant shows the color picker up front rather than behind a checkbox

### Fixed
- The app header runs full-bleed instead of being inset by the page gutter
- Adding a color variant that already exists says which one it collided with, matched case-insensitively, instead of silently doing nothing — variant matching is by label, so two rows differing only in case are two variants the floor reads as one
- Deleting a color variant still referenced by items, stock, orders or BOMs explains that instead of failing on a database constraint

## [0.8.0] - 2026-08-23

### Added
- Hovering anything with a `title` shows the app's own tooltip instead of the OS one — XP pale yellow in classic, a dark bubble in modern, with `role="tooltip"` and `aria-describedby` wired up. `GlobalTooltip` delegates from `document`, so the next `title=` anyone types is themed without them knowing the file exists. Rich or multi-line content uses `<Tooltip content>` directly
- Text clipped to an ellipsis with no `title` of its own gets a hover showing it in full, which is the only affordance an ellipsis ever had
- A `Chip` too narrow for its cell re-renders itself unclipped, in place, on hover — a badge does something better than a tooltip, so chips opt out of the global layer and own their popout

### Changed
- Colour chips show the colour code alone; the name moves to the tooltip, and only when it says something the code does not. In real data the two are near-identical ("318" / "318"), so the `{code} — {name}` label every view built was duplicated text that overflowed narrow cells
- The MO progress bar on the sales-order table is itself the link to the MO. The code chip above it ate the column's width and truncated the code to noise ("PR-2026-08-00010-00…"); the code now lives in the hover and a multi-MO line carries its count on the steps line
- Classic buttons, tab tops and toolbar controls all take one shared `BUTTON_RADIUS`, and every classic button carries the same `XP_BTN` hover/press motion instead of hand-rolled mouse-enter state per call site

### Fixed
- Long variant chips clip to the sales-order table's Item column instead of pushing it wider
- The PR chip on the sales-order table is a shared `Chip`, so it pops out when clipped like every other badge — a hand-rolled span had no popout

## [0.7.0] - 2026-08-23

### Added
- Work orders list has a Setting tab alongside Beaming / Weaving / Dyeing. `Others` is now derived from the tab list itself instead of a second hardcoded set of centre types, so adding a tab can't leave a type counted on two tabs at once
- The Surat Jalan number can be typed in the print preview before printing. It overrides the shipment's delivery-note number on the printed sheet and the modal title only — nothing is written back to the shipment, so a one-off manual number doesn't rewrite the record

### Changed
- Mobile views wear the same classic chrome as the desktop app: blue-gradient window bar, a toolbar strip carrying the current page title, and a tab bar in the sidebar palette. The old navy bar over grey tabs belonged to no other screen in the app. Shared primitives live in `mobileTheme.tsx`, so the phone views stop re-inventing their panels and cards per screen
- Variant identity chips (size / shade / combo) take their colour from one `VARIANT_TONE` map and a shared `VariantChip`. Seven views were each re-colouring them, so the same shade read pink on the work-order list, slate on the netting plan and beige on the BOM list. Shade chips are now the neutral slate ones and size takes the pink — a shade often carries its own colour swatch, and a swatch sitting on a tinted fill reads as a colour clash rather than as the colour of the goods
- SO/PO/PR/MO/WO references hanging off a row render as `OriginChip` badges with one tone per document type, so several origins side by side stay tellable apart and a PR is the same purple on every page
- Every control in a classic page header takes the same rounded XP chrome; a generic `.btn-light` rule was squaring off only some of them

## [0.6.1] - 2026-08-23

### Changed
- Every small tinted badge — status chip, count pill, variant/colour/combo chip, qty chip, tag chip, permission chip, lot chip — takes its corner radius from one `CHIP_RADIUS` token and a shared `<Chip>` primitive. Seven modern radii and two classic ones were in use across ~60 chips, so two chips in the same table cell could render one square and one pill
- Sidebar labels drop the `(SO)`/`(PO)` abbreviations

### Fixed
- The production-run netting preview splits component rows per size the same way MO creation splits component MOs: a size-differentiated sub-BOM now gets one row per size (matched to the parent's size row by Size master, else by label), while an unsized or free sub-BOM still pools across every parent size. The preview was pooling all sizes into one component row, so it showed a different tree than the run it was previewing

## [0.6.0] - 2026-08-22

### Added
- Sales Orders list shows how far production has actually got on each line: a per-line work-order step column (`3/5 · DYEING`) next to the fulfilment bar, expandable to the individual steps with their work-center stage and status. Root MOs are pegged to a line the same way `qty_made` already was, so the two columns can never disagree, and several MOs answering one line pool their counts

### Changed
- Dispatch is one table instead of a Deck tab and a Shipments tab. The Deck tab was a picker wearing a list's clothes — un-staged pick lists and the shipments they became were the same work seen twice, and the loader was flipping tabs to reconstruct it. Both grains now share nine columns under one status chip bar (`On Deck` is a client-side pseudo-status), with deck rows marked by a left tick and closed off by a divider

### Fixed
- Sales-order table columns hold their pinned widths and the table scrolls horizontally, instead of the new MO-progress column squeezing every other column narrower

## [0.5.0] - 2026-08-21

### Added
- Weaving runs can be paused and resumed: a loom carries several work orders at once, and parking one no longer charges its idle days against that run's efficiency. Each pause is stored as an interval (`weaving_run_pauses`) with reason and actor, so the floor can answer "which day did this WO slip, and why"
- Mounted beams in the work-center monitor carry their own item column and identity chips (size / combo / shade), so a beam is identifiable without opening it
- The browser tab is named after the current page (`<page> · <app name>`), so several open Terras tabs stay tellable apart

### Changed
- A weaving run closes with the work it tracks: completing or cancelling its work order, closing its MO, or deleting the WO now stops the run instead of leaving it accruing elapsed days against work nobody is doing. `DELIVERED` deliberately does not close a run (planned qty met, order still open)
- App icons redesigned on the XP blue theme — hexagon outline with an inset cube depth facet behind the T — and all PWA/apple icon assets regenerated to match

### Fixed
- Sales-order fulfilment is measured in the item's stock UoM instead of the ordered yardage. Most finished goods stock in kg while the SO form authors yards, so an 11 kg dispatch against a 10,000 yd order read as 0.1% shipped and the order could never reach READY or SENT. Lines with no honest conversion report "unknown" rather than silently reading as satisfied
- Production Run quantities seed from the server-derived base UoM instead of the SO's yardage, matching the fulfilment fix above
- Production Runs and Manufacturing Orders fetch their lists on mount, so arriving via `router.push` no longer leaves the page stuck on a skeleton
- Added the standard `mobile-web-app-capable` meta tag alongside the apple-prefixed one, silencing the install warning on non-iOS browsers

## [0.4.0] - 2026-08-20

### Added
- Sales Orders list serves its Production Run chips inline from the server (new SO response fields + an index on `production_runs.sales_order_id`)
- List tables now keep their header row pinned while the body scrolls

### Changed
- One shared table vocabulary across every list route: sortable column headers (`SortableTh`), header/cell styling (`lvTh`/`lvTd`), zebra striping, empty-state row, code chips, checkboxes and picker rows, and the row-expand chevron (`ExpandToggle`/`ExpanderCell`)
- Bulk-select lists share one `useRowSelection` hook instead of per-page selection state
- Every domain status renders through `StatusChip`; every number through one formatting module where views declare precision once; every blank value as the same em-dash placeholder
- Expandable lists use one control-column order — checkbox, chevron, then code
- One page-fill and scroll-area convention for list routes, and the last hand-rolled toolbars moved onto shared `SearchField`/`ToolbarCount`
- List loading shows a shape-matched skeleton instead of a bare loading line
- Row chevron rotates on hover and multi-select checkboxes show a hover ring, instead of swapping glyphs/flat states

### Fixed
- Dates and date-input seeds render in the configured display timezone rather than the browser's
- Sales Orders sort server-side, so page 1 shows the real first rows
- Work Queue columns have locked widths and truncate long codes instead of overlapping

### Performance
- Sales Orders page no longer pulls a ~1.3 MB production-runs payload or primes idle pickers on load

## [0.3.1] - 2026-08-19

### Fixed
- Sales Orders page no longer pulls the full eager-loaded Manufacturing Order tree on first load — it never read that data (leftover from a shared fetch condition)
- Sales Orders page now resolves its BOM auto-match/size lookup via a new slim `GET /boms/lookup` (id/code/item/attributes/sizes only) instead of the full nested `/boms` payload (every BOM's materials + routing); full `/boms` still serves manufacturing/production-runs where the nested tree is needed for MRP

## [0.3.0] - 2026-08-19

### Added
- Server-side pagination for the remaining long lists: Sales Orders, Purchase Orders, dyeing and setting work-order tabs, Lab Dip Requests, Dye Recipes, Partners (customers/suppliers) and Stock On-Hand
- `GET /partners/lookup` and `GET /stock/balance/paginated`, so pages that scan the whole set (purchase-order printing, material availability) keep getting every row while the list views take a page window
- Print and CSV export on paginated lists now fetch every matching row rather than the page on screen

### Changed
- One page-window contract across the backend: `PageParams`/`PageWindow` in `core/pagination.py` replaces the `(page - 1) * size` arithmetic that was duplicated at 19 call sites; `skip`/`limit` stays accepted as a legacy alias
- One page-window contract on the frontend: `usePaginatedFetch`/`usePageState`/`useDebouncedSearch` replace ~19 hand-rolled copies, and add the stale-response race guard nearly all of them were missing
- Samples, Items, Manufacturing Orders, Production Runs, audit logs and the stock ledger now resolve their window through the shared dependency
- Lab dip list sorting moved server-side (`COALESCE(updated_at, created_at) DESC, id DESC`) so page 1 shows the newest requests

### Fixed
- Paginated lists snap back into range when the set shrinks under the current offset — deleting the last rows on a page no longer leaves an empty table with the pager reading "Page 5 / 4"
- Sales Orders no longer re-filters the server page against the un-debounced search box, which blanked the table for the length of each keystroke pause
- Paging or searching during an in-flight load is no longer swallowed by the fetch de-duplicator, which keyed on the route alone and so returned the previous page's request

## [0.2.0] - 2026-08-19

### Added
- Terras Systems module suite teaser on the login page (SCM, WMS, HRIS, PSA, PIM, CMS tiles) with hover-enlarge custom tooltip
- System status, version, and last-update time shown on the login page
- Colors (Variant) list pagination with shared Pager
- Create/print/import buttons moved from title bars into table toolbars across BOM, Sales Orders, and procurement/inventory/engineering views, for consistency

### Changed
- Rebranded "Teras" to "Terras" across UI, docs, and README
- Standardized library-page toolbar create buttons to the shared green ToolbarButton

### Fixed
- PDF approval/rejection attachments now render correctly in the lab dip view
- Hover-enlarged suite tile and tooltip no longer clip at the container edge
- Classic-theme logout button hover darkens instead of washing white
- CodeConfigModal now stacks above its parent create/edit panel
- Remaining toolbar button styling drift (StockOnHand green, LabDipRequest, dual-styled CSV export, Attributes button position)

## [0.1.0] - 2026-08-18

Baseline release. Commit history prior to this tag (1300+ commits) is not itemized here —
this tag marks the point CHANGELOG tracking starts. Full history remains in `git log`.

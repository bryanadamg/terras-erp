'use client';

import { useEffect, useRef } from 'react';
import SalesOrderView from '../components/sales/SalesOrderView';
import { useData } from '../context/DataContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { colorLabel } from '../components/shared/xpTheme';
import { API_BASE } from '../components/shared/apiBase';

export default function SalesOrdersPage() {
    const { items, attributes, salesOrders, partners, bomsLookup: boms, refreshSalesOrders, authFetch, filters: { setSoSearch } } = useData();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const router = useRouter();
    const searchParams = useSearchParams();
    const consumedSoRef = useRef<string | null>(null);

    // Deep link from a chip elsewhere (Packing Order table, etc.) — jump straight
    // to this order by filtering the list to its PO#, same idiom as MO/PR chips
    // filtering their own lists (see manufacturing-orders/page.tsx `mo` param).
    useEffect(() => {
        const so = searchParams.get('so');
        if (so && so !== consumedSoRef.current) {
            consumedSoRef.current = so;
            setSoSearch(so);
            router.replace('/sales-orders');
        }
    }, [searchParams, router, setSoSearch]);


    // The SO item + combo pickers live inside SalesOrderView's create/edit modal and
    // are primed by it only once that modal opens — see `pickersActive` there. They
    // used to be lifted here and primed on page mount.

    const handleCreateSO = async (p: any) => {
        const res = await authFetch(`${API_BASE}/sales-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) refreshSalesOrders();
        return res;
    };

    const handleDeleteSO = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Sales Order',
            message: 'Are you sure you want to delete this sales order?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/sales-orders/${id}`, { method: 'DELETE' });
        if (res.ok) refreshSalesOrders();
    };

    const handleGeneratePR = async (so: any) => {
        const soLines: any[] = so.lines || [];

        // Group lines by (item_id + attribute set + color) — one group = one root MO.
        // Color is part of the key so different shades of the same item split into
        // separate entries (each gets its own dyeing recipe); shared greige is
        // consolidated downstream by PR Pass 2.
        const attrGroupMap = new Map<string, any[]>();
        soLines.forEach((l: any) => {
            // Pending-shade lines (color still in lab dip) key on labdip_variant_code
            // so different pending shades of the same item also split into their own
            // root MO — the code later backfills the minted color on approval.
            // bom_id is part of the key too: two lines can share item+attrs+color and
            // still be ordered against different recipes (per-shade root BOMs are
            // attribute-less and indistinguishable otherwise). Where the recipe is
            // unambiguous the ids match anyway, so those lines still merge.
            const key = l.item_id + '::' + [...(l.attribute_value_ids || [])].sort().join(',') + '::' + (l.color_id || '') + '::' + (l.labdip_variant_code || '') + '::' + (l.bom_id || '');
            if (!attrGroupMap.has(key)) attrGroupMap.set(key, []);
            attrGroupMap.get(key)!.push(l);
        });

        // What this SO already has a PR for. Server-scoped to this one order rather
        // than filtered client-side out of the windowed /production-runs feed: that
        // feed only held the newest 50 PRs, so an older SO read as "not covered" and
        // the user could create a duplicate PR for work already planned.
        let coverage: { covered_size_ids: string[]; covered_size_tokens: string[]; covered_entries: any[] } = { covered_size_ids: [], covered_size_tokens: [], covered_entries: [] };
        try {
            const covRes = await authFetch(`${API_BASE}/sales-orders/${so.id}/pr-coverage`);
            if (!covRes.ok) throw new Error(String(covRes.status));
            coverage = await covRes.json();
        } catch {
            // Never fall through to "nothing is covered" — that is the duplicate-PR
            // path this check exists to prevent.
            showToast('Could not check existing Production Runs for this order. Please retry.', 'danger');
            return;
        }
        // Coverage is compared on the folded size NAME: an SO line states a generic
        // size (the BOM is the PR's pick), so it has no BOMSize id to match on.
        // Measurement-only sizes have no name and are still matched by id.
        const coveredSizes = new Set<string>((coverage.covered_size_tokens || []).map(String));
        const coveredSizeIds = new Set<string>((coverage.covered_size_ids || []).map(String));

        const entries: Array<{
            // Empty when the item's recipe is ambiguous — the planner picks it in
            // the PR modal, which is the whole point of decoupling size from BOM.
            bom_id: string;
            item_id?: string;
            sizes?: { bom_size_id?: string; size_token?: string; size_label?: string; qty: number }[];
            total_qty?: number;
            attribute_value_ids?: string[];
            color_id?: string;
            color_label?: string;
            labdip_variant_code?: string;
        }> = [];
        let missingBomCount = 0;
        const unweighedItems = new Set<string>();

        // Seed the PR in the produced item's own base UoM, never in the SO's ordered
        // yardage. `qty_ordered_base` is derived per line server-side (qty_kg, else
        // Item.weight_per_unit — see so_fulfilment_service.ordered_qty_in_stock_uom),
        // so it is right whatever the item's uom is: kg lines come back as kg, yard
        // and pcs lines pass straight through. It replaces a client-side
        // `items.find(b.item_id)` lookup that read `undefined` for any item outside
        // the 50-row paginated `items` window — the kg branch then never fired and the
        // PR was seeded in raw yards, 20-200x too large for kg-stocked cloth.
        //
        // `null` means the item has no weight and no operator-entered qty_kg, so there
        // is no honest number to plan against. Return it as-is and let the caller drop
        // the whole group rather than substitute 0 or the yardage.
        const pickQty = (l: any): number | null =>
            l.qty_ordered_base === null || l.qty_ordered_base === undefined
                ? null
                : parseFloat(l.qty_ordered_base) || 0;

        for (const [, groupLines] of attrGroupMap) {
            const firstLine = groupLines[0];
            const lineAttrIds: string[] = firstLine.attribute_value_ids || [];
            const lineColorId: string | undefined = firstLine.color_id || undefined;
            const lineColorLabel: string | undefined = colorLabel(firstLine.color_code, firstLine.color_name) || undefined;
            const lineLabdip: string | undefined = firstLine.labdip_variant_code || undefined;

            // The recipe the user picked on the SO line wins when there is one.
            // Retired BOMs fall through: /boms returns inactive ones too, and a
            // months-old order must not pin a dead recipe.
            let matchingBOM = firstLine.bom_id
                ? boms.find((b: any) => String(b.id) === String(firstLine.bom_id) && b.active !== false)
                : undefined;

            // Otherwise derive it — but only where the derivation is UNAMBIGUOUS.
            // Two attribute-less roots over their own greige (403 RED, 403 NAVY)
            // both match, and picking whichever comes first is how every shade used
            // to collapse onto one recipe. An ambiguous item is left for the planner
            // to resolve on the Production Run instead of being guessed here.
            const itemBoms = boms.filter((b: any) => b.item_id === firstLine.item_id && b.active !== false);
            if (!matchingBOM) {
                // Exact attribute match (legacy lines with no stored BOM)
                const exact = itemBoms.filter((b: any) => {
                    const bomAttrIds: string[] = b.attribute_value_ids || [];
                    if (lineAttrIds.length !== bomAttrIds.length) return false;
                    return lineAttrIds.every((id: string) => bomAttrIds.includes(id));
                });
                // Fallback: base BOM with no attributes (color applied via dyeing)
                const bare = itemBoms.filter((b: any) => (b.attribute_value_ids || []).length === 0);
                const pool = exact.length > 0 ? exact : bare;
                if (pool.length === 1) matchingBOM = pool[0];
            }

            // A line pinned to a BOMSize has already named its recipe implicitly —
            // that row belongs to exactly one BOM.
            if (!matchingBOM) {
                const pinned = groupLines.map((l: any) => l.bom_size_id).find(Boolean);
                if (pinned) {
                    matchingBOM = itemBoms.find((b: any) =>
                        (b.sizes || []).some((sz: any) => String(sz.id) === String(pinned))
                    );
                }
            }

            if (!matchingBOM && itemBoms.length === 0) {
                missingBomCount++;
                continue;
            }

            // A group is planned as one unit (one root MO), so one unweighed line
            // poisons all of it — summing the rest would silently under-order.
            if (groupLines.some((l: any) => pickQty(l) === null)) {
                unweighedItems.add(firstLine.item_code || firstLine.item_name || 'item');
                continue;
            }

            // A line's size is a folded size NAME, not a BOMSize id — the PR
            // resolves it against whichever BOM ends up chosen. When the BOM is
            // already known the id is resolved here too, so a fully-determined
            // handoff seeds the modal exactly as it did before.
            const lineSizeToken = (l: any): string => String(l.size_display || '').trim().toLowerCase();
            // A line that still carries the legacy per-BOM pointer is matched by
            // that id, mirroring the server's peg: the id names a size AND the BOM
            // it belongs to, so two same-size lines against two recipes stay apart.
            // It is also the only identity a measurement-only size (157 cm) has.
            const legacySizeId = (l: any): string => (l.bom_size_id ? String(l.bom_size_id) : '');
            const bomSizeIdFor = (token: string): string | undefined => {
                if (!matchingBOM || !token) return undefined;
                const bs = (matchingBOM.sizes || []).find((x: any) =>
                    String(x.size_name || x.size?.name || x.label || '').trim().toLowerCase() === token
                );
                return bs?.id;
            };
            const linesWithSize = groupLines.filter((l: any) => !!lineSizeToken(l) || !!legacySizeId(l));

            if (linesWithSize.length > 0) {
                const uncoveredSizes = linesWithSize
                    .filter((l: any) => (
                        legacySizeId(l)
                            ? !coveredSizeIds.has(legacySizeId(l))
                            : !coveredSizes.has(lineSizeToken(l))
                    ))
                    .map((l: any) => ({
                        bom_size_id: legacySizeId(l) || bomSizeIdFor(lineSizeToken(l)),
                        size_token: lineSizeToken(l) || undefined,
                        size_label: l.size_display || undefined,
                        qty: pickQty(l)!,
                    }));
                if (uncoveredSizes.length > 0) {
                    entries.push({
                        bom_id: matchingBOM?.id || '',
                        item_id: firstLine.item_id,
                        sizes: uncoveredSizes,
                        attribute_value_ids: lineAttrIds.length > 0 ? lineAttrIds : undefined,
                        color_id: lineColorId,
                        color_label: lineColorLabel,
                        labdip_variant_code: lineLabdip,
                    });
                }
            } else {
                const sortedLineAttrs = [...lineAttrIds].sort().join(',');
                // With no recipe decided yet, any candidate BOM for this item
                // counts as coverage — the existing PR planned this same demand
                // under whichever recipe the planner chose then.
                const bomIds = new Set<string>(
                    (matchingBOM ? [matchingBOM] : itemBoms).map((b: any) => String(b.id))
                );
                const covered = coverage.covered_entries.some((e: any) => {
                    if (!bomIds.has(String(e.bom_id))) return false;
                    const entryAttrs = [...(e.attribute_value_ids || [])].sort().join(',');
                    return entryAttrs === sortedLineAttrs && String(e.color_id || '') === String(lineColorId || '') && String(e.labdip_variant_code || '') === String(lineLabdip || '');
                });
                if (!covered) {
                    const totalQty = groupLines.reduce((acc: number, l: any) => acc + pickQty(l)!, 0);
                    entries.push({
                        bom_id: matchingBOM?.id || '',
                        item_id: firstLine.item_id,
                        total_qty: totalQty,
                        attribute_value_ids: lineAttrIds.length > 0 ? lineAttrIds : undefined,
                        color_id: lineColorId,
                        color_label: lineColorLabel,
                        labdip_variant_code: lineLabdip,
                    });
                }
            }
        }

        // Warn whether or not anything else made it through — a partially seeded PR
        // that quietly omits an item is worse than one the user knows is incomplete.
        if (unweighedItems.size > 0) {
            const names = [...unweighedItems].join(', ');
            showToast(
                `Skipped ${names}: no weight per unit on the item, so the order quantity can't be converted to kg. Set it on the item master (or enter Kg on the SO line) and retry.`,
                'warning'
            );
        }

        if (entries.length === 0) {
            if (missingBomCount > 0) {
                showToast(`${missingBomCount} item(s) have no matching BOM. Please create recipes first.`, 'warning');
            } else if (unweighedItems.size === 0) {
                showToast('All items already have a Production Run.', 'info');
            }
            return;
        }

        const params: Record<string, string> = {
            action: 'create_pr',
            sales_order_id: so.id,
            so_code: so.po_number || '',
            bom_entries: encodeURIComponent(JSON.stringify(entries)),
        };
        router.push(`/production-runs?${new URLSearchParams(params).toString()}`);
    };

    const handleUpdateSO = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/sales-orders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) refreshSalesOrders();
        return res;
    };

    const handleUpdateSOStatus = async (soId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/sales-orders/${soId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) {
            refreshSalesOrders();
            showToast(`Order status updated to ${status}`, 'success');
        } else {
            const err = await res.json();
            showToast(`Error: ${err.detail}`, 'danger');
        }
    };

    return (
            <SalesOrderView
                items={items}
                attributes={attributes}
                boms={boms}
                salesOrders={salesOrders}
                partners={partners}
                onCreateSO={handleCreateSO}
                onDeleteSO={handleDeleteSO}
                onEditSO={handleUpdateSO}
                onUpdateSOStatus={handleUpdateSOStatus}
                onGenerateWO={handleGeneratePR}
            />
    );}

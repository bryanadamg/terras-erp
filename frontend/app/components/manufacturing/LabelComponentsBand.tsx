'use client';
import React from 'react';
import { CODE_FONT } from '../shared/xpTheme';

/**
 * "Komponen Terpakai" band for the output labels (./BagLabelCard, ./BeamLabelCard).
 *
 * Source is the completion's own `actual_items` — what the operator logged as
 * consumed for THIS bag/beam — not the BOM. That is deliberate: a label looks
 * backward at one finished physical unit, so it has to state what actually went
 * in, which is also the only source that carries a **substitute**. When the
 * operator swaps a BOM line for another item, `MOCompletionItem` stores the
 * substitute's `item_id` and nothing else, so the substitute is simply the item
 * on the row.
 *
 * No fetch: `MOCompletion.actual_items` is `lazy="joined"` (and so is its `item`),
 * so every payload carrying completions already has code/name/qty.
 *
 * The SUB tag is *derived*, not stored: an actual item absent from the BOM's line
 * list for this MO was not planned, so it is a substitute or a manual add. The
 * original it replaced is NOT recoverable — `mo_completion_items` has no
 * `orig_item_id` column and the rows carry no order — so the tag says "this was
 * not on the BOM" and deliberately does not name what it stood in for.
 *
 * Renders nothing when the completion logged no materials (~7% of rows), the same
 * way the Kartu Kerja materials band hides itself rather than printing an empty
 * table on a sticker with no room to spare.
 */
export default function LabelComponentsBand({
    completion,
    parentMO,
    title = 'Komponen Terpakai',
}: {
    completion: any;
    parentMO: any;
    title?: string;
}) {
    const rows: any[] = completion?.actual_items || [];
    if (!rows.length) return null;

    // Planned item ids for this MO — BOM lines, falling back to the creation-time
    // snapshot so a BOM edited after the fact doesn't retro-flag every row as SUB.
    const plannedIds = new Set<string>([
        ...(parentMO?.bom?.lines || []).map((l: any) => String(l.item_id)),
        ...(parentMO?.planned_components || []).map((c: any) => String(c.item_id)),
    ]);

    const th: React.CSSProperties = { border: '1px solid #bbb', padding: '2px 5px', textAlign: 'left' };
    const td: React.CSSProperties = { border: '1px solid #bbb', padding: '2px 5px' };

    return (
        <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.3px', marginBottom: '2px' }}>
                {title}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
                <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                        <th style={th}>Komponen</th>
                        <th style={{ ...th, textAlign: 'right', width: '26%' }}>Qty</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r: any) => {
                        const isSub = !plannedIds.has(String(r.item_id));
                        const qty = Number(r.qty_used ?? 0);
                        return (
                            <tr key={r.id || r.item_id}>
                                <td style={td}>
                                    {r.item_code && (
                                        <span style={{ fontFamily: CODE_FONT, color: '#555', marginRight: '4px', fontSize: '8px' }}>
                                            {r.item_code}
                                        </span>
                                    )}
                                    {r.item_name || r.item_code || r.item_id}
                                    {isSub && (
                                        <span style={{ marginLeft: '4px', fontSize: '7px', fontWeight: 'bold', border: '1px solid #000', padding: '0 2px' }}>
                                            SUB
                                        </span>
                                    )}
                                </td>
                                <td style={{ ...td, textAlign: 'right', fontWeight: 'bold' }}>
                                    {qty > 0 ? qty.toFixed(2) : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

'use client';

import React from 'react';
import { xpFont, FORM_SECTION_BLUE } from './xpTheme';
import { lvThBanded, lvZebra, Dash } from './listViewTheme';

/** The weighed-out recipe for one bath.
 *
 *  Shared, not copied: the same sheet is read on the Dyeing Orders tab, in the WO
 *  completion modal and on the mobile scan terminal, and two of those are the same
 *  operator on the same bath. Cross-page drift in what a dose says is a real bug
 *  class here — an unlabelled number in a "Weigh Out" column is a 1000x mistake
 *  waiting to happen.
 *
 *  Numbers are never computed in this component. Doses come from
 *  `GET /dye-recipes/{id}/doses`, whose formula lives in
 *  backend/app/services/dyeing_dose_service.py — the single source, so the sheet,
 *  the snapshotted DyeingRunChemical.planned_qty and the Kartu Kerja cannot disagree.
 */

const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface DoseLine {
    line_id: string;
    item_id: string;
    item_code?: string | null;
    item_name?: string | null;
    chemical_type?: string | null;
    basis?: string | null;
    qty_per_liter?: number | null;
    qty_per_100kg?: number | null;
    dose?: number | null;
    dose_unit?: string | null;
    dose_kg?: number | null;
    uom_id?: string | null;
    uom_name?: string | null;
}

/** A weighed recipe from GET /dye-recipes/{id}/doses. */
export interface DosePreview {
    recipe_code?: string | null;
    recipe_name?: string | null;
    substrate_qty?: number | null;
    bath_volume_liters?: number | null;
    liquor_ratio?: number | null;
    lines: DoseLine[];
}

export const fmtDose = (v: number | null | undefined, digits = 3) =>
    v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits });

/** How a line is dosed, spelled out — the two bases are not interchangeable and the
 *  operator has to see which number a row followed. */
export const BASIS_LABEL: Record<string, string> = {
    PER_LITER: 'g/L x bath',
    PER_100KG: '% owf x kg',
};

/** Unit of a dose, taken from the sheet that produced it: a g/L line is dosed in
 *  grams while an owf line carries the line's own UOM. */
export const doseUnitFor = (doses: DosePreview | null, itemId: string) =>
    doses?.lines.find(l => String(l.item_id) === String(itemId))?.dose_unit ?? null;

const panel = (): React.CSSProperties => ({ border: '1px solid #7f9db9', background: 'white' });

const sectionHeader = (): React.CSSProperties => ({
    background: FORM_SECTION_BLUE, color: 'white', padding: '3px 8px',
    fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
});

interface DoseSheetProps {
    doses: DosePreview | null;
    /** What to say when the recipe has no weighable lines (or is still loading). */
    emptyHint: string;
    /** Own the outer margin from the call site — this sits in three layouts. */
    style?: React.CSSProperties;
}

export default function DoseSheet({ doses, emptyHint, style }: DoseSheetProps) {
    const rows = doses?.lines ?? [];
    const noBath = !doses?.bath_volume_liters;
    const th = lvThBanded();
    return (
        <div style={{ ...panel(), overflow: undefined, ...style }}>
            <div style={{ ...sectionHeader(), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>Dye Weights for this Bath</span>
                <span style={{ fontWeight: 400, fontSize: 10}}>
                    {doses?.bath_volume_liters != null
                        ? `${fmtDose(doses.bath_volume_liters, 1)} L water`
                        : 'no bath volume yet'}
                    {doses?.liquor_ratio != null ? `  |  1 : ${fmtDose(doses.liquor_ratio, 2)}` : ''}
                    {doses?.substrate_qty != null ? `  |  ${fmtDose(doses.substrate_qty, 2)} kg substrate` : ''}
                </span>
            </div>
            {rows.length === 0 ? (
                <div style={{ padding: '6px 8px', color: '#888', fontSize: 11}}>
                    {emptyHint}
                </div>
            ) : (
                <>
                    {noBath && (
                        <div style={{ background: '#fff3cd', borderBottom: '1px solid #ffc107', padding: '3px 8px', fontSize: 10, color: '#664d03' }}>
                            Enter the bath volume (Volume Air) to weigh out the g/L chemicals. Per-100kg
                            dyestuff is already costed off the substrate weight.
                        </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11}}>
                            <thead>
                                <tr style={{ background: '#ece9d8', borderBottom: '1px solid #7f9db9' }}>
                                    <th style={{ ...th }}>Chemical</th>
                                    <th style={{ ...th }}>Type</th>
                                    <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Rate</th>
                                    <th style={{ ...th, whiteSpace: 'nowrap' }}>Basis</th>
                                    <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>Weigh Out</th>
                                    <th style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>kg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((l, idx) => (
                                    <tr key={l.line_id} style={{ borderBottom: '1px solid #e0e0e0', background: lvZebra(idx) }}>
                                        <td style={{ padding: '2px 6px' }}>
                                            {l.item_name ?? l.item_code ?? <Dash />}
                                        </td>
                                        <td style={{ padding: '2px 6px' }}>
                                            {l.chemical_type ?? <Dash />}
                                        </td>
                                        <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {l.basis === 'PER_LITER'
                                                ? `${fmtDose(l.qty_per_liter, 4)} g/L`
                                                : l.basis === 'PER_100KG'
                                                    ? `${fmtDose(l.qty_per_100kg, 4)} /100kg`
                                                    : <Dash />}
                                        </td>
                                        <td style={{ padding: '2px 6px', whiteSpace: 'nowrap', color: '#666' }}>
                                            {l.basis ? (BASIS_LABEL[l.basis] ?? l.basis) : 'no rate set'}
                                        </td>
                                        <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                                            {l.dose == null ? <Dash /> : `${fmtDose(l.dose, 3)}${l.dose_unit ? ` ${l.dose_unit}` : ''}`}
                                        </td>
                                        <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: '#666' }}>
                                            {l.dose_kg == null ? <Dash /> : fmtDose(l.dose_kg, 4)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

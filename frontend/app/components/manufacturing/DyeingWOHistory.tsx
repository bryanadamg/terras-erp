'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { StatusChip } from '../shared/xpTheme';
import { lvSubTable, lvSubTh, lvSubTd, lvSubRow } from '../shared/listViewTheme';
import { fmtMinutes, fmtQty } from '../shared/format';

/** A phase stamp as the floor writes it: "28 Sept 2026, 12:00". Shared with the
 *  monitor's Color matching / Start / Complete columns so the two never drift. */
export function useFmtStamp() {
    const { formatCustom } = useTimezone();
    return (v: any) => (v
        ? formatCustom(v, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }, 'en-GB')
        : '—');
}

function minutesBetween(a: any, b: any): number | null {
    if (!a || !b) return null;
    return (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
}

/**
 * Every bath one dyeing WO has had (a re-dye is a second run), one sub-row per
 * phase: matching -> dyeing -> complete. Fetched per WO rather than taken off the
 * monitor row, because the monitor only lists recent batches and a WO's older
 * baths must still show here. Rendered in the monitor's expand row, the same place
 * the WO list shows a WO's completion log.
 */
/**
 * The monitor row's Output bar written out as arithmetic: speed x ropes x run window
 * -> yards -> the item's stock UOM through its weight factor -> share of the WO qty.
 * Every operand is a figure the backend already returned, so this only lays them out.
 */
function RunCalc({ r }: { r: any }) {
    const { t } = useLanguage();
    if (r.time_yards == null) return null;
    const uom = r.item_uom || '';
    const n = (v: any, d = 1) => fmtQty(v, d);
    const lines: [ReactNode, ReactNode][] = [[
        <>{n(r.run_minutes)} min × {n(r.yards_per_min, 2)} {t('yd_per_min')} × {r.lines} {t('lines').toLowerCase()}</>,
        <>{n(r.time_yards)} {t('yd_short')}</>,
    ]];
    if (r.weight_per_unit != null && r.time_qty != null) {
        // A g/m factor weighs metres, so the yards are restated before it applies.
        const perMetre = r.weight_unit === 'g/m';
        lines.push([
            <>{n(perMetre ? r.time_yards * 0.9144 : r.time_yards)} {perMetre ? 'm' : t('yd_short')} × {n(r.weight_per_unit, 2)} {r.weight_unit} ÷ 1000</>,
            <>{n(r.time_qty, 2)} {uom}</>,
        ]);
    } else if (r.time_qty != null && r.time_qty !== r.time_yards) {
        lines.push([<>{n(r.time_yards)} {t('yd_short')} → {uom}</>, <>{n(r.time_qty, 2)} {uom}</>]);
    }
    if (r.progress_pct != null) {
        lines.push([
            <>{n(r.time_qty, 2)} ÷ {n(r.target_qty, 2)} {uom}</>,
            <>{n(r.progress_pct)}% <span style={{ fontWeight: 'normal', color: '#666' }}>{t('calc_of_wo')}</span></>,
        ]);
    }
    const subTd = lvSubTd();
    return (
        <table style={{ ...lvSubTable(), width: 'auto' }}>
            <thead>
                <tr>
                    <th colSpan={3} style={lvSubTh()}>
                        {t('calc_title')} · #{r.run_number}
                        {r.clock === 'IN_PROGRESS' && <span style={{ fontWeight: 'normal', color: '#666' }}> ({t('running')})</span>}
                    </th>
                </tr>
            </thead>
            <tbody>
                {lines.map(([expr, result], i) => (
                    <tr key={i} style={lvSubRow(0)}>
                        <td style={{ ...subTd, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#444' }}>{expr}</td>
                        <td style={{ ...subTd, padding: '0 2px', color: '#888' }}>=</td>
                        <td style={{ ...subTd, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold' }}>{result}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function DyeingWOHistory({ workOrderId, authFetch, apiBase, calc }: {
    workOrderId: string;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    apiBase: string;
    /** The monitor row whose Output bar to explain beside the history. */
    calc?: any;
}) {
    const { t } = useLanguage();
    const fmtStamp = useFmtStamp();
    const [runs, setRuns] = useState<any[] | null>(null);

    useEffect(() => {
        let live = true;
        setRuns(null);
        authFetch(`${apiBase}/dyeing-runs?work_order_id=${workOrderId}`)
            .then(r => (r.ok ? r.json() : []))
            .catch(() => [])
            .then(d => { if (live) setRuns(Array.isArray(d) ? d : []); });
        return () => { live = false; };
    }, [workOrderId, authFetch, apiBase]);

    if (runs === null) return <div style={{ color: '#888', fontStyle: 'italic', fontSize: 10, padding: 4 }}>{t('loading') || 'Loading...'}</div>;
    if (runs.length === 0) return <div style={{ color: '#888', fontStyle: 'italic', fontSize: 10, padding: 4 }}>{t('history_no_bath')}</div>;

    const subTh = lvSubTh();
    const subTd = lvSubTd();
    return (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <table style={{ ...lvSubTable(), maxWidth: 760 }}>
            <thead>
                <tr>
                    <th style={{ ...subTh, width: 50 }}>{t('history_bath')}</th>
                    <th style={{ ...subTh, width: 130 }}>{t('history_step')}</th>
                    <th style={{ ...subTh, width: 150 }}>{t('history_when')}</th>
                    <th style={subTh}>{t('status')}</th>
                </tr>
            </thead>
            <tbody>
                {runs.flatMap((run, ri) => {
                    // The gap belongs between two stamps, so it renders as a connector
                    // row between them rather than in a column beside the later one.
                    const steps = [
                        { label: t('start_color_matching'), at: run.color_matching_at, gap: null as number | null, gapLabel: '', hint: '' },
                        { label: t('start_batch'), at: run.started_at, gap: minutesBetween(run.color_matching_at, run.started_at), gapLabel: t('gap_matching'), hint: t('phase_prep_gap') },
                        { label: t('complete_batch'), at: run.completed_at, gap: minutesBetween(run.started_at, run.completed_at), gapLabel: t('gap_on_machine'), hint: t('phase_run_gap') },
                    ];
                    return steps.flatMap((s, si) => [
                        ...(s.gap != null ? [
                            <tr key={`${run.id}-${si}-gap`} style={lvSubRow(ri)}>
                                <td style={{ ...subTd, borderTop: 'none', borderBottom: 'none', padding: '0 4px' }} />
                                <td colSpan={3} title={s.hint} style={{ ...subTd, borderTop: 'none', borderBottom: 'none', padding: '0 4px', fontSize: 10, color: '#666', whiteSpace: 'nowrap' }}>
                                    <span style={{ display: 'inline-block', borderLeft: '2px solid #b8b4a8', height: 16, verticalAlign: 'middle', margin: '0 8px 0 6px' }} />
                                    <i className="bi bi-arrow-down" style={{ marginRight: 4 }} />
                                    <b style={{ color: '#333' }}>{fmtMinutes(s.gap)}</b> {s.gapLabel}
                                </td>
                            </tr>,
                        ] : []),
                        <tr key={`${run.id}-${si}`} style={lvSubRow(ri)}>
                            <td style={{ ...subTd, fontWeight: 'bold' }}>{si === 0 ? `#${run.run_number}` : ''}</td>
                            <td style={{ ...subTd, fontWeight: 'bold' }}>{s.label}</td>
                            <td style={{ ...subTd, whiteSpace: 'nowrap', color: s.at ? '#222' : '#aaa' }}>{fmtStamp(s.at)}</td>
                            <td style={subTd}>
                                {si === 0 && <StatusChip status={run.status || 'PENDING'} tint />}
                                {si === 0 && run.operator_name && <span style={{ marginLeft: 6, color: '#555' }}>{run.operator_name}</span>}
                            </td>
                        </tr>,
                    ]);
                })}
            </tbody>
        </table>
        {calc && <RunCalc r={calc} />}
        </div>
    );
}

'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { StatusChip } from '../shared/xpTheme';
import { lvSubTable, lvSubTh, lvSubTd, lvSubRow } from '../shared/listViewTheme';
import { fmtMinutes } from '../shared/format';

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
export default function DyeingWOHistory({ workOrderId, authFetch, apiBase }: {
    workOrderId: string;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    apiBase: string;
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
        <table style={{ ...lvSubTable(), maxWidth: 760 }}>
            <thead>
                <tr>
                    <th style={{ ...subTh, width: 50 }}>{t('history_bath')}</th>
                    <th style={{ ...subTh, width: 130 }}>{t('history_step')}</th>
                    <th style={{ ...subTh, width: 150 }}>{t('history_when')}</th>
                    <th style={{ ...subTh, width: 80, textAlign: 'right' }}>{t('history_duration')}</th>
                    <th style={subTh}>{t('status')}</th>
                </tr>
            </thead>
            <tbody>
                {runs.flatMap((run, ri) => {
                    const steps = [
                        { label: t('start_color_matching'), at: run.color_matching_at, gap: null as number | null, hint: '' },
                        { label: t('start_batch'), at: run.started_at, gap: minutesBetween(run.color_matching_at, run.started_at), hint: t('phase_prep_gap') },
                        { label: t('complete_batch'), at: run.completed_at, gap: minutesBetween(run.started_at, run.completed_at), hint: t('phase_run_gap') },
                    ];
                    return steps.map((s, si) => (
                        <tr key={`${run.id}-${si}`} style={lvSubRow(ri)}>
                            <td style={{ ...subTd, fontWeight: 'bold' }}>{si === 0 ? `#${run.run_number}` : ''}</td>
                            <td style={{ ...subTd, fontWeight: 'bold' }}>{s.label}</td>
                            <td style={{ ...subTd, whiteSpace: 'nowrap', color: s.at ? '#222' : '#aaa' }}>{fmtStamp(s.at)}</td>
                            <td style={{ ...subTd, textAlign: 'right', color: '#555' }} title={s.hint || undefined}>
                                {s.gap != null ? fmtMinutes(s.gap) : ''}
                            </td>
                            <td style={subTd}>
                                {si === 0 && <StatusChip status={run.status || 'PENDING'} tint />}
                                {si === 0 && run.operator_name && <span style={{ marginLeft: 6, color: '#555' }}>{run.operator_name}</span>}
                            </td>
                        </tr>
                    ));
                })}
            </tbody>
        </table>
    );
}

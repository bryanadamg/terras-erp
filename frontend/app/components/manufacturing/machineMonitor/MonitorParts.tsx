'use client';

import React from 'react';
import {
    xpFont, familyColor, ProgressBar, StatusChip, XPActionButton, ToggleChip,
    CHIP_RADIUS, SECTION_RADIUS,
} from '../../shared/xpTheme';
import { xpToolbar, FilterChipBar } from '../../shared/shellTheme';
import { machineStrip, machineChipStatus } from './machineStatus';
import { MonitorSection, UNGROUPED } from './useMonitorSections';

const RED = familyColor('red');

/**
 * Chrome shared by the loom grid and the dye-vessel grid.
 *
 * Only the parts that carry no domain meaning live here — the grid geometry, the
 * group bands, the filter chips, the efficiency bar and the card frame. Each
 * monitor supplies its own card BODY, because a loom's warp/prep readout and a
 * vessel's rpm/yards readout are different jobs and merging them would produce a
 * component that is a switch statement wearing a card.
 */

/** Efficiency against its target tick. One call, so every bar in both monitors
 * (grid card and machine modal hero alike) reads identically. */
export const EffBar = ({ eff, target, label, height = 9 }: {
    eff: number | null | undefined; target: number | null | undefined;
    label?: string; height?: number;
}) => (
    <ProgressBar
        pct={Number(eff) || 0}
        tone={(eff ?? 0) >= (target ?? 0) ? 'green' : 'red'}
        markerPct={Number(target) || 0}
        markerTitle={label}
        height={height}
    />
);

/** The `auto-fill` track both grids lay their cards on. Kept in one place so the
 * loading skeleton's geometry can quote the same numbers and the real grid drops
 * into its tracks with no shift. */
export const gridColumns = (classic: boolean) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${240}px, 1fr))`,
    gap: 8,
} as React.CSSProperties);

export const CardGrid = ({ classic, children }: { classic: boolean; children: React.ReactNode }) => (
    <div style={gridColumns(true)}>{children}</div>
);

/**
 * One machine tile. Classic = XP raised tile with a status strip; modern = a
 * bootstrap card with a status chip. The body is the caller's.
 *
 * Every card is the same height (grid stretch) whatever its status, so the white
 * body must grow with it — an idle machine's tile used to stop under its last
 * line and leave bare bevel below.
 */
export const MachineCard = ({
    classic, code, name, status, statusLabel, alarm, badge, onClick, title, footer, children,
}: {
    classic: boolean;
    code: string;
    name: string;
    /** IDLE | STAGED | DRAW_IN | TUNING | LOADED | RUNNING */
    status: string;
    statusLabel: string;
    /** Show the behind-schedule / attention triangle. */
    alarm?: boolean;
    alarmTitle?: string;
    /** Small right-aligned note in the header (e.g. "3 WO"). */
    badge?: React.ReactNode;
    onClick?: () => void;
    title?: string;
    /** Rendered below the body, outside the flex-grow region (beam strip, prep row). */
    footer?: React.ReactNode;
    children: React.ReactNode;
}) => {
    if (true) {
        return (
            <div onClick={onClick} title={title} className="tile-hover"
                style={{
                    border: '2px solid', borderColor: '#ffffff #808080 #808080 #ffffff',
                    background: '#ece9d8', cursor: onClick ? 'pointer' : undefined,
                    borderRadius: SECTION_RADIUS, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                }}>
                <div style={{
                    background: machineStrip(status), color: '#fff', fontFamily: xpFont,
                    fontSize: 11, fontWeight: 'bold', padding: '2px 7px', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center', gap: 6,
                    borderBottom: '1px solid #00000033',
                }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {code} — {name}
                    </span>
                    <span style={{ fontSize: 9, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {alarm && <i className="bi bi-exclamation-triangle-fill" />}
                        {badge}
                        {statusLabel.toUpperCase()}
                    </span>
                </div>
                <div style={{
                    padding: '6px 8px', background: '#fff', fontFamily: xpFont,
                    flex: 1, display: 'flex', flexDirection: 'column',
                }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
                    {footer}
                </div>
            </div>
        );
    }
    return (
        <div onClick={onClick} className="card h-100 shadow-sm border tile-hover"
            style={{ cursor: onClick ? 'pointer' : undefined, borderRadius: SECTION_RADIUS }} title={title}>
            <div className="card-body p-3 d-flex flex-column">
                <div className="d-flex align-items-center gap-2 mb-2">
                    <span style={{ fontWeight: 'bold', fontSize: 15 }}>{code}</span>
                    <span className="text-muted small text-truncate" style={{ flex: 1 }}>{name}</span>
                    {alarm && <i className="bi bi-exclamation-triangle-fill" style={{ color: RED }} />}
                    {badge && <span className="text-muted" style={{ fontSize: 11 }}>{badge}</span>}
                    <StatusChip status={machineChipStatus(status)} label={statusLabel} tint />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
                {footer}
            </div>
        </div>
    );
};

export const sectionLabel = (sec: { id: string | null; code: string; name: string }) =>
    sec.id ? `${sec.code}${sec.name ? ' — ' + sec.name : ''}` : 'Ungrouped';

/**
 * Group band. Carries the bank's own health (running · avg efficiency · below
 * target · late) so a section reports itself without the reader tallying cards —
 * the counts alone said nothing about whether the bank was in trouble. Classic
 * reuses the shared toolbar strip; modern keeps the underlined caption row.
 */
export const GroupHeader = <M,>({ classic, sec, labels, action }: {
    classic: boolean;
    sec: MonitorSection<M>;
    labels: { machines: string; running: string; avgEfficiency: string; belowTarget: string; late: string };
    action?: React.ReactNode;
}) => {
    const health = (
        <>
            <span style={{ fontWeight: 'normal', color: '#555' }}>
                {sec.machines.length} {labels.machines} · {sec.running} {labels.running}
            </span>
            {sec.avgEff !== null && (
                <span style={{ fontWeight: 'normal', color: '#555' }}>
                    {labels.avgEfficiency}: <b style={{ color: '#333' }}>{sec.avgEff.toFixed(1)}%</b>
                </span>
            )}
            {sec.belowTarget > 0 && (
                <StatusChip status="CANCELLED" label={`${sec.belowTarget} ${labels.belowTarget}`} tint />
            )}
            {sec.late > 0 && (
                <StatusChip status="CANCELLED" label={`${sec.late} ${labels.late}`} tint />
            )}
        </>
    );
    const right = action ? <span style={{ marginLeft: 'auto' }}>{action}</span> : null;
    return <div style={xpToolbar({
            marginBottom: 6, border: '1px solid #b0a898', borderRadius: SECTION_RADIUS,
            fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: familyColor('blue'),
        })}>
            <i className="bi bi-collection" />
            <span>{sectionLabel(sec)}</span>
            {health}
            {right}
        </div>;
};

/**
 * Group focus chips + the running-only toggle.
 *
 * These FILTER, they do not hide: every chip keeps its plant-wide below-target
 * badge, so an alarm in a bank you are not looking at is still on screen — which
 * is what property tabs would have cost.
 */
export const MonitorChipBar = <M,>({
    classic, sections, isGrouped, groupFilter, onGroupChange,
    machineCount, runningOnly, runningCount, onRunningOnlyChange, labels,
}: {
    classic: boolean;
    sections: MonitorSection<M>[];
    isGrouped: boolean;
    groupFilter: string | null;
    onGroupChange: (v: string | null) => void;
    machineCount: number;
    runningOnly: boolean;
    runningCount: number;
    onRunningOnlyChange: (v: boolean) => void;
    labels: {
        group: string; all: string; machines: string; running: string;
        belowTarget: string; runningOnly: string; runningOnlyHint: string;
    };
}) => {
    const ALL_GROUPS = '__all__';
    const runningToggle = (
        <span style={{ marginLeft: isGrouped ? 'auto' : undefined }}>
            <ToggleChip
                classic
                on={runningOnly}
                tone="green"
                toneIdle
                title={labels.runningOnlyHint}
                onClick={() => onRunningOnlyChange(!runningOnly)}
            >
                <i className="bi bi-play-circle-fill" style={{ marginRight: 4 }} />
                {labels.runningOnly} ({runningCount})
            </ToggleChip>
        </span>
    );
    return (
        <div style={xpToolbar({ marginBottom: 8, border: '1px solid #b0a898', borderRadius: SECTION_RADIUS })}>
            {!isGrouped ? runningToggle : null}
            {isGrouped && (
                <span style={{ fontSize: 11, color: '#666', fontFamily: xpFont}}>
                    <i className="bi bi-funnel" style={{ marginRight: 4 }} />{labels.group}
                </span>
            )}
            {isGrouped && (
                <FilterChipBar
                    classic
                    value={groupFilter ?? ALL_GROUPS}
                    onChange={v => onGroupChange(v === ALL_GROUPS || v === groupFilter ? null : v)}
                    options={[
                        { value: ALL_GROUPS, label: `${labels.all} (${machineCount})` },
                        ...sections.map(sec => ({
                            value: sec.id || UNGROUPED,
                            title: `${sec.machines.length} ${labels.machines} · ${sec.running} ${labels.running}`,
                            label: (
                                <>
                                    {sectionLabel(sec)}
                                    <span style={{ opacity: 0.75 }}> ({sec.machines.length})</span>
                                    {sec.belowTarget > 0 && (
                                        <span
                                            title={`${sec.belowTarget} ${labels.belowTarget}`}
                                            style={{
                                                marginLeft: 5, padding: '0 4px', borderRadius: CHIP_RADIUS,
                                                background: RED, color: '#fff', fontSize: 9, fontWeight: 700,
                                            }}
                                        >
                                            {sec.belowTarget}
                                        </span>
                                    )}
                                </>
                            ),
                        })),
                    ]}
                />
            )}
            {isGrouped ? runningToggle : null}
        </div>
    );
};

export { XPActionButton };

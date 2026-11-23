'use client';

import React from 'react';
import { xpFont, CHIP_RADIUS, familyTint } from '../shared/xpTheme';
import { groupPermissionsBySection } from '../shared/permissionMatrix';
import { PermissionOption } from './PermissionsPicker';

/**
 * Building blocks for the Access Control list/detail screens. The tab used to
 * stack a roles table on a users table, with role detail expanding inline and
 * shoving the users off-screen; a narrow list beside a detail pane keeps both
 * the "who" and the "what can they do" on screen without the page jumping.
 */

export const isAdminPerms = (perms: { code: string }[]) => perms.some(p => p.code === 'admin.access');

export interface SectionCoverage { section: string; granted: number; total: number }

/** Granted-of-total per permission-matrix section, in matrix order. */
export function sectionCoverage(granted: { code: string }[], allPermissions: PermissionOption[]): SectionCoverage[] {
    const grantedBy = new Map(groupPermissionsBySection(granted).map(s => [s.section, s.permissions.length]));
    return groupPermissionsBySection(allPermissions).map(s => ({
        section: s.section,
        granted: grantedBy.get(s.section) || 0,
        total: s.permissions.length,
    }));
}

const heat = (f: number) => f <= 0 ? '#fff' : f >= 1 ? '#1c4a96' : f >= 0.6 ? '#4a7bd0' : f >= 0.3 ? '#8fb0e6' : '#cbdaf3';

/** One square per section, shaded by coverage — a role's shape at list-row size. */
export function CoverageStrip({ coverage }: { coverage: SectionCoverage[] }) {
    return (
        <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}>
            {coverage.map(c => (
                <i key={c.section} title={`${c.section}: ${c.granted}/${c.total}`} style={{
                    width: 10, height: 10, display: 'inline-block',
                    border: '1px solid #b7b3a6', background: heat(c.total ? c.granted / c.total : 0),
                }} />
            ))}
        </span>
    );
}

/** Section name + bar + count, the detail-pane version of `CoverageStrip`. */
export function CoveragePills({ coverage }: { coverage: SectionCoverage[] }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {coverage.map(c => (
                <span key={c.section} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 7px',
                    border: '1px solid #c8c4b6', background: '#faf9f4', borderRadius: CHIP_RADIUS,
                    fontFamily: xpFont, fontSize: 10, opacity: c.granted ? 1 : 0.45,
                }}>
                    {c.section}
                    <span style={{ width: 44, height: 6, border: '1px solid #b7b3a6', background: '#e4e1d6', position: 'relative' }}>
                        <span style={{ position: 'absolute', inset: 0, width: `${c.total ? 100 * c.granted / c.total : 0}%`, background: '#316ac5' }} />
                    </span>
                    <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums' }}>{c.granted}/{c.total}</span>
                </span>
            ))}
        </div>
    );
}

/** List pane beside a detail pane; both scroll on their own. */
export function MasterDetail({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
    // ponytail: fixed two-column grid, no phone stacking — Access Control is a desktop admin screen.
    return (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(260px, 330px) minmax(0, 1fr)', gap: 12 }}>
            <div style={{ minHeight: 0 }}>{list}</div>
            <div style={{ minHeight: 0 }}>{detail}</div>
        </div>
    );
}

export function ListRow({ selected, dim = false, onClick, children }: {
    selected: boolean; dim?: boolean; onClick: () => void; children: React.ReactNode;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={onClick}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
            className={selected ? undefined : 'access-list-row'}
            style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                borderBottom: '1px solid #ebe8dd', fontFamily: xpFont, fontSize: 11,
                background: selected ? '#316ac5' : undefined, color: selected ? '#fff' : undefined,
                opacity: dim && !selected ? 0.55 : 1,
            }}
        >{children}</div>
    );
}

/** Uppercase caption + body, the unit the detail pane is built from. */
export function DetailSection({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#33475b',
            }}>
                {title}
                {right && <span style={{ marginLeft: 'auto', fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>{right}</span>}
            </div>
            {children}
        </div>
    );
}

/** One-line notice with an optional fix-it action. */
export function Callout({ tone, icon, children, action }: {
    tone: 'amber' | 'blue'; icon: string; children: React.ReactNode; action?: React.ReactNode;
}) {
    const t = familyTint(tone);
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
            background: t.background, border: `1px solid ${t.borderColor}`, color: t.color,
            borderRadius: CHIP_RADIUS, fontFamily: xpFont, fontSize: 11,
        }}>
            <i className={`bi ${icon}`} style={{ fontSize: 13 }} />
            <span style={{ flex: 1 }}>{children}</span>
            {action}
        </div>
    );
}

/** Small tinted label — list-row flags ("No role", "Inactive"). */
export function Flag({ tone, icon, children, title }: {
    tone: 'amber' | 'gray' | 'blue'; icon?: string; children: React.ReactNode; title?: string;
}) {
    const t = familyTint(tone);
    return (
        <span title={title} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
            background: t.background, border: `1px solid ${t.borderColor}`, color: t.color,
            borderRadius: CHIP_RADIUS, padding: '0 5px', fontFamily: xpFont, fontSize: 9, fontWeight: 'bold', lineHeight: '15px',
        }}>
            {icon && <i className={`bi ${icon}`} />}{children}
        </span>
    );
}

/** "3h ago" / "2 mo ago"; exact time goes in a title beside it. */
export function relativeTime(iso?: string | null, now = Date.now()): string {
    if (!iso) return 'Never';
    const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.round(d / 30);
    return mo < 12 ? `${mo} mo ago` : `${Math.round(mo / 12)}y ago`;
}

/** Jaccard overlap between two permission sets (0..1) and the shared count. */
export function permissionOverlap(a: { id: string }[], b: { id: string }[]): { shared: number; score: number } {
    const bIds = new Set(b.map(p => p.id));
    const shared = a.filter(p => bIds.has(p.id)).length;
    const union = a.length + b.length - shared;
    return { shared, score: union ? shared / union : 0 };
}

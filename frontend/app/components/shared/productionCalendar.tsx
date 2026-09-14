'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
    xpFont, familyColor, FormSection, SectionTitle, XPActionButton, WeekdayToggle, WEEKDAY_LABELS,
} from './xpTheme';

/**
 * Production-calendar editor, shared by the two places a machine calendar is set:
 * the per-machine monitor tab (each edit hits the server immediately) and the
 * group batch-apply modal (edits accumulate locally, one cascade PUT on apply).
 *
 * Only the *persistence* differs, so that is all the callers own: they pass the
 * current weekdays/holidays and get `onToggleWeekday` / `onToggleDay` callbacks.
 * Everything visual — the month grid, the Mon-first ordering, the working/rest/
 * national/holiday color legend, the click hint — lives here, because the group form
 * previously had no grid at all and the two screens taught the floor two different
 * mental models of the same setting.
 */

const RED = familyColor('red');
const AMBER = familyColor('amber');
const TODAY_BLUE = familyColor('blue');

/** One holiday row. `id` is present only for server-persisted rows (machine side). */
export interface CalendarHoliday {
    holiday_date: string;
    note?: string | null;
    id?: string;
}

export interface NationalHoliday { date: string; name: string }

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (v: any) => String(v).slice(0, 10);

/**
 * Indonesian national holidays for a year, from `/weaving/id-holidays`. Both
 * calendars overlay them (as a reference, and as the note text when a day is
 * adopted), and both used to fetch them with their own effect.
 */
export function useNationalHolidays(
    authFetch: (url: string, opts?: any) => Promise<Response>,
    apiBase: string,
    year: number,
    enabled = true,
): Map<string, string> {
    const [rows, setRows] = useState<NationalHoliday[]>([]);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        authFetch(`${apiBase}/weaving/id-holidays?year=${year}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (!cancelled && d) setRows(d.holidays || []); })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [authFetch, apiBase, year, enabled]);
    return useMemo(() => new Map(rows.map(h => [h.date, h.name])), [rows]);
}

/** Working-weekday picker + its hint, in the standard section chrome. */
export function WorkingDaysSection({ weekdays, onToggleWeekday, canEdit, onSave }: {
    weekdays: number[];
    onToggleWeekday: (day: number) => void;
    canEdit: boolean;
    /** Machine side persists weekdays on its own button; the group form applies
     *  everything from the modal footer, so it passes nothing. */
    onSave?: () => void;
}) {
    const { t } = useLanguage();
    return (
        <FormSection title={<SectionTitle icon="bi-calendar-week">{t('working_days')}</SectionTitle>}>
            <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                <WeekdayToggle value={weekdays} onToggle={onToggleWeekday} disabled={!canEdit} />
                {canEdit && onSave && (
                    <span className="ms-2">
                        <XPActionButton tone="success" icon="bi-check-lg" label={t('save')} onClick={onSave} />
                    </span>
                )}
            </div>
            <p
                style={{ fontFamily: xpFont, fontSize: 10, color: '#777', margin: 0 }}
            >
                {t('working_days_hint')}
            </p>
        </FormSection>
    );
}

/** Month navigation strip (prev / label / next / today). */
function MonthNav({ month, onMonthChange }: {
    month: Date;
    onMonthChange: (d: Date) => void;
}) {
    const { t } = useLanguage();
    return (
        <div className="d-flex align-items-center gap-2 mb-2">
            <XPActionButton tone="neutral" icon="bi-chevron-left"
                onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
            <span style={{ minWidth: 150, textAlign: 'center', fontWeight: 'bold', fontFamily: xpFont}}>
                {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <XPActionButton tone="neutral" icon="bi-chevron-right"
                onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
            <XPActionButton tone="neutral" label={t('today')} onClick={() => onMonthChange(new Date())} />
        </div>
    );
}

/**
 * Mon-first month grid. Clicking a day toggles it as a holiday through
 * `onToggleDay` — the caller decides whether that means an API call or a local
 * edit. Purely controlled: no fetching, no state beyond what is passed in.
 */
export function HolidayMonthGrid({ month, weekdays, holidays, national, onToggleDay, canEdit }: {
    month: Date;
    weekdays: number[];
    holidays: CalendarHoliday[];
    national: Map<string, string>;
    /** `existing` is the matching holiday row when the day is already marked;
     *  `nationalName` is the national-holiday name to use as the note when adopting. */
    onToggleDay?: (dateStr: string, existing: CalendarHoliday | undefined, nationalName?: string) => void;
    canEdit: boolean;
}) {
    const { t } = useLanguage();
    const y = month.getFullYear();
    const mo = month.getMonth();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // Mon-first
    const holMap = useMemo(
        () => new Map(holidays.map(h => [dayKey(h.holiday_date), h])),
        [holidays],
    );
    const todayStr = isoDay(new Date());

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < lead; i++) cells.push(<div key={`b${i}`} />);
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${y}-${pad(mo + 1)}-${pad(d)}`;
        const dow = (new Date(y, mo, d).getDay() + 6) % 7;
        const working = weekdays.includes(dow);
        const hol = holMap.get(ds);
        const nat = national.get(ds);
        const isToday = ds === todayStr;
        let bg = '#fff';
        if (hol) bg = '#f0cccc';
        else if (nat) bg = '#ffe2b8';
        else if (!working) bg = '#e6e3da';
        cells.push(
            <div key={ds}
                onClick={() => { if (canEdit && onToggleDay) onToggleDay(ds, hol, nat); }}
                title={hol ? (hol.note || t('holiday')) : nat ? `${nat} — ${t('click_to_add')}` : (working ? t('working_day') : t('rest_day'))}
                style={{
                    minHeight: 48, padding: '2px 4px', background: bg, overflow: 'hidden',
                    cursor: canEdit && onToggleDay ? 'pointer' : 'default',
                    border: isToday ? `2px solid ${TODAY_BLUE}` : '1px solid',
                    borderColor: isToday ? TODAY_BLUE : ('#c8c4b8'),
                    fontFamily: xpFont, fontSize: 11,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: isToday ? 'bold' : 'normal' }}>{d}</span>
                    {nat && <i className="bi bi-star-fill" style={{ fontSize: 8, color: AMBER }} />}
                    {hol && <i className="bi bi-x-circle-fill" style={{ fontSize: 8, color: RED }} />}
                </div>
                {nat && <div style={{ fontSize: 8, color: AMBER, lineHeight: 1.05, maxHeight: 22, overflow: 'hidden' }}>{nat}</div>}
                {hol && hol.note && !nat && <div style={{ fontSize: 8, color: RED, lineHeight: 1.05, maxHeight: 22, overflow: 'hidden' }}>{hol.note}</div>}
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>
                {WEEKDAY_LABELS.map(h => (
                    <div key={h} style={{ textAlign: 'center', fontSize: 10, fontWeight: 'bold', color: '#666', fontFamily: xpFont}}>{h}</div>
                ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>{cells}</div>
        </div>
    );
}

/** Color key for the grid — kept next to the grid it explains. */
function CalendarLegend() {
    const { t } = useLanguage();
    const swatches: [string, string][] = [
        ['#fff', t('working_day')],
        ['#e6e3da', t('rest_day')],
        ['#ffe2b8', `★ ${t('national_holiday')}`],
        ['#f0cccc', t('holiday')],
    ];
    return (
        <div className="d-flex flex-wrap gap-3 mt-2" style={{ fontSize: 10, color: '#666', fontFamily: xpFont}}>
            {swatches.map(([c, label]) => (
                <span key={label} className="d-inline-flex align-items-center">
                    <span style={{ display: 'inline-block', width: 11, height: 11, background: c, border: '1px solid #aaa', marginRight: 4 }} />{label}
                </span>
            ))}
        </div>
    );
}

/**
 * The whole holidays block: section chrome + month nav + grid + legend + hint,
 * with an optional header action (both callers put "import national holidays for
 * the displayed year" there) and optional extra content below the grid (the group
 * form's note-entry row and holiday table).
 */
export function HolidayCalendarSection({
    month, onMonthChange, weekdays, holidays, national,
    onToggleDay, canEdit, headerAction, children,
}: {
    month: Date;
    onMonthChange: (d: Date) => void;
    weekdays: number[];
    holidays: CalendarHoliday[];
    national: Map<string, string>;
    onToggleDay?: (dateStr: string, existing: CalendarHoliday | undefined, nationalName?: string) => void;
    canEdit: boolean;
    headerAction?: React.ReactNode;
    children?: React.ReactNode;
}) {
    const { t } = useLanguage();
    return (
        <FormSection title={
            <SectionTitle icon="bi-calendar3" right={headerAction}>{t('holidays')}</SectionTitle>
        }>
            <MonthNav month={month} onMonthChange={onMonthChange} />
            <HolidayMonthGrid
                month={month}
                weekdays={weekdays}
                holidays={holidays}
                national={national}
                onToggleDay={onToggleDay}
                canEdit={canEdit}
            />
            <CalendarLegend />
            <p
                style={{ fontFamily: xpFont, fontSize: 10, color: '#777', marginTop: 4 }}
            >
                {t('calendar_click_hint')}
            </p>
            {children}
        </FormSection>
    );
}

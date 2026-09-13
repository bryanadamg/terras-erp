'use client';

import { useState, useEffect, useCallback } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { useLanguage } from '../../context/LanguageContext';
import {
    xpFont, familyColor, FormSection, FieldLabel, XPActionButton,
    SectionTitle as SecTitle, ModalFooterActions,
} from '../shared/xpTheme';
import { lvInput, lvTh, lvTd, lvRow, LV_STICKY_THEAD } from '../shared/listViewTheme';
import {
    WorkingDaysSection, HolidayCalendarSection, useNationalHolidays,
} from '../shared/productionCalendar';

const RED = familyColor('red');

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** TYPE or GROUP node the calendar is applied from. */
    group: { id: string; code?: string; name?: string } | null;
    authFetch: (url: string, opts?: any) => Promise<Response>;
    apiBase: string;
    /** Called after a successful apply so the caller can reload its data. */
    onApplied?: () => void;
}

/**
 * Batch production calendar for a whole group of machines.
 *
 * Cascade-copy: the group node stores what was set (so the form reopens with it)
 * and every machine underneath is written the same weekdays + holidays in one
 * request. Editing one loom at a time is still possible from its own monitor card;
 * re-applying here overwrites those per-machine tweaks, which is the point.
 */
export default function GroupCalendarModal({ isOpen, onClose, group, authFetch, apiBase, onApplied }: Props) {
    const { t } = useLanguage();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
    const [holidays, setHolidays] = useState<{ holiday_date: string; note: string | null }[]>([]);
    const [machines, setMachines] = useState<any[]>([]);
    const [newHoliday, setNewHoliday] = useState('');
    const [newHolidayNote, setNewHolidayNote] = useState('');
    const [applyHolidays, setApplyHolidays] = useState(true);
    // Displayed month drives both the grid and which year "import national" pulls —
    // the separate year input the import used to need is gone.
    const [calRef, setCalRef] = useState<Date>(() => new Date());

    const groupId = group?.id;
    const national = useNationalHolidays(authFetch, apiBase, calRef.getFullYear(), isOpen);

    const load = useCallback(async () => {
        if (!groupId) return;
        setLoading(true);
        setError('');
        try {
            const res = await authFetch(`${apiBase}/work-center-groups/${groupId}/calendar`);
            if (!res.ok) { setError('Could not load the group calendar'); return; }
            const d = await res.json();
            setWeekdays(d.working_weekdays || [0, 1, 2, 3, 4]);
            setHolidays((d.holidays || []).map((h: any) => ({ holiday_date: String(h.holiday_date).slice(0, 10), note: h.note })));
            setMachines(d.machines || []);
        } finally {
            setLoading(false);
        }
    }, [groupId, apiBase, authFetch]);

    useEffect(() => {
        if (isOpen && groupId) {
            setApplyHolidays(true);
            setNewHoliday('');
            setNewHolidayNote('');
            setCalRef(new Date());
            load();
        }
    }, [isOpen, groupId, load]);

    const toggleWeekday = (d: number) =>
        setWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));

    // Local-only edits — nothing is written until Apply cascades the whole set.
    const addHolidayDate = (ds: string, note: string | null) =>
        setHolidays(prev => prev.some(h => h.holiday_date === ds)
            ? prev
            : [...prev, { holiday_date: ds, note }].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));

    const removeHoliday = (ds: string) =>
        setHolidays(prev => prev.filter(h => h.holiday_date !== ds));

    const addHoliday = () => {
        if (!newHoliday) return;
        addHolidayDate(newHoliday, newHolidayNote || null);
        setNewHoliday('');
        setNewHolidayNote('');
    };

    const apply = async () => {
        if (!groupId) return;
        setSaving(true);
        setError('');
        try {
            const res = await authFetch(`${apiBase}/work-center-groups/${groupId}/calendar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    working_weekdays: weekdays,
                    // null = leave each machine's own holidays alone (weekdays only).
                    holidays: applyHolidays ? holidays : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                setError(d?.detail || 'Could not apply the calendar');
                return;
            }
            onApplied && onApplied();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    // Adopt every national holiday of the displayed year. The dates come from the
    // shared hook that already feeds the grid overlay, so no second fetch.
    const importNational = () => {
        setHolidays(prev => {
            const have = new Set(prev.map(h => h.holiday_date));
            const merged = [...prev];
            national.forEach((name, date) => {
                if (have.has(date)) return;
                merged.push({ holiday_date: date, note: name });
                have.add(date);
            });
            return merged.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
        });
        setApplyHolidays(true);
    };

    const label = group ? `${group.code || ''}${group.name ? ' — ' + group.name : ''}` : '';

    return (
        <ModalWrapper
            isOpen={isOpen}
            modeless
            onClose={onClose}
            size="lg"
            variant="primary"
            title={<><i className="bi bi-calendar3 me-1" /> {t('work_calendar')} — {label}</>}
            footer={
                <>
                    <span style={{ marginRight: 'auto', fontSize: 11, color: '#666', fontFamily: xpFont}}>
                        {machines.length} machine{machines.length !== 1 ? 's' : ''} in this group
                    </span>
                    {/* Shared modal footer (Cancel + solid submit) — a hand-rolled pair
                        here rendered flat gray in Classic, since the global .btn-primary
                        override strips the bevel gradient. */}
                    <ModalFooterActions
                        classic
                        onCancel={onClose}
                        cancelLabel={t('cancel')}
                        onSubmit={apply}
                        submitLabel={`${t('apply_to')} ${machines.length}`}
                        submittingLabel={`${t('saving')}…`}
                        submitting={saving}
                        variant="primary"
                        disabled={loading || machines.length === 0}
                    />
                </>
            }
        >
            {/* Sectioned with the shared FormSection / FieldLabel / XPActionButton set —
                the same chrome as the per-machine monitor modal this opens alongside,
                so the two calendars don't read as two different products. */}
            <div style={{ fontFamily: xpFont, fontSize: 11}}>
                {error && (
                    <div style={{ background: '#ffe8e8', border: `1px solid ${RED}55`, color: RED, padding: '4px 8px', marginBottom: 10 }}>{error}</div>
                )}

                {/* Same editor as the per-machine calendar tab (shared
                    WorkingDaysSection / HolidayCalendarSection). The only difference is
                    persistence: clicks here edit local state and the whole set cascades
                    to every machine on Apply. This form had no month grid at all before —
                    a date field and a table — so the two screens taught two different
                    mental models of one setting. */}
                <WorkingDaysSection
                    classic
                    weekdays={weekdays}
                    onToggleWeekday={toggleWeekday}
                    canEdit
                />

                <HolidayCalendarSection
                    classic
                    month={calRef}
                    onMonthChange={setCalRef}
                    weekdays={weekdays}
                    holidays={holidays}
                    national={national}
                    canEdit={applyHolidays}
                    onToggleDay={(ds, existing, nat) => {
                        if (existing) removeHoliday(ds);
                        else addHolidayDate(ds, nat || null);
                    }}
                    headerAction={
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input type="checkbox" checked={applyHolidays} onChange={e => setApplyHolidays(e.target.checked)} />
                            {t('replace_holidays_on_machines')}
                        </label>
                    }
                >
                    {/* Group-only extras: a note the grid can't capture, a whole-year
                        import, and the flat list of what will be written. */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap', margin: '10px 0 6px' }}>
                        <div>
                            <FieldLabel classic>{t('date')}</FieldLabel>
                            <input type="date" style={{ ...lvInput(true), width: 140 }} value={newHoliday} onChange={e => setNewHoliday(e.target.value)} />
                        </div>
                        <div style={{ flex: 1, minWidth: 140 }}>
                            <FieldLabel classic>{t('note')}</FieldLabel>
                            <input style={lvInput(true)} value={newHolidayNote} onChange={e => setNewHolidayNote(e.target.value)} placeholder="Cuti bersama" />
                        </div>
                        <XPActionButton classic tone="neutral" icon="bi-plus-lg" label={t('add')} disabled={!newHoliday} onClick={addHoliday} />
                        <span style={{ width: 1, alignSelf: 'stretch', background: '#c8c4b8' }} />
                        <XPActionButton classic tone="neutral" icon="bi-download"
                            label={`${t('import_id_holidays')} ${calRef.getFullYear()}`} onClick={importNational} />
                    </div>

                    <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid #808080', background: '#fff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={LV_STICKY_THEAD}>
                                <tr style={{ background: '#d4d0c8' }}>
                                    <th style={{ ...lvTh(true), width: 110 }}>{t('date')}</th>
                                    <th style={lvTh(true)}>{t('note')}</th>
                                    <th style={{ ...lvTh(true), width: 36, borderRight: 'none' }} />
                                </tr>
                            </thead>
                            <tbody>
                                {holidays.map((h, idx) => (
                                    <tr key={h.holiday_date} style={lvRow(true, idx)}>
                                        <td style={lvTd(true)}>{h.holiday_date}</td>
                                        <td style={lvTd(true)}>{h.note || ''}</td>
                                        <td style={{ ...lvTd(true), borderRight: 'none', textAlign: 'right' }}>
                                            <XPActionButton
                                                classic
                                                tone="danger"
                                                icon="bi-x"
                                                title={t('remove')}
                                                onClick={() => removeHoliday(h.holiday_date)}
                                            />
                                        </td>
                                    </tr>
                                ))}
                                {holidays.length === 0 && (
                                    <tr><td colSpan={3} style={{ ...lvTd(true), borderRight: 'none', textAlign: 'center', padding: 12, color: '#888', fontStyle: 'italic' }}>
                                        {loading ? t('loading') : t('no_holidays')}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </HolidayCalendarSection>

                <FormSection classic title={<SecTitle icon="bi-cpu">{t('machines_to_update')}</SecTitle>}>
                    <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>
                        {machines.length === 0
                            ? <span style={{ fontStyle: 'italic', color: '#888' }}>{t('no_machines_in_group')}</span>
                            : machines.map((m: any) => m.code).join(', ')}
                    </div>
                </FormSection>
            </div>
        </ModalWrapper>
    );
}

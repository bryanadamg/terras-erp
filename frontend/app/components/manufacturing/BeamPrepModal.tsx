'use client';

// Warp prep popup — who drew in ("rumus") or tied in ("sambungan") each beam, and
// over how many ends. Shown after Stage/Mount on every beam about to go up, and
// again to correct a mount afterwards. That work is paid per end, so the per-
// operator prep report (Production Output → Drawing-in / Tying-in) sums what is
// entered here.
//
// The operator field is the shared Combobox over user accounts. It has no free-text
// mode, so whatever is typed into its search is offered back as one more option —
// "typed name, no account" — for a floor worker who has no login. Such a pick is
// valued `name:<text>`; any other value is an account id.
import React, { useEffect, useState } from 'react';
import SearchableSelect, { ComboboxOption } from '@bryanadamg/terras-ui/components/Combobox';
import ModalWrapper from '../shared/ModalWrapper';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../shared/Toast';
import { xpFont, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { lvTh, lvTd } from '../shared/listViewTheme';
import { API_BASE } from '../shared/apiBase';

const xpInput = (extra: React.CSSProperties = {}) => xpInputBase({ padding: '0 4px', boxSizing: 'border-box', ...extra });
const xpBtn = (primary?: boolean): React.CSSProperties => xpBtnBase(primary ? { ...BTN_TONES.success, padding: '2px 14px' } : {});

export type BeamPrepType = 'DRAW_IN' | 'TYING_IN';

/** What the backend takes as `prep` on a beam mount (schemas.BeamPrep). */
export interface BeamPrep {
    prep_type: BeamPrepType;
    ends: number;
    operator_user_id: string | null;
    operator: string | null;
}

export interface BeamPrepBeam {
    batch_id: string;
    beam_number: string | null;
    ends?: number | null;
    /** An existing record, when correcting a mount rather than creating one. */
    prep?: Partial<BeamPrep> | null;
}

interface Operator { id: string; username: string; full_name: string | null }

/** `operator`: an account id, `name:<typed text>`, or '' for none yet. */
interface Row { operator: string; term: string; prep_type: BeamPrepType | ''; ends: string }

interface Props {
    beams: BeamPrepBeam[];
    onClose: () => void;
    /** Resolves false when the mount/correction failed, keeping the popup open. */
    onConfirm: (prepByBatch: Record<string, BeamPrep>) => Promise<boolean | void> | boolean | void;
    submitLabel?: string;
}

const TYPED = 'name:';

export default function BeamPrepModal({ beams, onClose, onConfirm, submitLabel }: Props) {
    const { authFetch } = useData() as any;
    const { t } = useLanguage();
    const { showToast } = useToast();
    const [operators, setOperators] = useState<Operator[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(beams.map(b => [b.batch_id, {
        operator: b.prep?.operator_user_id || (b.prep?.operator ? `${TYPED}${b.prep.operator}` : ''),
        term: '',
        prep_type: (b.prep?.prep_type as BeamPrepType) || '',
        ends: String(b.prep?.ends ?? b.ends ?? ''),
    }])));

    useEffect(() => {
        authFetch(`${API_BASE}/users/operators`)
            .then((r: Response) => (r.ok ? r.json() : []))
            .then((d: Operator[]) => setOperators(d || []))
            .catch(() => setOperators([]));
    }, [authFetch]);

    const accountOptions: ComboboxOption[] = operators.map(o => ({
        value: o.id, label: o.full_name || o.username, subLabel: o.username,
    }));

    // Accounts, plus the typed name being searched for and the one already picked.
    const optionsFor = (r: Row): ComboboxOption[] => {
        const typed = new Set<string>();
        if (r.term.trim()) typed.add(r.term.trim());
        if (r.operator.startsWith(TYPED)) typed.add(r.operator.slice(TYPED.length));
        const extra = [...typed]
            .filter(name => !accountOptions.some(o => o.label.toLowerCase() === name.toLowerCase()))
            .map(name => ({ value: `${TYPED}${name}`, label: name, subLabel: t('beam_prep_no_account') }));
        return [...extra, ...accountOptions];
    };

    const set = (id: string, patch: Partial<Row>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    const submit = async () => {
        const out: Record<string, BeamPrep> = {};
        for (const b of beams) {
            const r = rows[b.batch_id];
            const name = b.beam_number || '';
            if (!r.operator) { showToast(t('beam_prep_need_operator').replace('{beam}', name), 'danger'); return; }
            if (!r.prep_type) { showToast(t('beam_prep_need_type').replace('{beam}', name), 'danger'); return; }
            const ends = parseInt(r.ends, 10);
            if (!ends || ends <= 0) { showToast(t('beam_prep_need_ends').replace('{beam}', name), 'danger'); return; }
            const typed = r.operator.startsWith(TYPED);
            out[b.batch_id] = {
                prep_type: r.prep_type,
                ends,
                operator_user_id: typed ? null : r.operator,
                // Blank for an account: the backend snapshots the account's name.
                operator: typed ? r.operator.slice(TYPED.length) : null,
            };
        }
        setSubmitting(true);
        try {
            const ok = await onConfirm(out);
            if (ok !== false) onClose();
        } finally {
            setSubmitting(false);
        }
    };

    const typeBtn = (id: string, value: BeamPrepType, label: string) => {
        const on = rows[id]?.prep_type === value;
        return (
            <button
                type="button"
                className={XP_BTN}
                onClick={() => set(id, { prep_type: value })}
                style={xpBtnBase(on ? { ...BTN_TONES.primary, fontWeight: 'bold' } : {})}
                aria-pressed={on}
            >{label}</button>
        );
    };

    return (
        <ModalWrapper
            isOpen
            modeless
            level={2}
            onClose={onClose}
            title={t('beam_prep_title')}
            size="lg"
            footer={
                <>
                    <button className={XP_BTN} style={xpBtn(false)} onClick={onClose} disabled={submitting}>{t('cancel')}</button>
                    <button className={XP_BTN} style={xpBtn(true)} onClick={submit} disabled={submitting}>
                        {submitting ? '...' : (submitLabel || t('save'))}
                    </button>
                </>
            }
        >
            <div style={{ fontFamily: xpFont, fontSize: 11 }}>
                <div style={{ color: '#555', marginBottom: 8 }}>{t('beam_prep_hint')}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: '#d4d0c8' }}>
                            <th style={lvTh()}>{t('beam')}</th>
                            <th style={lvTh()}>{t('operator')}</th>
                            <th style={lvTh()}>{t('beam_prep_type')}</th>
                            <th style={{ ...lvTh(), borderRight: 'none' }}>{t('ends')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {beams.map(b => {
                            const r = rows[b.batch_id];
                            return (
                                <tr key={b.batch_id}>
                                    <td style={{ ...lvTd(), fontWeight: 'bold', whiteSpace: 'nowrap' }}>{b.beam_number || '—'}</td>
                                    <td style={{ ...lvTd(), minWidth: 230 }}>
                                        <SearchableSelect
                                            options={optionsFor(r)}
                                            value={r.operator}
                                            onChange={v => set(b.batch_id, { operator: v })}
                                            // '' arrives on close; keep the last term so a typed
                                            // pick stays in the list behind the trigger.
                                            onSearch={term => { if (term) set(b.batch_id, { term }); }}
                                            placeholder={t('beam_prep_operator_ph')}
                                        />
                                    </td>
                                    <td style={{ ...lvTd(), whiteSpace: 'nowrap' }}>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            {typeBtn(b.batch_id, 'DRAW_IN', t('prep_draw_in'))}
                                            {typeBtn(b.batch_id, 'TYING_IN', t('prep_tying_in'))}
                                        </div>
                                    </td>
                                    <td style={{ ...lvTd(), borderRight: 'none' }}>
                                        <input
                                            type="number" min={1} step={1}
                                            value={r.ends}
                                            onChange={e => set(b.batch_id, { ends: e.target.value })}
                                            style={xpInput({ width: 80, textAlign: 'right' })}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </ModalWrapper>
    );
}

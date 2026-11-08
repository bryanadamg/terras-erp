'use client';

// Warp prep popup — who drew in ("rumus") or tied in ("sambungan") each beam, and
// over how many ends. Shown after Stage/Mount on every beam about to go up, and
// again to correct a mount afterwards. That work is paid per end, so the per-
// operator prep report (Production Output → Warp Prep) sums what is entered here.
//
// One operator field covers both cases the floor has: pick a user account from the
// list, or type the name of a floor worker who has no login. Only an exact match
// to an account is pegged to it; anything else is stored as a typed name.
import React, { useEffect, useId, useMemo, useState } from 'react';
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

interface Row { operator: string; prep_type: BeamPrepType | ''; ends: string }

interface Props {
    beams: BeamPrepBeam[];
    onClose: () => void;
    /** Resolves when the mount/correction went through; the modal closes itself. */
    onConfirm: (prepByBatch: Record<string, BeamPrep>) => Promise<boolean | void> | boolean | void;
    submitLabel?: string;
}

const opLabel = (o: Operator) => (o.full_name ? `${o.full_name} (${o.username})` : o.username);

export default function BeamPrepModal({ beams, onClose, onConfirm, submitLabel }: Props) {
    const { authFetch } = useData() as any;
    const { t } = useLanguage();
    const { showToast } = useToast();
    const listId = useId();
    const [operators, setOperators] = useState<Operator[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(beams.map(b => [b.batch_id, {
        operator: b.prep?.operator || '',
        prep_type: (b.prep?.prep_type as BeamPrepType) || '',
        ends: String(b.prep?.ends ?? b.ends ?? ''),
    }])));

    useEffect(() => {
        authFetch(`${API_BASE}/users/operators`)
            .then((r: Response) => (r.ok ? r.json() : []))
            .then((d: Operator[]) => setOperators(d || []))
            .catch(() => setOperators([]));
    }, [authFetch]);

    // Typed text → account. The datalist offers "Full Name (username)", but a
    // supervisor may also type just the username or the full name; a name two
    // accounts share stays a typed name rather than a guess.
    const accountFor = useMemo(() => {
        const byKey = new Map<string, Operator | null>();
        const put = (k: string | null, o: Operator) => {
            if (!k) return;
            const key = k.trim().toLowerCase();
            byKey.set(key, byKey.has(key) && byKey.get(key)?.id !== o.id ? null : o);
        };
        operators.forEach(o => { put(opLabel(o), o); put(o.username, o); put(o.full_name, o); });
        return (text: string) => byKey.get(text.trim().toLowerCase()) || null;
    }, [operators]);

    // A correction opens on the account's id, which may predate the list loading.
    useEffect(() => {
        if (!operators.length) return;
        setRows(prev => {
            const next = { ...prev };
            let changed = false;
            beams.forEach(b => {
                const id = b.prep?.operator_user_id;
                const o = id ? operators.find(x => x.id === id) : null;
                if (o && next[b.batch_id] && !accountFor(next[b.batch_id].operator)) {
                    next[b.batch_id] = { ...next[b.batch_id], operator: opLabel(o) };
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [operators, beams, accountFor]);

    const set = (id: string, patch: Partial<Row>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    const submit = async () => {
        const out: Record<string, BeamPrep> = {};
        for (const b of beams) {
            const r = rows[b.batch_id];
            const name = b.beam_number || '';
            if (!r.operator.trim()) { showToast(t('beam_prep_need_operator').replace('{beam}', name), 'danger'); return; }
            if (!r.prep_type) { showToast(t('beam_prep_need_type').replace('{beam}', name), 'danger'); return; }
            const ends = parseInt(r.ends, 10);
            if (!ends || ends <= 0) { showToast(t('beam_prep_need_ends').replace('{beam}', name), 'danger'); return; }
            const acct = accountFor(r.operator);
            out[b.batch_id] = {
                prep_type: r.prep_type,
                ends,
                operator_user_id: acct?.id || null,
                // The account's name is the snapshot when one matched; the typed
                // text otherwise — the only identity a worker without a login has.
                operator: acct ? (acct.full_name || acct.username) : r.operator.trim(),
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
                <datalist id={listId}>
                    {operators.map(o => <option key={o.id} value={opLabel(o)} />)}
                </datalist>
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
                            const acct = r.operator.trim() ? accountFor(r.operator) : null;
                            return (
                                <tr key={b.batch_id}>
                                    <td style={{ ...lvTd(), fontWeight: 'bold', whiteSpace: 'nowrap' }}>{b.beam_number || '—'}</td>
                                    <td style={lvTd()}>
                                        <input
                                            list={listId}
                                            value={r.operator}
                                            onChange={e => set(b.batch_id, { operator: e.target.value })}
                                            placeholder={t('beam_prep_operator_ph')}
                                            style={xpInput({ width: 220 })}
                                            autoFocus={b === beams[0]}
                                        />
                                        {r.operator.trim() && (
                                            <div style={{ fontSize: 9, color: acct ? '#1a5e1a' : '#8a5a00' }}>
                                                {acct ? t('beam_prep_has_account') : t('beam_prep_no_account')}
                                            </div>
                                        )}
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

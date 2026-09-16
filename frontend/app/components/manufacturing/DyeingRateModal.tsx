'use client';

import { useState, useEffect, useMemo } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../shared/Toast';
import { xpFont, xpInput, FormSection, FieldLabel, XPActionButton, familyColor } from '../shared/xpTheme';

const AMBER = familyColor('amber');

/**
 * The rate one dye batch is measured at.
 *
 * Separate from the Dyeing Orders create/complete forms because it is entered at a
 * different moment by a different person: whoever sets the machine up, before the
 * batch runs, rather than whoever records the shade afterwards.
 *
 * Two factors, not three. The speed is PICKED off the `Dyeing Speed` system
 * attribute rather than typed, because the old chain (rpm x the work center's reel
 * geometry x lines) was two numbers nobody at the vessel could verify and one that
 * read as a measurement when it was a typo. A free-entry row stays for a speed
 * nobody has added to the list yet — the backend takes any positive value — but the
 * list is the path, and it is curated on the Attributes page like every other
 * system attribute's values.
 */
export default function DyeingRateModal({ isOpen, run, onClose, onSaved, authFetch, apiBase }: {
    isOpen: boolean;
    run: any;
    onClose: () => void;
    onSaved: () => void;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    apiBase: string;
}) {
    const { t } = useLanguage();
    const { showToast } = useToast();
    // The speed list rides in on the attributes master load every page already
    // holds — a dedicated fetch for five numbers would be a second source of the
    // same rows.
    const { attributes } = useData();

    const [speed, setSpeed] = useState('');
    const [lines, setLines] = useState('');
    const [saving, setSaving] = useState(false);

    /** Curated speeds, numeric and ascending. Non-numeric values are skipped rather
     *  than shown: this attribute's values ARE numbers, and a stray label would
     *  produce a run with no rate at all. */
    const presets = useMemo(() => {
        const attr = (attributes || []).find((a: any) => a.system_role === 'dyeing_speed');
        return (attr?.values || [])
            .map((v: any) => ({ id: String(v.id), n: parseFloat(String(v.value).replace(',', '.')) }))
            .filter((v: any) => !isNaN(v.n) && v.n > 0)
            .sort((a: any, b: any) => a.n - b.n);
    }, [attributes]);

    // Re-seed whenever a different batch is opened. Without the `run.id` dependency
    // the second card opened would show the first one's numbers.
    useEffect(() => {
        if (!run) return;
        setSpeed(run.yards_per_min !== null && run.yards_per_min !== undefined ? String(run.yards_per_min) : '');
        setLines(run.lines ? String(run.lines) : '1');
    }, [run?.id]);

    const speedNum = Number(speed);
    const linesNum = Number(lines);
    // The rate the two factors actually produce, shown before it is saved: a speed
    // picked for the wrong vessel is caught here and not three hours later when the
    // card reads 900%.
    const derived = (speedNum > 0 && linesNum > 0) ? speedNum * linesNum : null;
    // A speed the floor typed (or one curated away since) still has to show as the
    // current value rather than silently falling back to the first preset.
    const isCustom = speed !== '' && !presets.some((p: any) => p.n === speedNum);

    const save = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${apiBase}/dyeing-runs/${run.id}/rate`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    yards_per_min: speed === '' ? null : Number(speed),
                    lines: lines === '' ? null : Number(lines),
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(typeof d?.detail === 'string' ? d.detail : t('rate_failed'), 'danger');
                return;
            }
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={`${t('set_rate')} — ${run?.wo_code || run?.mo_code || ''}`}
            size="sm"
            variant="primary"
            modeless
            footer={
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <XPActionButton tone="neutral" label={t('cancel')} onClick={onClose} />
                    <XPActionButton tone="primary" icon="bi-check-lg"
                        label={t('save')} disabled={saving} onClick={save} />
                </div>
            }
        >
            <div style={{ fontFamily: xpFont }}>
                <FormSection title={t('set_rate')}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                            <FieldLabel hint={t('speed_preset_hint')}>{t('yd_per_min')}</FieldLabel>
                            <select
                                value={isCustom ? '__custom' : speed}
                                onChange={e => { if (e.target.value !== '__custom') setSpeed(e.target.value); }}
                                style={xpInput()}
                            >
                                <option value="">—</option>
                                {presets.map((p: any) => (
                                    <option key={p.id} value={String(p.n)}>{p.n}</option>
                                ))}
                                {isCustom && <option value="__custom">{speed} ({t('custom')})</option>}
                            </select>
                        </div>
                        <div>
                            <FieldLabel>{t('lines')}</FieldLabel>
                            <input type="number" min="1" step="1" value={lines}
                                onChange={e => setLines(e.target.value)} style={xpInput()} />
                        </div>
                    </div>
                    {/* The escape hatch, deliberately below the picker and narrower than
                        it: a vessel run at a speed nobody has added to the list must
                        still be recordable, but the list is the path. */}
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#777' }}>
                        <span>{t('or_type_speed')}</span>
                        <input type="number" min="0" step="any" value={speed}
                            onChange={e => setSpeed(e.target.value)}
                            style={{ ...xpInput(), width: 70 }} />
                        {presets.length === 0 && (
                            <span style={{ color: AMBER }}>{t('no_speed_presets')}</span>
                        )}
                    </div>
                    <div style={{
                        marginTop: 8, paddingTop: 6, borderTop: '1px solid #c8c4b8',
                        display: 'flex', justifyContent: 'space-between', fontSize: 11,
                    }}>
                        <span style={{ color: '#888' }}>
                            {t('yd_per_min')} × {t('lines')}
                        </span>
                        <b style={{ color: derived ? '#333' : AMBER }}>
                            {derived !== null ? `${derived.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${t('yd_per_min')}` : '—'}
                        </b>
                    </div>
                </FormSection>
            </div>
        </ModalWrapper>
    );
}

'use client';

import { useState, useEffect } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../shared/Toast';
import { xpFont, xpInput, FormSection, FieldLabel, XPActionButton, familyColor } from '../shared/xpTheme';

const AMBER = familyColor('amber');

/**
 * The rate inputs one dye batch is judged against.
 *
 * Separate from the Dyeing Orders create/complete forms because it is entered at a
 * different moment by a different person: whoever sets the machine up, before the
 * batch runs, rather than whoever records the shade afterwards.
 *
 * `yards_per_rev` is deliberately NOT editable here — it is machine geometry, not a
 * per-batch choice, so it belongs on the work center in Routing. Showing it
 * read-only is what makes the derived rate below verifiable: a supervisor can see
 * all three factors and the yd/min they produce.
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

    const [rpm, setRpm] = useState('');
    const [lines, setLines] = useState('');
    const [target, setTarget] = useState('');
    const [saving, setSaving] = useState(false);

    // Re-seed whenever a different batch is opened. Without the `run.id` dependency
    // the second card opened would show the first one's numbers.
    useEffect(() => {
        if (!run) return;
        setRpm(run.rpm !== null && run.rpm !== undefined ? String(run.rpm) : '');
        setLines(run.lines ? String(run.lines) : '1');
        setTarget(run.target_efficiency_pct !== null && run.target_efficiency_pct !== undefined
            ? String(run.target_efficiency_pct) : '50');
    }, [run?.id]);

    const yardsPerRev = run?.machine?.yards_per_rev ?? run?.yards_per_rev ?? null;
    const rpmNum = Number(rpm);
    const linesNum = Number(lines);
    // The whole point of the read-only reel figure: show the rate the three factors
    // actually produce, so a mistyped rpm is caught here and not three hours later
    // when the card reads 900%.
    const derived = (yardsPerRev && rpmNum > 0 && linesNum > 0)
        ? rpmNum * Number(yardsPerRev) * linesNum
        : null;

    const save = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${apiBase}/dyeing-runs/${run.id}/rate`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rpm: rpm === '' ? null : Number(rpm),
                    lines: lines === '' ? null : Number(lines),
                    target_efficiency_pct: target === '' ? null : Number(target),
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

    const num = (value: string, set: (v: string) => void, min: string, step: string) => (
        <input
            type="number"
            min={min}
            step={step}
            value={value}
            onChange={e => set(e.target.value)}
            className={undefined}
            style={xpInput()}
        />
    );

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
                            <FieldLabel>{t('rpm')}</FieldLabel>
                            {num(rpm, setRpm, '0', '1')}
                        </div>
                        <div>
                            <FieldLabel>{t('lines')}</FieldLabel>
                            {num(lines, setLines, '1', '1')}
                        </div>
                        <div>
                            <FieldLabel>{t('target')} %</FieldLabel>
                            {num(target, setTarget, '1', '1')}
                        </div>
                        <div>
                            <FieldLabel hint={t('no_reel_measured_hint')}>
                                {t('yards_per_rev')}
                            </FieldLabel>
                            <div style={{
                                fontSize: 11, fontWeight: 'bold', paddingTop: 3,
                                color: yardsPerRev ? '#333' : '#8a6100',
                            }}>
                                {yardsPerRev ?? t('no_reel_measured')}
                            </div>
                        </div>
                    </div>
                    <div style={{
                        marginTop: 8, paddingTop: 6, borderTop: `1px solid ${'#c8c4b8'}`,
                        display: 'flex', justifyContent: 'space-between', fontSize: 11,
                    }}>
                        <span style={{ color: '#888' }}>
                            {t('rpm')} × {t('yards_per_rev')} × {t('lines')}
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

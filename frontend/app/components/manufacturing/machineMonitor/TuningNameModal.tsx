'use client';

// Asked when a loom enters Tuning: the tuner's name is what the Loom Tuning report
// (Production Output) lists. Free text — tuners are often floor workers with no
// login — with operator accounts offered as suggestions.
import React, { useEffect, useState } from 'react';
import ModalWrapper from '../../shared/ModalWrapper';
import { useData } from '../../../context/DataContext';
import { useLanguage } from '../../../context/LanguageContext';
import { xpBtn, XP_BTN } from '../../shared/xpTheme';
import { field as xpInputBase, BTN_TONES } from '@bryanadamg/terras-ui/styles';
import { API_BASE } from '../../shared/apiBase';

export default function TuningNameModal({ loomCode, onClose, onConfirm }: {
    loomCode: string;
    onClose: () => void;
    onConfirm: (name: string) => void;
}) {
    const { authFetch } = useData() as any;
    const { t } = useLanguage();
    const [name, setName] = useState('');
    const [names, setNames] = useState<string[]>([]);

    useEffect(() => {
        authFetch(`${API_BASE}/users/operators`)
            .then((r: Response) => (r.ok ? r.json() : []))
            .then((d: any[]) => setNames((d || []).map(o => o.full_name || o.username)))
            .catch(() => setNames([]));
    }, [authFetch]);

    const submit = () => { if (name.trim()) { onConfirm(name.trim()); onClose(); } };

    return (
        <ModalWrapper
            isOpen
            level={3}
            size="sm"
            onClose={onClose}
            title={<><i className="bi bi-sliders me-1" />{t('tuning')} · {loomCode}</>}
            footer={
                <>
                    <button className={XP_BTN} style={xpBtn()} onClick={onClose}>{t('cancel')}</button>
                    <button className={XP_BTN} style={xpBtn({ ...BTN_TONES.success, padding: '2px 14px' })}
                        onClick={submit} disabled={!name.trim()}>{t('tuning')}</button>
                </>
            }
        >
            <label style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>{t('tuning_who')}</label>
            <input
                autoFocus
                list="tuning-operators"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                style={xpInputBase({ width: '100%', boxSizing: 'border-box', padding: '0 4px' })}
            />
            <datalist id="tuning-operators">
                {names.map(n => <option key={n} value={n} />)}
            </datalist>
        </ModalWrapper>
    );
}

'use client';

// Who is tuning a loom — picked inline beside the Tuning button. Operator accounts
// are offered, and whatever is typed is offered back as one more option, since
// tuners are often floor workers with no login (same rule as the warp-prep picker).
// The value is the name itself: the Loom Tuning report stores names, not accounts.
import React, { useEffect, useState } from 'react';
import SearchableSelect, { ComboboxOption } from '@bryanadamg/terras-ui/components/Combobox';
import { useData } from '../../../context/DataContext';
import { useLanguage } from '../../../context/LanguageContext';
import { API_BASE } from '../../shared/apiBase';

/** Operator account names, fetched once by the screen that shows the pickers. */
export function useOperatorNames(enabled = true): string[] {
    const { authFetch } = useData() as any;
    const [names, setNames] = useState<string[]>([]);
    useEffect(() => {
        if (!enabled) return;
        authFetch(`${API_BASE}/users/operators`)
            .then((r: Response) => (r.ok ? r.json() : []))
            .then((d: any[]) => setNames((d || []).map(o => o.full_name || o.username)))
            .catch(() => setNames([]));
    }, [authFetch, enabled]);
    return names;
}

export default function TunerPicker({ names, value, onChange, style }: {
    names: string[];
    value: string;
    onChange: (name: string) => void;
    style?: React.CSSProperties;
}) {
    const { t } = useLanguage();
    const [term, setTerm] = useState('');
    const known = new Set(names.map(n => n.toLowerCase()));
    const typed = [term.trim(), value].filter((n, i, a) => n && !known.has(n.toLowerCase()) && a.indexOf(n) === i);
    const options: ComboboxOption[] = [
        ...typed.map(n => ({ value: n, label: n, subLabel: t('beam_prep_no_account') })),
        ...names.map(n => ({ value: n, label: n })),
    ];
    return (
        // The card behind opens the machine window on click — keep picks (the popup
        // bubbles through React's tree) from reaching it.
        <span onClick={e => e.stopPropagation()} style={{ display: 'inline-block', minWidth: 0, ...style }}>
            <SearchableSelect
                options={options}
                value={value}
                onChange={onChange}
                // '' arrives on close; keep the last term so a typed pick stays listed.
                onSearch={s => { if (s) setTerm(s); }}
                placeholder={t('tuning_who')}
                size="sm"
            />
        </span>
    );
}

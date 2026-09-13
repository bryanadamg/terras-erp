import React from 'react';
import { SearchField, ToolbarCount } from '../shared/shellTheme';

// Shared search bar for the PR / MO list tabs. The field itself is the app-wide
// SearchField — this component only owns the strip it sits in and the result tally.
export default function ManufacturingSearchBar({
    value, onChange, placeholder, total, filters, showCount, actions,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    total: number;
    /** Optional filter chips, rendered between the field and the tally. */
    filters?: React.ReactNode;
    /** Force the result tally on when a filter (not the search box) narrows the list. */
    showCount?: boolean;
    /** Rightmost action buttons (Create/Print/etc), pushed to the far edge. */
    actions?: React.ReactNode;
}) {
    return (
        <div className="no-print" style={{
            padding: '5px 8px',
            borderBottom: '1px solid #808080',
            background: '#ece9d8',
            display: 'flex', alignItems: 'center', gap: 8,
        }}>
            <SearchField classic value={value} onChange={onChange} placeholder={placeholder} width={320} grow />
            {filters}
            {(value || showCount) && (
                <ToolbarCount classic>
                    {total} result{total === 1 ? '' : 's'}
                </ToolbarCount>
            )}
            {actions && (
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                    {actions}
                </div>
            )}
        </div>
    );
}

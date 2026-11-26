import React from 'react';
import { SearchField } from '../shared/shellTheme';
import { Count as ToolbarCount } from '@bryanadamg/terras-ui/components/Window';
import { toolbar as xpToolbar } from '@bryanadamg/terras-ui/styles';

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
        <div className="no-print" style={xpToolbar({ padding: '5px 8px', gap: 8 })}>
            <SearchField value={value} onChange={onChange} placeholder={placeholder} width={320} grow />
            {filters}
            {(value || showCount) && (
                <ToolbarCount>
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

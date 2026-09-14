'use client';

/**
 * The quantity formula editor as a dialog, opened from the gear beside Apply in
 * the Production Run modal — the point at which a planner discovers the formula
 * is wrong is the point at which they are using it, and sending them to Settings
 * means abandoning a half-filled run.
 *
 * Level 2: it opens on top of the Production Run window, which is level 1.
 * The rule set it edits is plant-wide, not per-run, so `onSaved` hands the new
 * rules straight back for the open run to use without a refetch.
 */

import ModalWrapper from './ModalWrapper';
import { xpBtn, BTN_TONES, XP_BTN } from './xpTheme';
import { QtyFormulaRule } from './qtyFormula';
import { QtyFormulaEditorFields, useQtyFormulaEditor } from './QtyFormulaEditor';

export default function QtyFormulaModal({ isOpen, onClose, canEdit, onSaved }: {
    isOpen: boolean;
    onClose: () => void;
    canEdit: boolean;
    onSaved?: (rules: QtyFormulaRule[]) => void;
}) {
    const editor = useQtyFormulaEditor(onSaved);

    const hint: React.CSSProperties = { fontSize: 10, color: '#6b6558', marginTop: 3 };

    const btn = (label: string, onClick: () => void, tone?: React.CSSProperties, disabled = false) => (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={xpBtn({ ...(tone || {}), padding: '3px 14px' })}
            className={XP_BTN}
        >
            {label}
        </button>
    );

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            level={2}
            // Modeless like the run window under it: the formula is written
            // against the quantities on that form, so it has to be draggable
            // aside and leave the run readable rather than dimming it.
            modeless
            size="lg"
            title="Production Quantity Formula"
            footer={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
                    {canEdit && btn('Reset to default', editor.reset)}
                    {btn('Close', onClose)}
                    {canEdit && btn(
                        editor.saving ? 'Saving…' : 'Save Formula',
                        // Saving from here closes the dialog: the planner came for
                        // the run, not the formula. A failed save keeps it open so
                        // the message stays next to the field that caused it.
                        async () => { if (await editor.save()) onClose(); },
                        BTN_TONES.primary,
                        editor.saving || editor.hasErrors,
                    )}
                </div>
            }
        >
            <div style={{ padding: 8}}>
                <QtyFormulaEditorFields editor={editor} classic canEdit={canEdit} hint={hint} />
            </div>
        </ModalWrapper>
    );
}

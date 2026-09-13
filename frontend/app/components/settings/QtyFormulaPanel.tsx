'use client';

/**
 * Settings home of the plant-wide production quantity formula.
 *
 * The fields and the tester live in `shared/QtyFormulaEditor` because the same
 * editor opens from the gear beside Apply in the Production Run modal; this file
 * is only the Settings chrome around it (panel header, Reset action, Save row).
 */

import { useUser } from '../../context/UserContext';
import { xpBtn, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { QtyFormulaEditorFields, useQtyFormulaEditor } from '../shared/QtyFormulaEditor';
import SettingsPanel from './SettingsPanel';
import { settingsActions, settingsHint } from './settingsStyles';

export default function QtyFormulaPanel() {
    const { hasPermission } = useUser();
    const canEdit = hasPermission('admin.access');
    const editor = useQtyFormulaEditor();

    return (
        <SettingsPanel
            icon="bi-calculator"
            title="Production Quantity Formula"
            right={canEdit ? (
                <button
                    type="button"
                    onClick={editor.reset}
                    style={xpBtn({ padding: '2px 8px' })}
                    className={XP_BTN}
                >
                    <i className="bi bi-arrow-counterclockwise" style={{ marginRight: 4 }}></i>
                    Reset to default
                </button>
            ) : undefined}
        >
            <QtyFormulaEditorFields
                editor={editor}
                classic
                canEdit={canEdit}
                hint={settingsHint(true)}
            />

            {canEdit && !editor.loading && (
                <div style={settingsActions(true)}>
                    <button
                        type="button"
                        onClick={() => { editor.save(); }}
                        disabled={editor.saving || editor.hasErrors}
                        style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px' })}
                        className={XP_BTN}
                    >
                        <i className="bi bi-save" style={{ marginRight: 4 }}></i>
                        {editor.saving ? 'Saving…' : 'Save Formula'}
                    </button>
                </div>
            )}
        </SettingsPanel>
    );
}

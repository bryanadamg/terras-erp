'use client';

import { useState } from 'react';
import { useToast } from '../shared/Toast';
import { useTheme, UI_SCALES } from '../../context/ThemeContext';
import { useTimezone, AVAILABLE_TIMEZONES } from '../../context/TimezoneContext';
import { useUser } from '../../context/UserContext';
import { xpBtn, xpInput, FieldLabel, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { settingsActions, settingsCol, settingsColumns, settingsGrid, settingsHint } from './settingsStyles';
import SettingsPanel from './SettingsPanel';
import CompanyProfileView from './CompanyProfileView';
import QtyFormulaPanel from './QtyFormulaPanel';

export default function SettingsGeneralTab({
    appName, onUpdateAppName,
    companyProfile, onUpdateCompanyProfile, onUploadLogo,
}: any) {
    const { showToast } = useToast();
    const { hasPermission } = useUser();
    const isAdmin = hasPermission('admin.access');
    const { uiStyle: currentStyle, uiScale, setUiScale } = useTheme();
    const { timezone, setTimezone } = useTimezone();

    const [name, setName] = useState(appName);
    const [tz, setTz] = useState(timezone);
    const [scale, setScale] = useState(uiScale);

    const handleSubmitSystem = (e: React.FormEvent) => {
        e.preventDefault();
        if (onUpdateAppName && isAdmin) onUpdateAppName(name);
        setTimezone(tz);
        setUiScale(scale);
        showToast('System preferences updated!', 'success');
    };

    return (
        // Two independent forms with their own submit buttons, so they sit side
        // by side rather than stacked: a name field, two selects and a
        // logo+address block each used the full page width and neither filled it.
        <div style={settingsColumns}>
            <div style={settingsCol(400, 1)}>
                <SettingsPanel icon="bi-gear-fill" title="System Preferences">
                    <form onSubmit={handleSubmitSystem}>
                        <div style={settingsGrid()}>
                            <div>
                                <FieldLabel>Application Name</FieldLabel>
                                <input
                                    style={xpInput({ width: '100%' })}
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    disabled={!isAdmin}
                                />
                                {!isAdmin && (
                                    <div style={settingsHint()}>Only admins can change the application name.</div>
                                )}
                            </div>
                            <div>
                                <FieldLabel>Interface Scale</FieldLabel>
                                <select
                                    style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                                    value={scale}
                                    onChange={e => setScale(Number(e.target.value))}
                                >
                                    {UI_SCALES.map(s => (
                                        <option key={s} value={s}>
                                            {s}%{s === 80 ? ' (Default)' : ''}
                                        </option>
                                    ))}
                                </select>
                                <div style={settingsHint()}>
                                    Fits more rows on screen without browser zoom. Applies on this
                                    device; phones and printouts always render at 100%.
                                </div>
                            </div>
                            <div>
                                <FieldLabel>Display Timezone</FieldLabel>
                                <select
                                    style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                                    value={tz}
                                    onChange={e => setTz(e.target.value)}
                                >
                                    {AVAILABLE_TIMEZONES.map(z => (
                                        <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
                                    ))}
                                </select>
                                <div style={settingsHint()}>
                                    Dates &amp; times (e.g. stock ledger) display in this zone on this device.
                                </div>
                            </div>
                        </div>
                        <div style={settingsActions()}>
                            <button
                                type="submit"
                                style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px', display: 'flex', alignItems: 'center', gap: 4 })}
                                className={XP_BTN}
                            >
                                <i className="bi bi-save" style={{ marginRight: 4 }}></i>
                                Save Preferences
                            </button>
                        </div>
                    </form>
                </SettingsPanel>
            </div>

            {/* Company Profile (Admin Only). Wider basis: it carries a 200px logo
                well plus the address fields beside it. */}
            {hasPermission('admin.access') && (
                <div style={settingsCol(560, 1)}>
                    <CompanyProfileView
                        profile={companyProfile}
                        onUpdate={onUpdateCompanyProfile}
                        onUploadLogo={onUploadLogo}
                    />
                </div>
            )}

            {/* Full-bleed on its own row, under the two forms: it is a wide data
                table (four columns plus a tester), and the tab's rule is that
                those don't share a row — squeezed between two forms its
                expressions and its Makes column both had to shrink. */}
            <div style={{ ...settingsCol(520, 1), flexBasis: '100%' }}>
                <QtyFormulaPanel />
            </div>
        </div>
    );
}

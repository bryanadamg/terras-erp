'use client';

import { useState } from 'react';
import { useToast } from '../shared/Toast';
import { useTheme, UI_SCALES } from '../../context/ThemeContext';
import { useTimezone, AVAILABLE_TIMEZONES } from '../../context/TimezoneContext';
import { useUser } from '../../context/UserContext';
import { useRememberedTab } from '../../hooks/useRememberedTab';
import { xpBtn, xpFont, XP_BTN } from '../shared/xpTheme';
import { field as xpInput, BTN_TONES } from '@bryanadamg/terras-ui/styles';
import { FieldLabel } from '@bryanadamg/terras-ui/components/Field';
import { FilterChipBar } from '@bryanadamg/terras-ui/components/FilterChipBar';
import { settingsActions, settingsGrid, settingsHint } from './settingsStyles';
import CompanyProfileView from './CompanyProfileView';
import QtyFormulaPanel from './QtyFormulaPanel';
import { ProfileSection, PasswordSection } from './AccountSections';
import { MasterDetail, ListRow, DetailSection } from './settingsParts';

type GeneralSection = 'profile' | 'password' | 'display' | 'company' | 'production';

const SECTION_META: Record<GeneralSection, { title: string; icon: string }> = {
    profile: { title: 'Profile', icon: 'bi-person-fill' },
    password: { title: 'Password', icon: 'bi-key-fill' },
    display: { title: 'Display', icon: 'bi-laptop' },
    company: { title: 'Company', icon: 'bi-building' },
    production: { title: 'Production Rules', icon: 'bi-calculator' },
};

/** Small uppercase heading over a group of menu rows. */
function NavGroup({ icon, children }: { icon: string; children: React.ReactNode }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 10px 4px',
            fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b6558',
        }}>
            <i className={`bi ${icon}`} />{children}
        </div>
    );
}

/**
 * General — what used to be two tabs, regrouped by who a setting affects.
 *
 * "General" mixed this-browser-only preferences (scale, timezone) with
 * company-wide admin settings (company profile, production formula), and "My
 * Account" held the rest of the personal ones. One menu with a You group and a
 * Company group says which is which; anyone without `system_admin.edit` only
 * gets the You group, instead of a disabled name field and a read-only formula.
 */
export default function SettingsGeneralTab({
    appName, onUpdateAppName,
    companyProfile, onUpdateCompanyProfile, onUploadLogo,
}: any) {
    const { showToast } = useToast();
    const { hasPermission } = useUser();
    const isAdmin = hasPermission('system_admin.edit');
    const { uiScale, setUiScale } = useTheme();
    const { timezone, setTimezone, formatDateTime } = useTimezone();

    const sections: GeneralSection[] = isAdmin
        ? ['profile', 'password', 'display', 'company', 'production']
        : ['profile', 'password', 'display'];
    const [section, setSection] = useRememberedTab<GeneralSection>('settings.general', 'profile', sections);

    const [name, setName] = useState(appName);

    const saveAppName = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdateAppName?.(name);
        showToast('Application name updated!', 'success');
    };

    const navRow = (key: GeneralSection) => (
        <ListRow key={key} selected={section === key} onClick={() => setSection(key)}>
            <i className={`bi ${SECTION_META[key].icon}`} />
            <span style={{ flex: 1 }}>{SECTION_META[key].title}</span>
            {key === 'display' && <span style={{ fontSize: 9, opacity: 0.7 }}>this device</span>}
        </ListRow>
    );

    const body: Record<GeneralSection, React.ReactNode> = {
        profile: <ProfileSection />,
        password: <PasswordSection />,
        display: (
            <DetailSection title={<>Display <span style={{ fontWeight: 'normal', textTransform: 'none', letterSpacing: 0, color: '#888' }}>· this device only, applied as you change it</span></>}>
                {/* Both live in this browser's storage, so they apply on change —
                    a Save button suggested they went to the server for everyone. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
                    <div>
                        <FieldLabel>Interface Scale</FieldLabel>
                        <FilterChipBar
                            ariaLabel="Interface scale"
                            options={UI_SCALES.map(s => ({ value: String(s), label: `${s}%${s === 80 ? ' · default' : ''}` }))}
                            value={String(uiScale)}
                            onChange={v => setUiScale(Number(v))}
                        />
                        <div style={settingsHint()}>Fits more rows on screen without browser zoom. Phones and printouts always render at 100%.</div>
                    </div>
                    <div style={{ maxWidth: 360 }}>
                        <FieldLabel>Display Timezone</FieldLabel>
                        <select
                            style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                            value={timezone}
                            onChange={e => setTimezone(e.target.value)}
                        >
                            {AVAILABLE_TIMEZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                        </select>
                        <div style={settingsHint()}>
                            Now: <b>{formatDateTime(new Date())}</b>. Dates &amp; times (e.g. stock ledger) display in this zone on this device.
                        </div>
                    </div>
                </div>
            </DetailSection>
        ),
        company: (
            <>
                <CompanyProfileView profile={companyProfile} onUpdate={onUpdateCompanyProfile} onUploadLogo={onUploadLogo} />
                <form onSubmit={saveAppName}>
                    <DetailSection title="Application">
                        <div style={{ ...settingsGrid(220), maxWidth: 760 }}>
                            <div>
                                <FieldLabel>Application Name</FieldLabel>
                                <input style={xpInput({ width: '100%' })} value={name} onChange={e => setName(e.target.value)} />
                                {/* ponytail: stored in localStorage by settings/page.tsx; a server-side setting if it must apply to everyone. */}
                                <div style={settingsHint()}>Title bar and login screen. Saved in this browser for now.</div>
                            </div>
                        </div>
                        <div style={{ ...settingsActions(), maxWidth: 760 }}>
                            <button type="submit" style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px' })} className={XP_BTN}>
                                <i className="bi bi-save" style={{ marginRight: 4 }} />Save Name
                            </button>
                        </div>
                    </DetailSection>
                </form>
            </>
        ),
        production: <QtyFormulaPanel />,
    };

    return (
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <MasterDetail
                icon={SECTION_META[section].icon}
                title={SECTION_META[section].title}
                listWidth={200}
                list={
                    <nav aria-label="General settings sections" style={{ overflow: 'auto' }}>
                        <NavGroup icon="bi-person">You</NavGroup>
                        {(['profile', 'password', 'display'] as GeneralSection[]).map(navRow)}
                        {isAdmin && (
                            <>
                                <NavGroup icon="bi-building">Company</NavGroup>
                                {(['company', 'production'] as GeneralSection[]).map(navRow)}
                            </>
                        )}
                    </nav>
                }
                detail={body[section]}
            />
        </div>
    );
}

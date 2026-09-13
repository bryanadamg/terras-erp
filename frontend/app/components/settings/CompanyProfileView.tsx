import { useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { STATIC_BASE as API_BASE } from '../shared/apiBase';
import { xpBtn, xpInput, FieldLabel, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { settingsActions, settingsGrid, settingsHint, SETTINGS_FIELD_GAP } from './settingsStyles';
import SettingsPanel from './SettingsPanel';

export default function CompanyProfileView({ profile, onUpdate, onUploadLogo, authFetch }: any) {
    const { showToast } = useToast();
    const [editProfile, setEditProfile] = useState({
        name: '',
        address: '',
        phone: '',
        email: '',
        website: '',
        tax_id: ''
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);


    useEffect(() => {
        if (profile) {
            setEditProfile({
                name: profile.name || '',
                address: profile.address || '',
                phone: profile.phone || '',
                email: profile.email || '',
                website: profile.website || '',
                tax_id: profile.tax_id || ''
            });
        }
    }, [profile]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onUpdate(editProfile);
            showToast('Company profile updated!', 'success');
        } catch (e) {
            showToast('Failed to update profile', 'danger');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', e.target.files[0]);
            await onUploadLogo(formData);
            showToast('Logo uploaded successfully!', 'success');
        } catch (e) {
            showToast('Failed to upload logo', 'danger');
        } finally {
            setIsUploading(false);
        }
    };

    const inputStyle = xpInput({ width: '100%' });
    const inputClass = '';

    return (
        <SettingsPanel
            icon="bi-building"
            title="Company Profile"
            right="Used on printed document headers"
        >
            <form onSubmit={handleSubmit}>
                {/* Logo is one decision and the address block is another, so they
                    sit side by side and wrap as a unit — not as a bootstrap
                    column with a border hung off its edge. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 200, flexShrink: 0 }}>
                        <FieldLabel classic>Company Logo</FieldLabel>
                        <div style={{
                            border: '1px solid #7f9db9',
                            borderRadius: 0,
                            background: '#ffffff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: 132, marginBottom: 6, padding: 8,
                        }}>
                            {profile?.logo_url ? (
                                <img src={`${API_BASE}${profile.logo_url}`} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                            ) : (
                                <span style={settingsHint(true)}>No logo uploaded</span>
                            )}
                        </div>
                        <label
                            style={xpBtn({ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 })}
                        >
                            {isUploading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-upload"></i>}
                            <span style={{ marginLeft: 4 }}>Upload Logo</span>
                            <input type="file" hidden onChange={handleLogoUpload} disabled={isUploading} accept="image/*" />
                        </label>
                        <div style={settingsHint(true)}>Transparent PNG, around 300 × 100 px.</div>
                    </div>

                    <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: SETTINGS_FIELD_GAP }}>
                        <div>
                            <FieldLabel classic>Company Name</FieldLabel>
                            <input style={inputStyle} className={inputClass} value={editProfile.name} onChange={e => setEditProfile({ ...editProfile, name: e.target.value })} required />
                        </div>
                        <div>
                            <FieldLabel classic>Address</FieldLabel>
                            <textarea
                                style={xpInput({ width: '100%', height: 'auto', padding: '4px 6px', resize: 'vertical' as const })}
                                className={inputClass}
                                rows={2}
                                value={editProfile.address}
                                onChange={e => setEditProfile({ ...editProfile, address: e.target.value })}
                            />
                        </div>
                        <div style={settingsGrid(160)}>
                            <div>
                                <FieldLabel classic>Phone</FieldLabel>
                                <input style={inputStyle} className={inputClass} value={editProfile.phone} onChange={e => setEditProfile({ ...editProfile, phone: e.target.value })} />
                            </div>
                            <div>
                                <FieldLabel classic>Email</FieldLabel>
                                <input type="email" style={inputStyle} className={inputClass} value={editProfile.email} onChange={e => setEditProfile({ ...editProfile, email: e.target.value })} />
                            </div>
                            <div>
                                <FieldLabel classic>Website</FieldLabel>
                                <input style={inputStyle} className={inputClass} value={editProfile.website} onChange={e => setEditProfile({ ...editProfile, website: e.target.value })} />
                            </div>
                            <div>
                                <FieldLabel classic>Tax ID / NPWP</FieldLabel>
                                <input style={inputStyle} className={inputClass} value={editProfile.tax_id} onChange={e => setEditProfile({ ...editProfile, tax_id: e.target.value })} />
                            </div>
                        </div>
                    </div>
                </div>

                <div style={settingsActions(true)}>
                    <button
                        type="submit"
                        style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px', display: 'flex', alignItems: 'center', gap: 4 })}
                        className={XP_BTN}
                        disabled={isSaving}
                    >
                        {isSaving ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-save"></i>}
                        <span style={{ marginLeft: 4 }}>Save Profile</span>
                    </button>
                </div>
            </form>
        </SettingsPanel>
    );
}

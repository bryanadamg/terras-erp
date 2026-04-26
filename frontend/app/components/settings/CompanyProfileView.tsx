import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useTheme } from '../context/ThemeContext';

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

    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';

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

    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace('/api', '');

    const xpBevel: React.CSSProperties = {
        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
        marginBottom: 16,
    };
    const xpTitleBar: React.CSSProperties = {
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
        color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
        padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
        borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', minHeight: '26px',
    };
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px',
        cursor: 'pointer', background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
        border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        color: '#000000', borderRadius: 0, ...extra,
    });
    const xpInput: React.CSSProperties = {
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 6px',
        background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
    };

    return (
        <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0 mb-4'}>
            {classic ? (
                <div style={xpTitleBar}>
                    <span><i className="bi bi-building" style={{ marginRight: 6 }}></i>Company Profile</span>
                    <span style={{ background: '#1a5e1a', border: '1px solid #0a3e0a', color: '#fff', padding: '1px 6px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif', fontWeight: 'bold' }}>Print Header Info</span>
                </div>
            ) : (
                <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="card-title mb-0"><i className="bi bi-building me-2"></i>Company Profile</h5>
                    <span className="badge bg-primary">Print Header Info</span>
                </div>
            )}
            {classic ? (
                <div style={{ padding: '12px 14px', background: '#ece9d8' }}>
                    <div className="row g-0">
                        <div className="col-md-4" style={{ paddingRight: 12, borderRight: '1px solid #c0bdb5', textAlign: 'center' }}>
                            <div style={{ marginBottom: 8 }}>
                                <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Company Logo</label>
                                <div style={{ border: '1px solid #7f9db9', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150, marginBottom: 6 }}>
                                    {profile?.logo_url ? (
                                        <img src={`${API_BASE}${profile.logo_url}`} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    ) : (
                                        <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#888' }}>No Logo Uploaded</span>
                                    )}
                                </div>
                                <label style={xpBtn({ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 })}>
                                    {isUploading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-upload"></i>}
                                    Upload Logo
                                    <input type="file" hidden onChange={handleLogoUpload} disabled={isUploading} accept="image/*" />
                                </label>
                                <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '9px', color: '#888', marginTop: 4 }}>Recommended: Transparent PNG, 300x100px</div>
                            </div>
                        </div>
                        <div className="col-md-8" style={{ paddingLeft: 12 }}>
                            <form onSubmit={handleSubmit}>
                                <div style={{ marginBottom: 8 }}>
                                    <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Company Name</label>
                                    <input style={{ ...xpInput, width: '100%' }} value={editProfile.name} onChange={e => setEditProfile({ ...editProfile, name: e.target.value })} required />
                                </div>
                                <div style={{ marginBottom: 8 }}>
                                    <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Address</label>
                                    <textarea style={{ ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const }} rows={2} value={editProfile.address} onChange={e => setEditProfile({ ...editProfile, address: e.target.value })}></textarea>
                                </div>
                                <div className="row g-0" style={{ marginBottom: 8 }}>
                                    <div className="col-md-6" style={{ paddingRight: 4 }}>
                                        <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Phone</label>
                                        <input style={{ ...xpInput, width: '100%' }} value={editProfile.phone} onChange={e => setEditProfile({ ...editProfile, phone: e.target.value })} />
                                    </div>
                                    <div className="col-md-6" style={{ paddingLeft: 4 }}>
                                        <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Email</label>
                                        <input type="email" style={{ ...xpInput, width: '100%' }} value={editProfile.email} onChange={e => setEditProfile({ ...editProfile, email: e.target.value })} />
                                    </div>
                                </div>
                                <div className="row g-0" style={{ marginBottom: 8 }}>
                                    <div className="col-md-6" style={{ paddingRight: 4 }}>
                                        <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Website</label>
                                        <input style={{ ...xpInput, width: '100%' }} value={editProfile.website} onChange={e => setEditProfile({ ...editProfile, website: e.target.value })} />
                                    </div>
                                    <div className="col-md-6" style={{ paddingLeft: 4 }}>
                                        <label style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 }}>Tax ID / NPWP</label>
                                        <input style={{ ...xpInput, width: '100%' }} value={editProfile.tax_id} onChange={e => setEditProfile({ ...editProfile, tax_id: e.target.value })} />
                                    </div>
                                </div>
                                <button type="submit" style={xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold', width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 10px' })} disabled={isSaving}>
                                    {isSaving ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-save"></i>}
                                    Save Profile
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="card-body">
                    <div className="row g-4">
                        <div className="col-md-4 text-center border-end">
                            <div className="mb-3">
                                <label className="small fw-bold text-muted d-block mb-2">Company Logo</label>
                                <div className="border rounded p-3 mb-3 bg-light d-flex align-items-center justify-content-center" style={{ height: '150px' }}>
                                    {profile?.logo_url ? (
                                        <img src={`${API_BASE}${profile.logo_url}`} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    ) : (
                                        <div className="text-muted small italic">No Logo Uploaded</div>
                                    )}
                                </div>
                                <label className="btn btn-sm btn-outline-primary w-100">
                                    {isUploading ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-upload me-1"></i>}
                                    Upload Logo
                                    <input type="file" hidden onChange={handleLogoUpload} disabled={isUploading} accept="image/*" />
                                </label>
                                <div className="extra-small text-muted mt-2">Recommended: Transparent PNG, 300x100px</div>
                            </div>
                        </div>
                        <div className="col-md-8">
                            <form onSubmit={handleSubmit}>
                                <div className="row g-3">
                                    <div className="col-md-12">
                                        <label className="form-label small fw-bold">Company Name</label>
                                        <input className="form-control" value={editProfile.name} onChange={e => setEditProfile({ ...editProfile, name: e.target.value })} required />
                                    </div>
                                    <div className="col-md-12">
                                        <label className="form-label small fw-bold">Address</label>
                                        <textarea className="form-control" rows={2} value={editProfile.address} onChange={e => setEditProfile({ ...editProfile, address: e.target.value })}></textarea>
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold">Phone</label>
                                        <input className="form-control" value={editProfile.phone} onChange={e => setEditProfile({ ...editProfile, phone: e.target.value })} />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold">Email</label>
                                        <input type="email" className="form-control" value={editProfile.email} onChange={e => setEditProfile({ ...editProfile, email: e.target.value })} />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold">Website</label>
                                        <input className="form-control" value={editProfile.website} onChange={e => setEditProfile({ ...editProfile, website: e.target.value })} />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold">Tax ID / NPWP</label>
                                        <input className="form-control" value={editProfile.tax_id} onChange={e => setEditProfile({ ...editProfile, tax_id: e.target.value })} />
                                    </div>
                                </div>
                                <button type="submit" className="btn btn-primary w-100 mt-4" disabled={isSaving}>
                                    {isSaving ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-save me-1"></i>}
                                    Save Profile
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

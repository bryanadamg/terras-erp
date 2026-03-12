import { useState, useEffect } from 'react';
import { useToast } from './Toast';

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

    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace('/api', '');

    return (
        <div className="card shadow-sm border-0 mb-4">
            <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <h5 className="card-title mb-0"><i className="bi bi-building me-2"></i>Company Profile</h5>
                <span className="badge bg-primary">Print Header Info</span>
            </div>
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
        </div>
    );
}

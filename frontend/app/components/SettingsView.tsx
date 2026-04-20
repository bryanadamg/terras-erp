import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useTheme } from '../context/ThemeContext';
import { useUser, User } from '../context/UserContext';
import CompanyProfileView from './CompanyProfileView';
import PixelAvatar from './PixelAvatar';
import AvatarPicker from './AvatarPicker';

export default function SettingsView({
    appName, onUpdateAppName, uiStyle, onUpdateUIStyle, requestConfirm,
    companyProfile, onUpdateCompanyProfile, onUploadLogo
}: any) {
  const { showToast } = useToast();
  const { currentUser, users, setCurrentUser, hasPermission, refreshUsers } = useUser();

  const [name, setName] = useState(appName);
  const [style, setStyle] = useState(uiStyle || currentStyle || 'classic');
  const [roles, setRoles] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);

  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';

  // Database Management State
  const [currentDbUrl, setCurrentDbUrl] = useState('');
  const [newDbUrl, setNewDbUrl] = useState('');
  const [dbProfiles, setDbProfiles] = useState<any[]>([]);
  const [isDbLoading, setIsDbLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);

  // Self-Service Account State
  const [selfUsername, setSelfUsername] = useState('');
  const [selfFullName, setSelfFullName] = useState('');
  const [selfPassword, setSelfPassword] = useState('');
  const [selfConfirmPassword, setSelfConfirmPassword] = useState('');
  const [selfAvatarId, setSelfAvatarId] = useState<string>('1');

  // User Management State (Admin)
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editName, setEditName] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editPermissionIds, setEditPermissionIds] = useState<string[]>([]);
  const [editAllowedCategories, setEditAllowedCategories] = useState<string[]>([]);
  const [editAvatarId, setEditAvatarId] = useState<string>('1');
  const [newPassword, setNewPassword] = useState('');

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

  // ── XP shared inline styles ────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = {
      border: '2px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
      background: '#ece9d8',
      borderRadius: 0,
      marginBottom: 16,
  };

  const xpTitleBar = (gradient = 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', border = '#003080'): React.CSSProperties => ({
      background: gradient,
      color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '12px',
      fontWeight: 'bold',
      padding: '4px 8px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: `1px solid ${border}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: '26px',
  });

  const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      padding: '2px 10px',
      cursor: 'pointer',
      background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
      border: '1px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      color: '#000000',
      borderRadius: 0,
      ...extra,
  });

  const xpInput: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
      padding: '1px 6px',
      background: '#ffffff',
      color: '#000000',
      height: '20px',
      outline: 'none',
  };

  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
      borderBottom: '2px solid #808080',
      fontSize: '10px',
      fontWeight: 'bold',
      color: '#000000',
  };

  const xpThCell: React.CSSProperties = {
      padding: '3px 6px',
      borderRight: '1px solid #b0aaa0',
      textAlign: 'left' as const,
      whiteSpace: 'nowrap' as const,
      fontFamily: 'Tahoma, Arial, sans-serif',
  };

  const tdBase: React.CSSProperties = {
      padding: '4px 6px',
      borderRight: '1px solid #c0bdb5',
      borderBottom: '1px solid #d0cdc8',
      verticalAlign: 'top' as const,
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
  };

  const xpLabel: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      color: '#000',
      display: 'block',
      marginBottom: 2,
  };

  const xpSectionHead: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '10px',
      fontWeight: 'bold',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      color: '#555',
      borderBottom: '1px solid #c0bdb5',
      paddingBottom: 3,
      marginBottom: 8,
  };

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchDbInfo = async () => {
      try {
          const res = await fetch(`${API_BASE}/admin/database/current`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
          });
          if (res.ok) {
              const data = await res.json();
              setCurrentDbUrl(data.data.url);
          }
      } catch (e) { console.error("DB info fetch failed", e); }
  };

  useEffect(() => {
      if (currentUser) {
          setSelfUsername(currentUser.username);
          setSelfFullName(currentUser.full_name);
          setSelfAvatarId(currentUser.avatar_id || '1');
      }
      Promise.all([
          fetch(`${API_BASE}/roles`).then(res => res.json()),
          fetch(`${API_BASE}/permissions`).then(res => res.json()),
          fetch(`${API_BASE}/categories`).then(res => res.json())
      ]).then(([rolesData, permsData, catsData]) => {
          setRoles(rolesData);
          setAllPermissions(permsData);
          setAllCategories(catsData);
      }).catch(err => console.error("Failed to fetch auth data", err));

      if (hasPermission('admin.access')) {
          refreshUsers();
          fetchDbInfo();
          fetchSnapshots();
          const savedProfiles = localStorage.getItem('terras_db_profiles');
          if (savedProfiles) setDbProfiles(JSON.parse(savedProfiles));
      }
  }, [currentUser]);

  const handleSwitchDatabase = async (url: string) => {
      setIsDbLoading(true);
      try {
          const res = await fetch(`${API_BASE}/admin/database/switch`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('access_token')}`
              },
              body: JSON.stringify({ name: 'Manual Switch', url })
          });
          if (res.ok) {
              showToast('Database switched and initialized!', 'success');
              if (!dbProfiles.some(p => p.url === url)) {
                  const newProfiles = [...dbProfiles, { name: `DB ${dbProfiles.length + 1}`, url }];
                  setDbProfiles(newProfiles);
                  localStorage.setItem('terras_db_profiles', JSON.stringify(newProfiles));
              }
              window.location.reload();
          } else {
              const err = await res.json();
              showToast(`Switch failed: ${err.detail}`, 'danger');
          }
      } catch (e) {
          showToast('Network error during DB switch', 'danger');
      } finally {
          setIsDbLoading(false);
      }
  };

  const fetchSnapshots = async () => {
      try {
          const res = await fetch(`${API_BASE}/admin/database/snapshots`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
          });
          if (res.ok) setSnapshots(await res.json());
      } catch (e) { console.error("Snapshot fetch failed", e); }
  };

  const handleCreateSnapshot = async () => {
      setIsSnapshotLoading(true);
      try {
          const res = await fetch(`${API_BASE}/admin/database/snapshots`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
          });
          if (res.ok) {
              showToast('Snapshot created successfully', 'success');
              fetchSnapshots();
          }
      } catch (e) { showToast('Failed to create snapshot', 'danger'); }
      finally { setIsSnapshotLoading(false); }
  };

  const handleDownloadSnapshot = async (filename: string) => {
      try {
          const res = await fetch(`${API_BASE}/admin/database/snapshots/${filename}/download`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
          });
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
      } catch (e) { showToast('Download failed', 'danger'); }
  };

  const handleRestoreSnapshot = async (filename: string) => {
      requestConfirm('Restore Snapshot?', `Are you sure you want to restore "${filename}"? Current data will be overwritten.`, async () => {
          setIsSnapshotLoading(true);
          try {
              const res = await fetch(`${API_BASE}/admin/database/snapshots/${filename}/restore`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
              });
              if (res.ok) {
                  showToast('Database restored successfully!', 'success');
                  window.location.reload();
              } else {
                  const err = await res.json();
                  showToast(`Restore failed: ${err.detail}`, 'danger');
              }
          } catch (e) { showToast('Restore failed', 'danger'); }
          finally { setIsSnapshotLoading(false); }
      });
  };

  const handleUploadSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.[0]) return;
      const file = e.target.files[0];
      const formData = new FormData();
      formData.append('file', file);
      setIsSnapshotLoading(true);
      try {
          const res = await fetch(`${API_BASE}/admin/database/snapshots/upload`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
              body: formData
          });
          if (res.ok) {
              showToast('Snapshot uploaded!', 'success');
              fetchSnapshots();
          }
      } catch (e) { showToast('Upload failed', 'danger'); }
      finally { setIsSnapshotLoading(false); }
  };

  const handleSubmitSystem = (e: React.FormEvent) => {
      e.preventDefault();
      if (onUpdateAppName) onUpdateAppName(name);
      if (onUpdateUIStyle) onUpdateUIStyle(style);
      showToast('System preferences updated!', 'success');
  };

  const handleSelfAccountUpdate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentUser) return;
      const payload: any = { username: selfUsername, full_name: selfFullName, avatar_id: selfAvatarId };
      if (selfPassword) {
          if (selfPassword !== selfConfirmPassword) {
              showToast('Passwords do not match', 'warning');
              return;
          }
          payload.password = selfPassword;
      }
      try {
          const res = await fetch(`${API_BASE}/users/${currentUser.id}`, {
              method: 'PUT',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('access_token')}`
              },
              body: JSON.stringify(payload)
          });
          if (res.ok) {
              const updatedUser = await res.json();
              setCurrentUser(updatedUser);
              showToast('Account updated successfully', 'success');
              setSelfPassword('');
              setSelfConfirmPassword('');
          } else {
              const err = await res.json();
              showToast(`Failed: ${err.detail}`, 'danger');
          }
      } catch (error) {
          showToast('Error updating account', 'danger');
      }
  };

  const startEditingUser = (user: User) => {
      setEditingUser(user.id);
      setEditUsername(user.username);
      setEditName(user.full_name);
      setEditRoleId(user.role?.id || '');
      setEditPermissionIds(user.permissions?.map(p => p.id) || []);
      setEditAllowedCategories(user.allowed_categories || []);
      setEditAvatarId(user.avatar_id || '1');
      setNewPassword('');
  };

  const toggleEditPermission = (permId: string) => {
      setEditPermissionIds(prev =>
          prev.includes(permId) ? prev.filter(id => id !== permId) : [...prev, permId]
      );
  };

  const toggleEditCategory = (catName: string) => {
      setEditAllowedCategories(prev =>
          prev.includes(catName) ? prev.filter(c => c !== catName) : [...prev, catName]
      );
  };

  const saveUserChanges = async (userId: string) => {
      try {
          const payload: any = {
              username: editUsername,
              full_name: editName,
              role_id: editRoleId || null,
              permission_ids: editPermissionIds,
              allowed_categories: editAllowedCategories.length > 0 ? editAllowedCategories : null,
              avatar_id: editAvatarId,
          };
          if (newPassword) payload.password = newPassword;
          const res = await fetch(`${API_BASE}/users/${userId}`, {
              method: 'PUT',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('access_token')}`
              },
              body: JSON.stringify(payload)
          });
          if (res.ok) {
              const updated = await res.json();
              showToast('User updated successfully!', 'success');
              if (currentUser?.id === userId) setCurrentUser(updated);
              setEditingUser(null);
              setNewPassword('');
              refreshUsers();
          } else {
              const err = await res.json();
              showToast(`Failed: ${err.detail}`, 'danger');
          }
      } catch (e) {
          console.error(e);
          showToast('Error updating user', 'danger');
      }
  };

  return (
    <div className="row justify-content-center fade-in">
      <div className="col-md-10">

        {/* ── System Preferences ─────────────────────────────────────────────── */}
        <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0 mb-4'}>
          {classic ? (
              <div style={xpTitleBar()}>
                  <span><i className="bi bi-gear-fill" style={{ marginRight: 6 }}></i>System Preferences</span>
              </div>
          ) : (
              <div className="card-header bg-white">
                  <h5 className="card-title mb-0">System Preferences</h5>
              </div>
          )}
          <div style={classic ? { padding: '12px 14px', background: '#ece9d8' } : undefined} className={classic ? '' : 'card-body'}>
              <form onSubmit={handleSubmitSystem}>
                  <div className="row">
                      <div className="col-md-6 mb-3">
                          <label
                              style={classic ? xpLabel : undefined}
                              className={classic ? '' : 'form-label'}
                          >Application Name</label>
                          <input
                              style={classic ? { ...xpInput, width: '100%' } : undefined}
                              className={classic ? '' : 'form-control'}
                              value={name}
                              onChange={e => setName(e.target.value)}
                          />
                      </div>
                      <div className="col-md-6 mb-3">
                          <label
                              style={classic ? xpLabel : undefined}
                              className={classic ? '' : 'form-label'}
                          >Interface Style</label>
                          <select
                              style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%' } : undefined}
                              className={classic ? '' : 'form-select'}
                              value={style}
                              onChange={e => setStyle(e.target.value)}
                          >
                              <option value="default">Default (Corporate)</option>
                              <option value="modern">Modern (Rounded)</option>
                              <option value="compact">Compact (High Density)</option>
                              <option value="classic">Classic (Windows XP)</option>
                          </select>
                      </div>
                  </div>
                  <button
                      type="submit"
                      style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold', width: '100%', padding: '4px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }) : undefined}
                      className={classic ? '' : 'btn btn-primary w-100'}
                  >
                      <i className="bi bi-save" style={classic ? { marginRight: 4 } : undefined}></i>
                      {classic ? '' : ''}Save Preferences
                  </button>
              </form>
          </div>
        </div>

        {/* ── Company Profile (Admin Only) ────────────────────────────────────── */}
        {hasPermission('admin.access') && (
            <CompanyProfileView
                profile={companyProfile}
                onUpdate={onUpdateCompanyProfile}
                onUploadLogo={onUploadLogo}
            />
        )}

        {/* ── Account Settings ────────────────────────────────────────────────── */}
        <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0 mb-4'}>
            {classic ? (
                <div style={xpTitleBar('linear-gradient(to right, #006e8e 0%, #00a8c8 100%)', '#004a5e')}>
                    <span><i className="bi bi-person-fill" style={{ marginRight: 6 }}></i>Account Settings</span>
                </div>
            ) : (
                <div className="card-header bg-white">
                    <h5 className="card-title mb-0">Account Settings</h5>
                </div>
            )}
            <div style={classic ? { padding: '12px 14px', background: '#ece9d8' } : undefined} className={classic ? '' : 'card-body'}>
                <form onSubmit={handleSelfAccountUpdate}>
                    <div style={classic ? { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 } : { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <div style={classic ? { width: 56, height: 56, border: '2px solid', borderColor: '#fff #888 #888 #fff', background: '#e0dcd4', display: 'flex', alignItems: 'center', justifyContent: 'center' } : { width: 60, height: 60, border: '2px solid #dee2e6', borderRadius: 8, background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <PixelAvatar avatarId={selfAvatarId} size={48} />
                            </div>
                            <span style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: 9, color: '#555' } : { fontSize: 10, color: '#888' }}>Preview</span>
                        </div>
                        <div>
                            <label style={classic ? xpLabel : { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' }}>Choose Avatar</label>
                            <AvatarPicker value={selfAvatarId} onChange={setSelfAvatarId} classic={classic} />
                        </div>
                    </div>
                    <div className="row">
                        <div className="col-md-6 mb-3">
                            <label style={classic ? xpLabel : undefined} className={classic ? '' : 'form-label'}>Username</label>
                            <input
                                style={classic ? { ...xpInput, width: '100%' } : undefined}
                                className={classic ? '' : 'form-control'}
                                value={selfUsername}
                                onChange={e => setSelfUsername(e.target.value)}
                                required
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label style={classic ? xpLabel : undefined} className={classic ? '' : 'form-label'}>Full Name</label>
                            <input
                                style={classic ? { ...xpInput, width: '100%' } : undefined}
                                className={classic ? '' : 'form-control'}
                                value={selfFullName}
                                onChange={e => setSelfFullName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label
                                style={classic ? { ...xpLabel, color: '#8b0000' } : undefined}
                                className={classic ? '' : 'form-label text-danger'}
                            >New Password <span style={classic ? { color: '#666', fontWeight: 'normal' } : undefined} className={classic ? '' : ''}>(leave blank to keep current)</span></label>
                            <input
                                type="password"
                                style={classic ? { ...xpInput, width: '100%', borderColor: '#cc6666' } : undefined}
                                className={classic ? '' : 'form-control border-danger border-opacity-25'}
                                value={selfPassword}
                                onChange={e => setSelfPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label
                                style={classic ? { ...xpLabel, color: '#8b0000' } : undefined}
                                className={classic ? '' : 'form-label text-danger'}
                            >Confirm New Password</label>
                            <input
                                type="password"
                                style={classic ? { ...xpInput, width: '100%', borderColor: '#cc6666' } : undefined}
                                className={classic ? '' : 'form-control border-danger border-opacity-25'}
                                value={selfConfirmPassword}
                                onChange={e => setSelfConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #006e8e, #004a5e)', borderColor: '#004a5e #001a2e #001a2e #004a5e', color: '#ffffff', fontWeight: 'bold', width: '100%', padding: '4px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }) : undefined}
                        className={classic ? '' : 'btn btn-outline-primary w-100 mt-2'}
                    >Update My Profile &amp; Security</button>
                </form>
            </div>
        </div>

        {/* ── Admin Sections ──────────────────────────────────────────────────── */}
        {hasPermission('admin.access') && (
            <>
            {/* Database Infrastructure */}
            <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0 mb-4 border-start border-4 border-info'}>
                {classic ? (
                    <div style={xpTitleBar('linear-gradient(to right, #006e8e 0%, #00a8c8 100%)', '#004a5e')}>
                        <span><i className="bi bi-database-fill-gear" style={{ marginRight: 6 }}></i>Database Infrastructure</span>
                        <span style={{ background: '#004a5e', border: '1px solid #003040', color: '#aaeeff', padding: '1px 6px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif', fontWeight: 'bold' }}>Admin Only</span>
                    </div>
                ) : (
                    <div className="card-header bg-info bg-opacity-10 text-info-emphasis d-flex justify-content-between align-items-center">
                        <h5 className="card-title mb-0" data-testid="db-infrastructure-header"><i className="bi bi-database-fill-gear me-2"></i>Database Infrastructure</h5>
                        <span className="badge bg-info">Admin Only</span>
                    </div>
                )}
                <div style={classic ? { padding: '12px 14px', background: '#ece9d8' } : undefined} className={classic ? '' : 'card-body'}>
                    <div className="mb-3">
                        <label
                            style={classic ? { ...xpLabel, fontWeight: 'bold', color: '#555', textTransform: 'uppercase' as const, fontSize: '10px', letterSpacing: '0.5px' } : undefined}
                            className={classic ? '' : 'form-label small fw-bold text-muted'}
                        >Current Connection</label>
                        {classic ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ background: '#e0dfd8', border: '1px solid #b0a898', padding: '1px 6px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333' }}>
                                    <i className="bi bi-link-45deg"></i>
                                </span>
                                <input style={{ ...xpInput, flex: 1, background: '#f0ede6' }} value={currentDbUrl} readOnly />
                            </div>
                        ) : (
                            <div className="input-group">
                                <span className="input-group-text bg-light"><i className="bi bi-link-45deg"></i></span>
                                <input className="form-control bg-light font-monospace small" value={currentDbUrl} readOnly />
                            </div>
                        )}
                    </div>

                    <div className="row g-4">
                        <div className="col-md-7">
                            <div style={classic ? xpSectionHead : undefined} className={classic ? '' : ''}>
                                {classic ? 'Switch to New Database' : <label className="form-label small fw-bold text-primary">Switch to New Database</label>}
                            </div>
                            {classic ? (
                                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                                    <input
                                        style={{ ...xpInput, flex: 1, fontFamily: "'Courier New', monospace" }}
                                        placeholder="postgresql+psycopg2://user:pass@host:port/db"
                                        value={newDbUrl}
                                        onChange={e => setNewDbUrl(e.target.value)}
                                    />
                                    <button
                                        style={xpBtn({ background: 'linear-gradient(to bottom, #006e8e, #004a5e)', borderColor: '#004a5e #001a2e #001a2e #004a5e', color: '#ffffff' })}
                                        onClick={() => handleSwitchDatabase(newDbUrl)}
                                        disabled={!newDbUrl || isDbLoading}
                                    >
                                        {isDbLoading ? <span className="spinner-border spinner-border-sm"></span> : 'Switch Connection'}
                                    </button>
                                </div>
                            ) : (
                                <div className="input-group mb-2">
                                    <input
                                        className="form-control font-monospace small"
                                        placeholder="postgresql+psycopg2://user:pass@host:port/db"
                                        value={newDbUrl}
                                        onChange={e => setNewDbUrl(e.target.value)}
                                    />
                                    <button
                                        className="btn btn-info text-white"
                                        onClick={() => handleSwitchDatabase(newDbUrl)}
                                        disabled={!newDbUrl || isDbLoading}
                                    >
                                        {isDbLoading ? <span className="spinner-border spinner-border-sm"></span> : 'Switch Connection'}
                                    </button>
                                </div>
                            )}
                            <div
                                style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#8b0000', marginTop: 2 } : undefined}
                                className={classic ? '' : 'form-text extra-small text-danger'}
                            >
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>
                                WARNING: Switching databases will change the entire data context.
                            </div>
                        </div>
                        <div className="col-md-5">
                            <div style={classic ? xpSectionHead : undefined} className={classic ? '' : ''}>
                                {classic ? 'Saved Profiles' : <label className="form-label small fw-bold text-muted">Saved Profiles</label>}
                            </div>
                            {classic ? (
                                <div style={{ border: '1px solid #b0a898', background: '#ffffff', maxHeight: 120, overflowY: 'auto' as const }}>
                                    {dbProfiles.map((p, i) => (
                                        <button
                                            key={i}
                                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '3px 8px', background: 'none', border: 'none', borderBottom: '1px solid #e0dfd8', cursor: 'pointer', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', textAlign: 'left' as const }}
                                            onClick={() => setNewDbUrl(p.url)}
                                        >
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '90%' }}>{p.name}: {p.url}</span>
                                            <i className="bi bi-arrow-right-short"></i>
                                        </button>
                                    ))}
                                    {dbProfiles.length === 0 && (
                                        <div style={{ padding: '8px', textAlign: 'center', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#888', fontStyle: 'italic' }}>No saved profiles</div>
                                    )}
                                </div>
                            ) : (
                                <div className="list-group list-group-flush border rounded overflow-auto" style={{maxHeight: '120px'}}>
                                    {dbProfiles.map((p, i) => (
                                        <button
                                            key={i}
                                            className="list-group-item list-group-item-action d-flex justify-content-between align-items-center small"
                                            onClick={() => setNewDbUrl(p.url)}
                                        >
                                            <span className="text-truncate" style={{maxWidth: '80%'}}>{p.name}: {p.url}</span>
                                            <i className="bi bi-arrow-right-short"></i>
                                        </button>
                                    ))}
                                    {dbProfiles.length === 0 && <div className="p-3 text-center text-muted extra-small">No saved profiles</div>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Snapshot & Context Migration */}
            <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0 mb-4 border-start border-4 border-primary'}>
                {classic ? (
                    <div style={xpTitleBar()}>
                        <span><i className="bi bi-camera-fill" style={{ marginRight: 6 }}></i>Snapshot &amp; Context Migration</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <label style={xpBtn()}>
                                <i className="bi bi-cloud-upload" style={{ marginRight: 4 }}></i>Upload Snapshot
                                <input type="file" hidden onChange={handleUploadSnapshot} disabled={isSnapshotLoading} />
                            </label>
                            <button
                                style={xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff' })}
                                onClick={handleCreateSnapshot}
                                disabled={isSnapshotLoading}
                            >
                                {isSnapshotLoading ? <span className="spinner-border spinner-border-sm" style={{ marginRight: 4 }}></span> : <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>}
                                Create New Snapshot
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="card-header bg-primary bg-opacity-10 text-primary-emphasis d-flex justify-content-between align-items-center">
                        <h5 className="card-title mb-0"><i className="bi bi-camera-fill me-2"></i>Snapshot &amp; Context Migration</h5>
                        <div className="d-flex gap-2">
                            <label className="btn btn-sm btn-outline-primary mb-0" style={{cursor: 'pointer'}}>
                                <i className="bi bi-cloud-upload me-1"></i>Upload Snapshot
                                <input type="file" hidden onChange={handleUploadSnapshot} disabled={isSnapshotLoading} />
                            </label>
                            <button className="btn btn-primary btn-sm" onClick={handleCreateSnapshot} disabled={isSnapshotLoading}>
                                {isSnapshotLoading ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-plus-lg me-1"></i>}
                                Create New Snapshot
                            </button>
                        </div>
                    </div>
                )}
                <div style={classic ? { background: '#ece9d8' } : undefined} className={classic ? '' : 'card-body p-0'}>
                    <div className="table-responsive">
                        <table
                            style={classic ? { width: '100%', borderCollapse: 'collapse' as const, background: '#fff' } : undefined}
                            className={classic ? '' : 'table table-hover align-middle mb-0 small'}
                        >
                            <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                                <tr>
                                    <th style={classic ? { ...xpThCell } : undefined} className={classic ? '' : 'ps-4'}>Snapshot Filename</th>
                                    <th style={classic ? xpThCell : undefined}>Created At</th>
                                    <th style={classic ? xpThCell : undefined}>Size</th>
                                    <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snapshots.map((s, i) => (
                                    <tr
                                        key={i}
                                        style={classic ? { background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                                    >
                                        <td style={classic ? { ...tdBase, fontFamily: "'Courier New', monospace", fontSize: '10px' } : undefined} className={classic ? '' : 'ps-4 font-monospace'}>{s.name}</td>
                                        <td style={classic ? tdBase : undefined}>{new Date(s.created_at).toLocaleString()}</td>
                                        <td style={classic ? tdBase : undefined}>{(s.size / 1024 / 1024).toFixed(2)} MB</td>
                                        <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'text-end pe-4'}>
                                            <div style={classic ? { display: 'flex', gap: 4, justifyContent: 'flex-end' } : undefined} className={classic ? '' : 'd-flex gap-2 justify-content-end'}>
                                                {classic ? (
                                                    <>
                                                        <button
                                                            title="Export/Download"
                                                            onClick={() => handleDownloadSnapshot(s.name)}
                                                            style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#0058e6', fontSize: '14px' }}
                                                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                        ><i className="bi bi-download"></i></button>
                                                        <button
                                                            title="Restore/Rollback"
                                                            onClick={() => handleRestoreSnapshot(s.name)}
                                                            style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#2e7d32', fontSize: '14px' }}
                                                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#4caf50'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f5e9'; }}
                                                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                        ><i className="bi bi-arrow-counterclockwise"></i></button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="btn btn-sm btn-link text-primary p-0" onClick={() => handleDownloadSnapshot(s.name)} title="Export/Download">
                                                            <i className="bi bi-download fs-5"></i>
                                                        </button>
                                                        <button className="btn btn-sm btn-link text-success p-0" onClick={() => handleRestoreSnapshot(s.name)} title="Restore/Rollback">
                                                            <i className="bi bi-arrow-counterclockwise fs-5"></i>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {snapshots.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={4}
                                            style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '20px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                            className={classic ? '' : 'text-center py-4 text-muted'}
                                        >No snapshots found. Create one to begin.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* User Management */}
            <div style={classic ? xpBevel : undefined} className={classic ? '' : 'card shadow-sm border-0'}>
                {classic ? (
                    <div style={xpTitleBar('linear-gradient(to right, #8e0000 0%, #c84040 100%)', '#4a0000')}>
                        <span><i className="bi bi-shield-lock" style={{ marginRight: 6 }}></i>User Management (Admin)</span>
                    </div>
                ) : (
                    <div className="card-header bg-danger bg-opacity-10 text-danger-emphasis">
                        <h5 className="card-title mb-0"><i className="bi bi-shield-lock me-2"></i>User Management (Admin)</h5>
                    </div>
                )}
                <div style={classic ? { background: '#ece9d8' } : undefined} className={classic ? '' : 'card-body p-0'}>
                    <div className="table-responsive">
                        <table
                            style={classic ? { width: '100%', borderCollapse: 'collapse' as const, background: '#fff' } : undefined}
                            className={classic ? '' : 'table table-hover align-middle mb-0'}
                        >
                            <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                                <tr>
                                    <th style={classic ? { ...xpThCell, width: 36 } : undefined} className={classic ? '' : 'ps-4'} />
                                    <th style={classic ? xpThCell : undefined} className={classic ? '' : ''}>Username</th>
                                    <th style={classic ? xpThCell : undefined}>Full Name</th>
                                    <th style={classic ? xpThCell : undefined}>Role &amp; Password</th>
                                    <th style={classic ? xpThCell : undefined}>Permissions</th>
                                    <th style={classic ? xpThCell : undefined}>Allowed Categories</th>
                                    <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user, rowIndex) => (
                                    <tr
                                        key={user.id}
                                        style={classic ? { background: editingUser === user.id ? '#fffde8' : rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                                        className={classic ? '' : (editingUser === user.id ? 'bg-light' : '')}
                                    >
                                        {editingUser === user.id ? (
                                            <>
                                                <td style={classic ? { ...tdBase, verticalAlign: 'top' } : undefined} className={classic ? '' : 'ps-4'}>
                                                    <div style={classic ? { width: 28, height: 28, border: '1px solid', borderColor: '#fff #888 #888 #fff', background: '#e0dcd4', display: 'flex', alignItems: 'center', justifyContent: 'center' } : { width: 32, height: 32, border: '1px solid #dee2e6', borderRadius: 4, background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <PixelAvatar avatarId={editAvatarId} size={24} />
                                                    </div>
                                                    <div style={{ marginTop: 4 }}>
                                                        <AvatarPicker value={editAvatarId} onChange={setEditAvatarId} classic={classic} />
                                                    </div>
                                                </td>
                                                <td style={classic ? tdBase : undefined} className={classic ? '' : ''}>
                                                    <input
                                                        style={classic ? { ...xpInput, width: '100%', fontFamily: "'Courier New', monospace" } : undefined}
                                                        className={classic ? '' : 'form-control form-control-sm font-monospace'}
                                                        value={editUsername}
                                                        onChange={e => setEditUsername(e.target.value)}
                                                    />
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <input
                                                        style={classic ? { ...xpInput, width: '100%' } : undefined}
                                                        className={classic ? '' : 'form-control form-control-sm'}
                                                        value={editName}
                                                        onChange={e => setEditName(e.target.value)}
                                                    />
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <select
                                                        style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%', marginBottom: 4 } : undefined}
                                                        className={classic ? '' : 'form-select form-select-sm mb-2'}
                                                        value={editRoleId}
                                                        onChange={e => setEditRoleId(e.target.value)}
                                                    >
                                                        <option value="">No Role</option>
                                                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                                    </select>
                                                    <input
                                                        type="password"
                                                        style={classic ? { ...xpInput, width: '100%', borderColor: '#cc6666' } : undefined}
                                                        className={classic ? '' : 'form-control form-control-sm'}
                                                        placeholder="Reset Password..."
                                                        value={newPassword}
                                                        onChange={e => setNewPassword(e.target.value)}
                                                    />
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <div
                                                        style={classic ? { display: 'flex', flexWrap: 'wrap' as const, gap: 4, padding: '4px 6px', background: '#ffffff', border: '1px solid #b0a898', maxHeight: 150, overflowY: 'auto' as const } : { maxHeight: 150, overflowY: 'auto' as const }}
                                                        className={classic ? '' : 'd-flex flex-wrap gap-2 p-2 border rounded bg-white'}
                                                    >
                                                        {allPermissions.map(p => (
                                                            <div key={p.id} style={classic ? { display: 'flex', alignItems: 'center', gap: 3 } : undefined} className={classic ? '' : 'form-check m-0'}>
                                                                <input
                                                                    style={classic ? { cursor: 'pointer' } : undefined}
                                                                    className={classic ? '' : 'form-check-input'}
                                                                    type="checkbox"
                                                                    checked={editPermissionIds.includes(p.id)}
                                                                    onChange={() => toggleEditPermission(p.id)}
                                                                    id={`perm-${p.id}`}
                                                                />
                                                                <label
                                                                    style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#000', cursor: 'pointer' } : undefined}
                                                                    className={classic ? '' : 'form-check-label small'}
                                                                    htmlFor={`perm-${p.id}`}
                                                                    title={p.description}
                                                                >{p.code}</label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <div
                                                        style={classic ? { display: 'flex', flexWrap: 'wrap' as const, gap: 4, padding: '4px 6px', background: '#ffffff', border: '1px solid #b0a898', maxHeight: 150, overflowY: 'auto' as const } : { maxHeight: 150, overflowY: 'auto' as const }}
                                                        className={classic ? '' : 'd-flex flex-wrap gap-2 p-2 border rounded bg-white'}
                                                    >
                                                        {allCategories.map(c => (
                                                            <div key={c.id} style={classic ? { display: 'flex', alignItems: 'center', gap: 3 } : undefined} className={classic ? '' : 'form-check m-0'}>
                                                                <input
                                                                    style={classic ? { cursor: 'pointer' } : undefined}
                                                                    className={classic ? '' : 'form-check-input'}
                                                                    type="checkbox"
                                                                    checked={editAllowedCategories.includes(c.name)}
                                                                    onChange={() => toggleEditCategory(c.name)}
                                                                    id={`cat-${c.id}`}
                                                                />
                                                                <label
                                                                    style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#000', cursor: 'pointer' } : undefined}
                                                                    className={classic ? '' : 'form-check-label small'}
                                                                    htmlFor={`cat-${c.id}`}
                                                                >{c.name}</label>
                                                            </div>
                                                        ))}
                                                        {allCategories.length === 0 && (
                                                            <small style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#888' } : undefined} className={classic ? '' : 'text-muted'}>No categories defined</small>
                                                        )}
                                                    </div>
                                                    <small
                                                        style={classic ? { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '9px', color: '#888', display: 'block', marginTop: 2 } : { fontSize: '0.65rem' }}
                                                        className={classic ? '' : 'text-muted d-block mt-1'}
                                                    >*Uncheck all for full access</small>
                                                </td>
                                                <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'text-end pe-4'}>
                                                    <div style={classic ? { display: 'flex', gap: 2, justifyContent: 'flex-end' } : undefined} className={classic ? '' : 'd-flex gap-1 justify-content-end'}>
                                                        {classic ? (
                                                            <>
                                                                <button
                                                                    style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', padding: '2px 8px' })}
                                                                    onClick={() => saveUserChanges(user.id)}
                                                                ><i className="bi bi-check-lg"></i></button>
                                                                <button
                                                                    style={xpBtn({ padding: '2px 8px' })}
                                                                    onClick={() => setEditingUser(null)}
                                                                ><i className="bi bi-x-lg"></i></button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button className="btn btn-sm btn-success" onClick={() => saveUserChanges(user.id)}>
                                                                    <i className="bi bi-check-lg"></i>
                                                                </button>
                                                                <button className="btn btn-sm btn-light border" onClick={() => setEditingUser(null)}>
                                                                    <i className="bi bi-x-lg"></i>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td style={classic ? { ...tdBase, textAlign: 'center' as const } : undefined} className={classic ? '' : 'ps-4'}>
                                                    <div style={classic ? { width: 28, height: 28, border: '1px solid', borderColor: '#fff #888 #888 #fff', background: '#e0dcd4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : { width: 32, height: 32, border: '1px solid #dee2e6', borderRadius: 4, background: '#f8f9fa', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <PixelAvatar avatarId={user.avatar_id} size={24} />
                                                    </div>
                                                </td>
                                                <td style={classic ? { ...tdBase, fontFamily: "'Courier New', monospace", fontWeight: 'bold' } : undefined} className={classic ? '' : 'font-monospace'}>{user.username}</td>
                                                <td style={classic ? tdBase : undefined}>{user.full_name}</td>
                                                <td style={classic ? tdBase : undefined}>
                                                    {classic ? (
                                                        <span style={{ background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#000', padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif', fontWeight: 'bold' }}>
                                                            {user.role?.name || '-'}
                                                        </span>
                                                    ) : (
                                                        <span className="badge bg-secondary">{user.role?.name || '-'}</span>
                                                    )}
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <div style={classic ? { display: 'flex', flexWrap: 'wrap' as const, gap: 2 } : undefined} className={classic ? '' : 'd-flex flex-wrap gap-1'}>
                                                        {user.permissions?.map((p: any) => (
                                                            classic ? (
                                                                <span key={p.id} style={{ background: '#dde8f5', border: '1px solid #7f9db9', color: '#00006e', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif' }}>
                                                                    {p.code}
                                                                </span>
                                                            ) : (
                                                                <span key={p.id} className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25" style={{fontSize: '0.65rem'}}>
                                                                    {p.code}
                                                                </span>
                                                            )
                                                        ))}
                                                        {(!user.permissions || user.permissions.length === 0) && (
                                                            <span style={classic ? { fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: 'Tahoma,Arial,sans-serif' } : undefined} className={classic ? '' : 'text-muted small italic'}>Inherited only</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={classic ? tdBase : undefined}>
                                                    <div style={classic ? { display: 'flex', flexWrap: 'wrap' as const, gap: 2 } : undefined} className={classic ? '' : 'd-flex flex-wrap gap-1'}>
                                                        {user.allowed_categories && user.allowed_categories.length > 0 ? (
                                                            user.allowed_categories.map((c: string) => (
                                                                classic ? (
                                                                    <span key={c} style={{ background: '#fff8e1', border: '1px solid #c77800', color: '#4a3000', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif' }}>
                                                                        {c}
                                                                    </span>
                                                                ) : (
                                                                    <span key={c} className="badge bg-warning bg-opacity-10 text-dark border border-warning border-opacity-25" style={{fontSize: '0.65rem'}}>
                                                                        {c}
                                                                    </span>
                                                                )
                                                            ))
                                                        ) : (
                                                            classic ? (
                                                                <span style={{ background: '#e8f5e9', border: '1px solid #2e7d32', color: '#1b4620', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif' }}>All Categories</span>
                                                            ) : (
                                                                <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25" style={{fontSize: '0.65rem'}}>All Categories</span>
                                                            )
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'text-end pe-4'}>
                                                    {classic ? (
                                                        <button
                                                            title="Edit"
                                                            onClick={() => startEditingUser(user)}
                                                            style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '12px' }}
                                                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                        ><i className="bi bi-pencil-square"></i></button>
                                                    ) : (
                                                        <button className="btn btn-sm btn-link" onClick={() => startEditingUser(user)}>
                                                            <i className="bi bi-pencil-square"></i>
                                                        </button>
                                                    )}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                {classic && (
                    <div style={{ background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898', padding: '2px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#333' }}>
                        {users.length} user{users.length !== 1 ? 's' : ''} total
                    </div>
                )}
            </div>
            </>
        )}

      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useUser, User } from '../context/UserContext';
import CompanyProfileView from './CompanyProfileView';

export default function SettingsView({ 
    appName, onUpdateAppName, uiStyle, onUpdateUIStyle, requestConfirm,
    companyProfile, onUpdateCompanyProfile, onUploadLogo
}: any) {
  const { showToast } = useToast();
  const { currentUser, users, setCurrentUser, hasPermission, refreshUsers } = useUser();
  
  const [name, setName] = useState(appName);
  const [style, setStyle] = useState(uiStyle || 'default');
  const [roles, setRoles] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);

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

  // User Management State (Admin)
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editName, setEditName] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editPermissionIds, setEditPermissionIds] = useState<string[]>([]);
  const [editAllowedCategories, setEditAllowedCategories] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState('');

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

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
      // Sync self state with current user
      if (currentUser) {
          setSelfUsername(currentUser.username);
          setSelfFullName(currentUser.full_name);
      }

      // Fetch roles, permissions, categories
      Promise.all([
          fetch(`${API_BASE}/roles`).then(res => res.json()),
          fetch(`${API_BASE}/permissions`).then(res => res.json()),
          fetch(`${API_BASE}/categories`).then(res => res.json())
      ]).then(([rolesData, permsData, catsData]) => {
          setRoles(rolesData);
          setAllPermissions(permsData);
          setAllCategories(catsData);
      }).catch(err => console.error("Failed to fetch auth data", err));

      // Refresh users and DB info if admin
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
              // Save to profiles if not present
              if (!dbProfiles.some(p => p.url === url)) {
                  const newProfiles = [...dbProfiles, { name: `DB ${dbProfiles.length + 1}`, url }];
                  setDbProfiles(newProfiles);
                  localStorage.setItem('terras_db_profiles', JSON.stringify(newProfiles));
              }
              // Refresh whole app state since data context changed
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

      const payload: any = {
          username: selfUsername,
          full_name: selfFullName
      };

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
              allowed_categories: editAllowedCategories.length > 0 ? editAllowedCategories : null
          };
          
          if (newPassword) {
              payload.password = newPassword;
          }

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
        
        {/* System Settings */}
        <div className="card shadow-sm border-0 mb-4">
          <div className="card-header bg-white">
             <h5 className="card-title mb-0">System Preferences</h5>
          </div>
          <div className="card-body">
             <form onSubmit={handleSubmitSystem}>
                 <div className="row">
                     <div className="col-md-6 mb-3">
                         <label className="form-label">Application Name</label>
                         <input className="form-control" value={name} onChange={e => setName(e.target.value)} />
                     </div>
                     <div className="col-md-6 mb-3">
                         <label className="form-label">Interface Style</label>
                         <select className="form-select" value={style} onChange={e => setStyle(e.target.value)}>
                             <option value="default">Default (Corporate)</option>
                             <option value="modern">Modern (Rounded)</option>
                             <option value="compact">Compact (High Density)</option>
                             <option value="classic">Classic (Windows XP)</option>
                         </select>
                     </div>
                 </div>
                 <button type="submit" className="btn btn-primary w-100">Save Preferences</button>
             </form>
          </div>
        </div>

        {/* Company Profile (Admin Only) */}
        {hasPermission('admin.access') && (
            <CompanyProfileView 
                profile={companyProfile} 
                onUpdate={onUpdateCompanyProfile} 
                onUploadLogo={onUploadLogo} 
            />
        )}

        {/* Self-Service Account Security */}
        <div className="card shadow-sm border-0 mb-4">
            <div className="card-header bg-white">
                <h5 className="card-title mb-0">Account Settings</h5>
            </div>
            <div className="card-body">
                <form onSubmit={handleSelfAccountUpdate}>
                    <div className="row">
                        <div className="col-md-6 mb-3">
                            <label className="form-label">Username</label>
                            <input 
                                className="form-control" 
                                value={selfUsername} 
                                onChange={e => setSelfUsername(e.target.value)}
                                required 
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label className="form-label">Full Name</label>
                            <input 
                                className="form-control" 
                                value={selfFullName} 
                                onChange={e => setSelfFullName(e.target.value)}
                                required 
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label className="form-label text-danger">New Password (leave blank to keep current)</label>
                            <input 
                                type="password" 
                                className="form-control border-danger border-opacity-25" 
                                value={selfPassword} 
                                onChange={e => setSelfPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="col-md-6 mb-3">
                            <label className="form-label text-danger">Confirm New Password</label>
                            <input 
                                type="password" 
                                className="form-control border-danger border-opacity-25" 
                                value={selfConfirmPassword} 
                                onChange={e => setSelfConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                    </div>
                    <button type="submit" className="btn btn-outline-primary w-100 mt-2">Update My Profile & Security</button>
                </form>
            </div>
        </div>

        {/* Admin User Management */}
        {hasPermission('admin.access') && (
            <>
            {/* Database Infrastructure Section */}
            <div className="card shadow-sm border-0 mb-4 border-start border-4 border-info">
                <div className="card-header bg-info bg-opacity-10 text-info-emphasis d-flex justify-content-between align-items-center">
                    <h5 className="card-title mb-0" data-testid="db-infrastructure-header"><i className="bi bi-database-fill-gear me-2"></i>Database Infrastructure</h5>
                    <span className="badge bg-info">Admin Only</span>
                </div>
                <div className="card-body">
                    <div className="mb-4">
                        <label className="form-label small fw-bold text-muted">Current Connection</label>
                        <div className="input-group">
                            <span className="input-group-text bg-light"><i className="bi bi-link-45deg"></i></span>
                            <input className="form-control bg-light font-monospace small" value={currentDbUrl} readOnly />
                        </div>
                    </div>

                    <div className="row g-4">
                        <div className="col-md-7">
                            <label className="form-label small fw-bold text-primary">Switch to New Database</label>
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
                            <div className="form-text extra-small text-danger">
                                <i className="bi bi-exclamation-triangle-fill me-1"></i>
                                WARNING: Switching databases will change the entire data context. Ensure the target DB is accessible.
                            </div>
                        </div>
                        <div className="col-md-5">
                            <label className="form-label small fw-bold text-muted">Saved Profiles</label>
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
                        </div>
                    </div>
                </div>
            </div>

            {/* Snapshot & Context Migration Section */}
            <div className="card shadow-sm border-0 mb-4 border-start border-4 border-primary">
                <div className="card-header bg-primary bg-opacity-10 text-primary-emphasis d-flex justify-content-between align-items-center">
                    <h5 className="card-title mb-0"><i className="bi bi-camera-fill me-2"></i>Snapshot & Context Migration</h5>
                    <div className="d-flex gap-2">
                        <label className="btn btn-sm btn-outline-primary mb-0" style={{cursor: 'pointer'}}>
                            <i className="bi bi-cloud-upload me-1"></i>Upload Snapshot
                            <input type="file" hidden onChange={handleUploadSnapshot} disabled={isSnapshotLoading} />
                        </label>
                        <button 
                            className="btn btn-primary btn-sm" 
                            onClick={handleCreateSnapshot}
                            disabled={isSnapshotLoading}
                        >
                            {isSnapshotLoading ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-plus-lg me-1"></i>}
                            Create New Snapshot
                        </button>
                    </div>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0 small">
                            <thead className="table-light">
                                <tr>
                                    <th className="ps-4">Snapshot Filename</th>
                                    <th>Created At</th>
                                    <th>Size</th>
                                    <th className="text-end pe-4">Context Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snapshots.map((s, i) => (
                                    <tr key={i}>
                                        <td className="ps-4 font-monospace">{s.name}</td>
                                        <td>{new Date(s.created_at).toLocaleString()}</td>
                                        <td>{(s.size / 1024 / 1024).toFixed(2)} MB</td>
                                        <td className="text-end pe-4">
                                            <div className="d-flex gap-2 justify-content-end">
                                                <button className="btn btn-sm btn-link text-primary p-0" onClick={() => handleDownloadSnapshot(s.name)} title="Export/Download">
                                                    <i className="bi bi-download fs-5"></i>
                                                </button>
                                                <button className="btn btn-sm btn-link text-success p-0" onClick={() => handleRestoreSnapshot(s.name)} title="Restore/Rollback">
                                                    <i className="bi bi-arrow-counterclockwise fs-5"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {snapshots.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="text-center py-4 text-muted">No snapshots found. Create one to begin.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="card shadow-sm border-0">
                <div className="card-header bg-danger bg-opacity-10 text-danger-emphasis">
                    <h5 className="card-title mb-0"><i className="bi bi-shield-lock me-2"></i>User Management (Admin)</h5>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th className="ps-4">Username</th>
                                    <th>Full Name</th>
                                    <th>Role & Password</th>
                                    <th>Permissions</th>
                                    <th>Allowed Categories</th>
                                    <th className="text-end pe-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user.id} className={editingUser === user.id ? 'bg-light' : ''}>
                                        {editingUser === user.id ? (
                                            <>
                                                <td className="ps-4">
                                                    <input 
                                                        className="form-control form-control-sm font-monospace" 
                                                        value={editUsername} 
                                                        onChange={e => setEditUsername(e.target.value)} 
                                                    />
                                                </td>
                                                <td>
                                                    <input 
                                                        className="form-control form-control-sm" 
                                                        value={editName} 
                                                        onChange={e => setEditName(e.target.value)} 
                                                    />
                                                </td>
                                                <td>
                                                    <select 
                                                        className="form-select form-select-sm mb-2"
                                                        value={editRoleId}
                                                        onChange={e => setEditRoleId(e.target.value)}
                                                    >
                                                        <option value="">No Role</option>
                                                        {roles.map(r => (
                                                            <option key={r.id} value={r.id}>{r.name}</option>
                                                        ))}
                                                    </select>
                                                    <input 
                                                        type="password"
                                                        className="form-control form-control-sm"
                                                        placeholder="Reset Password..."
                                                        value={newPassword}
                                                        onChange={e => setNewPassword(e.target.value)}
                                                    />
                                                </td>
                                                <td>
                                                    <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-white" style={{maxHeight: '150px', overflowY: 'auto'}}>
                                                        {allPermissions.map(p => (
                                                            <div key={p.id} className="form-check m-0">
                                                                <input 
                                                                    className="form-check-input" 
                                                                    type="checkbox" 
                                                                    checked={editPermissionIds.includes(p.id)}
                                                                    onChange={() => toggleEditPermission(p.id)}
                                                                    id={`perm-${p.id}`}
                                                                />
                                                                <label className="form-check-label small" htmlFor={`perm-${p.id}`} title={p.description}>
                                                                    {p.code}
                                                                </label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-white" style={{maxHeight: '150px', overflowY: 'auto'}}>
                                                        {allCategories.map(c => (
                                                            <div key={c.id} className="form-check m-0">
                                                                <input 
                                                                    className="form-check-input" 
                                                                    type="checkbox" 
                                                                    checked={editAllowedCategories.includes(c.name)}
                                                                    onChange={() => toggleEditCategory(c.name)}
                                                                    id={`cat-${c.id}`}
                                                                />
                                                                <label className="form-check-label small" htmlFor={`cat-${c.id}`}>
                                                                    {c.name}
                                                                </label>
                                                            </div>
                                                        ))}
                                                        {allCategories.length === 0 && <small className="text-muted">No categories defined</small>}
                                                    </div>
                                                    <small className="text-muted d-block mt-1" style={{fontSize: '0.65rem'}}>*Uncheck all for full access</small>
                                                </td>
                                                <td className="text-end pe-4">
                                                    <div className="d-flex gap-1 justify-content-end">
                                                        <button className="btn btn-sm btn-success" onClick={() => saveUserChanges(user.id)}>
                                                            <i className="bi bi-check-lg"></i>
                                                        </button>
                                                        <button className="btn btn-sm btn-light border" onClick={() => setEditingUser(null)}>
                                                            <i className="bi bi-x-lg"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="ps-4 font-monospace">{user.username}</td>
                                                <td>{user.full_name}</td>
                                                <td><span className="badge bg-secondary">{user.role?.name || '-'}</span></td>
                                                <td>
                                                    <div className="d-flex flex-wrap gap-1">
                                                        {user.permissions?.map(p => (
                                                            <span key={p.id} className="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25" style={{fontSize: '0.65rem'}}>
                                                                {p.code}
                                                            </span>
                                                        ))}
                                                        {(!user.permissions || user.permissions.length === 0) && <span className="text-muted small italic">Inherited only</span>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="d-flex flex-wrap gap-1">
                                                        {user.allowed_categories && user.allowed_categories.length > 0 ? (
                                                            user.allowed_categories.map((c: string) => (
                                                                <span key={c} className="badge bg-warning bg-opacity-10 text-dark border border-warning border-opacity-25" style={{fontSize: '0.65rem'}}>
                                                                    {c}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25" style={{fontSize: '0.65rem'}}>All Categories</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="text-end pe-4">
                                                    <button className="btn btn-sm btn-link" onClick={() => startEditingUser(user)}>
                                                        <i className="bi bi-pencil-square"></i>
                                                    </button>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            </>
        )}

      </div>
    </div>
  );
}
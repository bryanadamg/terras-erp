'use client';

import { useEffect, useMemo, useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { xpBtn, xpInput, CODE_FONT, xpFont, FieldLabel, FormError, ModalFooterActions, XP_BTN } from '../shared/xpTheme';
import AvatarPicker from '../shared/AvatarPicker';
import PermissionsPicker, { PermissionOption } from './PermissionsPicker';
import { User } from '../../context/UserContext';

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';

function generatePassword(length = 14): string {
    const bytes = new Uint32Array(length);
    (window.crypto || (window as any).msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

export interface UserFormPayload {
    username: string;
    full_name: string;
    role_id: string | null;
    permission_ids: string[];
    avatar_id: string;
    password?: string;
}

export default function UserFormModal({
    isOpen, onClose, mode, user, roles, allPermissions, onSubmit,
}: {
    isOpen: boolean;
    onClose: () => void;
    mode: 'create' | 'edit';
    user?: User;
    roles: any[];
    allPermissions: PermissionOption[];
    onSubmit: (payload: UserFormPayload) => Promise<{ ok: boolean; error?: string }>;
}) {
    const [username, setUsername] = useState('');
    const [fullName, setFullName] = useState('');
    const [roleId, setRoleId] = useState('');
    const [permissionIds, setPermissionIds] = useState<string[]>([]);
    // Empty means "no recipe stored yet", which renders as an avatar seeded from
    // the username rather than a shared default.
    const [avatarId, setAvatarId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(mode === 'create');
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setUsername(user?.username || '');
        setFullName(user?.full_name || '');
        setRoleId(user?.role?.id || '');
        setPermissionIds(user?.permissions?.map(p => p.id) || []);
        setAvatarId(user?.avatar_id || '');
        setPassword('');
        setShowPassword(mode === 'create');
        setPasswordVisible(false);
        setError('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, user?.id]);

    // Template comes from the role picked in this form, not the user's saved role:
    // moving someone into an executive role should preview that role's default
    // before the save, not after.
    const roleAvatarTemplate = useMemo(
        () => roles.find(r => r.id === roleId)?.default_avatar_id ?? null,
        [roles, roleId],
    );

    const rolePermissionIds = useMemo(() => {
        const role = roles.find(r => r.id === roleId);
        return role?.permissions?.map((p: any) => p.id) || [];
    }, [roles, roleId]);

    const handleGeneratePassword = () => {
        const pw = generatePassword();
        setPassword(pw);
        setPasswordVisible(true);
    };

    const handleSubmit = async () => {
        setError('');
        if (!username || !fullName) {
            setError('Username and full name are required');
            return;
        }
        if (mode === 'create' && !password) {
            setError('Password is required');
            return;
        }
        setSubmitting(true);
        const payload: UserFormPayload = {
            username, full_name: fullName,
            role_id: roleId || null,
            permission_ids: permissionIds,
            avatar_id: avatarId,
        };
        if (mode === 'create' || (showPassword && password)) payload.password = password;
        const res = await onSubmit(payload);
        setSubmitting(false);
        if (res.ok) {
            onClose();
        } else {
            setError(res.error || 'Something went wrong');
        }
    };

    return (
        <ModalWrapper
            isOpen={isOpen}
            modeless
            onClose={onClose}
            title={<span><i className="bi bi-person-badge me-2"></i>{mode === 'create' ? 'Add User' : `Edit User — ${user?.username}`}</span>}
            variant={mode === 'create' ? 'success' : 'primary'}
            /* Same reason as RoleFormModal: the permission matrix wraps every resource
               row onto three lines at md. The two modals show the same picker, so they
               get the same width. */
            size="xl"
            footer={
                <ModalFooterActions
                    classic
                    onCancel={onClose}
                    onSubmit={handleSubmit}
                    submitting={submitting}
                    submitLabel={mode === 'create' ? 'Create User' : 'Save Changes'}
                    variant={mode === 'create' ? 'success' : 'primary'}
                />
            }
        >
            <FormError classic>{error}</FormError>

            {/* Preview frame lives inside AvatarPicker (it has to, for the
                hover-to-try-on stage) — don't add a second one here. */}
            <div className="mb-3">
                <FieldLabel classic>Avatar</FieldLabel>
                <AvatarPicker value={avatarId} onChange={setAvatarId} seed={username} template={roleAvatarTemplate} classic />
            </div>

            {/* Paired two-up: at xl these single-line fields each stretching the full
                width read as a form with nothing in it. Collapses to one column on
                narrow screens. */}
            <div className="row g-2 mb-3">
                <div className="col-md-6">
                    <FieldLabel classic>Username</FieldLabel>
                    <input
                        style={xpInput({ width: '100%', fontFamily: CODE_FONT })}
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                    />
                </div>
                <div className="col-md-6">
                    <FieldLabel classic>Full Name</FieldLabel>
                    <input
                        style={xpInput({ width: '100%' })}
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                    />
                </div>
            </div>

            <div className="row g-2 mb-3">
                <div className="col-md-6">
                    <FieldLabel classic>Role</FieldLabel>
                    <select
                        style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                        value={roleId}
                        onChange={e => setRoleId(e.target.value)}
                    >
                        <option value="">No Role</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </div>
                <div className="col-md-6">
                    <FieldLabel
                        classic
                        right={mode === 'edit' && !showPassword ? (
                            <button
                                type="button"
                                style={xpBtn({ padding: '1px 6px', fontSize: 10 })}
                                className={XP_BTN}
                                onClick={() => setShowPassword(true)}
                            >Reset Password…</button>
                        ) : undefined}
                    >Password</FieldLabel>
                    {showPassword ? (
                        <>
                            <div className="d-flex gap-1">
                                <input
                                    type={passwordVisible ? 'text' : 'password'}
                                    style={xpInput({ width: '100%', borderColor: '#cc6666' })}
                                    placeholder={mode === 'create' ? 'Password' : 'New password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                                <button
                                    type="button"
                                    title={passwordVisible ? 'Hide' : 'Show'}
                                    style={xpBtn({ padding: '1px 6px' })}
                                    className={XP_BTN}
                                    onClick={() => setPasswordVisible(v => !v)}
                                ><i className={`bi ${passwordVisible ? 'bi-eye-slash' : 'bi-eye'}`}></i></button>
                                <button
                                    type="button"
                                    title="Generate a random password"
                                    style={xpBtn({ padding: '1px 6px' })}
                                    className={XP_BTN}
                                    onClick={handleGeneratePassword}
                                ><i className="bi bi-shuffle"></i></button>
                                {mode === 'edit' && (
                                    <button
                                        type="button"
                                        title="Cancel password reset"
                                        style={xpBtn({ padding: '1px 6px' })}
                                        className={XP_BTN}
                                        onClick={() => { setShowPassword(false); setPassword(''); setPasswordVisible(false); }}
                                    ><i className="bi bi-x-lg"></i></button>
                                )}
                            </div>
                            {passwordVisible && password && (
                                <small style={{ fontFamily: xpFont, fontSize: 9, color: '#888', display: 'block', marginTop: 2 }}>
                                    Copy this now — it won&apos;t be shown again after saving.
                                </small>
                            )}
                        </>
                    ) : (
                        <div style={{ fontFamily: xpFont, fontSize: 10, color: '#888', fontStyle: 'italic' }}>
                            Leave unchanged, or reset it above.
                        </div>
                    )}
                </div>
            </div>

            <div className="mb-3">
                <FieldLabel classic>Permissions</FieldLabel>
                <PermissionsPicker
                    allPermissions={allPermissions}
                    selectedIds={permissionIds}
                    onChange={setPermissionIds}
                    disabledIds={rolePermissionIds}
                />
                <small style={{ fontFamily: xpFont, fontSize: 9, color: '#888', display: 'block', marginTop: 2 }}>
                    Locked chips are already granted by the selected role. Category/location/station
                    scoping is configured on the Role, not per user.
                </small>
            </div>
        </ModalWrapper>
    );
}

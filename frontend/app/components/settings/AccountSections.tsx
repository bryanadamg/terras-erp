'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useUser } from '../../context/UserContext';
import { xpBtn, XP_BTN } from '../shared/xpTheme';
import { field as xpInput, BTN_TONES } from '@bryanadamg/terras-ui/styles';
import { FieldLabel } from '@bryanadamg/terras-ui/components/Field';
import { settingsActions, settingsGrid } from './settingsStyles';
import AvatarPicker from '../shared/AvatarPicker';
import { useData } from '../../context/DataContext';
import { API_BASE } from '../shared/apiBase';
import { DetailSection } from './settingsParts';

/**
 * The signed-in user's own account, as two sections of the General tab with a
 * save each. They were one form with one "Save Account" under both, so fixing a
 * typo in your name also re-sent whatever sat in the password fields — and the
 * button read as "save password" from wherever you were looking.
 */

/** PUT the signed-in user's own record; true on success. */
function useSaveSelf() {
    const { authFetch } = useData();
    const { showToast } = useToast();
    const { currentUser, setCurrentUser } = useUser();
    return async (payload: Record<string, unknown>, okMessage: string): Promise<boolean> => {
        if (!currentUser) return false;
        try {
            const res = await authFetch(`${API_BASE}/users/${currentUser.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setCurrentUser(await res.json());
                showToast(okMessage, 'success');
                return true;
            }
            const err = await res.json().catch(() => ({}));
            showToast(`Failed: ${err.detail || res.status}`, 'danger');
        } catch {
            showToast('Error updating account', 'danger');
        }
        return false;
    };
}

export function ProfileSection() {
    const { currentUser } = useUser();
    const saveSelf = useSaveSelf();
    const [username, setUsername] = useState('');
    const [fullName, setFullName] = useState('');
    // Empty means "no recipe stored yet" — seeded from the username instead.
    const [avatarId, setAvatarId] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!currentUser) return;
        setUsername(currentUser.username);
        setFullName(currentUser.full_name);
        setAvatarId(currentUser.avatar_id || '');
    }, [currentUser]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        await saveSelf({ username, full_name: fullName, avatar_id: avatarId }, 'Profile saved');
        setSaving(false);
    };

    return (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <DetailSection title="Avatar">
                {/* AvatarPicker owns the preview: one outside it can't show the
                    candidate you are hovering. */}
                <FieldLabel hint="Hover an option to try it on; Shuffle rolls a whole new face.">Choose Avatar</FieldLabel>
                <AvatarPicker value={avatarId} onChange={setAvatarId} seed={username} template={currentUser?.role?.default_avatar_id} />
            </DetailSection>
            <DetailSection title="Name">
                <div style={{ ...settingsGrid(220), maxWidth: 760 }}>
                    <div>
                        <FieldLabel hint="What you sign in with.">Username</FieldLabel>
                        <input style={xpInput({ width: '100%' })} value={username} onChange={e => setUsername(e.target.value)} required />
                    </div>
                    <div>
                        <FieldLabel hint="Shown on documents you create and in activity logs.">Full Name</FieldLabel>
                        <input style={xpInput({ width: '100%' })} value={fullName} onChange={e => setFullName(e.target.value)} required />
                    </div>
                </div>
            </DetailSection>
            <div style={{ ...settingsActions(), marginTop: 0, maxWidth: 760 }}>
                <button type="submit" disabled={saving} style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px' })} className={XP_BTN}>
                    <i className="bi bi-save" style={{ marginRight: 4 }} />Save Profile
                </button>
            </div>
        </form>
    );
}

export function PasswordSection() {
    const { showToast } = useToast();
    const saveSelf = useSaveSelf();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (next !== confirm) {
            showToast('Passwords do not match', 'warning');
            return;
        }
        setSaving(true);
        if (await saveSelf({ password: next, current_password: current }, 'Password changed')) {
            setCurrent(''); setNext(''); setConfirm('');
        }
        setSaving(false);
    };

    return (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <DetailSection title="Change Password">
                <div style={{ ...settingsGrid(220), maxWidth: 760 }}>
                    <div>
                        <FieldLabel>Current Password</FieldLabel>
                        <input type="password" autoComplete="current-password" style={xpInput({ width: '100%' })}
                            value={current} onChange={e => setCurrent(e.target.value)} required placeholder="••••••••" />
                    </div>
                    <div>
                        <FieldLabel>New Password</FieldLabel>
                        <input type="password" autoComplete="new-password" style={xpInput({ width: '100%' })}
                            value={next} onChange={e => setNext(e.target.value)} required placeholder="••••••••" />
                    </div>
                    <div>
                        <FieldLabel>Confirm New Password</FieldLabel>
                        <input type="password" autoComplete="new-password" style={xpInput({ width: '100%' })}
                            value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="••••••••" />
                    </div>
                </div>
            </DetailSection>
            <div style={{ ...settingsActions(), marginTop: 0, maxWidth: 760 }}>
                <button type="submit" disabled={saving || !next} style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px' })} className={XP_BTN}>
                    <i className="bi bi-key" style={{ marginRight: 4 }} />Change Password
                </button>
            </div>
        </form>
    );
}

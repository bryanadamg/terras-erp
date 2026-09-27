'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useUser } from '../../context/UserContext';
import { xpBtn, xpInput, FieldLabel, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { settingsActions, settingsCol, settingsColumns, settingsGrid, settingsStack } from './settingsStyles';
import SettingsPanel from './SettingsPanel';
import AvatarPicker from '../shared/AvatarPicker';
import { useData } from '../../context/DataContext';
import { API_BASE } from '../shared/apiBase';

export default function SettingsAccountTab() {
    const { authFetch } = useData();
    const { showToast } = useToast();
    const { currentUser, setCurrentUser } = useUser();

    const [selfUsername, setSelfUsername] = useState('');
    const [selfFullName, setSelfFullName] = useState('');
    const [selfPassword, setSelfPassword] = useState('');
    const [selfConfirmPassword, setSelfConfirmPassword] = useState('');
    // Empty means "no recipe stored yet" — seeded from the username instead.
    const [selfAvatarId, setSelfAvatarId] = useState<string>('');

    useEffect(() => {
        if (currentUser) {
            setSelfUsername(currentUser.username);
            setSelfFullName(currentUser.full_name);
            setSelfAvatarId(currentUser.avatar_id || '');
        }
    }, [currentUser]);

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
            const res = await authFetch(`${API_BASE}/users/${currentUser.id}`, {
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

    return (
        // Avatar, identity and password are three decisions, not eight fields in
        // one block — changing your display name shouldn't sit in the same rhythm
        // as resetting your own credentials. One form still submits all three.
        //
        // Two columns: the avatar editor is the only thing here that genuinely
        // wants width (nine slot tabs and a thumbnail grid), and the two text
        // pairs beside it are what used to leave 1400px of empty panel each.
        <form onSubmit={handleSelfAccountUpdate} style={settingsStack}>
            <div style={settingsColumns}>
                <div style={settingsCol(560, 2)}>
                    <SettingsPanel icon="bi-person-badge" title="Avatar">
                        {/* No preview frame here: AvatarPicker owns the stage, because a
                            preview outside it can't show the candidate you are hovering. */}
                        <FieldLabel hint="Hover an option to try it on; Shuffle rolls a whole new face.">
                            Choose Avatar
                        </FieldLabel>
                        <AvatarPicker value={selfAvatarId} onChange={setSelfAvatarId} seed={selfUsername} template={currentUser?.role?.default_avatar_id} />
                    </SettingsPanel>
                </div>

                <div style={settingsCol(320, 1)}>
                    <SettingsPanel icon="bi-person-fill" title="Profile">
                        <div style={settingsGrid(200)}>
                            <div>
                                <FieldLabel>Username</FieldLabel>
                                <input
                                    style={xpInput({ width: '100%' })}
                                    value={selfUsername}
                                    onChange={e => setSelfUsername(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <FieldLabel>Full Name</FieldLabel>
                                <input
                                    style={xpInput({ width: '100%' })}
                                    value={selfFullName}
                                    onChange={e => setSelfFullName(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                    </SettingsPanel>

                    <SettingsPanel icon="bi-key-fill" title="Password">
                        <div style={settingsGrid(200)}>
                            <div>
                                <FieldLabel hint="Leave blank to keep your current password.">New Password</FieldLabel>
                                <input
                                    type="password"
                                    style={xpInput({ width: '100%' })}
                                    value={selfPassword}
                                    onChange={e => setSelfPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                            <div>
                                <FieldLabel>Confirm New Password</FieldLabel>
                                <input
                                    type="password"
                                    style={xpInput({ width: '100%' })}
                                    value={selfConfirmPassword}
                                    onChange={e => setSelfConfirmPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                    </SettingsPanel>
                </div>
            </div>

            {/* One submit for all three groups, so it spans the columns — not
                inside the password panel, where it would read as "save password". */}
            <div style={{ ...settingsActions(), marginTop: 0 }}>
                <button
                    type="submit"
                    style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px' })}
                    className={XP_BTN}
                >Save Account</button>
            </div>
        </form>
    );
}

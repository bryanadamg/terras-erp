'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE } from '../components/shared/apiBase';
import { rememberAvatar, rememberIdentity } from '../components/shared/avatarCache';
import { resolveRecipe, serializeRecipe } from '../components/shared/avatarRecipe';

interface Permission {
    id: string;
    code: string;
    description: string;
}

interface Role {
    id: string;
    name: string;
    permissions: Permission[];
    allowed_work_center_types?: string[] | null;
    allowed_categories?: string[] | null;
    allowed_locations?: string[] | null;
    /** Avatar template for users in this role with no saved avatar of their own. */
    default_avatar_id?: string | null;
}

export interface User {

    id: string;

    username: string;

    full_name: string;

    role: Role;

    permissions: Permission[]; // Direct granular permissions

    avatar_id?: string | null;
    is_active: boolean;
    last_login_at?: string | null;
}



/**
 * Ordered boot checkpoints, consumed by BootSplash to draw a determinate bar.
 * Each value is a real awaited stage, so the order here is the order of work:
 * client hydration → read stored token → validate it against /users/me → done.
 */
export type BootPhase = 'hydrating' | 'session' | 'verifying' | 'ready';

interface UserContextType {
    currentUser: User | null;
    users: User[];
    setCurrentUser: (user: User) => void;
    hasPermission: (permissionCode: string) => boolean;
    hasAnyPermission: (...permissionCodes: string[]) => boolean;
    hasWorkCenterScope: (centerType?: string | null) => boolean;
    hasCategoryScope: (categoryId?: string | null) => boolean;
    hasLocationScope: (locationId?: string | null) => boolean;
    refreshUsers: () => Promise<void>;
    login: (username: string, password: string) => Promise<boolean | 'network_error'>;
    logout: () => void;
    loading: boolean;
    bootPhase: BootPhase;
}



const UserContext = createContext<UserContextType | undefined>(undefined);



export function UserProvider({ children }: { children: React.ReactNode }) {

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [bootPhase, setBootPhase] = useState<BootPhase>('hydrating');

    const login = async (username, password): Promise<boolean | 'network_error'> => {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);

        try {
            const res = await fetch(`${API_BASE}/token`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) return false;

            const data = await res.json();
            localStorage.setItem('access_token', data.access_token);
            await fetchCurrentUser(data.access_token);
            return true;
        } catch (e) {
            return 'network_error';
        }
    };

    const logout = () => {
        localStorage.removeItem('access_token');
        setCurrentUser(null);
    };

    const fetchCurrentUser = async (token) => {
        try {
            const res = await fetch(`${API_BASE}/users/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const user = await res.json();
                setCurrentUser(user);
            } else {
                logout();
            }
        } catch (e) {
            logout();
        }
    };

    const refreshUsers = async () => {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        
        try {
            const res = await fetch(`${API_BASE}/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setUsers(await res.json());
            }
        } catch (e) {
            console.error("Failed to fetch users", e);
        }
    };

    // Boot sequence, deliberately split across two effects: setting 'session'
    // and then 'verifying' inside one pass would batch into a single render and
    // the boot bar would skip a step it is supposed to be reporting.
    useEffect(() => { setBootPhase('session'); }, []);

    useEffect(() => {
        if (bootPhase !== 'session') return;
        const token = localStorage.getItem('access_token');
        if (!token) {
            setBootPhase('ready');
            setLoading(false);
            return;
        }
        setBootPhase('verifying');
        fetchCurrentUser(token).finally(() => {
            setBootPhase('ready');
            setLoading(false);
        });
    }, [bootPhase]);

    // Cache the signed-in user's avatar recipe locally so the pre-auth login
    // screen can greet them with their own face. Hooked to currentUser rather
    // than to login() so it also covers session restore and profile saves —
    // including a reset back to the default, which forgets the old recipe.
    useEffect(() => {
        if (!currentUser) return;
        // Remember the EFFECTIVE recipe, not just an explicitly saved one: a role
        // template lives behind auth, so the login screen can't re-derive it from
        // the username the way it can re-derive a plain seeded face. Without this
        // an executive would meet the unconstrained face on the login screen and
        // their real one a second later.
        rememberAvatar(currentUser.username, serializeRecipe(resolveRecipe(
            currentUser.avatar_id,
            currentUser.username,
            currentUser.role?.default_avatar_id,
        )));
        // Same trade as the avatar: the login screen's staff ID card wants a name
        // and a role, both of which sit behind auth. Cached on the way in rather
        // than served to an unauthenticated caller.
        rememberIdentity(currentUser.username, {
            fullName: currentUser.full_name,
            role: currentUser.role?.name,
        });
    }, [currentUser]);

    const hasPermission = (permissionCode: string): boolean => {
        if (!currentUser) return false;
        
        // 1. Check Role permissions
        if (currentUser.role) {
            if (currentUser.role.permissions.some(p => p.code === 'admin.access')) return true;
            if (currentUser.role.permissions.some(p => p.code === permissionCode)) return true;
        }

        // 2. Check Direct (Granular) permissions
        if (currentUser.permissions && currentUser.permissions.some(p => p.code === permissionCode)) {
            return true;
        }
        
        return false;
    };

    const hasAnyPermission = (...permissionCodes: string[]): boolean => {
        return permissionCodes.some(hasPermission);
    };

    const hasWorkCenterScope = (centerType?: string | null): boolean => {
        const allowed = currentUser?.role?.allowed_work_center_types;
        if (!allowed || allowed.length === 0 || !centerType) return true;
        return allowed.includes(centerType);
    };

    const hasCategoryScope = (categoryId?: string | null): boolean => {
        const allowed = currentUser?.role?.allowed_categories;
        if (!allowed || allowed.length === 0 || !categoryId) return true;
        return allowed.includes(categoryId);
    };

    const hasLocationScope = (locationId?: string | null): boolean => {
        const allowed = currentUser?.role?.allowed_locations;
        if (!allowed || allowed.length === 0 || !locationId) return true;
        return allowed.includes(locationId);
    };

    return (
        <UserContext.Provider value={{ currentUser, users, setCurrentUser, hasPermission, hasAnyPermission, hasWorkCenterScope, hasCategoryScope, hasLocationScope, refreshUsers, login, logout, loading, bootPhase }}>
            {children}
        </UserContext.Provider>
    );
}

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) throw new Error('useUser must be used within UserProvider');
    return context;
};

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface Permission {
    id: string;
    code: string;
    description: string;
}

interface Role {
    id: string;
    name: string;
    permissions: Permission[];
}

export interface User {

    id: string;

    username: string;

    full_name: string;

    role: Role;

    permissions: Permission[]; // Direct granular permissions

    allowed_categories?: string[];

}



interface UserContextType {
    currentUser: User | null;
    users: User[];
    setCurrentUser: (user: User) => void;
    hasPermission: (permissionCode: string) => boolean;
    refreshUsers: () => Promise<void>;
    login: (username: string, password: string) => Promise<boolean | 'network_error'>;
    logout: () => void;
    loading: boolean;
}



const UserContext = createContext<UserContextType | undefined>(undefined);



export function UserProvider({ children }: { children: React.ReactNode }) {

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

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

    useEffect(() => {
        const token = localStorage.getItem('access_token');
        if (token) {
            fetchCurrentUser(token).finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);

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

    return (
        <UserContext.Provider value={{ currentUser, users, setCurrentUser, hasPermission, refreshUsers, login, logout, loading }}>
            {children}
        </UserContext.Provider>
    );
}

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) throw new Error('useUser must be used within UserProvider');
    return context;
};

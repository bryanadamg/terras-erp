'use client';

import { useState, useEffect } from 'react';
import MainLayout from '../components/MainLayout';
import SettingsView from '../components/SettingsView';
import { useData } from '../context/DataContext';

export default function SettingsPage() {
    const { fetchData, companyProfile, authFetch } = useData();
    const [appName, setAppName] = useState('Terras ERP');
    const [uiStyle, setUiStyle] = useState('classic');

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    useEffect(() => {
        const savedName = localStorage.getItem('app_name'); if (savedName) setAppName(savedName);
        const savedStyle = localStorage.getItem('ui_style'); if (savedStyle) setUiStyle(savedStyle);
    }, []);

    const handleUpdateAppName = (name: string) => {
        setAppName(name);
        localStorage.setItem('app_name', name);
    };

    const handleUpdateUIStyle = (style: string) => {
        setUiStyle(style);
        localStorage.setItem('ui_style', style);
        window.location.reload(); // Apply globally
    };

    const handleUpdateCompanyProfile = async (profile: any) => {
        const res = await authFetch(`${API_BASE}/settings/company`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profile)
        });
        if (res.ok) fetchData('settings');
    };

    const handleUploadLogo = async (formData: FormData) => {
        const res = await authFetch(`${API_BASE}/settings/company/logo`, {
            method: 'POST',
            body: formData // No Content-Type header for FormData
        });
        if (res.ok) fetchData('settings');
    };

    return (
        <MainLayout>
            <SettingsView 
                appName={appName} 
                onUpdateAppName={handleUpdateAppName} 
                uiStyle={uiStyle} 
                onUpdateUIStyle={handleUpdateUIStyle} 
                companyProfile={companyProfile}
                onUpdateCompanyProfile={handleUpdateCompanyProfile}
                onUploadLogo={handleUploadLogo}
                onClearCache={() => { localStorage.removeItem('terras_master_cache'); fetchData(); }} 
            />
        </MainLayout>
    );
}

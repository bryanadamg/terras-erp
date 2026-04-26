'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import ConfirmModal from '../components/shared/ConfirmModal';

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'warning';
}

interface ConfirmContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmOptions>({ title: 'Confirm', message: '' });
    const [resolveRef, setResolveRef] = useState<((value: boolean) => void) | null>(null);

    const confirm = useCallback((confirmOptions: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            setOptions({
                title: confirmOptions.title || 'Confirm Action',
                message: confirmOptions.message,
                confirmText: confirmOptions.confirmText || 'Confirm',
                variant: confirmOptions.variant || 'danger'
            });
            setResolveRef(() => resolve);
            setIsOpen(true);
        });
    }, []);

    const handleConfirm = useCallback(() => {
        if (resolveRef) resolveRef(true);
        setIsOpen(false);
    }, [resolveRef]);

    const handleCancel = useCallback(() => {
        if (resolveRef) resolveRef(false);
        setIsOpen(false);
    }, [resolveRef]);

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <ConfirmModal 
                isOpen={isOpen}
                onClose={handleCancel}
                onConfirm={handleConfirm}
                title={options.title || 'Confirm'}
                message={options.message}
                confirmText={options.confirmText}
                variant={options.variant}
            />
        </ConfirmContext.Provider>
    );
}

export const useConfirm = () => {
    const context = useContext(ConfirmContext);
    if (!context) throw new Error('useConfirm must be used within ConfirmProvider');
    return context;
};

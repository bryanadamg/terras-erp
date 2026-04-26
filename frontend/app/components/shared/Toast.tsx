'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

type ToastType = 'success' | 'danger' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 2000 }}>
                {toasts.map((toast) => (
                    <div 
                        key={toast.id} 
                        className={`toast show border-0 shadow fade-in mb-2 toast-type-${toast.type}`} 
                        role="alert"
                    >
                        <div className={`toast-body d-flex align-items-center gap-2`}>
                            <i className={`bi ${getIcon(toast.type)}`}></i>
                            {toast.message}
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function getIcon(type: ToastType) {
    switch(type) {
        case 'success': return 'bi-check-circle-fill';
        case 'danger': return 'bi-exclamation-triangle-fill';
        case 'warning': return 'bi-exclamation-circle-fill';
        default: return 'bi-info-circle-fill';
    }
}

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used within ToastProvider');
    return context;
};

'use client';

import React from 'react';
import ModalWrapper from './ModalWrapper';
import { useTheme } from '../../context/ThemeContext';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'warning';
}

const xpConfirmBtn = (variant: 'danger' | 'primary' | 'warning'): React.CSSProperties => {
    const base: React.CSSProperties = {
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11, padding: '3px 20px',
        cursor: 'pointer', borderRadius: 0, border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        background: 'linear-gradient(to bottom, #fff, #d4d0c8)', color: '#000',
    };
    if (variant === 'danger') return {
        ...base,
        background: 'linear-gradient(to bottom, #e08080, #c03030)',
        borderColor: '#e04040 #801010 #801010 #e04040',
        color: '#fff', fontWeight: 'bold',
    };
    if (variant === 'primary') return {
        ...base,
        background: 'linear-gradient(to bottom, #6090e0, #2050c0)',
        borderColor: '#4070d0 #102060 #102060 #4070d0',
        color: '#fff', fontWeight: 'bold',
    };
    return base;
};

const xpCancelBtn: React.CSSProperties = {
    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11, padding: '3px 16px',
    cursor: 'pointer', borderRadius: 0, border: '1px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: 'linear-gradient(to bottom, #fff, #d4d0c8)', color: '#000',
};

export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    variant = 'danger'
}: ConfirmModalProps) {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={<><i className={`bi ${variant === 'danger' ? 'bi-exclamation-triangle' : 'bi-info-circle'} me-1`}></i> {title}</>}
            level={3}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            footer={
                <>
                    {classic ? (
                        <button type="button" style={xpCancelBtn} onClick={onClose}>Cancel</button>
                    ) : (
                        <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={onClose}>Cancel</button>
                    )}
                    {classic ? (
                        <button type="button" style={xpConfirmBtn(variant)} onClick={() => { onConfirm(); onClose(); }}>
                            {confirmText.toUpperCase()}
                        </button>
                    ) : (
                        <button type="button" className={`btn btn-sm btn-${variant} px-4 fw-bold shadow-sm`} onClick={() => { onConfirm(); onClose(); }}>
                            {confirmText.toUpperCase()}
                        </button>
                    )}
                </>
            }
        >
            <p className="mb-0 text-center py-2">{message}</p>
        </ModalWrapper>
    );
}

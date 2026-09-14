'use client';

import React from 'react';
import ModalWrapper from './ModalWrapper';
import { xpFont } from './xpTheme';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'warning' | 'success';
}

const xpConfirmBtn = (variant: 'danger' | 'primary' | 'warning' | 'success'): React.CSSProperties => {
    const base: React.CSSProperties = {
        fontFamily: xpFont, fontSize: 11, padding: '3px 20px',
        cursor: 'pointer', borderRadius: 3, border: '1px solid',
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
    if (variant === 'success') return {
        ...base,
        background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)',
        borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a',
        color: '#fff', fontWeight: 'bold',
    };
    return base;
};

const xpCancelBtn: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, padding: '3px 16px',
    cursor: 'pointer', borderRadius: 3, border: '1px solid',
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

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={<><i className={`bi ${variant === 'danger' || variant === 'warning' ? 'bi-exclamation-triangle' : variant === 'success' ? 'bi-check-circle' : 'bi-info-circle'} me-1`}></i> {title}</>}
            level={3}
            variant={variant === 'danger' ? 'danger' : variant === 'success' ? 'success' : 'primary'}
            size="sm"
            modeless
            footer={
                <>
                    {<button type="button" style={xpCancelBtn} onClick={onClose}>Cancel</button>}
                    {<button type="button" style={xpConfirmBtn(variant)} onClick={() => { onConfirm(); onClose(); }}>
                            {confirmText.toUpperCase()}
                        </button>}
                </>
            }
        >
            <p className="mb-0 text-center py-2">{message}</p>
        </ModalWrapper>
    );
}

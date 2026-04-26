'use client';

import React from 'react';
import ModalWrapper from './ModalWrapper';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'warning';
}

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
            title={<><i className={`bi ${variant === 'danger' ? 'bi-exclamation-triangle' : 'bi-info-circle'} me-1`}></i> {title}</>}
            level={3} // Always top level
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            footer={
                <>
                    <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={onClose}>Cancel</button>
                    <button 
                        type="button" 
                        className={`btn btn-sm btn-${variant} px-4 fw-bold shadow-sm`} 
                        onClick={() => { onConfirm(); onClose(); }}
                    >
                        {confirmText.toUpperCase()}
                    </button>
                </>
            }
        >
            <p className="mb-0 text-center py-2">{message}</p>
        </ModalWrapper>
    );
}

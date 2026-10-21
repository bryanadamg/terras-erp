'use client';

import React from 'react';
import ModalWrapper from './ModalWrapper';
import Button from '@bryanadamg/terras-ui/components/Button';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'warning' | 'success';
}

// `warning` has no orange button anywhere in this app: it confirms on the plain face.
const CONFIRM_TONE = { danger: 'danger', primary: 'primary', success: 'success', warning: 'default' } as const;

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
                    <Button onClick={onClose} style={{ padding: '3px 16px' }}>Cancel</Button>
                    <Button tone={CONFIRM_TONE[variant]} onClick={() => { onConfirm(); onClose(); }} style={{ padding: '3px 20px' }}>
                        {confirmText.toUpperCase()}
                    </Button>
                </>
            }
        >
            <p className="mb-0 text-center py-2">{message}</p>
        </ModalWrapper>
    );
}

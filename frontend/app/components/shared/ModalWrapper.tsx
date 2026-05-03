'use client';

import React, { useState, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';

interface ModalWrapperProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    level?: 1 | 2 | 3;
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    variant?: 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'dark';
}

const xpTitleGradients: Record<string, string> = {
    primary: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
    success: 'linear-gradient(to right, #1a6e1a 0%, #3ab83a 100%)',
    warning: 'linear-gradient(to right, #8e5000 0%, #c87c00 100%)',
    info:    'linear-gradient(to right, #006e8e 0%, #00a8c8 100%)',
    danger:  'linear-gradient(to right, #8e0000 0%, #c84040 100%)',
    dark:    'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
};

const xpTitleBorders: Record<string, string> = {
    primary: '#003080', success: '#0a4e0a', warning: '#5e3000',
    info: '#004a5e', danger: '#5e0000', dark: '#0a0a1e',
};

const xpSizeWidths: Record<string, number> = { sm: 340, md: 480, lg: 640, xl: 820, xxl: 1100 };

export default function ModalWrapper({
    isOpen, onClose, title, children, footer,
    level = 1, size = 'md', variant = 'primary'
}: ModalWrapperProps) {
    const { uiStyle: currentStyle } = useTheme();
    const [closeBtnHov, setCloseBtnHov] = useState(false);
    const backdropMouseDown = useRef(false);

    if (!isOpen) return null;

    const zIndices = { 1: 20000, 2: 20100, 3: 20200 };
    const modalZIndex = zIndices[level];

    // ── XP Dialog ──────────────────────────────────────────────────────────
    if (currentStyle === 'classic') {
        return (
            <div
                style={{
                    position: 'fixed', inset: 0, zIndex: modalZIndex,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseDown={e => { backdropMouseDown.current = e.target === e.currentTarget; }}
                onClick={() => { if (backdropMouseDown.current) onClose(); }}
            >
                <div
                    style={{
                        width: xpSizeWidths[size] || 480, maxWidth: '96vw',
                        border: '2px solid',
                        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                        boxShadow: '4px 4px 12px rgba(0,0,0,0.55)',
                        background: '#ece9d8',
                        borderRadius: 0,
                        display: 'flex', flexDirection: 'column',
                        maxHeight: '92vh',
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* XP Title Bar */}
                    <div style={{
                        background: xpTitleGradients[variant] || xpTitleGradients.primary,
                        color: '#ffffff',
                        fontFamily: 'Tahoma, Arial, sans-serif',
                        fontSize: '12px', fontWeight: 'bold',
                        padding: '4px 6px 4px 8px',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                        borderBottom: `1px solid ${xpTitleBorders[variant] || '#003080'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        minHeight: '26px', gap: 6,
                        userSelect: 'none' as const,
                        flexShrink: 0,
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {title}
                        </span>
                        <button
                            onClick={onClose}
                            onMouseEnter={() => setCloseBtnHov(true)}
                            onMouseLeave={() => setCloseBtnHov(false)}
                            style={{
                                fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', fontWeight: 'bold',
                                width: 21, height: 21, minWidth: 21, cursor: 'pointer',
                                background: closeBtnHov
                                    ? 'linear-gradient(to bottom, #e8a0a0, #c84040)'
                                    : 'linear-gradient(to bottom, #d4c8c8, #a89898)',
                                border: '1px solid',
                                borderColor: closeBtnHov ? '#8e0000 #5e0000 #5e0000 #8e0000' : '#dfdfdf #808080 #808080 #dfdfdf',
                                color: '#ffffff', borderRadius: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1, flexShrink: 0,
                                textShadow: '0 1px 1px rgba(0,0,0,0.5)',
                            }}
                            title="Close"
                        >✕</button>
                    </div>

                    {/* Body — ui-style-classic triggers CSS overrides for Bootstrap controls */}
                    <div
                        className="ui-style-classic"
                        style={{ padding: '12px 14px', overflowY: 'auto', background: '#ece9d8', flex: 1 }}
                    >
                        {children}
                    </div>

                    {/* Footer */}
                    {footer && (
                        <div style={{
                            background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
                            borderTop: '1px solid #b0a898',
                            padding: '6px 10px',
                            display: 'flex', justifyContent: 'flex-end', gap: 4,
                            flexShrink: 0,
                        }}>
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Modern (Bootstrap) ──────────────────────────────────────────────────
    const headerClasses: Record<string, string> = {
        primary: 'bg-primary bg-opacity-10 text-primary-emphasis',
        success: 'bg-success bg-opacity-10 text-success-emphasis',
        warning: 'bg-warning bg-opacity-10 text-warning-emphasis',
        info:    'bg-info bg-opacity-10 text-info-emphasis',
        danger:  'bg-danger bg-opacity-10 text-danger-emphasis',
        dark:    'bg-dark text-white',
    };

    return (
        <div
            className="modal d-block"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: modalZIndex, position: 'fixed', inset: 0, backdropFilter: 'blur(4px)' }}
            onMouseDown={e => { backdropMouseDown.current = e.target === e.currentTarget; }}
            onClick={() => { if (backdropMouseDown.current) onClose(); }}
        >
            <div className={`modal-dialog modal-${size === 'xxl' ? 'xl' : size} modal-dialog-centered`} style={size === 'xxl' ? { maxWidth: 1100 } : undefined} onClick={e => e.stopPropagation()}>
                <div className="modal-content shadow-lg border-0 overflow-hidden">
                    <div className={`modal-header py-2 px-3 border-bottom ${headerClasses[variant]}`}>
                        <h5 className="modal-title small fw-bold d-flex align-items-center gap-2">{title}</h5>
                        <button type="button" className={`btn-close ${variant === 'dark' ? 'btn-close-white' : ''}`} onClick={onClose}></button>
                    </div>
                    <div className="modal-body p-4" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        {children}
                    </div>
                    {footer && (
                        <div className="modal-footer bg-light py-2 px-3 border-top">{footer}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

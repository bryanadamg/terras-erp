'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import ModalWrapper from './ModalWrapper';
import { useToast } from './Toast';
import { lvBtn, lvInput, lvLabel } from './listViewTheme';
import { API_BASE } from './apiBase';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';

type Kind = 'bug' | 'idea' | 'question';

// Header button + form that posts to /feedback, which files a GitHub issue.
// Anonymous unless the sender ticks "include my name" — see api/feedback.py.
export default function FeedbackButton() {
    const { authFetch } = useData();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>('bug');
    const [message, setMessage] = useState('');
    const [includeName, setIncludeName] = useState(false);
    const [sending, setSending] = useState(false);

    const close = () => { setOpen(false); setMessage(''); setIncludeName(false); setKind('bug'); };

    const submit = async () => {
        setSending(true);
        try {
            const res = await authFetch(`${API_BASE}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, message, page: pathname, include_name: includeName }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                showToast(err?.detail || t('feedback_failed'), 'danger');
                return;
            }
            showToast(t('feedback_sent'), 'success');
            close();
        } catch {
            showToast(t('feedback_failed'), 'danger');
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <button data-testid="feedback-btn" className="btn btn-sm btn-light" onClick={() => setOpen(true)} title={t('send_feedback')}>
                <i className="bi bi-chat-square-text"></i>
            </button>
            <ModalWrapper
                isOpen={open}
                onClose={close}
                title={<><i className="bi bi-chat-square-text me-1"></i> {t('send_feedback')}</>}
                size="md"
                modeless
                footer={
                    <>
                        <button type="button" style={lvBtn()} onClick={close}>{t('cancel')}</button>
                        <button type="button" style={lvBtn('primary')} disabled={sending || !message.trim()} onClick={submit}>
                            {sending ? t('saving') : t('send')}
                        </button>
                    </>
                }
            >
                <div className="mb-2">
                    <label style={lvLabel()}>{t('feedback_type')}</label>
                    <select style={lvInput()} value={kind} onChange={e => setKind(e.target.value as Kind)}>
                        <option value="bug">{t('feedback_bug')}</option>
                        <option value="idea">{t('feedback_idea')}</option>
                        <option value="question">{t('feedback_question')}</option>
                    </select>
                </div>
                <div className="mb-2">
                    <label style={lvLabel()}>{t('feedback_message')}</label>
                    <textarea
                        style={{ ...lvInput(), height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const }}
                        rows={5}
                        maxLength={5000}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        autoFocus
                    />
                </div>
                <label className="d-flex align-items-center gap-2" style={{ ...lvLabel(), cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeName} onChange={e => setIncludeName(e.target.checked)} />
                    {t('feedback_include_name')}
                </label>
                <div style={{ fontSize: 10, color: '#666' }}>
                    {includeName ? t('feedback_named_hint') : t('feedback_anonymous_hint')}
                </div>
            </ModalWrapper>
        </>
    );
}

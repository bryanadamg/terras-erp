'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import FeedbackDialog, { type FeedbackReport } from '@bryanadamg/terras-ui/components/FeedbackDialog';
import { useToast } from './Toast';
import { API_BASE } from './apiBase';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';

// Header button that opens terras-ui's shared FeedbackDialog; the dialog's
// report posts to /feedback, which files a GitHub issue. Anonymous unless the
// sender ticks "include my name" — see api/feedback.py.
export default function FeedbackButton() {
    const { authFetch } = useData();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    const submit = async (report: FeedbackReport) => {
        const res = await authFetch(`${API_BASE}/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...report, page: pathname }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.detail || t('feedback_failed'));
        }
        showToast(t('feedback_sent'), 'success');
    };

    return (
        <>
            <button data-testid="feedback-btn" className="btn btn-sm btn-light" onClick={() => setOpen(true)} title={t('send_feedback')}>
                <i className="bi bi-chat-square-text"></i>
            </button>
            {open && (
                <FeedbackDialog
                    onClose={() => setOpen(false)}
                    onSubmit={submit}
                    icon={<i className="bi bi-chat-square-text"></i>}
                    labels={{
                        title: t('send_feedback'),
                        type: t('feedback_type'),
                        bug: t('feedback_bug'),
                        idea: t('feedback_idea'),
                        question: t('feedback_question'),
                        message: t('feedback_message'),
                        includeName: t('feedback_include_name'),
                        anonymousHint: t('feedback_anonymous_hint'),
                        namedHint: t('feedback_named_hint'),
                        cancel: t('cancel'),
                        send: t('send'),
                        sending: t('feedback_sending'),
                        failed: t('feedback_failed'),
                    }}
                />
            )}
        </>
    );
}

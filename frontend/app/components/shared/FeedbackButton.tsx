'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import FeedbackDialog, { type FeedbackReport } from '@bryanadamg/terras-ui/components/FeedbackDialog';
import { useToast } from './Toast';
import { API_BASE } from './apiBase';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useLanguage } from '../../context/LanguageContext';

// Header button that opens terras-ui's shared FeedbackDialog; the dialog's
// report posts to /feedback, which files a GitHub issue. Anonymous unless the
// sender ticks "include my name" — see api/feedback.py.
//
// An unsent message is kept as a draft so closing the dialog (or reloading)
// doesn't lose it. sessionStorage, keyed by user: it goes when the tab does, so
// on a shared shop-floor PC the next person never opens someone else's
// half-written — and possibly anonymous — report. Screenshots aren't kept;
// they're too big for it.
const draftKey = (userId: string) => `terras-feedback-draft:${userId}`;

function readDraft(userId: string): string {
    try {
        return sessionStorage.getItem(draftKey(userId)) || '';
    } catch {
        return '';
    }
}

function saveDraft(userId: string, message: string) {
    try {
        if (message) sessionStorage.setItem(draftKey(userId), message);
        else sessionStorage.removeItem(draftKey(userId));
    } catch {
        // Storage blocked (private mode): the draft just isn't kept.
    }
}

export default function FeedbackButton() {
    const { authFetch } = useData();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const pathname = usePathname();
    const { currentUser } = useUser();
    const userId = currentUser?.id ?? '';
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
        // 202 + queued: saved on the server, waiting for its retry loop to
        // reach GitHub — not lost, but not in the inbox yet either.
        const { queued } = await res.json();
        saveDraft(userId, '');
        showToast(t(queued ? 'feedback_queued' : 'feedback_sent'), 'success');
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
                    defaultMessage={readDraft(userId)}
                    onMessageChange={(message) => saveDraft(userId, message)}
                    icon={<i className="bi bi-chat-square-text"></i>}
                    labels={{
                        title: t('send_feedback'),
                        message: t('feedback_message'),
                        attach: t('feedback_attach'),
                        pasteHint: t('feedback_paste_hint'),
                        editHint: t('feedback_edit_hint'),
                        blackoutHint: t('feedback_blackout_hint'),
                        undo: t('feedback_undo'),
                        done: t('feedback_done'),
                        remove: t('feedback_remove'),
                        limit: t('feedback_limit'),
                        tooLarge: t('feedback_too_large'),
                        notImage: t('feedback_not_image'),
                        includeName: t('feedback_include_name'),
                        anonymousHint: t('feedback_anonymous_hint'),
                        namedHint: t('feedback_named_hint'),
                        cancel: t('cancel'),
                        send: t('send'),
                        sending: t('feedback_sending'),
                        failed: t('feedback_failed'),
                        offline: t('feedback_offline'),
                    }}
                />
            )}
        </>
    );
}

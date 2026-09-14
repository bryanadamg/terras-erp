'use client';

import React from 'react';
import UIToastProvider, { useToast as usePackageToast } from '@bryanadamg/terras-ui/components/Toast';
import type { ToastTone } from '@bryanadamg/terras-ui/components/Toast';

/**
 * Transient feedback — now a thin adapter over terras-ui's Toast, which was
 * merged from this file and terras-sku's. What the package brings that this
 * didn't have: a close button on every toast, a 4-visible cap that drops the
 * oldest (never a running progress toast), per-tone durations (an error holds
 * 7s against a success's 4s, because an error is read rather than glanced at),
 * `role="alert"`/`aria-live="assertive"` on errors only, and ReactNode messages.
 * The progress toast is this app's own, carried over unchanged.
 *
 * Kept as a local module with the old function names so the 56 call sites are
 * untouched: `showToast(message, type)` and `showProgressToast(message, detail)`.
 * The package's tones are colour words (its one vocabulary across every
 * component); this file owns the semantic→colour map so no call site has to
 * re-decide what "danger" looks like.
 */

type ToastType = 'success' | 'danger' | 'warning' | 'info' | 'error';

// 'error' is an alias for 'danger' — both were in use here before, and dropping
// either would be a silent no-op at ~370 call sites.
const TONE: Record<ToastType, ToastTone> = {
    success: 'green',
    danger: 'red',
    error: 'red',
    warning: 'amber',
    info: 'blue',
};

// The package ships no icon set (sku draws these with lucide), so the tone→node
// map is a slot. Colour has to be set here: the package paints only the toast's
// left stripe in the tone, and leaves the icon to whatever it is handed.
const ICONS: Record<ToastTone, React.ReactNode> = {
    green: <i className="bi bi-check-circle-fill" style={{ color: 'var(--terras-status-green)' }} />,
    red: <i className="bi bi-exclamation-triangle-fill" style={{ color: 'var(--terras-status-red)' }} />,
    amber: <i className="bi bi-exclamation-circle-fill" style={{ color: 'var(--terras-status-amber)' }} />,
    blue: <i className="bi bi-info-circle-fill" style={{ color: 'var(--terras-status-blue)' }} />,
};

/**
 * Handle for a single long-running operation's toast. One toast is created up front
 * and mutated in place, instead of emitting a toast per completed unit of work.
 */
export interface ProgressToastHandle {
    /** pct is 0-100. Pass a detail line to describe the current unit of work. */
    update: (pct: number, detail?: string) => void;
    /** Replace with a final success message and start the auto-dismiss timer. */
    finish: (message: React.ReactNode, type?: ToastType) => void;
    /** Replace with a failure message (danger) and start the auto-dismiss timer. */
    fail: (message: React.ReactNode) => void;
    /** Drop it now, without a final message. */
    dismiss: () => void;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    return <UIToastProvider icons={ICONS}>{children}</UIToastProvider>;
}

export function useToast() {
    const toast = usePackageToast();

    return React.useMemo(() => ({
        // Type defaults to 'info', as it did here before the package landed —
        // the package's own `show` defaults to green, and the ~37 single-argument
        // calls in this app are all neutral notices.
        showToast: (message: React.ReactNode, type: ToastType = 'info') =>
            toast.show(message, TONE[type] ?? 'blue'),

        showProgressToast: (message: React.ReactNode, detail?: string): ProgressToastHandle => {
            const job = toast.progress(message, detail);
            return {
                update: job.update,
                finish: (finalMessage, type: ToastType = 'success') =>
                    job.finish(finalMessage, TONE[type] ?? 'green'),
                fail: job.fail,
                dismiss: job.dismiss,
            };
        },
    }), [toast]);
}

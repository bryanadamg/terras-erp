'use client';
import React, { useRef } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { MODAL_Z, MODAL_REPOSITION_EVENT, useInactiveChromeWhileOpen, WindowCloseButton } from './ModalWrapper';
import { toLayoutPx } from './uiScale';
import { xpFont, XP_BTN, xpBtn, BTN_TONES, WINDOW_RADIUS, WINDOW_RADIUS_INNER } from './xpTheme';

interface PrintModalShellProps {
    title: React.ReactNode;
    onClose: () => void;
    children: React.ReactNode;   // body + footer, exactly as each print modal already built them —
                                 // shell only replaces the backdrop/panel/header boilerplate that was
                                 // byte-for-byte duplicated across all 10 print modals.
    width?: string;
    maxWidth?: number;
    height?: string;
    bevel?: boolean;             // classic 2px bevel border on the panel (defaults true — matches the
                                 // majority; pass false for the print types that never had it, to keep
                                 // this refactor visually a no-op).
    /**
     * Modeless window: no backdrop, background page stays interactive, panel is
     * draggable by its title bar. Ignored on mobile (falls back to a normal
     * blocking modal). Matches ModalWrapper's `modeless`.
     */
    modeless?: boolean;
}

// Shared shell for print-preview modals (WO/BOM/Sample/SO/PO/StockLedger/DyeRecipe print).
// These are transient, always-on-top actions — same tier as ConfirmModal (level 3) so a
// print triggered from inside an already-open modeless modal still renders above it.
// Previously each of the 10 print modals hand-rolled this exact backdrop+header shell with
// a hardcoded `zIndex: 2000`, which is BELOW ModalWrapper's MODAL_Z scale (20000+) — opening
// a print from inside an open modal rendered it underneath, unreachable. Fixed by reusing
// the same MODAL_Z constant ModalWrapper itself exports for this exact "can't use
// ModalWrapper directly" case.
export default function PrintModalShell({
    title, onClose, children,
    width = 'calc(var(--app-vw) * 90 / 100)', maxWidth = 960, height = 'calc(var(--app-vh) * 88 / 100)',
    bevel = true, modeless = false,
}: PrintModalShellProps) {
    const isMobile = useIsMobile();
    const floating = modeless && !isMobile;

    // Mounted == open for this shell, so the page chrome behind it is inactive
    // for its whole life (same signal ModalWrapper uses).
    useInactiveChromeWhileOpen(true);

    const panelRef = useRef<HTMLDivElement>(null);
    const dragOffset = useRef({ x: 0, y: 0 });

    // Drag mutates the DOM transform directly (no React re-render), mirroring
    // ModalWrapper — stays smooth on old hardware, and dispatches the shared
    // reposition event so anchored portaled dropdowns stay glued.
    const startDrag = (e: React.PointerEvent) => {
        if (!floating || !panelRef.current) return;
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const base = { ...dragOffset.current };
        const el = panelRef.current;
        const onMove = (ev: PointerEvent) => {
            // Screen-px pointer delta → layout-px transform. See uiScale.ts.
            dragOffset.current = {
                x: base.x + toLayoutPx(ev.clientX - startX),
                y: base.y + toLayoutPx(ev.clientY - startY),
            };
            el.style.transform = `translate(calc(-50% + ${dragOffset.current.x}px), ${dragOffset.current.y}px)`;
            window.dispatchEvent(new Event(MODAL_REPOSITION_EVENT));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const headerStyle: React.CSSProperties = {
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#fff',
        fontFamily: xpFont, fontSize: 12, fontWeight: 'bold',
        borderRadius: `${WINDOW_RADIUS_INNER}px ${WINDOW_RADIUS_INNER}px 0 0`,
        padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        cursor: floating ? 'move' : undefined, touchAction: floating ? 'none' : undefined, userSelect: floating ? 'none' : undefined,
    };

    const panel = (
        <div
            ref={panelRef}
            style={{
                width, maxWidth, height, display: 'flex', flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)', background: '#fff',
                // Same frame radius as ModalWrapper — a print dialog is a window too.
                borderRadius: WINDOW_RADIUS, overflow: 'hidden',
                ...(bevel ? { border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf' } : {}),
                ...(floating ? {
                    position: 'fixed' as const, left: '50%', top: 56,
                    transform: `translate(calc(-50% + ${dragOffset.current.x}px), ${dragOffset.current.y}px)`,
                    zIndex: MODAL_Z[3],
                } : {}),
            }}
            onClick={e => e.stopPropagation()}
        >
            <div style={headerStyle} onPointerDown={floating ? startDrag : undefined}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{title}</span>
                <WindowCloseButton onClose={onClose} white={false} />
            </div>
            {children}
        </div>
    );

    // Modeless: no backdrop, background page stays interactive.
    if (floating) return panel;

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: MODAL_Z[3], display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={onClose}
        >
            {panel}
        </div>
    );
}

// The Close / Print bar every print modal ends with. All 16 of them hand-rolled it:
// the same padded strip, the same optional left-hand note, and the same pair of
// buttons — but with three different button faces (classic-inline + bootstrap,
// classic-inline in BOTH themes, and a pale-green XP variant), each carrying its own
// copy of the XP gradient. That is where `xpBtnGrey`/`xpBtnGreen`/`btnGreen` came
// from; they are gone. One footer, so a print dialog looks the same wherever it is
// opened from, and the button chrome lives in ONE place.
export function PrintModalFooter({ note, onClose, onPrint, printDisabled = false, printLabel = 'Print', closeLabel = 'Close' }: {
    /** Left-aligned hint ("Settings saved automatically"). Omitted → buttons sit right. */
    note?: React.ReactNode;
    onClose: () => void;
    onPrint: () => void;
    /** Nothing to print yet (no bags/lots/cartons) — greys the Print button. */
    printDisabled?: boolean;
    printLabel?: string;
    closeLabel?: string;
}) {
    const grey = xpBtn({ padding: '3px 12px' });
    const green = xpBtn({ ...BTN_TONES.success, padding: '3px 14px', opacity: printDisabled ? 0.5 : 1 });
    return (
        <div style={{
            padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', flexShrink: 0,
            display: 'flex', justifyContent: note ? 'space-between' : 'flex-end', alignItems: 'center', gap: 6,
        }}>
            {note && <span style={{ fontSize: 10, color: '#666' }}>{note}</span>}
            <div style={{ display: 'flex', gap: 6 }}>
                {<>
                        <button type="button" className={XP_BTN} style={grey} onClick={onClose}>{closeLabel}</button>
                        <button type="button" className={XP_BTN} style={green} disabled={printDisabled} onClick={onPrint}>
                            <i className="bi bi-printer" style={{ marginRight: 4 }} />{printLabel}
                        </button>
                    </>}
            </div>
        </div>
    );
}

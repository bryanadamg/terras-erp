import { useEffect, type RefObject } from 'react';

/**
 * Keep a scan box ready for a USB (keyboard-wedge) scanner, which types into
 * whatever has focus. Focuses the box while `active`, and pulls any stray
 * printable keystroke (focus on the page body or a button) back into it —
 * focusing on keydown lands that same character in the box, so none is lost.
 * Keystrokes into another field are left alone.
 */
export function useScannerFocus(ref: RefObject<HTMLInputElement | null>, active = true) {
    useEffect(() => {
        if (!active) return;
        ref.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement as HTMLElement | null;
            if (!ref.current || el === ref.current) return;
            if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
            ref.current.focus();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [ref, active]);
}

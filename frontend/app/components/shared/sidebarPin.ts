// Pinned = the full-width sidebar that stays open; unpinned = the 44px rail that
// opens on hover. Remembered per browser.
//
// A plain module, not part of Sidebar.tsx: layout.tsx (a server component) runs
// SIDEBAR_PIN_BOOT in <head> before first paint, so the boot placeholder is
// already drawn at the right width, and it cannot import from a client module.
export const SIDEBAR_PIN_KEY = 'terras_sidebar_pinned';

// Pinned unless the user unpinned it: with no stored choice the sidebar is the
// full one everyone already knows, and the hover rail is something to opt into
// with the pin — never a layout that changes under someone on their first day.
// (That also covers touch screens, which have no hover to open a rail with.)
export const SIDEBAR_PIN_BOOT =
  `try{if(localStorage.getItem('${SIDEBAR_PIN_KEY}')!=='0')` +
  `document.documentElement.setAttribute('data-sidebar-pinned','')}catch(e){}`;

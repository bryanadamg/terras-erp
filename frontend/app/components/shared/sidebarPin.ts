// Pinned = the full-width sidebar that stays open; unpinned = the 44px rail that
// opens on hover. Remembered per browser.
//
// A plain module, not part of Sidebar.tsx: layout.tsx (a server component) runs
// SIDEBAR_PIN_BOOT in <head> before first paint, so the boot placeholder is
// already drawn at the right width, and it cannot import from a client module.
export const SIDEBAR_PIN_KEY = 'terras_sidebar_pinned';

// A touch screen can't hover a rail open, so with no stored choice it starts pinned.
export const SIDEBAR_PIN_BOOT =
  `try{var v=localStorage.getItem('${SIDEBAR_PIN_KEY}');` +
  `if(v===null?matchMedia('(hover: none)').matches:v==='1')` +
  `document.documentElement.setAttribute('data-sidebar-pinned','')}catch(e){}`;

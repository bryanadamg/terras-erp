import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import TerrasSidebar from '@bryanadamg/terras-ui/components/Sidebar';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { NAV_SECTIONS, navLabel, leafPermissions } from './navConfig';
import { xpFont, BUTTON_RADIUS, XP_BTN, CHIP_RADIUS } from './xpTheme';
import PixelAvatar from './PixelAvatar';
import { SIDEBAR_PIN_KEY } from './sidebarPin';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onTabHover?: (tab: string) => void;
  appName: string;
  isOpen?: boolean;
}

// Exported so BootShell (the pre-auth skeleton reusing this same layout) can
// paint the identical colors instead of drifting out of sync with a second
// hand-rolled palette. Read from terras-ui's tokens so a palette bump follows.
export const SIDEBAR_BG = 'var(--terras-sidebar-bg, #f6f8fc)';
const NAV_COLOR = 'var(--terras-sidebar-active-color, #10276b)';

// Rail ↔ open, for erp's own slot content: the package keeps one layout and
// slides it (its "glide"), so these do the same — text widens and fades rather
// than mounting into a 44px box and wrapping for a frame.
// The shell's motion curve (globals.css --terras-sidebar-motion: a soft
// overshoot opening, a slow-then-quick release closing), shared with the
// package's own glide so Quick Scan and the ID card move with the rail.
const GLIDE = 'var(--terras-sidebar-motion, 0.12s)';
const glideText = (shown: boolean, maxWidth: number): React.CSSProperties => ({
  display: 'inline-block',
  maxWidth: shown ? maxWidth : 0,
  opacity: shown ? 1 : 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  verticalAlign: 'bottom',
  transition: `max-width ${GLIDE}, opacity ${GLIDE}, margin-left ${GLIDE}`,
});

function readPinned(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.hasAttribute('data-sidebar-pinned');
}

/**
 * erp's nav on terras-ui's Sidebar, the same component sku and crm use. This
 * file keeps what is erp's: the nav tree, permissions, i18n, the hover
 * prefetch, Quick Scan, the credit line and the ID card. The rail itself
 * (brand band, rows, section bands, footer strip) is the package's.
 *
 * The `.sidebar` wrapper stays: globals.css positions it (fixed, full height,
 * 200px, the mobile slide-in) and hides it in print, and BootShell paints the
 * same class while booting.
 */
export default function Sidebar({ activeTab, setActiveTab, onTabHover, appName, isOpen }: SidebarProps) {
  const { t } = useLanguage();
  const { currentUser, hasPermission } = useUser();
  const navRef = useRef<HTMLElement>(null);
  // Proximity growth is written straight onto the wrapper as --rail-approach,
  // not through state: it changes on every pointer move in the zone and only
  // the width rule in globals.css reads it.
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The boot script already settled the stored choice (default: pinned) onto <html>.
  const [pinned, setPinned] = useState(readPinned);
  // Drawn width, as the package reports it (pinned, or hover-opened). The
  // `is-rail` class off it is what globals.css sizes the shell from.
  const [expanded, setExpanded] = useState(pinned);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-sidebar-pinned', pinned);
  }, [pinned]);
  const togglePinned = () => setPinned((p) => {
    try { localStorage.setItem(SIDEBAR_PIN_KEY, p ? '0' : '1'); } catch {}
    return !p;
  });

  // Persist scroll position
  useLayoutEffect(() => {
    const savedScroll = sessionStorage.getItem('terras_sidebar_scroll');
    if (savedScroll && navRef.current) {
      navRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  const handleScroll = () => {
    if (navRef.current) {
      sessionStorage.setItem('terras_sidebar_scroll', navRef.current.scrollTop.toString());
    }
  };

  // Hover paint for the nav rows is the package's; this state only lights the
  // two controls erp draws itself (Quick Scan, the ID card).
  const [hovered, setHovered] = useState<string | null>(null);
  const prefetchTimer = useRef<any>(null);
  // Debounced prefetch of the hovered tab's data, so the fetch overlaps the
  // hover→click gap. Debounce avoids firing on fast mouse traversal — only a
  // deliberate pause triggers it. fetchData dedupes, so the later click/page-mount
  // fetch joins this in-flight request instead of repeating it.
  const prefetch = (key: string) => ({
    onMouseEnter: () => {
      if (onTabHover) {
        if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
        prefetchTimer.current = setTimeout(() => onTabHover(key), 180);
      }
    },
    onMouseLeave: () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    },
  });
  const H = (key: string) => {
    const p = prefetch(key);
    return {
      onMouseEnter: () => { setHovered(key); p.onMouseEnter(); },
      onMouseLeave: () => { setHovered(null); p.onMouseLeave(); },
    };
  };

  const go = (tab: string) => {
    setActiveTab(tab);
    if (onTabHover) onTabHover(tab);
  };

  const navItem = (tab: string, label: string, icon: string, sub = false) => ({
    key: tab,
    label,
    // Its own 12px line box: the package centres icons in a line-height-0 slot,
    // which would drop erp's row height by ~2px.
    icon: (
      <span style={{ width: 14, textAlign: 'center', fontSize: 12, lineHeight: 1.5 }}>
        <i className={`bi ${icon}`} />
      </span>
    ),
    sub,
    active: activeTab === tab,
    onClick: () => go(tab),
    ...prefetch(tab),
  });

  const sections = NAV_SECTIONS.flatMap((section) => {
    if (section.permissions && !section.permissions.some((p) => hasPermission(p))) return [];
    const visibleItems = section.items.filter((i) => {
      const codes = leafPermissions(i);
      return codes.length === 0 || codes.some((p) => hasPermission(p));
    });
    if (visibleItems.length === 0) return [];
    // The band navigates to the section's home mini-dashboard. It lights when
    // that page is open; the package also lights it while any child row is.
    const navKey = `sections/${section.key}`;
    return [{
      key: section.key,
      label: navLabel(t, section),
      // erp's band reads "<i/> LABEL": an inline icon and a space, not the
      // package's 5px flex gap. Rebuilt here (nbsp, so it isn't collapsed, and
      // the gap cancelled) so the label sits where it always has. One version in
      // both states — swapping it as the rail opened made the icon jump.
      icon: (
        <span style={{ marginRight: -5 }}>
          <i className={`bi ${section.icon}`} />{'\u00a0'}
        </span>
      ),
      right: <i className="bi bi-chevron-right" style={{ fontSize: 9, opacity: 0.7 }} aria-hidden="true" />,
      active: activeTab === `sections-${section.key}`,
      onClick: () => setActiveTab(navKey),
      ...prefetch(navKey),
      items: visibleItems.map((i) => navItem(i.tab, navLabel(t, i), i.icon, true)),
    }];
  });

  return (
    <div
      ref={wrapperRef}
      className={`sidebar${expanded ? '' : ' is-rail'}${isOpen ? ' mobile-open' : ''}`}
      style={{ background: SIDEBAR_BG, display: 'flex' }}
    >
      <TerrasSidebar
        expandOnHover
        // From 48px out the rail grows toward the cursor, in step with how close
        // it is (--rail-approach, up to 20px, over the gutter — the table does
        // not move), and opens outright once it meets it. A cursor heading for
        // it at speed opens it at once; one slowing into the table's first
        // column beside it only sees the small growth.
        approachDistance={48}
        onApproach={(p) => wrapperRef.current?.style.setProperty('--rail-approach', String(p))}
        collapsed={!pinned}
        onToggleCollapsed={togglePinned}
        // The band's pin: tilted outline = not pinned (hover rail), upright and
        // filled = pinned. Same metaphor as a pinned tab or note.
        pinIcon={({ pinned: isPinned }) => (
          <i className={`bi ${isPinned ? 'bi-pin-fill' : 'bi-pin-angle'}`} style={{ fontSize: 11 }} aria-hidden="true" />
        )}
        onExpandedChange={setExpanded}
        // The `.sidebar` wrapper owns the width (globals.css animates it from
        // `is-rail`); the package fills it in both states.
        width="100%"
        collapsedWidth="100%"
        // The `.sidebar` wrapper draws the right edge (globals.css); a second
        // one here would double it.
        style={{ borderRight: 'none' }}
        brandIcon={
          <img
            className="app-brand-icon"
            src="/icons/icon-192.png"
            alt={appName}
            data-no-tip
            style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 3 }}
          />
        }
        navRef={navRef}
        onNavScroll={handleScroll}
        top={({ collapsed }) => (
          <button
            className={XP_BTN}
            onClick={() => setActiveTab('scanner')}
            {...H('scanner')}
            title={collapsed ? 'Quick Scan' : undefined}
            style={{
              width: '100%',
              padding: '6px 0',
              borderRadius: BUTTON_RADIUS,
              background: hovered === 'scanner' ? '#2a6ce4' : '#1a5cd4',
              border: '1px solid #003088',
              color: '#fff',
              fontFamily: xpFont,
              fontSize: 11,
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <i className="bi bi-qr-code-scan" />
            <span style={{ ...glideText(!collapsed, 120), marginLeft: collapsed ? 0 : 6 }}>QUICK SCAN</span>
          </button>
        )}
        items={[navItem('dashboard', t('dashboard') || 'Dashboard', 'bi-house-door')]}
        sections={sections}
        // Rides at the end of the nav list, so the footer holds nothing but the
        // user card.
        navEnd={({ collapsed }) => (
          <div style={{ padding: '10px 8px 12px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <small style={{ fontSize: 9, color: '#6070a0', fontFamily: xpFont, opacity: collapsed ? 0 : 1, transition: `opacity ${GLIDE}` }}>
              {t('powered_by') || 'Powered by'} Terras ERP
            </small>
          </div>
        )}
        // On the rail the card keeps only its face (no spine, name, role or
        // gear), and takes a tooltip there since nothing else names it.
        footer={({ collapsed }) => (
          // Sole entry point to Settings — open to every user; the page itself
          // gates its admin-only tabs (Database & Backups, Access Control) via
          // hasPermission('admin.access').
          <button
            data-testid="user-dropdown"
            className={`${XP_BTN} sidebar-id-card`}
            onClick={() => setActiveTab('settings')}
            {...H('settings')}
            /* The card already shows name + role + a gear; a "Settings" title on
               top would double up, and stack with GlobalTooltip's clip-echo for
               the name/role spans. Same opt-out as the login ID card. */
            data-no-tip={collapsed ? undefined : true}
            title={collapsed ? `${currentUser?.full_name || currentUser?.username || ''} — Settings` : undefined}
            style={{
              width: '100%',
              padding: 0,
              borderRadius: 6,
              position: 'relative',
              background: hovered === 'settings'
                ? 'linear-gradient(to bottom, #ffffff, #e6ecfa)'
                : 'linear-gradient(to bottom, #f7f9ff, #dde4f4)',
              borderTop: '1px solid #fff',
              borderLeft: '1px solid #fff',
              borderRight: '1px solid #7b86a8',
              borderBottom: '1px solid #7b86a8',
              color: NAV_COLOR,
              fontFamily: xpFont,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'stretch',
              textAlign: 'left',
              overflow: 'hidden',
            }}
          >
            {/* Accent spine — the coloured edge of the ID card. */}
            {/* One layout in both states: the spine and padding slide to zero
                on the rail, where the face alone fills the 32px inside. */}
            <div style={{
              width: collapsed ? 0 : 3,
              flexShrink: 0,
              background: 'linear-gradient(to bottom, #4a7ddb, #003080)',
              transition: `width ${GLIDE}`,
            }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1,
              padding: collapsed ? 1 : '5px 7px',
              transition: `padding ${GLIDE}`,
            }}>
              {/* Photo frame */}
              <div style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fff',
                border: '1px solid #7b86a8',
                borderRadius: 4,
                boxShadow: 'inset 1px 1px 0 #e8edf8',
              }}>
                <PixelAvatar
                  avatarId={currentUser?.avatar_id}
                  seed={currentUser?.username}
                  template={currentUser?.role?.default_avatar_id}
                  size={24}
                />
              </div>
              <div style={{
                minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1,
                opacity: collapsed ? 0 : 1, transition: `opacity ${GLIDE}`,
              }}>
                <span
                  data-testid="username-display"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 'bold',
                    color: NAV_COLOR,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentUser?.full_name || currentUser?.username}
                </span>
                <span style={{
                  marginTop: 1,
                  alignSelf: 'flex-start',
                  maxWidth: '100%',
                  fontSize: 8.5,
                  fontWeight: 'bold',
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                  padding: '0 4px',
                  borderRadius: CHIP_RADIUS,
                  background: '#c9d6f2',
                  border: '1px solid #8f9dc4',
                  color: '#26365f',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {currentUser?.role?.name || '—'}
                </span>
              </div>
              <i
                className="bi bi-gear-fill"
                style={{
                  fontSize: 11,
                  flexShrink: 0,
                  color: hovered === 'settings' ? '#003080' : '#7b86a8',
                  opacity: collapsed ? 0 : 1,
                  transition: `opacity ${GLIDE}`,
                }}
              />
            </div>
          </button>
        )}
      />
    </div>
  );
}

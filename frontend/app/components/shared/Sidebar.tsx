import { Fragment, useState, useRef, useLayoutEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { NAV_SECTIONS, navLabel, leafPermissions, NavSection } from './navConfig';
import { xpFont, BUTTON_RADIUS, XP_BTN, CHIP_RADIUS } from './xpTheme';
import PixelAvatar from './PixelAvatar';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onTabHover?: (tab: string) => void;
  appName: string;
  isOpen?: boolean;
}


// Exported so BootShell (the pre-auth skeleton reusing this same layout) can
// paint the identical colors instead of drifting out of sync with a second
// hand-rolled palette.
export const SIDEBAR_BG   = '#d6dff7';
const SUB_BG       = '#bcc9e8';
const SUB_BG_DEEP  = '#a8b4cc';
const HOVER_BG     = '#0058e6';
const ACTIVE_BG    = '#ffffff';
const ACTIVE_COLOR = '#003080';
const NAV_COLOR    = '#003080';
const HDR_BORDER_B = '#003080';

function navItemStyle(
  isActive: boolean,
  isHovered: boolean,
  isSub = false,
  isDeepSub = false,
): React.CSSProperties {
  const bg = isHovered ? HOVER_BG
           : isActive  ? ACTIVE_BG
           : isDeepSub ? SUB_BG_DEEP
           : isSub     ? SUB_BG
           : 'transparent';
  return {
    padding: isDeepSub ? '3px 8px 3px 28px'
           : isSub     ? '4px 8px 4px 22px'
           : '5px 8px 5px 14px',
    color:      isHovered ? '#fff' : ACTIVE_COLOR,
    background: bg,
    fontWeight: isActive ? 'bold' : 'normal',
    borderLeft: isActive && !isHovered ? `3px solid ${HOVER_BG}` : '3px solid transparent',
    borderBottom: '1px solid #c0ccee',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: isSub ? 10.5 : 11,
    fontFamily: xpFont,
    userSelect: 'none' as const,
    transition: 'background 0.08s',
    textDecoration: 'none',
    listStyle: 'none',
  };
}

function sectionHdrStyle(isHovered: boolean): React.CSSProperties {
  return {
    background: isHovered
      ? 'linear-gradient(to right, #2a7cff, #0058e6)'
      : 'linear-gradient(to right, #0058e6, #003080)',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 10,
    padding: '4px 8px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    borderTop: '1px solid #7090cc',
    borderBottom: `1px solid ${HDR_BORDER_B}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontFamily: xpFont,
    transition: 'background 0.08s',
  };
}

export default function Sidebar({ activeTab, setActiveTab, onTabHover, appName, isOpen }: SidebarProps) {
  const { t } = useLanguage();
  const { currentUser, hasPermission } = useUser();
  const navStyle = navItemStyle;
  const hdrStyle = sectionHdrStyle;
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Persist scroll position
  useLayoutEffect(() => {
    const savedScroll = sessionStorage.getItem('terras_sidebar_scroll');
    if (savedScroll && sidebarRef.current) {
      sidebarRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, []);

  const handleScroll = () => {
    if (sidebarRef.current) {
      sessionStorage.setItem('terras_sidebar_scroll', sidebarRef.current.scrollTop.toString());
    }
  };

  const [hovered, setHovered] = useState<string | null>(null);
  const prefetchTimer = useRef<any>(null);
  // Hover handlers: set hover styling, and (debounced) prefetch that tab's data so the
  // fetch overlaps the hover→click gap. Debounce avoids firing on fast mouse traversal —
  // only a deliberate pause on an item triggers the prefetch. fetchData dedupes, so the
  // later click/page-mount fetch joins this in-flight request instead of repeating it.
  const H = (key: string) => ({
    onMouseEnter: () => {
      setHovered(key);
      if (onTabHover) {
        if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
        prefetchTimer.current = setTimeout(() => onTabHover(key), 180);
      }
    },
    onMouseLeave: () => {
      setHovered(null);
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    },
  });

  const handleTabClick = (tab: string, e: React.MouseEvent) => {
    e.preventDefault();
    setActiveTab(tab);
    if (onTabHover) onTabHover(tab);
  };

  // Shorthand: a nav link row
  const NavItem = ({
    tab, label, icon, isSub = false, isDeepSub = false,
  }: { tab: string; label: string; icon: string; isSub?: boolean; isDeepSub?: boolean }) => (
    <div
      style={navStyle(activeTab === tab, hovered === tab, isSub, isDeepSub)}
      onClick={(e) => handleTabClick(tab, e)}
      {...H(tab)}
    >
      <span style={{ width: 14, textAlign: 'center', fontSize: 12}}><i className={`bi ${icon}`} /></span>
      <span>{label}</span>
    </div>
  );

  // Section header — clickable, navigates to that section's home mini-dashboard.
  // Highlighted when its own page OR any child page is active, so the group-level
  // "where am I" never gets lost.
  const SectionHeader = ({ section, childActive }: { section: NavSection; childActive: boolean }) => {
    const navKey = `sections/${section.key}`;
    const active = activeTab === `sections-${section.key}` || childActive;
    return (
      <div style={hdrStyle(hovered === navKey || active)} onClick={() => setActiveTab(navKey)} {...H(navKey)}>
        <span><i className={`bi ${section.icon}`} /> {navLabel(t, section)}</span>
        <i className="bi bi-chevron-right" style={{ fontSize: 9, opacity: 0.7}} aria-hidden="true" />
      </div>
    );
  };

  return (
    <div
      className={`sidebar ${isOpen ? 'mobile-open' : ''}`}
      style={{
        background: SIDEBAR_BG,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: xpFont,
      }}
    >
      {/* ── Header ──
          Same height and same chrome as the page header it sits beside
          (`--app-header-h`, globals.css): the two are separate elements, so any
          difference breaks the top band at the sidebar seam. It was 40 tall with
          a 2px border against a 30px / 1px header. Height comes from the var —
          don't re-type the number here. */}
      <div style={{
        background: 'var(--xp-title-flat)',
        padding: '0 10px',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        borderBottom: '1px solid var(--xp-title-blue-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
        userSelect: 'none',
        height: 'var(--app-header-h)',
      }}>
        <img
          className="app-brand-icon"
          src="/icons/icon-192.png"
          alt={appName}
          data-no-tip
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: 3,
          }}
        />
      </div>

      <div className="sidebar-nav" ref={sidebarRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── Quick Scan ── */}
        <div style={{ padding: '8px 8px 4px'}}>
          <button
            className={XP_BTN}
            onClick={() => setActiveTab('scanner')}
            {...H('scanner')}
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
              gap: 6,
              letterSpacing: '0.5px',
            }}
          >
            <i className="bi bi-qr-code-scan" /> QUICK SCAN
          </button>
        </div>

        {/* ── Dashboard ── */}
        <NavItem tab="dashboard" label={t('dashboard') || 'Dashboard'} icon="bi-house-door" />

        {/* ── Sections (single source of truth: navConfig.ts) ── */}
        {NAV_SECTIONS.map((section) => {
          if (section.permissions && !section.permissions.some((p) => hasPermission(p))) return null;
          const visibleItems = section.items.filter((i) => {
            const codes = leafPermissions(i);
            return codes.length === 0 || codes.some((p) => hasPermission(p));
          });
          if (visibleItems.length === 0) return null;
          return (
            <Fragment key={section.key}>
              <SectionHeader section={section} childActive={visibleItems.some((i) => i.tab === activeTab)} />
              {visibleItems.map((i) => (
                <NavItem key={i.tab} tab={i.tab} label={navLabel(t, i)} icon={i.icon} isSub />
              ))}
            </Fragment>
          );
        })}

        {/* Credit line rides at the end of the nav list, so the footer holds
            nothing but the user card. */}
        <div style={{ padding: '10px 8px 12px', textAlign: 'center' }}>
          <small style={{ fontSize: 9, color: '#6070a0', fontFamily: xpFont}}>
            {t('powered_by') || 'Powered by'} Terras ERP
          </small>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        background: '#c0cade',
        borderTop: '1px solid #9098b8',
        padding: '6px 8px',
        flexShrink: 0,
      }}>
        {/* Sole entry point to Settings — open to every user; the page itself
            gates its admin-only tabs (Database & Backups, Access Control) via
            hasPermission('admin.access'). Used to be split between this footer
            (admin-only "System Admin") and a top-right avatar pill; merged into
            one so there's a single, consistent way in. */}
        <button
          data-testid="user-dropdown"
          className={`${XP_BTN} sidebar-id-card`}
          onClick={() => setActiveTab('settings')}
          {...H('settings')}
          /* Card already shows name + role + a gear icon - a "Settings" title
             on top just doubles up on what's already legible, and doubled as
             a second stacked box with GlobalTooltip's clip-echo for the name/
             role spans underneath it. Same opt-out as the login ID card. */
          data-no-tip
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
          <div style={{
            width: 3,
            flexShrink: 0,
            background: 'linear-gradient(to bottom, #4a7ddb, #003080)',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', minWidth: 0, flex: 1 }}>
            {/* Photo frame */}
            <div style={{
              width: 30,
              height: 30,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fff',
              ...({
                border: '1px solid #7b86a8',
                borderRadius: 4,
                boxShadow: 'inset 1px 1px 0 #e8edf8',
              }),
            }}>
              <PixelAvatar
                avatarId={currentUser?.avatar_id}
                seed={currentUser?.username}
                template={currentUser?.role?.default_avatar_id}
                size={24}
              />
            </div>
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
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
              }}
            />
          </div>
        </button>
      </div>
    </div>
  );
}

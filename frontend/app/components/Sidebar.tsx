import { useState, useRef, useLayoutEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onTabHover?: (tab: string) => void;
  appName: string;
  isOpen?: boolean;
}

const xpFont = 'Tahoma, "Segoe UI", sans-serif';

const SIDEBAR_BG   = '#d6dff7';
const SUB_BG       = '#bcc9e8';
const SUB_BG_DEEP  = '#a8b4cc';
const HOVER_BG     = '#316ac5';
const ACTIVE_BG    = '#ffffff';
const ACTIVE_COLOR = '#00309c';
const NAV_COLOR    = '#00309c';
const HDR_BORDER_B = '#0a2060';

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
    borderLeft: isActive && !isHovered ? '3px solid #316ac5' : '3px solid transparent',
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
      ? 'linear-gradient(to right, #4070c8, #2a4da0)'
      : 'linear-gradient(to right, #3060b8, #1a3d90)',
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
  const { hasPermission, logout } = useUser();
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

  const [inventoryExpanded,   setInventoryExpanded]   = useState(true);
  const [attributesExpanded,  setAttributesExpanded]  = useState(false);
  const [salesExpanded,       setSalesExpanded]       = useState(true);
  const [procurementExpanded, setProcurementExpanded] = useState(true);
  const [engineeringExpanded, setEngineeringExpanded] = useState(true);
  const [reportsExpanded,     setReportsExpanded]     = useState(true);

  const [hovered, setHovered] = useState<string | null>(null);
  const H = (key: string) => ({ onMouseEnter: () => setHovered(key), onMouseLeave: () => setHovered(null) });

  const handleTabClick = (tab: string, e: React.MouseEvent) => {
    e.preventDefault();
    setActiveTab(tab);
    if (onTabHover) onTabHover(tab);
  };

  const chevron = (expanded: boolean) => (
    <span style={{ fontSize: 10, opacity: 0.85 }}>{expanded ? '▾' : '▸'}</span>
  );

  // Shorthand: a nav link row
  const NavItem = ({
    tab, label, icon, isSub = false, isDeepSub = false,
  }: { tab: string; label: string; icon: string; isSub?: boolean; isDeepSub?: boolean }) => (
    <div
      style={navItemStyle(activeTab === tab, hovered === tab, isSub, isDeepSub)}
      onClick={(e) => handleTabClick(tab, e)}
      {...H(tab)}
    >
      <span style={{ width: 14, textAlign: 'center', fontSize: 12 }}>{icon}</span>
      <span>{label}</span>
    </div>
  );

  return (
    <div
      className={`sidebar ${isOpen ? 'mobile-open' : ''}`}
      ref={sidebarRef}
      onScroll={handleScroll}
      style={{ background: SIDEBAR_BG, display: 'flex', flexDirection: 'column', fontFamily: xpFont }}
    >
      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(to bottom, #1e4eb8 0%, #0a246a 100%)',
        padding: '8px 10px',
        color: '#fff',
        fontSize: 13,
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        flexShrink: 0,
        borderBottom: '2px solid #0a246a',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        letterSpacing: '0.2px',
        userSelect: 'none',
        fontFamily: xpFont,
        minHeight: 40,
      }}>
        <span style={{ fontSize: 18 }}>🏭</span>
        <span className="text-truncate" title={appName}>{appName}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── Quick Scan ── */}
        <div style={{ padding: '8px 8px 4px' }}>
          <button
            onClick={() => setActiveTab('scanner')}
            {...H('scanner')}
            style={{
              width: '100%',
              padding: '6px 0',
              background: hovered === 'scanner'
                ? 'linear-gradient(to bottom, #5a9af4, #2a6ce4)'
                : 'linear-gradient(to bottom, #4a8af4, #1a5cd4)',
              borderTop: '1px solid #90c0ff',
              borderLeft: '1px solid #90c0ff',
              borderRight: '1px solid #003088',
              borderBottom: '1px solid #003088',
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
            <span>⬛</span> QUICK SCAN
          </button>
        </div>

        {/* ── Dashboard ── */}
        <NavItem tab="dashboard" label={t('dashboard') || 'Dashboard'} icon="🏠" />

        {/* ── Sales ── */}
        <div
          style={sectionHdrStyle(hovered === 'hdr-sales')}
          onClick={() => setSalesExpanded(!salesExpanded)}
          {...H('hdr-sales')}
        >
          <span>📈 {t('sales') || 'Sales'}</span>
          {chevron(salesExpanded)}
        </div>
        {salesExpanded && (
          <>
            <NavItem tab="sales-orders" label={t('sales_orders') || 'Sales Orders'} icon="📄" isSub />
            <NavItem tab="customers"    label={t('customers') || 'Customers'}        icon="👥" isSub />
            <NavItem tab="samples"      label={t('sample_requests') || 'Sample Requests'} icon="🧪" isSub />
          </>
        )}

        {/* ── Procurement ── */}
        <div
          style={sectionHdrStyle(hovered === 'hdr-procurement')}
          onClick={() => setProcurementExpanded(!procurementExpanded)}
          {...H('hdr-procurement')}
        >
          <span>🛒 {t('procurement') || 'Procurement'}</span>
          {chevron(procurementExpanded)}
        </div>
        {procurementExpanded && (
          <>
            <NavItem tab="purchase-orders" label={t('purchase_orders') || 'Purchase Orders'} icon="🛍" isSub />
            <NavItem tab="suppliers"        label={t('suppliers') || 'Suppliers'}              icon="🚚" isSub />
          </>
        )}

        {/* ── Inventory ── */}
        {(hasPermission('inventory.manage') || hasPermission('stock.entry') || hasPermission('locations.manage')) && (
          <>
            <div
              style={sectionHdrStyle(hovered === 'hdr-inventory')}
              onClick={() => setInventoryExpanded(!inventoryExpanded)}
              {...H('hdr-inventory')}
            >
              <span>📦 {t('inventory') || 'Inventory'}</span>
              {chevron(inventoryExpanded)}
            </div>
            {inventoryExpanded && (
              <>
                {hasPermission('inventory.manage') && (
                  <>
                    <NavItem tab="inventory"     label={t('item_inventory') || 'Item Inventory'} icon="📋" isSub />
                    <NavItem tab="sample-masters" label={t('sample_masters') || 'Sample Masters'} icon="🧡" isSub />

                    {/* Nested: Attributes & Metadata */}
                    <div
                      style={{
                        ...navItemStyle(
                          ['attributes','categories','uom'].includes(activeTab),
                          hovered === 'hdr-attrs',
                          true,
                        ),
                        justifyContent: 'space-between',
                      }}
                      onClick={() => setAttributesExpanded(!attributesExpanded)}
                      {...H('hdr-attrs')}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, textAlign: 'center', fontSize: 12 }}>🏷</span>
                        <span>{t('attributes') || 'Attributes'} &amp; Metadata</span>
                      </span>
                      {chevron(attributesExpanded)}
                    </div>
                    {attributesExpanded && (
                      <>
                        <NavItem tab="attributes" label="Variants"              icon="🎨" isSub isDeepSub />
                        <NavItem tab="categories" label={t('categories') || 'Categories'} icon="🔲" isSub isDeepSub />
                        <NavItem tab="uom"         label="UOM"                   icon="📏" isSub isDeepSub />
                      </>
                    )}
                  </>
                )}
                {hasPermission('stock.entry') && (
                  <NavItem tab="stock"     label={t('stock_entry') || 'Stock Entry'} icon="↔" isSub />
                )}
                {hasPermission('locations.manage') && (
                  <NavItem tab="locations" label={t('locations') || 'Locations'}     icon="📍" isSub />
                )}
              </>
            )}
          </>
        )}

        {/* ── Engineering ── */}
        {(hasPermission('manufacturing.manage') || hasPermission('work_order.manage')) && (
          <>
            <div
              style={sectionHdrStyle(hovered === 'hdr-engineering')}
              onClick={() => setEngineeringExpanded(!engineeringExpanded)}
              {...H('hdr-engineering')}
            >
              <span>⚙ {t('engineering') || 'Engineering'}</span>
              {chevron(engineeringExpanded)}
            </div>
            {engineeringExpanded && (
              <>
                {hasPermission('manufacturing.manage') && (
                  <>
                    <NavItem tab="bom"     label={t('bom') || 'BOM'}     icon="🗂" isSub />
                    <NavItem tab="routing" label={t('routing') || 'Routing'} icon="🔀" isSub />
                  </>
                )}
                {hasPermission('work_order.manage') && (
                  <NavItem tab="manufacturing" label={t('work_orders') || 'Work Orders'} icon="⚙" isSub />
                )}
              </>
            )}
          </>
        )}

        {/* ── Reports ── */}
        {hasPermission('reports.view') && (
          <>
            <div
              style={sectionHdrStyle(hovered === 'hdr-reports')}
              onClick={() => setReportsExpanded(!reportsExpanded)}
              {...H('hdr-reports')}
            >
              <span>📊 {t('reports') || 'Reports'}</span>
              {chevron(reportsExpanded)}
            </div>
            {reportsExpanded && (
              <>
                <NavItem tab="reports"    label={t('stock_ledger') || 'Stock Ledger'} icon="📒" isSub />
                {hasPermission('admin.access') && (
                  <NavItem tab="audit-logs" label="Audit Logs" icon="📝" isSub />
                )}
              </>
            )}
          </>
        )}

        {/* ── System Admin ── */}
        {hasPermission('admin.access') && (
          <NavItem tab="settings" label="System Admin" icon="🔒" />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        background: '#c0cade',
        borderTop: '1px solid #9098b8',
        padding: '7px 8px',
        flexShrink: 0,
      }}>
        <button
          onClick={logout}
          {...H('logout')}
          style={{
            width: '100%',
            padding: '4px 0',
            background: hovered === 'logout'
              ? 'linear-gradient(to bottom, #ffffff, #e0dcd4)'
              : 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
            borderTop: '1px solid #fff',
            borderLeft: '1px solid #fff',
            borderRight: '1px solid #555',
            borderBottom: '1px solid #555',
            color: '#800000',
            fontFamily: xpFont,
            fontSize: 11,
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span>⬚</span> {t('logout') || 'Logout'}
        </button>
        <div style={{ marginTop: 5, textAlign: 'center' }}>
          <small style={{ fontSize: 9, color: '#6070a0', fontFamily: xpFont }}>
            {t('powered_by') || 'Powered by'} Teras ERP
          </small>
        </div>
      </div>
    </div>
  );
}

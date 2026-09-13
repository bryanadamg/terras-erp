import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useUser } from '../../context/UserContext';
import { xpToolbar as sharedXpToolbar, ShellWindow, ShellTitleBar } from '../shared/shellTheme';
import { lvTh, lvRow, LV_XP_FONT, LV_MODERN_FONT, lvThead } from '../shared/listViewTheme';
import { StatusChip, CODE_FONT, xpFont, xpBtn, TableSkeleton, useTableSkeletonMetrics, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { useData } from '../../context/DataContext';
import Pager from '../shared/Pager';

// entity_type is a raw model name (WorkOrder, attribute_value, work_center_holiday, ...) — humanize for display.
function formatEntityType(entityType: string): string {
    return entityType
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(' ')
        .filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

const AuditLogRow = memo(({ log, rowIndex, userName }: any) => {
    const [showChanges, setShowChanges] = useState(false);
    const { formatDateTime: tzDateTime } = useTimezone();
    const userShort = log.user_id ? log.user_id.split('-')[0] : 'System';
    const userLabel = userName || (log.user_id ? `User ${userShort}` : 'System');

    if (true) {
        const rowStyle = { ...lvRow(true, rowIndex ?? 0), cursor: log.changes ? 'pointer' : 'default' };
        return (
            <>
                <tr
                    style={showChanges ? { ...rowStyle, background: '#e8f0ff' } : rowStyle}
                    onClick={() => log.changes && setShowChanges(!showChanges)}
                >
                    <td style={{ padding: '3px 8px', fontFamily: LV_XP_FONT, fontSize: '10px', color: '#555' }}>
                        {tzDateTime(log.timestamp)}
                    </td>
                    <td style={{ padding: '3px 8px', fontFamily: LV_XP_FONT, fontSize: '11px', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.user_id}>
                        {userLabel}
                    </td>
                    <td style={{ padding: '3px 8px', overflow: 'hidden' }}>
                        <StatusChip status={log.action} title={log.action.replace(/_/g, ' ')} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                    </td>
                    <td style={{ padding: '3px 8px', overflow: 'hidden' }} title={log.entity_id}>
                        <span style={{ borderRadius: CHIP_RADIUS, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#e0dfd8', border: '1px solid #b0a898', padding: '1px 5px', fontFamily: LV_XP_FONT, fontSize: '10px', color: '#333' }}>{formatEntityType(log.entity_type)}</span>
                    </td>
                    <td style={{ padding: '3px 8px', fontFamily: LV_XP_FONT, fontSize: '11px', color: '#444' }}>
                        {log.details}
                        {log.changes && (
                            <i className={`bi bi-chevron-${showChanges ? 'up' : 'down'} ms-2`} style={{ color: '#0058e6', fontSize: '10px' }}></i>
                        )}
                    </td>
                </tr>
                {showChanges && log.changes && (
                    <tr style={{ background: '#f0f4ff' }}>
                        <td colSpan={5} style={{ padding: 0 }}>
                            <div style={{ padding: '6px 12px 8px 32px', borderBottom: '1px solid #c0bdb5' }}>
                                <div style={{ fontFamily: LV_XP_FONT, fontSize: '10px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase', marginBottom: 4 }}>Technical Diff (JSON)</div>
                                <pre style={{ fontFamily: CODE_FONT, fontSize: '10px', background: '#ffffff', border: '1px solid #7f9db9', padding: '4px 6px', margin: 0, maxHeight: '160px', overflowY: 'auto', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' }}>
                                    {JSON.stringify(log.changes, null, 2)}
                                </pre>
                            </div>
                        </td>
                    </tr>
                )}
            </>
        );
    }

    return (
        <>
            <tr style={{ ...lvRow(false, rowIndex ?? 0), cursor: log.changes ? 'pointer' : 'default' }} onClick={() => log.changes && setShowChanges(!showChanges)}>
                <td className="ps-4 text-muted" style={{ fontFamily: CODE_FONT }}>{tzDateTime(log.timestamp)}</td>
                <td><span className="fw-medium text-dark text-truncate d-inline-block" style={{ maxWidth: '100%' }} title={log.user_id}>{userLabel}</span></td>
                <td style={{ overflow: 'hidden' }}>
                    <StatusChip status={log.action} title={log.action.replace(/_/g, ' ')} style={{ fontFamily: LV_MODERN_FONT, borderRadius: 4, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                </td>
                <td className="text-truncate" title={log.entity_id}>
                    <span className="badge bg-light text-dark border fw-normal">{formatEntityType(log.entity_type)}</span>
                </td>
                <td className="text-muted">
                    {log.details}
                    {log.changes && <i className={`bi bi-chevron-${showChanges ? 'up' : 'down'} ms-2 text-primary`}></i>}
                </td>
            </tr>
            {showChanges && log.changes && (
                <tr className="bg-light bg-opacity-50">
                    <td colSpan={5} className="p-0">
                        <div className="p-3 ps-5 border-bottom shadow-inner">
                            <h6 className="extra-small fw-bold text-uppercase text-muted mb-2">Technical Diff (JSON)</h6>
                            <pre className="extra-small mb-0 overflow-auto bg-white p-2 border rounded" style={{ maxHeight: '200px', fontFamily: CODE_FONT }}>
                                {JSON.stringify(log.changes, null, 2)}
                            </pre>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
});

AuditLogRow.displayName = 'AuditLogRow';

export default function AuditLogsView({ auditLogs, currentPage, totalItems, pageSize, onPageChange, filterType, onFilterChange }: any) {
  const { t } = useLanguage();
  const { users, refreshUsers } = useUser();
  const { loading: dataLoading, fetchData } = useData();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { if (users.length === 0) refreshUsers(); }, []);

  const handleRefresh = async () => {
      if (refreshing) return;
      setRefreshing(true);
      try { await fetchData('audit-logs'); } finally { setRefreshing(false); }
  };

  const userNameById = useMemo(() => Object.fromEntries(
      users.map((u: any) => [u.id, u.full_name || u.username])
  ), [users]);

  // Skeleton sizing: measure one real row so the placeholders shown on the next
  // load are exactly as tall as the rows that replace them. Classic and modern
  // rows differ in height, so they cache under separate keys.
  const listBodyRef = useRef<HTMLTableSectionElement>(null);
  const skel = useTableSkeletonMetrics('audit-logs-classic', listBodyRef, auditLogs.length > 0);

  // ── XP inline styles ─────────────────────────────────────────────────────
  const xpToolbar: React.CSSProperties = sharedXpToolbar();
  const xpSelect: React.CSSProperties = {
      fontFamily: xpFont, fontSize: '11px', border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 4px',
      background: '#ffffff', color: '#000000', height: '22px', outline: 'none',
  };
  const xpSep: React.CSSProperties = {
      width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
  };

  const entityFilterOptions = (
      <>
          <option value="">All Entities</option>
          <option value="Item">Items</option>
          <option value="BOM">BOMs</option>
          <option value="WorkOrder">Work Orders</option>
          <option value="SalesOrder">Sales Orders</option>
          <option value="SampleRequest">Samples</option>
          <option value="StockEntry">Stock</option>
      </>
  );

  return (
      <ShellWindow classic fill="page" className="fade-in">
          <ShellTitleBar
              classic
              icon="bi-shield-check"
              title="System Audit Logs"
              subtitle={undefined}
              right={undefined}
          />

          {(
              <div style={xpToolbar}>
                  <button className={XP_BTN} style={xpBtn()} onClick={handleRefresh} disabled={refreshing} title="Refresh">
                      <i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }} />{refreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <div style={xpSep} />
                  <i className="bi bi-funnel" style={{ fontSize: '11px', color: '#666' }}></i>
                  <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#444' }}>Entity:</span>
                  <select style={{ ...xpSelect, width: 150 }} value={filterType} onChange={e => onFilterChange(e.target.value)}>
                      {entityFilterOptions}
                  </select>
                  <div style={xpSep} />
                  <span style={{ marginLeft: 'auto', fontFamily: xpFont, fontSize: '11px', color: '#444' }}>
                      <b>{totalItems}</b> total entries · click a row to expand diff
                  </span>
              </div>
          )}

          <div style={{ flex: 1, minHeight: 0, background: '#ffffff', overflowY: 'auto', overflowX: 'hidden' }}>
              <table
                  className={undefined}
                  style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}
              >
                  <thead style={{ ...lvThead(true), position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                          <th style={{ ...lvTh(true), width: 140 }} className={undefined}>Timestamp</th>
                          <th style={{ ...lvTh(true), width: 110 }}>User</th>
                          <th style={{ ...lvTh(true), width: 140 }}>Action</th>
                          <th style={{ ...lvTh(true), width: 160 }}>Entity</th>
                          <th style={{ ...lvTh(true), borderRight: 'none' }}>Details</th>
                      </tr>
                  </thead>
                  <tbody ref={listBodyRef}>
                      {auditLogs.map((log: any, i: number) => (
                          <AuditLogRow key={log.id} log={log} rowIndex={i} userName={userNameById[log.user_id]} />
                      ))}
                      {auditLogs.length === 0 && (dataLoading.auditLogs ? (
                          <TableSkeleton rows={8} cols={skel.cols ?? 5} classic rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                      ) : <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', fontFamily: xpFont, fontSize: '11px', color: '#666', fontStyle: 'italic' }}>
                              No activity logs found
                          </td></tr>)}
                  </tbody>
              </table>
          </div>

          <Pager page={currentPage} total={totalItems} pageSize={pageSize} onPageChange={onPageChange} />
      </ShellWindow>
  );
}

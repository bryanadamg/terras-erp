import React, { useState, memo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

function getActionXPStyle(action: string): React.CSSProperties {
    const map: Record<string, { bg: string; border: string; color: string }> = {
        CREATE:        { bg: '#e8f5e9', border: '#2e7d32', color: '#1b4620' },
        UPDATE:        { bg: '#fff8e1', border: '#c77800', color: '#4a3000' },
        DELETE:        { bg: '#fce4ec', border: '#b71c1c', color: '#6b0000' },
        UPDATE_STATUS: { bg: '#e3f2fd', border: '#1565c0', color: '#0a3070' },
    };
    const s = map[action] || { bg: '#e8e8e8', border: '#6a6a6a', color: '#222' };
    return {
        background: s.bg, border: `1px solid ${s.border}`, color: s.color,
        padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma,Arial,sans-serif',
        fontWeight: 'bold', whiteSpace: 'nowrap' as const,
    };
}

function getActionColor(action: string) {
    switch (action) {
        case 'CREATE': return 'success';
        case 'UPDATE': return 'warning';
        case 'DELETE': return 'danger';
        case 'UPDATE_STATUS': return 'info';
        default: return 'secondary';
    }
}

const AuditLogRow = memo(({ log, classic }: any) => {
    const [showChanges, setShowChanges] = useState(false);

    if (classic) {
        return (
            <>
                <tr
                    style={{ cursor: log.changes ? 'pointer' : 'default', background: showChanges ? '#e8f0ff' : undefined }}
                    onClick={() => log.changes && setShowChanges(!showChanges)}
                >
                    <td style={{ padding: '3px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#555', fontVariant: 'all-small-caps' }}>
                        {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: '3px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>
                        User {log.user_id ? log.user_id.split('-')[0] : 'System'}
                    </td>
                    <td style={{ padding: '3px 8px' }}>
                        <span style={getActionXPStyle(log.action)}>{log.action}</span>
                    </td>
                    <td style={{ padding: '3px 8px' }}>
                        <span style={{ background: '#e0dfd8', border: '1px solid #b0a898', padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#333' }}>{log.entity_type}</span>
                        <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#777', marginLeft: 4 }}>{log.entity_id.split('-')[0]}…</span>
                    </td>
                    <td style={{ padding: '3px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>
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
                                <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase', marginBottom: 4 }}>Technical Diff (JSON)</div>
                                <pre style={{ fontFamily: 'Consolas,monospace', fontSize: '10px', background: '#ffffff', border: '1px solid #7f9db9', padding: '4px 6px', margin: 0, maxHeight: '160px', overflowY: 'auto', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' }}>
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
            <tr style={{ cursor: log.changes ? 'pointer' : 'default' }} onClick={() => log.changes && setShowChanges(!showChanges)}>
                <td className="ps-4 text-muted font-monospace">{new Date(log.timestamp).toLocaleString()}</td>
                <td><span className="fw-medium text-dark">User {log.user_id ? log.user_id.split('-')[0] : 'System'}</span></td>
                <td>
                    <span className={`badge bg-${getActionColor(log.action)} bg-opacity-10 text-${getActionColor(log.action)} border border-${getActionColor(log.action)} border-opacity-25`}>
                        {log.action}
                    </span>
                </td>
                <td>
                    <span className="badge bg-light text-dark border">{log.entity_type}</span>
                    <span className="ms-1 font-monospace text-muted">{log.entity_id.split('-')[0]}...</span>
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
                            <pre className="extra-small font-monospace mb-0 overflow-auto bg-white p-2 border rounded" style={{ maxHeight: '200px' }}>
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
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';

  const totalPages = Math.ceil(totalItems / pageSize);
  const startRange = (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalItems);

  // ── XP inline styles ─────────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = {
      border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  };
  const xpTitleBar: React.CSSProperties = {
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', minHeight: '26px', flexWrap: 'wrap' as const, gap: 4,
  };
  const xpToolbar: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
      padding: '3px 6px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' as const,
  };
  const xpBtn = (extra: any = {}) => ({
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px', cursor: 'pointer',
      background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)', border: '1px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000', borderRadius: 0, ...extra,
  });
  const xpSelect: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 4px',
      background: '#ffffff', color: '#000000', height: '22px', outline: 'none',
  };
  const xpSep: React.CSSProperties = {
      width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
  };
  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderBottom: '2px solid #808080',
      fontSize: '10px', fontWeight: 'bold', color: '#000000',
  };

  if (classic) {
      return (
          <div className="fade-in">
              <div style={xpBevel}>
                  {/* Title bar */}
                  <div style={xpTitleBar}>
                      <span><i className="bi bi-shield-check" style={{ marginRight: 6 }}></i>System Audit Logs</span>
                      <span style={{ fontSize: '10px', opacity: 0.85 }}>Track all user activities and system changes</span>
                  </div>

                  {/* Filters toolbar */}
                  <div style={xpToolbar}>
                      <i className="bi bi-funnel" style={{ fontSize: '11px', color: '#666' }}></i>
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>Entity:</span>
                      <select style={{ ...xpSelect, width: 150 }} value={filterType} onChange={e => onFilterChange(e.target.value)}>
                          <option value="">All Entities</option>
                          <option value="Item">Items</option>
                          <option value="BOM">BOMs</option>
                          <option value="WorkOrder">Work Orders</option>
                          <option value="SalesOrder">Sales Orders</option>
                          <option value="SampleRequest">Samples</option>
                          <option value="StockEntry">Stock</option>
                      </select>
                      <div style={xpSep} />
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>
                          Showing <b>{startRange}</b>–<b>{endRange}</b> of <b>{totalItems}</b> logs
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                          <button style={{ ...xpBtn(), opacity: currentPage <= 1 ? 0.5 : 1 }} disabled={currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>
                              <i className="bi bi-chevron-left"></i> Prev
                          </button>
                          <span style={{ ...xpBtn({ cursor: 'default', background: '#ece9d8' }), fontWeight: 'bold', padding: '2px 8px' }}>
                              {currentPage} / {totalPages || 1}
                          </span>
                          <button style={{ ...xpBtn(), opacity: currentPage >= totalPages ? 0.5 : 1 }} disabled={currentPage >= totalPages} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}>
                              Next <i className="bi bi-chevron-right"></i>
                          </button>
                      </div>
                  </div>

                  {/* Table */}
                  <div style={{ background: '#ffffff', overflowX: 'auto', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                              <tr>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 150 }}>Timestamp</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 110 }}>User</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 100 }}>Action</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 160 }}>Entity</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px' }}>Details</th>
                              </tr>
                          </thead>
                          <tbody>
                              {auditLogs.map((log: any, i: number) => (
                                  <React.Fragment key={log.id}>
                                      <AuditLogRow log={log} classic={true} rowIndex={i} />
                                  </React.Fragment>
                              ))}
                              {auditLogs.length === 0 && (
                                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', fontStyle: 'italic' }}>No activity logs found</td></tr>
                              )}
                          </tbody>
                      </table>
                  </div>

                  {/* Status bar */}
                  <div style={{
                      background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                      padding: '2px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                  }}>
                      <span><b>{totalItems}</b> total entries · Click a row to expand diff details</span>
                  </div>
              </div>
          </div>
      );
  }

  // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
  return (
      <div className="card fade-in border-0 shadow-sm">
          <div className="card-header bg-white d-flex justify-content-between align-items-center">
              <div>
                  <h5 className="card-title mb-0">System Audit Logs</h5>
                  <p className="text-muted small mb-0 mt-1">Track all user activities and system changes. Click rows to see technical details.</p>
              </div>
              <div className="d-flex gap-2">
                  <div className="input-group input-group-sm" style={{ width: '180px' }}>
                      <span className="input-group-text px-2"><i className="bi bi-funnel"></i></span>
                      <select className="form-select" value={filterType} onChange={e => onFilterChange(e.target.value)}>
                          <option value="">All Entities</option>
                          <option value="Item">Items</option>
                          <option value="BOM">BOMs</option>
                          <option value="WorkOrder">Work Orders</option>
                          <option value="SalesOrder">Sales Orders</option>
                          <option value="SampleRequest">Samples</option>
                          <option value="StockEntry">Stock</option>
                      </select>
                  </div>
              </div>
          </div>
          <div className="card-body p-0">
              <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0 small">
                      <thead className="table-light">
                          <tr>
                              <th className="ps-4">Timestamp</th>
                              <th>User</th>
                              <th>Action</th>
                              <th>Entity</th>
                              <th>Details</th>
                          </tr>
                      </thead>
                      <tbody>
                          {auditLogs.map((log: any) => (
                              <AuditLogRow key={log.id} log={log} classic={false} />
                          ))}
                          {auditLogs.length === 0 && <tr><td colSpan={5} className="text-center py-5 text-muted">No activity logs found</td></tr>}
                      </tbody>
                  </table>
              </div>
          </div>
          <div className="card-footer bg-white border-top py-2 px-4 d-flex justify-content-between align-items-center">
              <div className="small text-muted font-monospace">Showing {startRange}-{endRange} of {totalItems} logs</div>
              <div className="btn-group">
                  <button className={`btn btn-sm btn-light border ${currentPage <= 1 ? 'disabled opacity-50' : ''}`} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>
                      <i className="bi bi-chevron-left me-1"></i>Previous
                  </button>
                  <div className="btn btn-sm btn-white border-top border-bottom px-3 fw-bold">Page {currentPage} of {totalPages || 1}</div>
                  <button className={`btn btn-sm btn-light border ${currentPage >= totalPages ? 'disabled opacity-50' : ''}`} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}>
                      Next<i className="bi bi-chevron-right ms-1"></i>
                  </button>
              </div>
          </div>
      </div>
  );
}

import { useState } from 'react';
import SearchableSelect from './SearchableSelect';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

export default function ReportsView({
    stockEntries,
    items,
    locations,
    categories,
    onRefresh,
    currentPage,
    totalItems,
    pageSize,
    onPageChange
}: any) {
  const { t } = useLanguage();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';

  const totalPages = Math.ceil(totalItems / pageSize);
  const startRange = (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalItems);

  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

  const handlePrint = () => window.print();

  const filteredEntries = stockEntries.filter((entry: any) => {
      const date = new Date(entry.created_at);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      if (start && date < start) return false;
      if (end) {
          const endDateTime = new Date(end);
          endDateTime.setHours(23, 59, 59, 999);
          if (date > endDateTime) return false;
      }
      if (categoryFilter) {
          const item = items.find((i: any) => i.id === entry.item_id);
          if (!item || item.category !== categoryFilter) return false;
      }
      return true;
  });

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
  const xpInput: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 6px',
      background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
  };
  const xpSelect: React.CSSProperties = { ...xpInput, height: '22px' };
  const xpSep: React.CSSProperties = {
      width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
  };
  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderBottom: '2px solid #808080',
      fontSize: '10px', fontWeight: 'bold', color: '#000000',
  };

  if (classic) {
      return (
          <div className="fade-in print-container">
              <div style={xpBevel}>
                  {/* Title bar */}
                  <div style={xpTitleBar} className="no-print">
                      <span><i className="bi bi-journal-text" style={{ marginRight: 6 }}></i>{t('stock_ledger')}</span>
                      <button style={xpBtn()} onClick={handlePrint} className="btn-print">
                          <i className="bi bi-printer" style={{ marginRight: 4 }}></i>{t('print')}
                      </button>
                  </div>

                  {/* Filters toolbar */}
                  <div style={xpToolbar} className="no-print">
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>Category:</span>
                      <select
                          style={{ ...xpSelect, width: 160 }}
                          value={categoryFilter}
                          onChange={e => setCategoryFilter(e.target.value)}
                      >
                          <option value="">{t('categories')} (All)</option>
                          {(categories || []).map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <div style={xpSep} />
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{t('from')}:</span>
                      <input type="date" style={{ ...xpInput, width: 130 }} value={startDate} onChange={e => setStartDate(e.target.value)} />
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{t('to')}:</span>
                      <input type="date" style={{ ...xpInput, width: 130 }} value={endDate} onChange={e => setEndDate(e.target.value)} />
                      <div style={xpSep} />
                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{filteredEntries.length} movements</span>
                  </div>

                  {/* Print header (print-only) */}
                  <div className="print-header d-none d-print-block" style={{ padding: '16px 12px 8px', borderBottom: '1px solid #b0a898' }}>
                      <h2 style={{ fontFamily: 'Tahoma,Arial,sans-serif', marginBottom: 4 }}>{t('stock_ledger')}</h2>
                      <p style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '12px', color: '#444', margin: 0 }}>Period: {startDate || 'All Time'} to {endDate || 'Present'}</p>
                      <p style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', margin: 0 }}>Generated: {new Date().toLocaleString()}</p>
                      {categoryFilter && <p style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', margin: 0 }}>Category: <b>{categoryFilter}</b></p>}
                  </div>

                  {/* Table */}
                  <div style={{ background: '#ffffff', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                              <tr>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 140 }}>{t('date')}</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('item_code')}</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 140 }}>{t('locations')}</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 80, textAlign: 'right' }}>Change</th>
                                  <th style={{ ...xpTableHeader, padding: '3px 8px', width: 120, textAlign: 'right' }}>Reference</th>
                              </tr>
                          </thead>
                          <tbody>
                              {filteredEntries.map((entry: any, i: number) => (
                                  <tr key={entry.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                      <td style={{ padding: '3px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#555', fontVariant: 'all-small-caps' }}>
                                          {new Date(entry.created_at).toLocaleString()}
                                      </td>
                                      <td style={{ padding: '3px 8px' }}>
                                          <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{getItemName(entry.item_id)}</div>
                                          <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#666' }}>
                                              {entry.attribute_values?.map((v: any) => v.value).join(', ') || '-'}
                                          </div>
                                      </td>
                                      <td style={{ padding: '3px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{getLocationName(entry.location_id)}</td>
                                      <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: entry.qty_change >= 0 ? '#1a5e1a' : '#c00000' }}>
                                          {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                      </td>
                                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                                          <span style={{ background: '#e0dfd8', border: '1px solid #b0a898', padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#333' }}>{entry.reference_type}</span>
                                          <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#777', marginLeft: 4 }}>#{entry.reference_id}</span>
                                      </td>
                                  </tr>
                              ))}
                              {filteredEntries.length === 0 && (
                                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', fontStyle: 'italic' }}>No records found for this period</td></tr>
                              )}
                          </tbody>
                      </table>
                  </div>

                  {/* Pagination footer */}
                  <div style={{
                      background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                      padding: '3px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                  }} className="no-print">
                      <span>Showing <b>{startRange}</b>–<b>{endRange}</b> of <b>{totalItems}</b> movements</span>
                      <div style={{ display: 'flex', gap: 2 }}>
                          <button
                              style={{ ...xpBtn(), opacity: currentPage <= 1 ? 0.5 : 1 }}
                              disabled={currentPage <= 1}
                              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                          >
                              <i className="bi bi-chevron-left"></i> Previous
                          </button>
                          <span style={{ ...xpBtn({ cursor: 'default', background: '#ece9d8' }), fontWeight: 'bold' }}>
                              {currentPage} / {totalPages || 1}
                          </span>
                          <button
                              style={{ ...xpBtn(), opacity: currentPage >= totalPages ? 0.5 : 1 }}
                              disabled={currentPage >= totalPages}
                              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                          >
                              Next <i className="bi bi-chevron-right"></i>
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
  return (
      <div className="card fade-in border-0 shadow-sm print-container">
          <div className="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-3 no-print">
              <div>
                  <h5 className="card-title mb-0">{t('stock_ledger')}</h5>
                  <small className="text-muted">Analyze inventory movements</small>
              </div>
              <div className="d-flex gap-2 align-items-center flex-nowrap">
                  <div className="input-group input-group-sm" style={{ width: '220px', minWidth: '220px' }}>
                      <span className="input-group-text px-2"><i className="bi bi-funnel"></i></span>
                      <SearchableSelect
                          options={[{ value: '', label: t('categories') + ' (All)' }, ...categories.map((c: any) => ({ value: c.name, label: c.name }))]}
                          value={categoryFilter}
                          onChange={setCategoryFilter}
                          placeholder={t('categories') + '...'}
                          className="flex-grow-1 border-0 p-0"
                      />
                  </div>
                  <div className="input-group input-group-sm" style={{ width: '160px', minWidth: '160px' }}>
                      <span className="input-group-text px-2">{t('from')}</span>
                      <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="input-group input-group-sm" style={{ width: '160px', minWidth: '160px' }}>
                      <span className="input-group-text px-2">{t('to')}</span>
                      <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                  <button className="btn btn-outline-primary btn-sm btn-print white-space-nowrap" onClick={handlePrint}>
                      <i className="bi bi-printer me-1"></i>{t('print')}
                  </button>
              </div>
          </div>
          <div className="card-body p-0">
              <div className="print-header d-none d-print-block p-4 border-bottom mb-4">
                  <h2 className="mb-1">{t('stock_ledger')}</h2>
                  <p className="text-muted mb-0">Period: {startDate || 'All Time'} to {endDate || 'Present'}</p>
                  <p className="text-muted small">Generated on: {new Date().toLocaleString()}</p>
                  {categoryFilter && <p className="text-muted small">Category Filter: <strong>{categoryFilter}</strong></p>}
              </div>
              <div className="table-responsive">
                  <table className="table table-hover table-striped mb-0 align-middle">
                      <thead className="table-light">
                          <tr>
                              <th className="ps-4">{t('date')}</th>
                              <th>{t('item_code')}</th>
                              <th>{t('locations')}</th>
                              <th className="text-end">Change</th>
                              <th className="text-end pe-4">Reference</th>
                          </tr>
                      </thead>
                      <tbody>
                          {filteredEntries.map((entry: any) => (
                              <tr key={entry.id}>
                                  <td className="ps-4 text-muted small font-monospace">{new Date(entry.created_at).toLocaleString()}</td>
                                  <td>
                                      <div className="fw-medium">{getItemName(entry.item_id)}</div>
                                      <div className="small text-muted">{entry.attribute_values?.map((v: any) => v.value).join(', ') || '-'}</div>
                                  </td>
                                  <td>{getLocationName(entry.location_id)}</td>
                                  <td className={`text-end fw-bold ${entry.qty_change >= 0 ? 'text-success' : 'text-danger'}`}>
                                      {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                  </td>
                                  <td className="text-end pe-4">
                                      <span className="badge bg-light text-dark border font-monospace small">{entry.reference_type}</span>
                                      <span className="ms-2 text-muted small">#{entry.reference_id}</span>
                                  </td>
                              </tr>
                          ))}
                          {filteredEntries.length === 0 && <tr><td colSpan={5} className="text-center py-5 text-muted">No records found for this period</td></tr>}
                      </tbody>
                  </table>
              </div>
          </div>
          <div className="card-footer bg-white border-top py-2 px-4 d-flex justify-content-between align-items-center no-print">
              <div className="small text-muted font-monospace">Showing {startRange}-{endRange} of {totalItems} movements</div>
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

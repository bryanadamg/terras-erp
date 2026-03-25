import { useState, useEffect } from 'react';
import SearchableSelect from './SearchableSelect';
import { useLanguage } from '../context/LanguageContext';

export default function StockEntryView({ items, locations, attributes, stockBalance, onRecordStock }: any) {
  const { t } = useLanguage();
  const [stockEntry, setStockEntry] = useState({ item_code: '', location_code: '', attribute_value_ids: [] as string[], qty: 0 });
  const [balanceSearch, setBalanceSearch] = useState('');
  const [currentStyle, setCurrentStyle] = useState('classic');

  useEffect(() => {
      const saved = localStorage.getItem('ui_style');
      if (saved) setCurrentStyle(saved);
  }, []);

  const classic = currentStyle === 'classic';

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;
      const otherValues = stockEntry.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      const newValues = valId ? [...otherValues, valId] : otherValues;
      setStockEntry({ ...stockEntry, attribute_value_ids: newValues });
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onRecordStock(stockEntry);
      setStockEntry({ item_code: '', location_code: '', attribute_value_ids: [], qty: 0 });
  };

  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || id;
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;
  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };
  const getBoundAttributes = (itemCode: string) => {
      const item = items.find((i: any) => i.code === itemCode);
      if (!item || !item.attribute_ids) return [];
      return attributes.filter((a: any) => item.attribute_ids.includes(a.id));
  };

  const boundAttrs = getBoundAttributes(stockEntry.item_code);

  const filteredBalance = (stockBalance || []).filter((bal: any) => {
      const name = getItemName(bal.item_id).toLowerCase();
      const code = getItemCode(bal.item_id).toLowerCase();
      const loc = getLocationName(bal.location_id).toLowerCase();
      const s = balanceSearch.toLowerCase();
      return name.includes(s) || code.includes(s) || loc.includes(s);
  });

  // ── XP inline styles ─────────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = {
      border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  };
  const xpTitleBar = (extra: any = {}): React.CSSProperties => ({
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', minHeight: '26px', ...extra,
  });
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
  const xpSelect: React.CSSProperties = {
      ...xpInput, height: '22px', paddingRight: 4,
  };
  const xpSep: React.CSSProperties = {
      width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
  };
  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderBottom: '2px solid #808080',
      fontSize: '10px', fontWeight: 'bold', color: '#000000',
  };
  const xpLabel: React.CSSProperties = {
      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2,
  };
  const xpSectionHead: React.CSSProperties = {
      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', fontWeight: 'bold', color: '#444',
      textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 4, paddingBottom: 2,
      borderBottom: '1px solid #c0bdb5',
  };

  if (classic) {
      return (
          <div className="row g-3 fade-in">
              {/* LEFT: Stock Entry Form */}
              <div className="col-md-5">
                  <div style={{ ...xpBevel, display: 'flex', flexDirection: 'column' }}>
                      <div style={xpTitleBar({ background: 'linear-gradient(to right, #6a3a8e 0%, #a06ac8 100%)', borderBottom: '1px solid #3d1a5e' })}>
                          <span><i className="bi bi-box-seam" style={{ marginRight: 6 }}></i>{t('stock_entry')}</span>
                      </div>
                      <div style={{ padding: '8px', background: '#f5f4ef' }}>
                          <form onSubmit={handleSubmit}>
                              {/* Item section */}
                              <div style={{ marginBottom: 8 }}>
                                  <div style={xpSectionHead}><i className="bi bi-box2" style={{ marginRight: 4 }}></i>{t('item_inventory')}</div>
                                  <label style={xpLabel}>Item</label>
                                  <div style={{ marginBottom: 6 }}>
                                      <SearchableSelect
                                          options={items.map((item: any) => ({ value: item.code, label: item.name, subLabel: item.code }))}
                                          value={stockEntry.item_code}
                                          onChange={(code: string) => setStockEntry({ ...stockEntry, item_code: code, attribute_value_ids: [] })}
                                          required
                                          placeholder={t('search') + '...'}
                                      />
                                  </div>
                                  {boundAttrs.map((attr: any) => (
                                      <div key={attr.id} style={{ marginBottom: 4 }}>
                                          <label style={xpLabel}>{attr.name}</label>
                                          <select
                                              style={{ ...xpSelect, width: '100%' }}
                                              value={stockEntry.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''}
                                              onChange={e => handleValueChange(e.target.value, attr.id)}
                                          >
                                              <option value="">Select {attr.name}...</option>
                                              {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                          </select>
                                      </div>
                                  ))}
                              </div>
                              {/* Transaction details */}
                              <div style={{ marginBottom: 8 }}>
                                  <div style={xpSectionHead}><i className="bi bi-arrow-left-right" style={{ marginRight: 4 }}></i>Transaction Details</div>
                                  <label style={xpLabel}>{t('locations')}</label>
                                  <div style={{ marginBottom: 6 }}>
                                      <SearchableSelect
                                          options={locations.map((loc: any) => ({ value: loc.code, label: loc.name, subLabel: loc.code }))}
                                          value={stockEntry.location_code}
                                          onChange={(code: string) => setStockEntry({ ...stockEntry, location_code: code })}
                                          required
                                          placeholder={t('locations') + '...'}
                                      />
                                  </div>
                                  <label style={xpLabel}>{t('qty')} <span style={{ color: '#666', fontWeight: 'normal' }}>(use negative to subtract)</span></label>
                                  <input
                                      type="number"
                                      style={{ ...xpInput, width: '100%' }}
                                      placeholder="0"
                                      value={stockEntry.qty || ''}
                                      onChange={e => setStockEntry({ ...stockEntry, qty: parseFloat(e.target.value) })}
                                      required
                                  />
                              </div>
                              <button
                                  type="submit"
                                  style={{ ...xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' }), width: '100%', padding: '4px 10px' }}
                              >
                                  <i className="bi bi-floppy" style={{ marginRight: 6 }}></i>{t('save')}
                              </button>
                          </form>
                      </div>
                  </div>
              </div>

              {/* RIGHT: Stock Balance */}
              <div className="col-md-7">
                  <div style={{ ...xpBevel, display: 'flex', flexDirection: 'column' }}>
                      <div style={xpTitleBar()}>
                          <span><i className="bi bi-table" style={{ marginRight: 6 }}></i>{t('stock_ledger')} (Live)</span>
                          <span style={{ fontSize: '10px', opacity: 0.85 }}>{(stockBalance || []).length} records</span>
                      </div>
                      <div style={xpToolbar}>
                          <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                          <input
                              style={{ ...xpInput, flex: 1, minWidth: 100 }}
                              placeholder="Search item or location..."
                              value={balanceSearch}
                              onChange={e => setBalanceSearch(e.target.value)}
                          />
                          <div style={xpSep} />
                          <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{filteredBalance.length} row{filteredBalance.length === 1 ? '' : 's'}</span>
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff', maxHeight: 'calc(100vh - 200px)' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                  <tr>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('item_code')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('attributes')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('locations')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px', textAlign: 'right' }}>{t('qty')}</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredBalance.map((bal: any, i: number) => (
                                      <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                          <td style={{ padding: '4px 8px' }}>
                                              <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{getItemName(bal.item_id)}</div>
                                              <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#666', fontVariant: 'all-small-caps' }}>{getItemCode(bal.item_id)}</div>
                                          </td>
                                          <td style={{ padding: '4px 8px' }}>
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                                  {bal.attribute_value_ids && bal.attribute_value_ids.length > 0 ? (
                                                      bal.attribute_value_ids.map((vid: string) => (
                                                          <span key={vid} style={{ background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#333' }}>{getAttributeValueName(vid)}</span>
                                                      ))
                                                  ) : (
                                                      <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#888', fontStyle: 'italic' }}>Standard</span>
                                                  )}
                                              </div>
                                          </td>
                                          <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{getLocationName(bal.location_id)}</td>
                                          <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: bal.qty < 0 ? '#c00000' : '#00008b' }}>
                                              {bal.qty}
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredBalance.length === 0 && (
                                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', fontStyle: 'italic' }}>Warehouse is empty</td></tr>
                                  )}
                              </tbody>
                          </table>
                      </div>
                      <div style={{
                          background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                          padding: '2px 8px', display: 'flex', gap: 16,
                          fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                      }}>
                          <span><b>{(stockBalance || []).length}</b> Total SKUs</span>
                          <span style={{ color: '#c00000' }}><b>{(stockBalance || []).filter((b: any) => b.qty < 0).length}</b> Negative</span>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
  return (
      <div className="row g-4 fade-in">
          <div className="col-md-5">
              <div className="card h-100 shadow-sm border-0">
                  <div className="card-header bg-primary bg-opacity-10 text-primary-emphasis py-3">
                      <h5 className="card-title mb-0"><i className="bi bi-box-seam me-2"></i>{t('stock_entry')}</h5>
                  </div>
                  <div className="card-body">
                      <form onSubmit={handleSubmit}>
                          <div className="mb-4 p-3 bg-light rounded-3 border border-dashed">
                              <label className="form-label text-muted text-uppercase small fw-bold mb-3">{t('item_inventory')}</label>
                              <div className="mb-3">
                                  <SearchableSelect
                                      options={items.map((item: any) => ({ value: item.code, label: item.name, subLabel: item.code }))}
                                      value={stockEntry.item_code}
                                      onChange={(code: string) => setStockEntry({ ...stockEntry, item_code: code, attribute_value_ids: [] })}
                                      required
                                      placeholder={t('search') + '...'}
                                  />
                              </div>
                              {boundAttrs.map((attr: any) => (
                                  <div key={attr.id} className="mb-2">
                                      <label className="form-label small mb-1 text-muted">{attr.name}</label>
                                      <select
                                          className="form-select form-select-sm shadow-sm"
                                          value={stockEntry.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''}
                                          onChange={e => handleValueChange(e.target.value, attr.id)}
                                      >
                                          <option value="">Select {attr.name}...</option>
                                          {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                      </select>
                                  </div>
                              ))}
                          </div>
                          <div className="mb-4">
                              <label className="form-label text-muted text-uppercase small fw-bold">Transaction Details</label>
                              <div className="row g-2">
                                  <div className="col-8">
                                      <SearchableSelect
                                          options={locations.map((loc: any) => ({ value: loc.code, label: loc.name, subLabel: loc.code }))}
                                          value={stockEntry.location_code}
                                          onChange={(code: string) => setStockEntry({ ...stockEntry, location_code: code })}
                                          required
                                          placeholder={t('locations') + '...'}
                                      />
                                  </div>
                                  <div className="col-4">
                                      <input type="number" className="form-control" placeholder={t('qty')} value={stockEntry.qty} onChange={e => setStockEntry({ ...stockEntry, qty: parseFloat(e.target.value) })} required />
                                  </div>
                              </div>
                          </div>
                          <button type="submit" className="btn btn-primary w-100 py-2 fw-bold shadow-sm">{t('save')}</button>
                      </form>
                  </div>
              </div>
          </div>
          <div className="col-md-7">
              <div className="card h-100 shadow-sm border-0">
                  <div className="card-header bg-white py-3 border-bottom-0 d-flex justify-content-between align-items-center">
                      <h5 className="card-title mb-0">{t('stock_ledger')} (Live)</h5>
                      <div className="input-group input-group-sm" style={{ width: 220 }}>
                          <span className="input-group-text"><i className="bi bi-search"></i></span>
                          <input className="form-control" placeholder="Search..." value={balanceSearch} onChange={e => setBalanceSearch(e.target.value)} />
                      </div>
                  </div>
                  <div className="card-body p-0">
                      <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0">
                              <thead className="table-light">
                                  <tr>
                                      <th className="ps-4">{t('item_code')}</th>
                                      <th>{t('attributes')}</th>
                                      <th>{t('locations')}</th>
                                      <th className="text-end pe-4">{t('qty')}</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredBalance.map((bal: any, idx: number) => (
                                      <tr key={idx}>
                                          <td className="ps-4">
                                              <div className="fw-bold text-dark">{getItemName(bal.item_id)}</div>
                                              <div className="small text-muted font-monospace">{getItemCode(bal.item_id)}</div>
                                          </td>
                                          <td>
                                              <div className="d-flex flex-wrap gap-1">
                                                  {bal.attribute_value_ids && bal.attribute_value_ids.length > 0 ? (
                                                      bal.attribute_value_ids.map((vid: string) => (
                                                          <span key={vid} className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10 small">{getAttributeValueName(vid)}</span>
                                                      ))
                                                  ) : (
                                                      <span className="text-muted small fst-italic">Standard</span>
                                                  )}
                                              </div>
                                          </td>
                                          <td><span className="small">{getLocationName(bal.location_id)}</span></td>
                                          <td className="text-end pe-4">
                                              <span className={`fw-bold font-monospace ${bal.qty < 0 ? 'text-danger' : 'text-primary'}`}>{bal.qty}</span>
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredBalance.length === 0 && <tr><td colSpan={4} className="text-center py-5 text-muted fst-italic">Warehouse is empty</td></tr>}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
}

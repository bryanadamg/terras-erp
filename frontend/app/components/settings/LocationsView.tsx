import { useState } from 'react';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

export default function LocationsView({ locations, onCreateLocation, onDeleteLocation, onRefresh, fetchLocations }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [newLocation, setNewLocation] = useState({ code: '', name: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const xpBevel: React.CSSProperties = {
      border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  };
  const xpTitleBar: React.CSSProperties = {
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', minHeight: '26px',
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

  const handleSubmitLocation = async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
          const res = await onCreateLocation(newLocation);
          if (res && res.status === 400) {
              const freshLocations = fetchLocations ? await fetchLocations() : locations;
              let baseCode = newLocation.code;
              const baseMatch = baseCode.match(/^(.*)-(\d+)$/);
              if (baseMatch) baseCode = baseMatch[1];
              let counter = 1;
              let suggestedCode = `${baseCode}-${counter}`;
              while (freshLocations.some((l: any) => l.code === suggestedCode)) { counter++; suggestedCode = `${baseCode}-${counter}`; }
              showToast(`Location Code "${newLocation.code}" already exists. Suggesting: ${suggestedCode}`, 'warning');
              setNewLocation({ ...newLocation, code: suggestedCode });
          } else if (res && res.ok) {
              showToast('Location added successfully!', 'success');
              setNewLocation({ code: '', name: '' });
          } else {
              showToast('Failed to add location', 'danger');
          }
      } finally {
          setIsSubmitting(false);
      }
  };

  const filtered = (locations || []).filter((l: any) =>
      l.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (classic) {
      return (
          <div className="row justify-content-center fade-in">
              <div className="col-md-10">
                  <div style={xpBevel}>
                      <div style={xpTitleBar}>
                          <span><i className="bi bi-geo-alt-fill" style={{ marginRight: 6 }}></i>{t('locations')}</span>
                      </div>

                      <div style={{ display: 'flex' }}>
                          {/* Left: Create form */}
                          <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #b0a898', background: '#f5f4ef', padding: '8px' }}>
                              <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#000', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #c0bdb5' }}>
                                  <i className="bi bi-plus-circle" style={{ marginRight: 4 }}></i>Add Location
                              </div>
                              <form onSubmit={handleSubmitLocation}>
                                  <label style={xpLabel}>{t('location_code')}</label>
                                  <input
                                      style={{ ...xpInput, width: '100%', marginBottom: 6 }}
                                      placeholder="WH-01"
                                      value={newLocation.code}
                                      onChange={e => setNewLocation({ ...newLocation, code: e.target.value })}
                                      required
                                  />
                                  <label style={xpLabel}>{t('location_name')}</label>
                                  <input
                                      style={{ ...xpInput, width: '100%', marginBottom: 8 }}
                                      placeholder="Main Warehouse"
                                      value={newLocation.name}
                                      onChange={e => setNewLocation({ ...newLocation, name: e.target.value })}
                                      required
                                  />
                                  <button
                                      type="submit"
                                      disabled={isSubmitting}
                                      style={{ ...xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' }), width: '100%', opacity: isSubmitting ? 0.6 : 1 }}
                                  >
                                      <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{isSubmitting ? '...' : t('add')}
                                  </button>
                              </form>
                          </div>

                          {/* Right: Table */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={xpToolbar}>
                                  <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                                  <input
                                      style={{ ...xpInput, width: 200 }}
                                      placeholder="Search locations..."
                                      value={searchTerm}
                                      onChange={e => setSearchTerm(e.target.value)}
                                  />
                                  <div style={xpSep} />
                                  <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>
                                      {filtered.length} location{filtered.length === 1 ? '' : 's'}
                                  </span>
                              </div>
                              <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                      <thead>
                                          <tr>
                                              <th style={{ ...xpTableHeader, padding: '3px 8px', width: 100 }}>{t('location_code')}</th>
                                              <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('location_name')}</th>
                                              <th style={{ ...xpTableHeader, padding: '3px 8px', width: 36 }}></th>
                                          </tr>
                                      </thead>
                                      <tbody>
                                          {filtered.map((loc: any, i: number) => (
                                              <tr key={loc.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                                  <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#00008b', fontVariant: 'all-small-caps' }}>{loc.code}</td>
                                                  <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{loc.name}</td>
                                                  <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                                                      <button
                                                          style={{
                                                              ...xpBtn(),
                                                              border: hoveredId === loc.id ? '1px solid #808080' : '1px solid transparent',
                                                              background: hoveredId === loc.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent',
                                                              padding: '1px 5px',
                                                          }}
                                                          onMouseEnter={() => setHoveredId(loc.id)}
                                                          onMouseLeave={() => setHoveredId(null)}
                                                          onClick={() => onDeleteLocation(loc.id)}
                                                          title="Delete"
                                                      >
                                                          <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                                      </button>
                                                  </td>
                                              </tr>
                                          ))}
                                          {filtered.length === 0 && (
                                              <tr>
                                                  <td colSpan={3} style={{ textAlign: 'center', padding: '20px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>
                                                      No locations found
                                                  </td>
                                              </tr>
                                          )}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      </div>

                      {/* Status bar */}
                      <div style={{
                          background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                          padding: '2px 8px', display: 'flex', gap: 16,
                          fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                      }}>
                          <span><b>{(locations || []).length}</b> Total</span>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  return (
      <div className="row justify-content-center fade-in">
          <div className="col-md-8">
              <div className="card h-100">
                  <div className="card-header d-flex justify-content-between align-items-center bg-white">
                      <h5 className="card-title mb-0">{t('locations')}</h5>
                  </div>
                  <div className="card-body">
                      <div className="row g-4">
                          <div className="col-md-5 border-end">
                              <h6 className="text-muted text-uppercase small fw-bold mb-3">{t('create')} {t('locations')}</h6>
                              <form onSubmit={handleSubmitLocation}>
                                  <div className="mb-3">
                                      <label className="form-label">{t('location_code')}</label>
                                      <input className="form-control" placeholder="WH-01" value={newLocation.code} onChange={e => setNewLocation({ ...newLocation, code: e.target.value })} required />
                                  </div>
                                  <div className="mb-3">
                                      <label className="form-label">{t('location_name')}</label>
                                      <input className="form-control" placeholder="Main Warehouse" value={newLocation.name} onChange={e => setNewLocation({ ...newLocation, name: e.target.value })} required />
                                  </div>
                                  <button type="submit" className="btn btn-success w-100" disabled={isSubmitting}><i className="bi bi-plus-lg me-1"></i> {isSubmitting ? '...' : t('add')}</button>
                              </form>
                          </div>
                          <div className="col-md-7">
                              <div className="input-group mb-3">
                                  <span className="input-group-text"><i className="bi bi-search"></i></span>
                                  <input className="form-control" placeholder="Search locations..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                              </div>
                              <div className="table-responsive">
                                  <table className="table table-hover align-middle">
                                      <thead className="table-light">
                                          <tr>
                                              <th>{t('location_code')}</th>
                                              <th>{t('location_name')}</th>
                                              <th style={{ width: '50px' }}></th>
                                          </tr>
                                      </thead>
                                      <tbody>
                                          {filtered.map((loc: any) => (
                                              <tr key={loc.id}>
                                                  <td className="fw-medium font-monospace text-primary">{loc.code}</td>
                                                  <td>{loc.name}</td>
                                                  <td className="text-end">
                                                      <button className="btn btn-sm btn-link text-danger" onClick={() => onDeleteLocation(loc.id)}>
                                                          <i className="bi bi-trash"></i>
                                                      </button>
                                                  </td>
                                              </tr>
                                          ))}
                                          {filtered.length === 0 && <tr><td colSpan={3} className="text-center text-muted py-3">No locations found</td></tr>}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
}

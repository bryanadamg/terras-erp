'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useTheme } from '../../context/ThemeContext';
import { useConfirm } from '../../context/ConfirmContext';

interface Batch {
  id: string;
  batch_number: string;
  item_id: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

interface BatchConsumption {
  id: string;
  manufacturing_order_id: string;
  input_batch_id: string;
  output_batch_id: string | null;
  qty_consumed: number;
  created_at: string;
}

interface BatchTrace {
  batch: Batch;
  consumptions: BatchConsumption[];
}

interface Item {
  id: string;
  code: string;
  name: string;
}

interface BatchesViewProps {
  items: Item[];
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  apiBase: string;
}

export default function BatchesView({ items, authFetch, apiBase }: BatchesViewProps) {
  const { showToast } = useToast();
  const { uiStyle } = useTheme();
  const { confirm } = useConfirm();
  const classic = uiStyle === 'classic';

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemFilter, setItemFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Create form
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createItemId, setCreateItemId] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Trace modal
  const [traceData, setTraceData] = useState<BatchTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const url = itemFilter
        ? `${apiBase}/batches?item_id=${itemFilter}&limit=200`
        : `${apiBase}/batches?limit=200`;
      const res = await authFetch(url);
      if (res.ok) setBatches(await res.json());
    } catch {
      showToast('Failed to load batches', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBatches(); }, [itemFilter]);

  const handleCreate = async () => {
    if (!createItemId) { showToast('Select an item', 'warning'); return; }
    setCreating(true);
    try {
      const res = await authFetch(`${apiBase}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: createItemId, notes: createNotes || null }),
      });
      if (res.ok) {
        showToast('Batch created', 'success');
        setIsCreateOpen(false);
        setCreateItemId('');
        setCreateNotes('');
        fetchBatches();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to create batch', 'danger');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (batch: Batch) => {
    const ok = await confirm({
      title: 'Delete Batch',
      message: `Delete batch ${batch.batch_number}? Stock linked to this batch will lose its batch reference.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await authFetch(`${apiBase}/batches/${batch.id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Deleted', 'success'); fetchBatches(); }
    else showToast('Delete failed', 'danger');
  };

  const handleTrace = async (batch: Batch) => {
    setTraceLoading(true);
    setTraceData(null);
    try {
      const res = await authFetch(`${apiBase}/batches/${batch.id}/trace`);
      if (res.ok) setTraceData(await res.json());
      else showToast('Failed to load trace', 'danger');
    } finally {
      setTraceLoading(false);
    }
  };

  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

  const filtered = batches.filter(b => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return b.batch_number.toLowerCase().includes(s) ||
      (itemMap[b.item_id]?.code || '').toLowerCase().includes(s) ||
      (itemMap[b.item_id]?.name || '').toLowerCase().includes(s);
  });

  // ── Styles ────────────────────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = classic ? {
    border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  } : {};

  const xpTitleBar: React.CSSProperties = classic ? {
    background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
    color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px',
    fontWeight: 'bold', padding: '4px 8px', borderBottom: '1px solid #003080',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '26px',
  } : {};

  const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => classic ? ({
    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px',
    cursor: 'pointer', background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000',
    borderRadius: 0, ...extra,
  }) : { cursor: 'pointer', ...extra };

  const xpInput: React.CSSProperties = classic ? {
    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
    padding: '1px 6px', background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
  } : {};

  const xpTable: React.CSSProperties = classic ? {
    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', width: '100%', borderCollapse: 'collapse',
  } : { width: '100%' };

  const xpTh: React.CSSProperties = classic ? {
    background: 'linear-gradient(to bottom, #f0ede4, #d8d4c8)', border: '1px solid #9090a0',
    padding: '2px 6px', fontWeight: 'bold', textAlign: 'left', whiteSpace: 'nowrap',
  } : {};

  const xpTd = (alt: boolean): React.CSSProperties => classic ? {
    border: '1px solid #c8c8c8', padding: '2px 6px',
    background: alt ? '#f0f0f8' : '#ffffff', verticalAlign: 'middle',
  } : { verticalAlign: 'middle' };

  return (
    <div className="p-3">
      {/* ── Header ── */}
      {classic ? (
        <div style={{ ...xpBevel, marginBottom: 12 }}>
          <div style={xpTitleBar}>
            <span>Batch / Lot Management</span>
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898' }}>
            <button style={xpBtn()} onClick={() => setIsCreateOpen(true)}>
              <i className="bi bi-plus" /> New Batch
            </button>
            <button style={xpBtn()} onClick={fetchBatches}>
              <i className="bi bi-arrow-clockwise" /> Refresh
            </button>
            <span style={{ marginLeft: 8, fontFamily: 'Tahoma', fontSize: 11 }}>Filter by Item:</span>
            <select style={{ ...xpInput, width: 200 }} value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
              <option value="">All Items</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
            </select>
            <input style={{ ...xpInput, width: 160 }} placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <h5 className="mb-0 fw-bold">Batch / Lot Management</h5>
          <button className="btn btn-sm btn-primary" onClick={() => setIsCreateOpen(true)}>
            <i className="bi bi-plus" /> New Batch
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={fetchBatches}>
            <i className="bi bi-arrow-clockwise" />
          </button>
          <select className="form-select form-select-sm" style={{ width: 200 }} value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
            <option value="">All Items</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
          </select>
          <input className="form-control form-control-sm" style={{ width: 200 }} placeholder="Search batches..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      )}

      {/* ── Table ── */}
      {classic ? (
        <div style={{ ...xpBevel, overflow: 'hidden' }}>
          <table style={xpTable}>
            <thead>
              <tr>
                <th style={xpTh}>Batch Number</th>
                <th style={xpTh}>Item Code</th>
                <th style={xpTh}>Item Name</th>
                <th style={xpTh}>Notes</th>
                <th style={xpTh}>Created By</th>
                <th style={xpTh}>Created At</th>
                <th style={xpTh}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ ...xpTd(false), textAlign: 'center', padding: 8 }}>Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...xpTd(false), textAlign: 'center', padding: 8 }}>No batches found.</td></tr>
              )}
              {filtered.map((b, i) => (
                <tr key={b.id}>
                  <td style={xpTd(i % 2 === 1)}><strong>{b.batch_number}</strong></td>
                  <td style={xpTd(i % 2 === 1)}>{itemMap[b.item_id]?.code || b.item_id}</td>
                  <td style={xpTd(i % 2 === 1)}>{itemMap[b.item_id]?.name || '-'}</td>
                  <td style={xpTd(i % 2 === 1)}>{b.notes || '-'}</td>
                  <td style={xpTd(i % 2 === 1)}>{b.created_by || '-'}</td>
                  <td style={xpTd(i % 2 === 1)}>{new Date(b.created_at).toLocaleDateString()}</td>
                  <td style={{ ...xpTd(i % 2 === 1), whiteSpace: 'nowrap' }}>
                    <button style={xpBtn({ marginRight: 4 })} onClick={() => handleTrace(b)} title="Trace forward">
                      <i className="bi bi-diagram-3" /> Trace
                    </button>
                    <button style={xpBtn({ background: 'linear-gradient(to bottom, #ffd0d0, #e08080)' })} onClick={() => handleDelete(b)}>
                      <i className="bi bi-trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover table-bordered mb-0">
            <thead className="table-light">
              <tr>
                <th>Batch Number</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Notes</th>
                <th>Created By</th>
                <th>Created At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="text-center">Loading...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center text-muted">No batches found.</td></tr>}
              {filtered.map(b => (
                <tr key={b.id}>
                  <td><strong>{b.batch_number}</strong></td>
                  <td>{itemMap[b.item_id]?.code || b.item_id}</td>
                  <td>{itemMap[b.item_id]?.name || '-'}</td>
                  <td>{b.notes || '-'}</td>
                  <td>{b.created_by || '-'}</td>
                  <td>{new Date(b.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-sm btn-outline-info me-1" onClick={() => handleTrace(b)} title="Trace forward">
                      <i className="bi bi-diagram-3" />
                    </button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(b)}>
                      <i className="bi bi-trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create Modal ── */}
      {isCreateOpen && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className={`modal-content ${classic ? '' : ''}`} style={classic ? { ...xpBevel, borderRadius: 0 } : {}}>
              {classic ? (
                <div style={xpTitleBar}>
                  <span>New Batch</span>
                  <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setIsCreateOpen(false)}>X</span>
                </div>
              ) : (
                <div className="modal-header">
                  <h5 className="modal-title">New Batch</h5>
                  <button className="btn-close" onClick={() => setIsCreateOpen(false)} />
                </div>
              )}
              <div className={classic ? '' : 'modal-body'} style={classic ? { padding: 12 } : {}}>
                <div className="mb-3">
                  <label style={classic ? { fontFamily: 'Tahoma', fontSize: 11 } : {}}>Item</label>
                  <select
                    className={classic ? '' : 'form-select form-select-sm mt-1'}
                    style={classic ? { ...xpInput, width: '100%', height: 22 } : {}}
                    value={createItemId}
                    onChange={e => setCreateItemId(e.target.value)}
                  >
                    <option value="">-- Select Item --</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                  </select>
                </div>
                <div className="mb-3">
                  <label style={classic ? { fontFamily: 'Tahoma', fontSize: 11 } : {}}>Notes (optional)</label>
                  <textarea
                    className={classic ? '' : 'form-control form-control-sm mt-1'}
                    style={classic ? { ...xpInput, width: '100%', height: 60, resize: 'vertical' } : {}}
                    value={createNotes}
                    onChange={e => setCreateNotes(e.target.value)}
                    placeholder="Optional notes..."
                  />
                </div>
              </div>
              <div
                className={classic ? '' : 'modal-footer'}
                style={classic ? { padding: '6px 12px', display: 'flex', gap: 6, justifyContent: 'flex-end', borderTop: '1px solid #c0c0c0' } : {}}
              >
                <button style={classic ? xpBtn() : undefined} className={classic ? '' : 'btn btn-sm btn-secondary'} onClick={() => setIsCreateOpen(false)}>Cancel</button>
                <button style={classic ? xpBtn() : undefined} className={classic ? '' : 'btn btn-sm btn-primary'} onClick={handleCreate} disabled={creating}>
                  {creating ? 'Creating...' : 'Create Batch'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Trace Modal ── */}
      {(traceData || traceLoading) && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content" style={classic ? { ...xpBevel, borderRadius: 0 } : {}}>
              {classic ? (
                <div style={xpTitleBar}>
                  <span>Forward Trace — {traceData?.batch.batch_number}</span>
                  <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setTraceData(null)}>X</span>
                </div>
              ) : (
                <div className="modal-header">
                  <h5 className="modal-title">Forward Trace — {traceData?.batch.batch_number}</h5>
                  <button className="btn-close" onClick={() => setTraceData(null)} />
                </div>
              )}
              <div style={classic ? { padding: 12 } : { padding: 16 }}>
                {traceLoading && <p style={classic ? { fontFamily: 'Tahoma', fontSize: 11 } : {}}>Loading trace...</p>}
                {traceData && traceData.consumptions.length === 0 && (
                  <p style={classic ? { fontFamily: 'Tahoma', fontSize: 11 } : { color: '#666' }}>
                    No manufacturing consumption recorded for this batch.
                  </p>
                )}
                {traceData && traceData.consumptions.length > 0 && (
                  <>
                    <p style={classic ? { fontFamily: 'Tahoma', fontSize: 11, marginBottom: 8 } : { marginBottom: 8, fontSize: 13 }}>
                      This batch was consumed in {traceData.consumptions.length} manufacturing operation(s):
                    </p>
                    <table style={classic ? xpTable : { width: '100%' }} className={classic ? '' : 'table table-sm table-bordered'}>
                      <thead>
                        <tr>
                          <th style={classic ? xpTh : {}}>Manufacturing Order</th>
                          <th style={classic ? xpTh : {}}>Qty Consumed</th>
                          <th style={classic ? xpTh : {}}>Output Batch</th>
                          <th style={classic ? xpTh : {}}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traceData.consumptions.map((c, i) => (
                          <tr key={c.id}>
                            <td style={classic ? xpTd(i % 2 === 1) : {}}>{c.manufacturing_order_id}</td>
                            <td style={classic ? xpTd(i % 2 === 1) : {}}>{c.qty_consumed}</td>
                            <td style={classic ? xpTd(i % 2 === 1) : {}}>{c.output_batch_id || '-'}</td>
                            <td style={classic ? xpTd(i % 2 === 1) : {}}>{new Date(c.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
              <div style={classic ? { padding: '6px 12px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #c0c0c0' } : { padding: '8px 16px', borderTop: '1px solid #dee2e6' }}>
                <button style={classic ? xpBtn() : undefined} className={classic ? '' : 'btn btn-sm btn-secondary'} onClick={() => setTraceData(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

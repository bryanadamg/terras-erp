import { useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { xpToolbar as sharedXpToolbar, ShellWindow, ShellTitleBar, SearchField } from '../shared/shellTheme';
import { lvTh, lvTd, lvRow, lvThead } from '../shared/listViewTheme';
import { XPActionButton, CodeChip, xpFont, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';

const ALL = '__all__';

export default function LocationsView({
  locations,
  onCreateLocation,
  onUpdateLocation,
  onDeleteLocation,
  onRefresh,
  fetchLocations,
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission('location.create', 'location.edit', 'location.delete');

  const [selectedStore, setSelectedStore] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Add warehouse (store)
  const [addingStore, setAddingStore] = useState(false);
  const [newStore, setNewStore] = useState({ code: '', name: '' });
  const [savingStore, setSavingStore] = useState(false);

  // Add zone
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [savingZone, setSavingZone] = useState(false);

  // Add bin
  const [showBinForm, setShowBinForm] = useState(false);
  const [newBinName, setNewBinName] = useState('');
  const [savingBin, setSavingBin] = useState(false);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Drag-drop (bins between zones)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [hoveredStore, setHoveredStore] = useState<string | null>(null);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [hoveredBin, setHoveredBin] = useState<string | null>(null);

  // ---------- styles (classic XP) ----------
  const xpToolbar: React.CSSProperties = sharedXpToolbar({ gap: 6 });
  const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => xpBtnBase(extra);
  const xpInput: React.CSSProperties = xpInputBase({ boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' });
  const xpLabel: React.CSSProperties = { fontFamily: xpFont, fontSize: 11, color: '#000', display: 'block', marginBottom: 2 };

  // ---------- derived data ----------
  const all = (locations || []);
  const stores = all.filter((l: any) => l.location_type === 'warehouse').sort((a: any, b: any) => a.name.localeCompare(b.name));
  const zonesOf = (storeId: string) => all.filter((l: any) => l.parent_id === storeId && l.location_type === 'zone').sort((a: any, b: any) => a.name.localeCompare(b.name));
  const binsOf = (zoneId: string) => all.filter((l: any) => l.parent_id === zoneId && l.location_type === 'bin').sort((a: any, b: any) => a.name.localeCompare(b.name));
  const zoneCount = (storeId: string) => all.filter((l: any) => l.parent_id === storeId).length;
  const binCount = (zoneId: string) => all.filter((l: any) => l.parent_id === zoneId).length;
  const selectedStoreObj = selectedStore !== ALL ? all.find((l: any) => l.id === selectedStore) : null;
  const selectedZoneObj = selectedZone ? all.find((l: any) => l.id === selectedZone) : null;
  const codeSet = new Set(all.map((l: any) => l.code));
  const ensureUniqueCode = (base: string) => {
    let c = base, n = 1;
    while (codeSet.has(c)) { c = `${base}-${n}`; n++; }
    return c;
  };

  // Reset zone selection when store changes
  useEffect(() => { setSelectedZone(null); setShowBinForm(false); }, [selectedStore]);

  // Fallback if selected items disappear
  useEffect(() => {
    if (selectedStore !== ALL && !all.some((l: any) => l.id === selectedStore)) setSelectedStore(ALL);
  }, [locations, selectedStore]);
  useEffect(() => {
    if (selectedZone && !all.some((l: any) => l.id === selectedZone)) setSelectedZone(null);
  }, [locations, selectedZone]);

  // ---------- handlers ----------
  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingStore) return;
    setSavingStore(true);
    try {
      const res = await onCreateLocation({ code: newStore.code, name: newStore.name, parent_id: null });
      if (res && res.status === 400) {
        showToast(`Code "${newStore.code}" already exists`, 'warning');
        setNewStore({ ...newStore, code: ensureUniqueCode(newStore.code.replace(/-\d+$/, '')) });
      } else if (res && res.ok) {
        showToast('Store added', 'success');
        setNewStore({ code: '', name: '' });
        setAddingStore(false);
      } else { showToast('Failed to add store', 'danger'); }
    } finally { setSavingStore(false); }
  };

  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newZoneName.trim();
    if (!name || savingZone || !selectedStoreObj) return;
    setSavingZone(true);
    try {
      const base = `${selectedStoreObj.code}-${name}`.replace(/\s+/g, '-');
      const code = ensureUniqueCode(base);
      const res = await onCreateLocation({ code, name, parent_id: selectedStoreObj.id });
      if (res && res.ok) {
        showToast('Zone added', 'success');
        setNewZoneName('');
      } else { showToast('Failed to add zone', 'danger'); }
    } finally { setSavingZone(false); }
  };

  const handleAddBin = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBinName.trim();
    if (!name || savingBin || !selectedZoneObj) return;
    setSavingBin(true);
    try {
      const base = `${selectedZoneObj.code}-${name}`.replace(/\s+/g, '-');
      const code = ensureUniqueCode(base);
      const res = await onCreateLocation({ code, name, parent_id: selectedZoneObj.id });
      if (res && res.ok) {
        showToast('Bin added', 'success');
        setNewBinName('');
      } else { showToast('Failed to add bin', 'danger'); }
    } finally { setSavingBin(false); }
  };

  const startRename = (loc: any) => { setRenamingId(loc.id); setRenameValue(loc.name); };
  const commitRename = async () => {
    const id = renamingId; const name = renameValue.trim();
    if (!id) return;
    const cur = all.find((l: any) => l.id === id);
    if (!name || (cur && name === cur.name)) { setRenamingId(null); return; }
    const res = onUpdateLocation ? await onUpdateLocation(id, { name }) : null;
    if (res && res.ok) showToast('Renamed', 'success');
    else if (res && res.status === 400) showToast('Cannot rename system stores', 'warning');
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    const err = await onDeleteLocation(id);
    if (typeof err === 'string') showToast(err, 'danger');
  };

  // drag-drop: bins dragged onto a zone re-parent
  const onDragStart = (e: React.DragEvent, loc: any) => { setDraggingId(loc.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', loc.id); } catch {} };
  const onDragEnd = () => { setDraggingId(null); setDragOverId(null); };
  const onZoneDragOver = (e: React.DragEvent, zoneId: string) => { if (!draggingId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== zoneId) setDragOverId(zoneId); };
  const onZoneDragLeave = (zoneId: string) => setDragOverId(prev => (prev === zoneId ? null : prev));
  const onZoneDrop = (e: React.DragEvent, zoneId: string) => {
    e.preventDefault();
    const id = draggingId || e.dataTransfer.getData('text/plain');
    setDraggingId(null); setDragOverId(null);
    if (!id || !onUpdateLocation) return;
    const loc = all.find((l: any) => l.id === id);
    if (!loc || loc.parent_id === zoneId || loc.id === zoneId) return;
    onUpdateLocation(id, { parent_id: zoneId });
  };

  // Quarantine hold flag. Set on the STORE and inherited by its zones/bins —
  // stock held anywhere under it shows on the Quarantine Packing page and cannot
  // be packed until its lot is dispositioned OK. Editable on system stores too:
  // a plant may hold elsewhere than the seeded Quarantine warehouse.
  const toggleQuarantine = async (loc: any) => {
    if (!onUpdateLocation) return;
    const next = !loc.is_quarantine;
    await onUpdateLocation(loc.id, { is_quarantine: next });
    showToast(
      next
        ? `${loc.name} is now a quarantine hold area`
        : `${loc.name} is no longer a quarantine hold area`,
      'success',
    );
  };

  const quarantineTitle = (loc: any) => loc.is_quarantine
    ? 'Quarantine hold area — click to stop holding stock here'
    : 'Click to make this a quarantine hold area';

  const q = searchTerm.toLowerCase();
  const matches = (l: any) => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q);

  // ---------- row renderers (shared tree, per-element classic/modern styling) ----------
  const storeRow = (loc: any) => {
    const active = selectedStore === loc.id;
    const over = dragOverId === loc.id;
    const renaming = renamingId === loc.id;
    const cnt = zoneCount(loc.id);
    const isSystem = !!loc.system_code;
    const Tag: any = 'div';
    return (
      <Tag
        key={loc.id}
        type={undefined}
        onClick={() => !renaming && setSelectedStore(loc.id)}
        onMouseEnter={() => setHoveredStore(loc.id)}
        onMouseLeave={() => setHoveredStore(null)}
        className={undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', fontFamily: xpFont, fontSize: 11, color: active ? '#fff' : '#000', background: over ? '#ffe9a8' : active ? 'linear-gradient(to bottom,#3c8cf0,#1a5fd0)' : 'transparent', border: over ? '1px dashed #b8860b' : '1px solid transparent' }}
      >
        <i className={`bi ${cnt > 0 ? 'bi-building-fill' : 'bi-building'}`} style={{ color: active ? '#fff' : '#caa55a' }} />
        {renaming ? (
          <input autoFocus className={undefined} style={{ ...xpInput, flex: 1, minWidth: 0 }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }} />
        ) : (
          <span className={undefined} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</span>
        )}
        {isSystem && <i className="bi bi-lock-fill" title="System store" style={{ color: active ? '#cde' : '#888', fontSize: 9}} />}
        {(loc.is_quarantine || (canManage && hoveredStore === loc.id)) && (
          <i
            className={`bi ${loc.is_quarantine ? 'bi-shield-fill-exclamation' : 'bi-shield'}`}
            title={quarantineTitle(loc)}
            onClick={(e) => { e.stopPropagation(); if (canManage) toggleQuarantine(loc); }}
            style={{ color: loc.is_quarantine ? (active ? '#ffd479' : '#b8860b') : (active ? '#cde' : '#999'), fontSize: 11, cursor: canManage ? 'pointer' : 'default' }}
          />
        )}
        <span className={undefined} style={{ fontSize: 10, color: active ? '#dde' : '#777' }}>{cnt}</span>
        {canManage && !renaming && !isSystem && hoveredStore === loc.id && (
          <>
              <i className="bi bi-pencil" title="Rename" onClick={(e) => { e.stopPropagation(); startRename(loc); }} style={{ color: active ? '#fff' : '#333', fontSize: 11 }} />
              <i className="bi bi-trash" title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(loc.id); }} style={{ color: active ? '#fff' : '#c00000', fontSize: 11 }} />
            </>)}
      </Tag>
    );
  };

  const zoneRow = (loc: any) => {
    const active = selectedZone === loc.id;
    const over = dragOverId === loc.id;
    const renaming = renamingId === loc.id;
    const cnt = binCount(loc.id);
    const Tag: any = 'div';
    return (
      <Tag
        key={loc.id}
        type={undefined}
        onClick={() => !renaming && setSelectedZone(active ? null : loc.id)}
        onMouseEnter={() => setHoveredZone(loc.id)}
        onMouseLeave={() => setHoveredZone(null)}
        onDragOver={(e: React.DragEvent) => onZoneDragOver(e, loc.id)}
        onDragLeave={() => onZoneDragLeave(loc.id)}
        onDrop={(e: React.DragEvent) => onZoneDrop(e, loc.id)}
        className={undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', fontFamily: xpFont, fontSize: 11, color: active ? '#fff' : '#000', background: over ? '#ffe9a8' : active ? 'linear-gradient(to bottom,#3c8cf0,#1a5fd0)' : 'transparent', border: over ? '1px dashed #b8860b' : '1px solid transparent' }}
      >
        <i className={`bi ${cnt > 0 ? 'bi-folder-fill' : 'bi-folder'}`} style={{ color: active ? '#fff' : '#c8a030' }} />
        {renaming ? (
          <input autoFocus className={undefined} style={{ ...xpInput, flex: 1, minWidth: 0 }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }} />
        ) : (
          <span className={undefined} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</span>
        )}
        <span className={undefined} style={{ fontSize: 10, color: active ? '#dde' : '#777' }}>{cnt}</span>
        {canManage && !renaming && hoveredZone === loc.id && (
          <>
              <i className="bi bi-pencil" title="Rename" onClick={(e) => { e.stopPropagation(); startRename(loc); }} style={{ color: active ? '#fff' : '#333', fontSize: 11 }} />
              <i className="bi bi-trash" title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(loc.id); }} style={{ color: active ? '#fff' : '#c00000', fontSize: 11 }} />
            </>)}
      </Tag>
    );
  };

  const binRow = (loc: any, i: number) => {
    const renaming = renamingId === loc.id;
    return (
      <tr
        key={loc.id}
        draggable={!renaming}
        onDragStart={(e) => onDragStart(e, loc)}
        onDragEnd={onDragEnd}
        onMouseEnter={() => setHoveredBin(loc.id)}
        onMouseLeave={() => setHoveredBin(null)}
        style={{
          ...lvRow(i),
          cursor: 'grab',
          background: draggingId === loc.id
            ? '#fff7d6'
            : (hoveredBin === loc.id)
              ? '#f0f6ff'
              : lvRow(i).background,
        }}
      >
        <td style={{ ...lvTd(), width: 24, textAlign: 'center' }}>
          <i className={`bi bi-grip-vertical${''}`} style={{ color: '#aaa' }} />
        </td>
        <td style={{ ...lvTd(), width: 150, ...({ fontWeight: 'bold', color: '#00008b' }) }}>
          {loc.code}
        </td>
        <td style={lvTd()}>
          {renaming ? (
            <input autoFocus className={undefined} style={{ ...xpInput, width: '100%' }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }} />
          ) : (
            <span className={undefined} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</span>
          )}
        </td>
        <td style={{ ...lvTd(), width: 60, textAlign: 'right', ...({ borderRight: 'none' }) }} onClick={(e) => e.stopPropagation()}>
          {canManage && (
            <span style={{ display: 'inline-flex', gap: 4 }}>
                <XPActionButton classic icon="bi-pencil" title="Rename" onClick={() => startRename(loc)} />
                <XPActionButton classic tone="danger" icon="bi-trash" title="Delete" onClick={() => handleDelete(loc.id)} />
              </span>)}
        </td>
      </tr>
    );
  };

  const renderZonePanel = () => {
    if (selectedStore === ALL) {
      return <div style={{ textAlign: 'center', padding: 24, fontFamily: xpFont, fontSize: 11, color: '#888' }}>Select a store to manage zones.</div>;
    }
    const zones = zonesOf(selectedStore).filter(matches);
    if (zones.length === 0) {
      return <div style={{ textAlign: 'center', padding: 24, fontFamily: xpFont, fontSize: 11, color: '#888' }}>No zones{q ? ' match' : ' yet — add one above'}.</div>;
    }
    return zones.map(zoneRow);
  };

  const bins = selectedZone ? binsOf(selectedZone).filter(matches) : [];

  const renderBinPanel = () => {
    if (!selectedZone) {
      return <div style={{ textAlign: 'center', padding: 24, fontFamily: xpFont, fontSize: 11, color: '#888' }}>Select a zone to manage bins.</div>;
    }
    if (bins.length === 0) {
      return <div style={{ textAlign: 'center', padding: 24, fontFamily: xpFont, fontSize: 11, color: '#888' }}>No bins{q ? ' match' : ' yet — add one above'}.</div>;
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ ...lvThead(), position: 'sticky', top: 0 }}>
          <tr>
            <th style={{ ...lvTh(), width: 24 }}></th>
            <th style={{ ...lvTh(), width: 150 }}>Code</th>
            <th style={lvTh()}>Name</th>
            <th style={{ ...lvTh(), width: 60, ...({ borderRight: 'none' }) }}></th>
          </tr>
        </thead>
        <tbody>{bins.map(binRow)}</tbody>
      </table>
    );
  };

  return (
    <ShellWindow fill="page" className="fade-in">
      <ShellTitleBar icon="bi-geo-alt-fill" title={t('locations')} />
      <div className="locations-panes" style={{ flex: 1, minHeight: 0 }}>

        {/* LEFT: stores */}
        <div
          className={'loc-pane'}
          style={{ width: 210, flexShrink: 0, borderRight: '1px solid #b0a898', background: '#f5f4ef', display: 'flex', flexDirection: 'column' }}
        >
          <div className={undefined} style={{ ...xpToolbar, justifyContent: 'space-between' }}>
            <span className={undefined} style={{ fontFamily: xpFont, fontSize: 11, fontWeight: 'bold' }}>Stores</span>
            {canManage && (
              <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={() => setAddingStore(v => !v)} title="New store"><i className="bi bi-plus-lg" /></button>)}
          </div>
          {addingStore && (
            <form onSubmit={handleAddStore} style={{ padding: '6px', borderBottom: '1px solid #d8d4c8', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input style={xpInput} placeholder="Code (e.g. RAW2)" value={newStore.code} onChange={(e) => setNewStore({ ...newStore, code: e.target.value })} required />
                <input style={xpInput} placeholder="Name (e.g. Raw Material 2)" value={newStore.name} onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} required />
                <button type="submit" className={XP_BTN} disabled={savingStore} style={xpBtn({ ...BTN_TONES.success, opacity: savingStore ? 0.6 : 1 })}>{savingStore ? '...' : 'Add store'}</button>
              </form>)}
          <div className={undefined} style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {<div onClick={() => setSelectedStore(ALL)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: selectedStore === ALL ? '#fff' : '#000', background: selectedStore === ALL ? 'linear-gradient(to bottom,#3c8cf0,#1a5fd0)' : 'transparent' }}>
                <i className="bi bi-collection" style={{ color: selectedStore === ALL ? '#fff' : '#888' }} /><span style={{ flex: 1 }}>All stores</span><span style={{ fontSize: 10, color: selectedStore === ALL ? '#dde' : '#777' }}>{stores.length}</span>
              </div>}
            {<div style={{ height: 1, background: '#d8d4c8', margin: '2px 6px' }} />}
            {stores.map(storeRow)}
            {stores.length === 0 && (
              <div style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: 11, color: '#888' }}>No stores yet</div>)}
          </div>
          <div className={undefined} style={{ background: 'linear-gradient(to bottom,#e8e6df,#d5d3cc)', borderTop: '1px solid #b0a898', padding: '2px 8px', fontFamily: xpFont, fontSize: 11, color: '#333' }}>
            <b>{stores.length}</b> stores · <b>{all.length}</b> total
          </div>
        </div>

        {/* MIDDLE: zones */}
        <div
          className={'loc-pane'}
          style={{ width: 200, flexShrink: 0, borderRight: '1px solid #b0a898', background: '#f5f4ef', display: 'flex', flexDirection: 'column' }}
        >
          <div className={undefined} style={{ ...xpToolbar, justifyContent: 'space-between' }}>
            <span className={undefined} style={{ fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: '#003080' }}>
              {selectedStoreObj ? selectedStoreObj.name : 'Zones'}
            </span>
            {canManage && selectedStoreObj && (
              <button className={XP_BTN} style={xpBtn({ padding: '1px 6px', ...BTN_TONES.success })} onClick={() => setShowZoneForm(v => !v)} title="New zone"><i className="bi bi-plus-lg" /></button>)}
          </div>
          {canManage && selectedStoreObj && showZoneForm && (
            <form onSubmit={handleAddZone} style={{ display: 'flex', gap: 4, padding: '4px 6px', background: '#eef3fb', borderBottom: '1px solid #b0c4de' }}>
                <input autoFocus style={{ ...xpInput, flex: 1, minWidth: 0 }} placeholder="Zone name" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} required />
                <button type="submit" className={XP_BTN} disabled={savingZone} style={xpBtn({ padding: '1px 6px', ...BTN_TONES.success, opacity: savingZone ? 0.6 : 1 })}>{savingZone ? '...' : 'Add'}</button>
              </form>)}
          <div className={undefined} style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
            {renderZonePanel()}
          </div>
        </div>

        {/* RIGHT: bins */}
        <div
          className={'loc-pane'}
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          <div className={undefined} style={xpToolbar}>
            {<span style={{ fontFamily: xpFont, fontSize: 12, fontWeight: 'bold', color: '#003080' }}>{selectedZoneObj ? selectedZoneObj.name : 'Bins'}</span>}
            <div className={undefined} style={{ flex: 1 }} />
            <SearchField classic value={searchTerm} onChange={setSearchTerm} placeholder="Search..." width={160} />
            {canManage && selectedZoneObj && (
              <button className={XP_BTN} style={xpBtn({ ...BTN_TONES.success })} onClick={() => setShowBinForm(v => !v)}><i className="bi bi-plus-lg" style={{ marginRight: 3 }} />Add bin</button>)}
          </div>
          {canManage && selectedZoneObj && showBinForm && (
            <form onSubmit={handleAddBin} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '6px 8px', background: '#eef3fb', borderBottom: '1px solid #b0c4de' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={xpLabel}>Bin / shelf name (e.g. A1, A2, B1)</label>
                  <input autoFocus style={{ ...xpInput, width: '100%' }} placeholder="A1" value={newBinName} onChange={(e) => setNewBinName(e.target.value)} required />
                </div>
                <span style={{ fontFamily: xpFont, fontSize: 10, color: '#666' }}>code: {selectedZoneObj.code}-{newBinName || '…'}</span>
                <button type="submit" className={XP_BTN} disabled={savingBin} style={xpBtn({ ...BTN_TONES.success, opacity: savingBin ? 0.6 : 1 })}>{savingBin ? '...' : 'Save'}</button>
                <button type="button" className={XP_BTN} onClick={() => setShowBinForm(false)} style={xpBtn()}><i className="bi bi-x-lg" /></button>
              </form>)}
          <div className={undefined} style={{ flex: 1, overflowY: 'auto' }}>
            {renderBinPanel()}
          </div>
        </div>

      </div>
    </ShellWindow>
  );
}

import React, { useState } from 'react';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { ShellWindow, ShellTitleBar, SearchField, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import { XPActionButton } from '../shared/xpTheme';
import {
  ColumnPanes, ColumnPane, ColumnAddBar, ColumnInput, ColumnRenameRow, ColumnRow, ColumnCount,
  ColumnEmpty, ColumnStatusBar,
} from '../shared/columnBrowser';

const byName = (a: any, b: any) => a.name.localeCompare(b.name);
const LEVELS = ['warehouse', 'zone', 'bin'] as const;

// Store → zone → bin, one column each (shared/columnBrowser.tsx — same shape as the
// Categories tab). Stock lives only in bins. Bins can be dragged onto another zone
// to re-parent them; the quarantine hold flag lives on the store.
export default function LocationsView({
  locations,
  onCreateLocation,
  onUpdateLocation,
  onDeleteLocation,
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { hasPermission } = useUser();
  const canCreate = hasPermission('location.create');
  const canEdit = hasPermission('location.edit');
  const canDelete = hasPermission('location.delete');

  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [adding, setAdding] = useState<null | { level: number; code: string; name: string }>(null);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<null | { id: string; value: string }>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // ---------- derived data ----------
  const all: any[] = locations || [];
  const byId = new Map(all.map(l => [l.id, l]));
  const kids = (id: string | null, type: string) =>
    all.filter(l => (l.parent_id ?? null) === id && l.location_type === type);

  // Search keeps each hit WITH its ancestors, so a matched bin still has a store
  // and zone to be reached through.
  const q = searchTerm.trim().toLowerCase();
  let keep: Set<string> | null = null;
  if (q) {
    keep = new Set();
    for (const l of all) {
      if (!l.code.toLowerCase().includes(q) && !l.name.toLowerCase().includes(q)) continue;
      for (let c = l; c && !keep.has(c.id); c = c.parent_id ? byId.get(c.parent_id) : null) keep.add(c.id);
    }
  }
  const visible = (id: string | null, type: string) => kids(id, type).filter(l => !keep || keep.has(l.id)).sort(byName);

  const stores = visible(null, 'warehouse');
  const store = (selectedStore && stores.find(s => s.id === selectedStore)) || stores[0] || null;
  const zones = store ? visible(store.id, 'zone') : [];
  const zone = (selectedZone && zones.find(z => z.id === selectedZone)) || null;
  const bins = zone ? visible(zone.id, 'bin') : [];
  const bin = (selectedBin && bins.find(b => b.id === selectedBin)) || null;

  const codeSet = new Set(all.map(l => l.code));
  const ensureUniqueCode = (base: string) => {
    let c = base, n = 1;
    while (codeSet.has(c)) { c = `${base}-${n}`; n++; }
    return c;
  };
  const childCode = (parent: any, name: string) => ensureUniqueCode(`${parent.code}-${name.trim()}`.replace(/\s+/g, '-'));

  // ---------- selection ----------
  const pickStore = (id: string) => { setSelectedStore(id); setSelectedZone(null); setSelectedBin(null); setAdding(null); };
  const pickZone = (id: string) => { setSelectedZone(id); setSelectedBin(null); setAdding(null); };

  // ---------- handlers ----------
  const parentFor = (level: number) => (level === 0 ? null : level === 1 ? store : zone);

  const submitAdd = async () => {
    if (!adding || saving) return;
    const parent = parentFor(adding.level);
    const name = adding.name.trim();
    const code = adding.level === 0 ? adding.code.trim() : parent ? childCode(parent, name) : '';
    if (!name || !code || (adding.level > 0 && !parent)) return;
    setSaving(true);
    try {
      const res = await onCreateLocation({ code, name, parent_id: parent?.id ?? null });
      if (res && res.status === 400 && adding.level === 0) {
        showToast(`Code "${code}" already exists`, 'warning');
        setAdding({ ...adding, code: ensureUniqueCode(code.replace(/-\d+$/, '')) });
      } else if (res && res.ok) {
        showToast(`${['Store', 'Zone', 'Bin'][adding.level]} added`, 'success');
        setAdding({ ...adding, code: '', name: '' }); // stay open: bins are usually added in runs
      } else {
        showToast(`Failed to add ${['store', 'zone', 'bin'][adding.level]}`, 'danger');
      }
    } finally { setSaving(false); }
  };

  const commitRename = async () => {
    const r = renaming;
    setRenaming(null);
    if (!r) return;
    const cur = byId.get(r.id);
    const name = r.value.trim();
    if (!name || !cur || name === cur.name) return;
    const res = onUpdateLocation ? await onUpdateLocation(r.id, { name }) : null;
    if (res && res.ok) showToast('Renamed', 'success');
    else if (res && res.status === 400) showToast('Cannot rename system stores', 'warning');
  };

  const handleDelete = async (loc: any) => {
    const err = await onDeleteLocation(loc.id);
    if (typeof err === 'string') showToast(err, 'danger');
  };

  // Quarantine hold flag. Set on the STORE and inherited by its zones/bins —
  // stock held anywhere under it shows on the Quarantine Packing page and cannot
  // be packed until its lot is dispositioned OK. Editable on system stores too:
  // a plant may hold elsewhere than the seeded Quarantine warehouse.
  const toggleQuarantine = async (loc: any) => {
    if (!onUpdateLocation) return;
    const next = !loc.is_quarantine;
    await onUpdateLocation(loc.id, { is_quarantine: next });
    showToast(next ? `${loc.name} is now a quarantine hold area` : `${loc.name} is no longer a quarantine hold area`, 'success');
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
    const loc = byId.get(id);
    if (!loc || loc.parent_id === zoneId || loc.id === zoneId) return;
    onUpdateLocation(id, { parent_id: zoneId });
  };

  // ---------- row pieces ----------
  const deleteBlock = (loc: any) => (loc.has_children || all.some(l => l.parent_id === loc.id)) ? 'Remove its sub-locations first' : null;

  const rowActions = (loc: any, extra?: React.ReactNode) => {
    const isSystem = !!loc.system_code;
    const block = deleteBlock(loc);
    const btns = (
      <>
        {extra}
        {canEdit && !isSystem && (
          <XPActionButton icon="bi-pencil" title="Rename" onClick={() => { setAdding(null); setRenaming({ id: loc.id, value: loc.name }); }} />
        )}
        {canDelete && !isSystem && (
          <XPActionButton tone="danger" icon="bi-trash" title={block ?? 'Delete'} disabled={!!block} onClick={() => handleDelete(loc)} />
        )}
      </>
    );
    return extra || (canEdit && !isSystem) || (canDelete && !isSystem) ? btns : undefined;
  };

  const renameRow = (loc: any) => renaming?.id === loc.id && (
    <ColumnRenameRow
      key={loc.id}
      value={renaming.value}
      onChange={v => setRenaming({ id: loc.id, value: v })}
      onCommit={commitRename}
      onCancel={() => setRenaming(null)}
    />
  );

  const storeRow = (s: any) => renameRow(s) || (
    <ColumnRow
      key={s.id}
      icon={kids(s.id, 'zone').length ? 'bi-building-fill' : 'bi-building'}
      iconColor="#caa55a"
      label={s.name}
      sub={s.code}
      selected={s.id === store?.id && !zone}
      onPath={s.id === store?.id && !!zone}
      onSelect={() => pickStore(s.id)}
      chevron
      title={s.full_path || s.name}
      actions={rowActions(s, canEdit && !s.is_quarantine ? (
        <XPActionButton icon="bi-shield" title="Make this a quarantine hold area" onClick={() => toggleQuarantine(s)} />
      ) : undefined)}
      trailing={
        <>
          {s.is_quarantine && (
            <i
              className="bi bi-shield-fill-exclamation"
              title={canEdit ? 'Quarantine hold area — click to stop holding stock here' : 'Quarantine hold area'}
              onClick={e => { e.stopPropagation(); if (canEdit) toggleQuarantine(s); }}
              style={{ color: '#b8860b', fontSize: 11, cursor: canEdit ? 'pointer' : 'default' }}
            />
          )}
          {s.system_code && <i className="bi bi-shield-lock" title="System store" style={{ color: '#a06000', fontSize: 10 }} />}
          <ColumnCount n={kids(s.id, 'zone').length} title="Zones" />
        </>
      }
    />
  );

  const zoneRow = (z: any) => renameRow(z) || (
    <ColumnRow
      key={z.id}
      icon={kids(z.id, 'bin').length ? 'bi-folder-fill' : 'bi-folder'}
      label={z.name}
      sub={z.code}
      selected={z.id === zone?.id && !bin}
      onPath={z.id === zone?.id && !!bin}
      onSelect={() => pickZone(z.id)}
      chevron
      highlight={dragOverId === z.id}
      onDragOver={e => onZoneDragOver(e, z.id)}
      onDragLeave={() => onZoneDragLeave(z.id)}
      onDrop={e => onZoneDrop(e, z.id)}
      title={z.full_path || z.name}
      actions={rowActions(z)}
      trailing={<ColumnCount n={kids(z.id, 'bin').length} title="Bins" />}
    />
  );

  const binRow = (b: any) => renameRow(b) || (
    <ColumnRow
      key={b.id}
      icon="bi-inbox"
      iconColor="#7f9db9"
      label={b.name}
      sub={b.code}
      selected={b.id === bin?.id}
      onSelect={() => setSelectedBin(b.id)}
      draggable={canEdit && renaming?.id !== b.id}
      dragging={draggingId === b.id}
      onDragStart={e => onDragStart(e, b)}
      onDragEnd={onDragEnd}
      title={canEdit ? `${b.full_path || b.name} — drag onto another zone to move it` : (b.full_path || b.name)}
      actions={rowActions(b)}
      trailing={canEdit ? <i className="bi bi-grip-vertical" style={{ color: '#bbb' }} /> : undefined}
    />
  );

  // ---------- panes ----------
  const addBar = (level: number) => {
    if (adding?.level !== level) return undefined;
    const parent = parentFor(level);
    const name = adding.name;
    const dup = level > 0 && !!name.trim() && !!parent &&
      kids(parent.id, LEVELS[level]).some(l => l.name.toLowerCase() === name.trim().toLowerCase());
    return (
      <ColumnAddBar
        onSubmit={submitAdd}
        onCancel={() => setAdding(null)}
        submitDisabled={saving || !name.trim() || dup || (level === 0 && !adding.code.trim())}
        hint={level > 0 && parent ? <>code: {name.trim() ? childCode(parent, name) : `${parent.code}-…`}</> : undefined}
      >
        {level === 0 && (
          <ColumnInput autoFocus style={{ flex: '0 0 90px' }} placeholder="Code" value={adding.code}
            onChange={e => setAdding({ ...adding, code: e.target.value })} />
        )}
        <ColumnInput
          autoFocus={level > 0}
          placeholder={level === 0 ? 'Store name' : level === 1 ? 'Zone name' : 'Bin / shelf (e.g. A1)'}
          value={name}
          invalid={dup && 'Already exists here'}
          onChange={e => setAdding({ ...adding, name: e.target.value })}
        />
      </ColumnAddBar>
    );
  };

  const openAdd = (level: number) => { setRenaming(null); setAdding(adding?.level === level ? null : { level, code: '', name: '' }); };

  const path = [store, zone, bin].filter(Boolean);
  const statusRight = bin ? <>Bin <b>{bin.code}</b></>
    : zone ? <><b>{kids(zone.id, 'bin').length}</b> bins</>
    : store ? <><b>{kids(store.id, 'zone').length}</b> zones · <b>{kids(store.id, 'zone').reduce((n, z) => n + kids(z.id, 'bin').length, 0)}</b> bins</>
    : null;

  return (
    <ShellWindow fill="page" className="fade-in">
      <ShellTitleBar icon="bi-geo-alt-fill" title={t('locations')} />
      <div style={xpToolbar({ flexShrink: 0, padding: '4px 8px' })}>
        <SearchField value={searchTerm} onChange={setSearchTerm} placeholder="Search code or name…" width={240} />
        <ToolbarCount right>
          {all.filter(l => l.location_type === 'warehouse').length} stores · {all.filter(l => l.location_type === 'bin').length} bins
        </ToolbarCount>
      </div>

      <ColumnPanes>
        <ColumnPane
          label="Stores" title="Stores" count={stores.length}
          onAdd={canCreate ? () => openAdd(0) : undefined} addTitle="New store"
          adding={addBar(0)}
        >
          {stores.length ? stores.map(storeRow) : <ColumnEmpty>{q ? 'No matches.' : 'No stores yet.'}</ColumnEmpty>}
        </ColumnPane>

        <ColumnPane
          label="Zones" title={store ? store.name : 'Zones'} count={store ? zones.length : undefined} dimmed={!store}
          onAdd={canCreate && store ? () => openAdd(1) : undefined} addTitle={store ? `New zone in ${store.name}` : undefined}
          adding={addBar(1)}
        >
          {!store ? <ColumnEmpty>Select a store.</ColumnEmpty>
            : zones.length ? zones.map(zoneRow)
            : <ColumnEmpty>{q ? 'No matches.' : `No zones in ${store.name}${canCreate ? ' — add one with +' : ''}.`}</ColumnEmpty>}
        </ColumnPane>

        <ColumnPane
          last label="Bins" title={zone ? zone.name : 'Bins'} count={zone ? bins.length : undefined} dimmed={!zone}
          onAdd={canCreate && zone ? () => openAdd(2) : undefined} addTitle={zone ? `New bin in ${zone.name}` : undefined}
          adding={addBar(2)}
        >
          {!zone ? <ColumnEmpty>Select a zone.</ColumnEmpty>
            : bins.length ? bins.map(binRow)
            : <ColumnEmpty>{q ? 'No matches.' : `No bins in ${zone.name}${canCreate ? ' — add one with +' : ''}.`}</ColumnEmpty>}
        </ColumnPane>
      </ColumnPanes>

      <ColumnStatusBar
        left={path.length ? <><i className="bi bi-geo-alt me-1" style={{ color: '#888' }} />{path.map((p: any) => p.name).join(' › ')}</> : <span style={{ color: '#888' }}>No store selected</span>}
        right={statusRight}
      />
    </ShellWindow>
  );
}

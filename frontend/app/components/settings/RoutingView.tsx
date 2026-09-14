'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import TreeSelect, { buildLocationPickerTree, TreeSelectOption } from '../shared/TreeSelect';
import { ShellWindow, ShellTitleBar, SearchField, ToolbarCount, ToolbarButton } from '../shared/shellTheme';
import { Tabs, TabDef } from '../shared/Tabs';
import Pager from '../shared/Pager';
import ModalWrapper from '../shared/ModalWrapper';
import { XPActionButton, useFloatingMenu, MenuTriggerButton, FloatingMenu, FormSection, FieldLabel, xpFont, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { lvBtn, lvPrimaryBtn, lvInput, lvLabel, lvTh, lvTd, lvSep, lvRow, lvThead } from '../shared/listViewTheme';

const WC_PAGE_SIZE = 20;
const OP_PAGE_SIZE = 20;

const CENTER_TYPES = ['GENERAL', 'BEAMING', 'WARPING', 'WEAVING', 'DYEING', 'SETTING', 'FINISHING', 'CUTTING'];

const emptyWC = { code: '', name: '', cost_per_hour: 0, center_type: 'GENERAL', input_location_id: '', output_location_id: '', reject_location_id: '', parent_id: '', node_type: 'MACHINE', beam_slots: 1 };

// 3-level tree: TYPE (root) → GROUP (optional) → MACHINE (leaf, what WO/BOM point
// at). Depth can't be read off parent_id since a group and a machine both have one,
// so node_type decides; legacy rows without it fall back to the old 2-level shape.
const LEVELS = [
    { value: 'TYPE', label: 'Type (root)' },
    { value: 'GROUP', label: 'Group' },
    { value: 'MACHINE', label: 'Machine' },
];
const nodeTypeOf = (w: any): string =>
    String(w?.node_type || (w?.parent_id ? 'MACHINE' : 'TYPE')).toUpperCase();
const LEVEL_DEPTH: Record<string, number> = { TYPE: 0, GROUP: 1, MACHINE: 2 };
const LEVEL_ICONS: Record<string, string> = { TYPE: 'bi-folder2', GROUP: 'bi-collection', MACHINE: 'bi-cpu' };
const LEVEL_HINTS: Record<string, string> = {
    TYPE: 'A top-level process family (WEAVING, DYEING…). Holds groups and machines, and can carry the default input/output locations they inherit.',
    GROUP: 'A set of machines inside one type — e.g. a loom hall. Set one production calendar and one pair of input/output locations for all of them at once.',
    MACHINE: 'A physical station. Work orders, BOM routing steps and the monitors all point at machines. Leave its locations blank to use its group\'s.',
};
const LOC_FIELDS = ['input_location_id', 'output_location_id', 'reject_location_id'] as const;
type LocField = typeof LOC_FIELDS[number];
// Code + name + type + one column per location field + the actions column. Derived
// so adding a location field can't leave a stale colSpan behind.
const WC_COL_COUNT = 3 + LOC_FIELDS.length + 1;

// Input/output/reject locations cascade down the tree: a machine with no own value
// uses its group's, then its type's. Mirrors work_center_service on the backend —
// a blank machine is normal config, not a missing setup. Each field resolves
// independently, so a loom can override only its output and still inherit the
// hall's defect store.
function inheritedLoc(wcs: any[], fromId: any, field: LocField): { id: string; from: any } | null {
    const byId = new Map(wcs.map((w: any) => [String(w.id), w]));
    let cur = fromId ? byId.get(String(fromId)) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(String(cur.id))) {
        seen.add(String(cur.id));
        if (cur[field]) return { id: String(cur[field]), from: cur };
        cur = cur.parent_id ? byId.get(String(cur.parent_id)) : undefined;
    }
    return null;
}
// Effective value for a row: its own override, else whatever it inherits.
function effectiveLoc(wcs: any[], wc: any, field: LocField): { id: string; from: any } | null {
    if (wc?.[field]) return { id: String(wc[field]), from: wc };
    return inheritedLoc(wcs, wc?.parent_id, field);
}
// Beam positions on a loom: how many warp beams must be mounted for a weaving WO
// to count as beam-ready. Machine config, not per-order — see beam_service.py.
const beamSlots = (v: any) => Math.max(1, parseInt(String(v ?? 1), 10) || 1);

function getWcTypeChip(t?: string): React.CSSProperties {
    switch ((t || '').toUpperCase()) {
        case 'BEAMING':  return { background: '#fce8ff', color: '#660088', border: '1px solid #dda8f0' };
        case 'WARPING':  return { background: '#fff3cc', color: '#664400', border: '1px solid #f0d888' };
        case 'WEAVING':  return { background: '#e8d8ff', color: '#440099', border: '1px solid #c4a8ee' };
        case 'DYEING':   return { background: '#cce4ff', color: '#003d80', border: '1px solid #99c4ee' };
        case 'SETTING':  return { background: '#ffeacc', color: '#7a3d00', border: '1px solid #e8c488' };
        case 'FINISHING':return { background: '#d4f0d4', color: '#005500', border: '1px solid #99cc99' };
        case 'CUTTING':  return { background: '#fff0cc', color: '#886600', border: '1px solid #ddcc88' };
        default:         return { background: '#e8e8e8', color: '#444',    border: '1px solid #ccc' };
    }
}

type WCRow = { wc: any; level: string; depth: number };

// Ordered rows: each TYPE, then its GROUPs with their machines, then the machines
// that sit straight under the TYPE (the pre-group shape). Anything whose parent is
// missing lands at the end so it never disappears from the list.
function buildTree(wcs: any[]): WCRow[] {
    const rows: WCRow[] = [];
    const byId = new Map(wcs.map((w: any) => [String(w.id), w]));
    const childrenOf = (id: string, level: string) =>
        wcs.filter((w: any) => String(w.parent_id || '') === id && nodeTypeOf(w) === level);

    for (const type of wcs.filter((w: any) => nodeTypeOf(w) === 'TYPE')) {
        rows.push({ wc: type, level: 'TYPE', depth: 0 });
        for (const grp of childrenOf(String(type.id), 'GROUP')) {
            rows.push({ wc: grp, level: 'GROUP', depth: 1 });
            for (const m of childrenOf(String(grp.id), 'MACHINE')) {
                rows.push({ wc: m, level: 'MACHINE', depth: 2 });
            }
        }
        for (const m of childrenOf(String(type.id), 'MACHINE')) {
            rows.push({ wc: m, level: 'MACHINE', depth: 1 });
        }
    }
    const placed = new Set(rows.map(r => String(r.wc.id)));
    for (const w of wcs) {
        if (placed.has(String(w.id))) continue;
        const level = nodeTypeOf(w);
        rows.push({ wc: w, level, depth: byId.has(String(w.parent_id)) ? LEVEL_DEPTH[level] ?? 1 : 1 });
    }
    return rows;
}

type TabKey = 'work_centers' | 'operations';

export default function RoutingView({ workCenters, operations, locations, onCreateWorkCenter, onUpdateWorkCenter, onDeleteWorkCenter, onCreateOperation, onDeleteOperation }: any) {
  const { t } = useLanguage();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission('routing.create', 'routing.edit', 'routing.delete');

  const TABS: TabDef<TabKey>[] = [
      { key: 'work_centers', label: t('work_centers'), icon: 'bi-cpu-fill' },
      { key: 'operations', label: t('standard_operations'), icon: 'bi-gear-fill' },
  ];

  const [activeTab, setActiveTab] = useState<TabKey>('work_centers');
  const [newWorkCenter, setNewWorkCenter] = useState({ ...emptyWC });
  const [newOperation, setNewOperation] = useState({ code: '', name: '' });
  const [wcSearch, setWcSearch] = useState('');
  const [opSearch, setOpSearch] = useState('');
  const [wcPage, setWcPage] = useState(1);
  const [opPage, setOpPage] = useState(1);
  const [editingWC, setEditingWC] = useState<any | null>(null);
  const [isCreateWCOpen, setIsCreateWCOpen] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const { openId: wcMenuOpenId, pos: wcMenuPos, toggle: wcMenuToggle, close: wcMenuClose } = useFloatingMenu(140);

  useEffect(() => { setWcPage(1); }, [wcSearch]);
  useEffect(() => { setOpPage(1); }, [opSearch]);

  const locationList = locations || [];
  const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locationList), [locationList]);
  const wcList = workCenters || [];
  const typeNodes = wcList.filter((w: any) => nodeTypeOf(w) === 'TYPE');
  const groupNodes = wcList.filter((w: any) => nodeTypeOf(w) === 'GROUP');
  const machineNodes = wcList.filter((w: any) => nodeTypeOf(w) === 'MACHINE');
  // Valid parents as a tree, so a group reads as sitting inside its type instead of as
  // one more entry in a flat list. A GROUP can only go under a TYPE; a MACHINE under
  // either, so types stay selectable there (= leave the machine ungrouped).
  const parentTreeFor = (level: string, selfId?: string): TreeSelectOption[] => {
      const notSelf = (w: any) => String(w.id) !== String(selfId || '');
      const groupOption = (g: any): TreeSelectOption => ({
          value: String(g.id),
          label: `${g.code} — ${g.name}`,
          subLabel: 'group',
      });
      const tree: TreeSelectOption[] = typeNodes.filter(notSelf).map((tn: any) => {
          const kids = level === 'MACHINE'
              ? groupNodes.filter((g: any) => String(g.parent_id) === String(tn.id) && notSelf(g))
              : [];
          return {
              value: String(tn.id),
              label: `${tn.code} — ${tn.name}`,
              subLabel: tn.center_type || undefined,
              children: kids.length ? kids.map(groupOption) : undefined,
          };
      });
      // Groups whose type row isn't in the list — keep them reachable at top level
      // rather than silently dropping them.
      if (level === 'MACHINE') {
          const knownTypes = new Set(typeNodes.map((tn: any) => String(tn.id)));
          groupNodes
              .filter((g: any) => notSelf(g) && !knownTypes.has(String(g.parent_id)))
              .forEach((g: any) => tree.push(groupOption(g)));
      }
      return tree;
  };

  const getLocName = (id: string | null) => {
      if (!id) return '—';
      const loc = locationList.find((l: any) => l.id === id);
      return loc ? loc.code : '—';
  };

  // "— from GROUP-A (SUPPLY-1) —" in an empty picker, so a blank field reads as
  // inherited-and-fine rather than unset. Falls back to plain none at the root.
  const locEmptyLabel = (wc: any, field: LocField) => {
      const inh = inheritedLoc(wcList, wc?.parent_id, field);
      return inh ? `— from ${inh.from.code} (${getLocName(inh.id)}) —` : '— none —';
  };
  const locEditHint = (wc: any, field: LocField) => {
      const inh = inheritedLoc(wcList, wc?.parent_id, field);
      if (!inh) return null;
      return (
          <span style={{ marginLeft: 4, fontWeight: 'normal', color: '#666'}}>
              (blank = {getLocName(inh.id)} from {inh.from.code})
          </span>
      );
  };

  // Parent chosen in the create panel, and the center type it forces. Everything under
  // a type shares that type (the backend cascades it on change), so letting the user
  // pick a different one here would only create a row that contradicts its own parent.
  const selectedParent = newWorkCenter.parent_id
      ? wcList.find((w: any) => String(w.id) === String(newWorkCenter.parent_id))
      : null;
  const inheritedType: string | null = selectedParent?.center_type || null;
  const effectiveNewType = inheritedType || newWorkCenter.center_type;
  const newTypeOptions = CENTER_TYPES.includes(effectiveNewType)
      ? CENTER_TYPES
      : [effectiveNewType, ...CENTER_TYPES];

  // Breadcrumb of where the new row will land: TYPE › GROUP › new row.
  const placementPreview = useMemo(() => {
      const chain: { label: string; isNew?: boolean }[] = [];
      let cursor: any = selectedParent;
      const seen = new Set<string>();
      while (cursor && !seen.has(String(cursor.id))) {
          seen.add(String(cursor.id));
          chain.unshift({ label: cursor.code || cursor.name });
          cursor = cursor.parent_id ? wcList.find((w: any) => String(w.id) === String(cursor.parent_id)) : null;
      }
      const self = newWorkCenter.code || newWorkCenter.name
          || (newWorkCenter.node_type === 'MACHINE' ? 'new machine' : newWorkCenter.node_type === 'GROUP' ? 'new group' : 'new type');
      chain.push({ label: self, isNew: true });
      if (newWorkCenter.node_type !== 'TYPE' && !selectedParent) {
          chain.unshift({ label: newWorkCenter.node_type === 'GROUP' ? '(pick a type)' : '(pick a type or group)' });
      }
      return chain;
  }, [selectedParent, wcList, newWorkCenter.code, newWorkCenter.name, newWorkCenter.node_type]);

  const createValid = !!newWorkCenter.code.trim() && !!newWorkCenter.name.trim()
      && (newWorkCenter.node_type === 'TYPE' || !!newWorkCenter.parent_id);

  const handleCreateWC = (e: React.FormEvent) => {
      e.preventDefault();
      if (!createValid) return;
      onCreateWorkCenter({
          ...newWorkCenter,
          center_type: effectiveNewType,
          // Containers keep locations too — machines under them inherit these.
          input_location_id: newWorkCenter.input_location_id || null,
          output_location_id: newWorkCenter.output_location_id || null,
          reject_location_id: newWorkCenter.reject_location_id || null,
          parent_id: newWorkCenter.node_type === 'TYPE' ? null : (newWorkCenter.parent_id || null),
          node_type: newWorkCenter.node_type,
          beam_slots: beamSlots(newWorkCenter.beam_slots),
      });
      setNewWorkCenter({ ...emptyWC });
      setIsCreateWCOpen(false);
  };

  const toggleGroup = (id: string) => {
      setExpandedGroupIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
      });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingWC) return;
      const level = nodeTypeOf(editingWC);
      onUpdateWorkCenter(editingWC.id, {
          code: editingWC.code,
          name: editingWC.name,
          description: editingWC.description,
          cost_per_hour: editingWC.cost_per_hour,
          center_type: editingWC.center_type,
          input_location_id: editingWC.input_location_id || null,
          output_location_id: editingWC.output_location_id || null,
          reject_location_id: editingWC.reject_location_id || null,
          parent_id: level === 'TYPE' ? null : (editingWC.parent_id || null),
          node_type: level,
          beam_slots: beamSlots(editingWC.beam_slots),
      });
      setEditingWC(null);
  };

  const handleCreateOp = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateOperation(newOperation);
      setNewOperation({ code: '', name: '' });
  };

  const hasChildren = (gid: string) => wcList.some((w: any) => String(w.parent_id) === String(gid));
  const isSearchingWC = wcSearch.trim().length > 0;
  const allWCRows = buildTree(wcList);
  const wcById = new Map(wcList.map((w: any) => [String(w.id), w]));
  // A row shows only when EVERY container above it is expanded — with three levels a
  // machine can be hidden by its group, its type, or both.
  const ancestorsVisible = (wc: any): boolean => {
      let pid = wc.parent_id ? String(wc.parent_id) : '';
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) {
          seen.add(pid);
          if (!wcById.has(pid)) return true; // parent not loaded — don't hide the row
          if (!expandedGroupIds.has(pid)) return false;
          pid = String((wcById.get(pid) as any).parent_id || '');
      }
      return true;
  };
  const filteredWCRows = allWCRows.filter(({ wc, level }) => {
      const q = wcSearch.toLowerCase();
      const matches = wc.code.toLowerCase().includes(q) || wc.name.toLowerCase().includes(q);
      if (isSearchingWC) return matches;
      if (level === 'TYPE') return true;
      return ancestorsVisible(wc);
  });
  const wcPages = Math.max(1, Math.ceil(filteredWCRows.length / WC_PAGE_SIZE));
  const clampedWcPage = Math.min(wcPage, wcPages);
  const pagedWCRows = filteredWCRows.slice((clampedWcPage - 1) * WC_PAGE_SIZE, clampedWcPage * WC_PAGE_SIZE);

  const filteredOp = (operations || []).filter((op: any) =>
      op.code.toLowerCase().includes(opSearch.toLowerCase()) ||
      op.name.toLowerCase().includes(opSearch.toLowerCase())
  );
  const opPages = Math.max(1, Math.ceil(filteredOp.length / OP_PAGE_SIZE));
  const clampedOpPage = Math.min(opPage, opPages);
  const pagedOp = filteredOp.slice((clampedOpPage - 1) * OP_PAGE_SIZE, clampedOpPage * OP_PAGE_SIZE);

  // ── Shared inline edit row (Work Centers) ─────────────────────────────────
  const renderEditRow = (colSpan: number) => {
      if (!editingWC) return null;
      const level = nodeTypeOf(editingWC);
      const isMachine = level === 'MACHINE';
      return (
          <tr style={{ background: '#fffde7', borderBottom: '2px solid #0058e6'}}>
              <td colSpan={colSpan} style={{ padding: '8px 10px' }}>
                  <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                          <div>
                              <label style={lvLabel()}>Code</label>
                              <input style={{ ...lvInput(), width: 80 }} value={editingWC.code} onChange={e => setEditingWC({ ...editingWC, code: e.target.value })} required />
                          </div>
                          <div style={{ flex: 1, minWidth: 140 }}>
                              <label style={lvLabel()}>{t('station_name')}</label>
                              <input style={lvInput()} value={editingWC.name} onChange={e => setEditingWC({ ...editingWC, name: e.target.value })} required />
                          </div>
                          <div>
                              <label style={lvLabel()}>Type</label>
                              <select style={{ ...lvInput(), width: 110 }} value={editingWC.center_type} onChange={e => setEditingWC({ ...editingWC, center_type: e.target.value })}>
                                  {CENTER_TYPES.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                              </select>
                          </div>
                          <div>
                              <label style={lvLabel()}>Level</label>
                              <select
                                  style={{ ...lvInput(), width: 110 }}
                                  value={level}
                                  onChange={e => setEditingWC({ ...editingWC, node_type: e.target.value, parent_id: e.target.value === 'TYPE' ? '' : editingWC.parent_id })}
                              >
                                  {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                              </select>
                          </div>
                          {level !== 'TYPE' && (
                              <div>
                                  <label style={lvLabel()}>{level === 'GROUP' ? 'Under Type' : 'Under Type / Group'}</label>
                                  <TreeSelect
                                      options={parentTreeFor(level, editingWC.id)}
                                      value={editingWC.parent_id || ''}
                                      onChange={id => setEditingWC({ ...editingWC, parent_id: id })}
                                      placeholder="— none —"
                                      size="sm"
                                      style={{ width: 200 }}
                                  />
                              </div>
                          )}
                      </div>
                      {/* Locations apply at every level: a container's value is the
                          default its machines inherit when they leave theirs blank. */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                              <div style={{ flex: 1, minWidth: 160 }}>
                                  <label style={lvLabel()}>Input Location{locEditHint(editingWC, 'input_location_id')}</label>
                                  <TreeSelect options={locPickerTreeOptions} value={editingWC.input_location_id || ''} onChange={id => setEditingWC({ ...editingWC, input_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(editingWC, 'input_location_id')} size="sm" style={{ width: '100%' }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 160 }}>
                                  <label style={lvLabel()}>Output Location{locEditHint(editingWC, 'output_location_id')}</label>
                                  <TreeSelect options={locPickerTreeOptions} value={editingWC.output_location_id || ''} onChange={id => setEditingWC({ ...editingWC, output_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(editingWC, 'output_location_id')} size="sm" style={{ width: '100%' }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 160 }}>
                                  <label style={lvLabel()} title="Defect store — QC-rejected output from this centre is moved here instead of staying on the good shelf">
                                      Reject Location{locEditHint(editingWC, 'reject_location_id')}
                                  </label>
                                  <TreeSelect options={locPickerTreeOptions} value={editingWC.reject_location_id || ''} onChange={id => setEditingWC({ ...editingWC, reject_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(editingWC, 'reject_location_id')} size="sm" style={{ width: '100%' }} />
                              </div>
                              {isMachine && ['WEAVING', 'TENUN'].includes((editingWC.center_type || '').toUpperCase()) && (
                                  <div style={{ width: 120 }}>
                                      <label style={lvLabel()}>Beam Slots</label>
                                      <input
                                          type="number" min={1} step={1}
                                          style={{ ...lvInput(), width: '100%' }}
                                          value={editingWC.beam_slots ?? 1}
                                          onChange={e => setEditingWC({ ...editingWC, beam_slots: e.target.value })}
                                          title="Beam positions on this loom — a weaving WO is beam-ready when this many beams are mounted"
                                      />
                                  </div>
                              )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                          <button type="submit" className={XP_BTN} style={lvPrimaryBtn()}>Save</button>
                          <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setEditingWC(null)}>Cancel</button>
                      </div>
                  </form>
              </td>
          </tr>
      );
  };

  // ── Work Centers tab ───────────────────────────────────────────────────────
  const renderWorkCentersTab = () => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Toolbar: add + search + count */}
          <div style={{
              background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
              borderBottom: '1px solid #b0a898',
              padding: '4px 8px',
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, flexShrink: 0,
          }}>
              <SearchField classic value={wcSearch} onChange={setWcSearch} placeholder="Search work centers…" width={240} />
              <ToolbarCount classic right>
                  {filteredWCRows.length.toLocaleString()} station{filteredWCRows.length !== 1 ? 's' : ''}
              </ToolbarCount>
              {canManage && (
                  <>
                      <span style={lvSep()} />
                      <ToolbarButton classic tone="create" icon="bi-plus-lg" onClick={() => { setNewWorkCenter({ ...emptyWC }); setIsCreateWCOpen(true); }}>
                          New Work Center
                      </ToolbarButton>
                  </>
              )}
          </div>

          {/* Table */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={lvThead()}>
                      <tr>
                          <th style={{ ...lvTh(), width: 140, paddingLeft: 10}}>Code</th>
                          <th style={lvTh()}>{t('station_name')}</th>
                          <th style={{ ...lvTh(), width: 90 }}>Type</th>
                          <th style={{ ...lvTh(), width: 100 }}>In Loc</th>
                          <th style={{ ...lvTh(), width: 100 }}>Out Loc</th>
                          <th style={{ ...lvTh(), width: 100 }} title="Defect store for QC-rejected output">Reject Loc</th>
                          <th style={{ ...lvTh(), width: 40, textAlign: 'right', borderRight: 'none' }}></th>
                      </tr>
                  </thead>
                  <tbody>
                      {pagedWCRows.map(({ wc, level, depth }, i) => {
                          const isContainer = level !== 'MACHINE';
                          const expandable = isContainer && hasChildren(wc.id);
                          const expanded = expandedGroupIds.has(wc.id);
                          const step = 20;
                          return editingWC?.id === wc.id
                              ? <React.Fragment key={wc.id}>{renderEditRow(WC_COL_COUNT)}</React.Fragment>
                              : (
                                  <tr
                                      key={wc.id}
                                      style={{
                                          ...(level === 'TYPE'
                                              ? { background: '#e8eaf6', borderBottom: '2px solid #9fa8da'}
                                              : level === 'GROUP'
                                                  ? { background: '#f2f3fa', borderBottom: '1px solid #c5cae9'}
                                                  : lvRow(i)),
                                          cursor: expandable ? 'pointer' : undefined,
                                      }}
                                      onClick={expandable ? () => toggleGroup(wc.id) : undefined}
                                  >
                                      <td style={{ ...lvTd(), paddingLeft: (10) + depth * step, fontWeight: 'bold', whiteSpace: 'nowrap', color: isContainer ? ('#1a237e') : ('#00008b') }}>
                                          {isContainer && <i className={expandable ? (expanded ? 'bi bi-caret-down-fill' : 'bi bi-caret-right-fill') : 'bi bi-folder2'} style={{ marginRight: 5, fontSize: 9, color: expandable ? '#555' : undefined }}></i>}
                                          {!isContainer && <i className="bi bi-dash" style={{ marginRight: 2, fontSize: 10, color: '#888' }}></i>}
                                          {wc.code}
                                      </td>
                                      <td style={{ ...lvTd(), paddingLeft: depth * step || undefined, fontStyle: isContainer ? 'italic' : 'normal' }}>
                                          {wc.name}
                                          {level === 'GROUP' && <span style={{ marginLeft: 6, fontSize: 9, fontStyle: 'normal', color: '#666' }}>GROUP</span>}
                                      </td>
                                      <td style={lvTd()}>
                                          <span style={{ padding: '1px 6px', borderRadius: CHIP_RADIUS, fontSize: 10, ...getWcTypeChip(wc.center_type) }}>{wc.center_type || 'GENERAL'}</span>
                                      </td>
                                      {LOC_FIELDS.map(field => {
                                          // Show what actually applies, italic when it comes from an
                                          // ancestor — a blank machine is inheriting, not unconfigured.
                                          const eff = effectiveLoc(wcList, wc, field);
                                          const own = !!wc[field];
                                          return (
                                              <td
                                                  key={field}
                                                  title={eff && !own ? `Inherited from ${eff.from.code}` : undefined}
                                                  style={{
                                                      ...lvTd(),
                                                      color: own ? '#444' : '#777',
                                                      fontStyle: eff && !own ? 'italic' : 'normal',
                                                      whiteSpace: 'nowrap',
                                                  }}
                                              >
                                                  {getLocName(eff?.id || null)}
                                              </td>
                                          );
                                      })}
                                      <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                          {canManage && <MenuTriggerButton classic onClick={e => wcMenuToggle(wc.id, e)} />}
                                      </td>
                                  </tr>
                              );
                      })}
                      {filteredWCRows.length === 0 && (
                          <tr><td colSpan={WC_COL_COUNT} style={{ ...lvTd(), borderRight: 'none', textAlign: 'center', padding: 20, color: '#888', fontStyle: 'italic' }}>No work centers defined</td></tr>
                      )}
                  </tbody>
              </table>
          </div>

          <Pager page={clampedWcPage} total={filteredWCRows.length} pageSize={WC_PAGE_SIZE} onPageChange={setWcPage} hideWhenEmpty />

          {wcMenuOpenId && (() => {
              const wc = wcList.find((w: any) => String(w.id) === wcMenuOpenId);
              if (!wc || !canManage) return null;
              return (
                  <FloatingMenu
                      pos={wcMenuPos}
                      items={[
                          { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', onClick: () => { wcMenuClose(); setEditingWC({ ...wc }); } },
                          { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { wcMenuClose(); onDeleteWorkCenter && onDeleteWorkCenter(wc.id); } },
                      ]}
                  />
              );
          })()}

          {(
              <div style={{
                  background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                  padding: '2px 8px', display: 'flex', gap: 16,
                  fontFamily: xpFont, fontSize: 11, color: '#333',
              }}>
                  <span><b>{wcList.length}</b> Total</span>
                  <span><b>{typeNodes.length}</b> Types</span>
                  <span><b>{groupNodes.length}</b> Groups</span>
                  <span><b>{machineNodes.length}</b> Machines</span>
              </div>
          )}
      </div>
  );

  // ── Operations tab ─────────────────────────────────────────────────────────
  const renderOperationsTab = () => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {canManage && (
              <div style={{ background: '#f5f4ef', borderBottom: '1px solid #b0a898', padding: '6px 8px'}}>
                  <form onSubmit={handleCreateOp} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                      <div>
                          <label style={lvLabel()}>Code</label>
                          <input style={{ ...lvInput(), width: 80 }} placeholder="OP-10" value={newOperation.code} onChange={e => setNewOperation({ ...newOperation, code: e.target.value })} required />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                          <label style={lvLabel()}>{t('operation_name')}</label>
                          <input style={lvInput()} placeholder="Cutting" value={newOperation.name} onChange={e => setNewOperation({ ...newOperation, name: e.target.value })} required />
                      </div>
                      <button type="submit" className={XP_BTN} style={lvPrimaryBtn()}>
                          <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{t('add')}
                      </button>
                  </form>
              </div>
          )}

          {/* Toolbar: search + count */}
          <div style={{
              background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
              borderBottom: '1px solid #b0a898',
              padding: '4px 8px',
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, flexShrink: 0,
          }}>
              <SearchField classic value={opSearch} onChange={setOpSearch} placeholder="Search operations…" width={240} />
              <span style={lvSep()} />
              <ToolbarCount classic right>
                  {filteredOp.length.toLocaleString()} operation{filteredOp.length !== 1 ? 's' : ''}
              </ToolbarCount>
          </div>

          {/* Table */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={lvThead()}>
                      <tr>
                          <th style={{ ...lvTh(), width: 100, paddingLeft: 10}}>Code</th>
                          <th style={lvTh()}>{t('operation_name')}</th>
                          <th style={{ ...lvTh(), width: 50, textAlign: 'right', borderRight: 'none' }}></th>
                      </tr>
                  </thead>
                  <tbody>
                      {pagedOp.map((op: any, i: number) => (
                          <tr key={op.id} style={lvRow(i)}>
                              <td style={{ ...lvTd(), paddingLeft: 10, fontWeight: 'bold', color: '#1a5e1a'}}>
                                  {op.code}
                                  {op.is_system && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 'bold', color: '#555', background: '#ddd', border: '1px solid #aaa', borderRadius: CHIP_RADIUS, padding: '0 3px' }}>sys</span>}
                              </td>
                              <td style={lvTd()}>{op.name}</td>
                              <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }}>
                                  {!op.is_system && canManage && (
                                      <XPActionButton classic tone="danger" icon="bi-trash" title="Delete" onClick={() => onDeleteOperation && onDeleteOperation(op.id)} />
                                  )}
                              </td>
                          </tr>
                      ))}
                      {filteredOp.length === 0 && (
                          <tr><td colSpan={3} style={{ ...lvTd(), borderRight: 'none', textAlign: 'center', padding: 20, color: '#888', fontStyle: 'italic' }}>No operations defined</td></tr>
                      )}
                  </tbody>
              </table>
          </div>

          <Pager page={clampedOpPage} total={filteredOp.length} pageSize={OP_PAGE_SIZE} onPageChange={setOpPage} hideWhenEmpty />

          {(
              <div style={{
                  background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                  padding: '2px 8px', display: 'flex', gap: 16,
                  fontFamily: xpFont, fontSize: 11, color: '#333',
              }}>
                  <span><b>{(operations || []).length}</b> Total</span>
              </div>
          )}
      </div>
  );

  return (
      <>
      <ShellWindow classic fill="page" className="fade-in">
          <ShellTitleBar
              classic
              icon="bi-signpost-split-fill"
              title={t('routing')}
              subtitle="Work centers and standard operations used across manufacturing routings"
          />
          <Tabs tabs={TABS} activeKey={activeTab} onChange={(key) => setActiveTab(key)} classic />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#ece9d8'}}>
              <div style={{ display: activeTab === 'work_centers' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                  {renderWorkCentersTab()}
              </div>
              <div style={{ display: activeTab === 'operations' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                  {renderOperationsTab()}
              </div>
          </div>
      </ShellWindow>

      {/* Create Work Center panel */}
      <ModalWrapper
          isOpen={isCreateWCOpen}
          modeless
          size="lg"
          onClose={() => setIsCreateWCOpen(false)}
          title={<><i className="bi bi-plus-circle me-1"></i> Add Work Center</>}
          variant="primary"
          footer={
              <>
                  {!createValid && (
                      <span style={{ marginRight: 'auto', fontSize: 11, color: '#a06000' }}>
                          {newWorkCenter.node_type !== 'TYPE' && !newWorkCenter.parent_id
                              ? `Choose where this ${newWorkCenter.node_type.toLowerCase()} sits first`
                              : 'Code and name are required'}
                      </span>
                  )}
                  <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setIsCreateWCOpen(false)}>Cancel</button>
                  <button type="button" className={XP_BTN} style={{ ...lvPrimaryBtn(), ...(createValid ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }} onClick={handleCreateWC} disabled={!createValid}>
                      <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{t('add')}
                  </button>
              </>
          }
      >
          <form onSubmit={handleCreateWC} style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Level first: it decides which fields below even apply. */}
              <FormSection classic title={<><i className="bi bi-diagram-3 me-1" />Placement</>}>
                  <FieldLabel classic hint="A machine is what work orders, BOM routing and monitors point at. Types and groups only organize them.">
                      What are you adding?
                  </FieldLabel>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const }}>
                      {LEVELS.map(l => {
                          const on = newWorkCenter.node_type === l.value;
                          return (
                              <button
                                  key={l.value}
                                  type="button"
                                  className={XP_BTN}
                                  onClick={() => setNewWorkCenter({ ...newWorkCenter, node_type: l.value, parent_id: '', input_location_id: '', output_location_id: '' })}
                                  style={{ ...(on ? lvPrimaryBtn() : lvBtn()), flex: 1, minWidth: 108, textAlign: 'center', padding: '4px 6px' }}
                                  title={LEVEL_HINTS[l.value]}
                              >
                                  <i className={`bi ${LEVEL_ICONS[l.value]}`} style={{ marginRight: 4 }} />{l.label.replace(' (root)', '')}
                              </button>
                          );
                      })}
                  </div>
                  <div style={{ fontSize: 10, color: '#665f4a', marginBottom: newWorkCenter.node_type === 'TYPE' ? 0 : 10 }}>
                      {LEVEL_HINTS[newWorkCenter.node_type]}
                  </div>

                  {newWorkCenter.node_type !== 'TYPE' && (
                      <>
                          <FieldLabel
                              classic
                              hint={newWorkCenter.node_type === 'GROUP'
                                  ? 'Groups sit inside one work center type.'
                                  : 'Pick a group to make the machine part of a batch-calendar group, or a type to leave it ungrouped.'}
                          >
                              {newWorkCenter.node_type === 'GROUP' ? 'Inside which type?' : 'Where does it sit?'} <span style={{ color: '#c00' }}>*</span>
                          </FieldLabel>
                          <TreeSelect
                              options={parentTreeFor(newWorkCenter.node_type)}
                              value={newWorkCenter.parent_id}
                              onChange={id => {
                                  // Adopt the parent's center type immediately: the field below is
                                  // read-only when inherited, so leaving state on its old value
                                  // would submit (and preview) a type the parent contradicts.
                                  const p = wcList.find((w: any) => String(w.id) === String(id));
                                  setNewWorkCenter({
                                      ...newWorkCenter,
                                      parent_id: id,
                                      center_type: p?.center_type || newWorkCenter.center_type,
                                  });
                              }}
                              placeholder="— choose —"
                              size="sm"
                              style={{ width: '100%' }}
                          />
                      </>
                  )}

                  {/* Where the new row lands, spelled out — the tree is 3 deep now. */}
                  <div style={{
                      marginTop: 10, padding: '4px 7px',
                      background: '#fbfbf7',
                      border: '1px solid #c0bdb5',
                      fontSize: 11, color: '#333',
                  }}>
                      <span style={{ color: '#888', marginRight: 4 }}>Will appear as</span>
                      {placementPreview.map((step, idx) => (
                          <span key={idx}>
                              {idx > 0 && <span style={{ color: '#aaa', margin: '0 4px' }}>›</span>}
                              <span style={step.isNew ? { fontWeight: 'bold', color: '#00008b'} : undefined}>{step.label}</span>
                          </span>
                      ))}
                  </div>
              </FormSection>

              <FormSection classic title={<><i className="bi bi-tag me-1" />Identity</>}>
                  <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ width: 110 }}>
                          <FieldLabel classic>Code <span style={{ color: '#c00' }}>*</span></FieldLabel>
                          <input style={lvInput()} placeholder={newWorkCenter.node_type === 'MACHINE' ? 'W-01' : 'W'} value={newWorkCenter.code} onChange={e => setNewWorkCenter({ ...newWorkCenter, code: e.target.value })} required autoFocus />
                      </div>
                      <div style={{ flex: 1 }}>
                          <FieldLabel classic>{t('station_name')} <span style={{ color: '#c00' }}>*</span></FieldLabel>
                          <input
                              style={lvInput()}
                              placeholder={newWorkCenter.node_type === 'TYPE' ? 'WEAVING' : newWorkCenter.node_type === 'GROUP' ? 'Hall A looms' : 'Loom 1'}
                              value={newWorkCenter.name}
                              onChange={e => setNewWorkCenter({ ...newWorkCenter, name: e.target.value })}
                              required
                          />
                      </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                      <FieldLabel
                          classic
                          hint={inheritedType
                              ? `Follows ${selectedParent?.code} — everything under a type shares its type.`
                              : 'Drives routing, monitors and the type chip in lists.'}
                      >
                          Center Type
                      </FieldLabel>
                      <select
                          style={{ ...lvInput(), ...(inheritedType ? { background: '#ece9d8', color: '#555' } : {}) }}
                          value={effectiveNewType}
                          disabled={!!inheritedType}
                          onChange={e => setNewWorkCenter({ ...newWorkCenter, center_type: e.target.value })}
                      >
                          {/* A parent may carry a type this list doesn't know (legacy rows,
                              e.g. TENUN) — show it rather than rendering an empty select. */}
                          {newTypeOptions.map(ct => <option key={ct} value={ct}>{ct}</option>)}
                      </select>
                  </div>
              </FormSection>

              {/* Locations live at every level. A group holds the pair its machines
                  inherit, so a machine only fills these in to override its group. */}
              <FormSection
                  classic
                  title={<><i className={`bi ${newWorkCenter.node_type === 'MACHINE' ? 'bi-cpu' : 'bi-geo-alt'} me-1`} />
                      {newWorkCenter.node_type === 'MACHINE' ? 'Machine setup' : 'Default locations'}</>}
              >
                  <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                          <FieldLabel
                              classic
                              hint={newWorkCenter.node_type === 'MACHINE'
                                  ? 'Where staged material is moved to. Leave blank to use the group\'s.'
                                  : 'Where staged material is moved to — every machine inside inherits this.'}
                          >
                              Input Location
                          </FieldLabel>
                          <TreeSelect options={locPickerTreeOptions} value={newWorkCenter.input_location_id} onChange={id => setNewWorkCenter({ ...newWorkCenter, input_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(newWorkCenter, 'input_location_id')} size="sm" style={{ width: '100%' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                          <FieldLabel
                              classic
                              hint={newWorkCenter.node_type === 'MACHINE'
                                  ? 'Where finished output is put away. Leave blank to use the group\'s.'
                                  : 'Where finished output is put away — every machine inside inherits this.'}
                          >
                              Output Location
                          </FieldLabel>
                          <TreeSelect options={locPickerTreeOptions} value={newWorkCenter.output_location_id} onChange={id => setNewWorkCenter({ ...newWorkCenter, output_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(newWorkCenter, 'output_location_id')} size="sm" style={{ width: '100%' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                          <FieldLabel
                              classic
                              hint={newWorkCenter.node_type === 'MACHINE'
                                  ? 'Defect store for QC-rejected output. Leave blank to use the group\'s.'
                                  : 'Defect store for QC-rejected output — e.g. Gd Greige BS for weaving, Gd WiP Beam Reject for beaming.'}
                          >
                              Reject Location
                          </FieldLabel>
                          <TreeSelect options={locPickerTreeOptions} value={newWorkCenter.reject_location_id} onChange={id => setNewWorkCenter({ ...newWorkCenter, reject_location_id: id })} allowEmpty emptyLabel={locEmptyLabel(newWorkCenter, 'reject_location_id')} size="sm" style={{ width: '100%' }} />
                      </div>
                  </div>
                  {newWorkCenter.node_type === 'MACHINE' && ['WEAVING', 'TENUN'].includes((effectiveNewType || '').toUpperCase()) && (
                      <div style={{ width: 140, marginTop: 8 }}>
                          <FieldLabel classic hint="Beam positions on this loom.">Beam Slots</FieldLabel>
                          <input
                              type="number" min={1} step={1}
                              style={{ ...lvInput(), width: '100%' }}
                              value={newWorkCenter.beam_slots}
                              onChange={e => setNewWorkCenter({ ...newWorkCenter, beam_slots: beamSlots(e.target.value) })}
                              title="A weaving WO is beam-ready when this many beams are mounted"
                          />
                      </div>
                  )}
              </FormSection>
          </form>
      </ModalWrapper>
      </>
  );
}

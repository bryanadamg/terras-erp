'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { xpInput, FieldLabel, FormError, ToggleChip, ModalFooterActions } from '../shared/xpTheme';
import PermissionsPicker, { PermissionOption } from './PermissionsPicker';
import AvatarPicker from '../shared/AvatarPicker';
import { PixelAvatarFromRecipe } from '../shared/PixelAvatar';
import { hasPins, parseRecipe, resolveRecipe, serializeRecipe, setFeature } from '../shared/avatarRecipe';
import { useData } from '../../context/DataContext';
import { PermissionChip, PermissionSectionTable, PermissionCountPill } from '../shared/permissionChips';

// Stand-in usernames for the "same dress code, different faces" strip. Fixed, so
// the preview doesn't reshuffle on every keystroke, and deliberately three: one
// face can't show that the template constrains the role rather than replacing it.
const SAMPLE_SEEDS = ['ayu', 'bryan', 'joko'];

export interface RoleFormPayload {
    name: string;
    description: string | null;
    permission_ids: string[];
    allowed_work_center_types: string[] | null;
    allowed_categories: string[] | null;
    allowed_locations: string[] | null;
    /** Avatar template; '' clears it (the backend maps empty to null). */
    default_avatar_id: string;
}

export interface RoleLike {
    id: string;
    name: string;
    description?: string | null;
    permissions: PermissionOption[];
    allowed_work_center_types?: string[] | null;
    allowed_categories?: string[] | null;
    allowed_locations?: string[] | null;
    default_avatar_id?: string | null;
}

interface ScopeOption { id: string; path: string[] }

/* A scope list as the same section table the permission matrix uses, one row per
   top-level parent (warehouse / root category) with the rest of the path on the
   chip — the flat "Raw Material / NYLON FILAMENT RW / ..." chip wall repeated the
   parent on every chip and hid which ones were on inside a nested scroll box. */
function ScopePicker({ title, anyLabel, options, selected, onChange }: {
    title: string;
    anyLabel: string;
    options: ScopeOption[];
    selected: string[];
    onChange: (ids: string[]) => void;
}) {
    const [filter, setFilter] = useState('');
    const sel = new Set(selected);
    const q = filter.trim().toLowerCase();
    const shown = q ? options.filter(o => o.path.join(' / ').toLowerCase().includes(q)) : options;

    // Parents that have children get their own row; childless top-level entries
    // share one row so a few lone locations don't each cost a line.
    const parents = new Set(options.filter(o => o.path.length > 1).map(o => o.path[0]));
    const groups = new Map<string, ScopeOption[]>();
    for (const o of shown) {
        const key = parents.has(o.path[0]) ? o.path[0] : '';
        groups.set(key, [...(groups.get(key) || []), o]);
    }
    const toggle = (id: string) => onChange(sel.has(id) ? selected.filter(x => x !== id) : [...selected, id]);

    const rows = Array.from(groups.entries())
        .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
        .map(([key, opts]) => ({
            key: key || '_top',
            label: key || 'Top level',
            chips: opts.map(o => (
                <PermissionChip
                    key={o.id}
                    code="edit"
                    label={key && o.path.length > 1 ? o.path.slice(1).join(' / ') : o.path[0]}
                    state={sel.has(o.id) ? 'on' : 'off'}
                    title={o.path.join(' / ')}
                    onClick={() => toggle(o.id)}
                />
            )),
        }));

    return (
        <>
            {options.length > 12 && (
                <input
                    style={xpInput({ width: '100%', marginBottom: 4 })}
                    placeholder="Filter…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            )}
            <PermissionSectionTable
                labelWidth={160}
                headerActive={selected.length > 0}
                title={<>{title}<PermissionCountPill granted={selected.length} total={options.length} /></>}
                right={selected.length
                    ? <button type="button" onClick={() => onChange([])}
                        style={{ fontSize: 9, background: 'none', border: 'none', color: '#00006e', textDecoration: 'underline', cursor: 'pointer' }}>
                        Clear — allow {anyLabel}
                    </button>
                    : <span style={{ fontSize: 9, color: '#1a5e2a', fontStyle: 'italic' }}>Unrestricted — {anyLabel}</span>}
                rows={rows.length ? rows : [{ key: '_none', label: 'No match', chips: null }]}
            />
        </>
    );
}

export default function RoleFormModal({
    isOpen, onClose, mode, role, allPermissions, onSubmit,
}: {
    isOpen: boolean;
    onClose: () => void;
    mode: 'create' | 'edit';
    role?: RoleLike;
    allPermissions: PermissionOption[];
    onSubmit: (payload: RoleFormPayload) => Promise<{ ok: boolean; error?: string }>;
}) {
    const { workCenters, categories, locations } = useData();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [permissionIds, setPermissionIds] = useState<string[]>([]);
    const [allowedWcTypes, setAllowedWcTypes] = useState<string[]>([]);
    const [allowedCategories, setAllowedCategories] = useState<string[]>([]);
    const [allowedLocations, setAllowedLocations] = useState<string[]>([]);
    const [defaultAvatarId, setDefaultAvatarId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [avatarOpen, setAvatarOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(role?.name || '');
        setDescription(role?.description || '');
        setPermissionIds(role?.permissions?.map(p => p.id) || []);
        setAllowedWcTypes(role?.allowed_work_center_types || []);
        setAllowedCategories(role?.allowed_categories || []);
        setAllowedLocations(role?.allowed_locations || []);
        setDefaultAvatarId(role?.default_avatar_id || '');
        setError('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, role?.id]);

    const wcTypes = useMemo(() => {
        const types = new Set<string>();
        for (const wc of workCenters) {
            if (wc.center_type) types.add(wc.center_type);
        }
        return Array.from(types).sort();
    }, [workCenters]);

    const selectedCodes = useMemo(() => {
        const selected = new Set(permissionIds);
        return new Set(allPermissions.filter(p => selected.has(p.id)).map(p => p.code));
    }, [permissionIds, allPermissions]);

    const hasWorkOrderPerm = useMemo(() => {
        for (const c of selectedCodes) if (c.startsWith('work_order.')) return true;
        return false;
    }, [selectedCodes]);

    const hasCategoryScopedPerm = useMemo(() => {
        for (const c of selectedCodes) if (c.startsWith('item.') || c.startsWith('stock_on_hand.')) return true;
        return false;
    }, [selectedCodes]);

    const hasLocationScopedPerm = useMemo(() => {
        for (const c of selectedCodes) if (c.startsWith('lot.')) return true;
        return false;
    }, [selectedCodes]);

    // Whether the picked template constrains anything. Also drives the strip's
    // caption: with no pins, the samples ARE the unconstrained seeded faces.
    const avatarPins = useMemo(() => {
        const parsed = parseRecipe(defaultAvatarId);
        return !!parsed && hasPins(parsed);
    }, [defaultAvatarId]);

    // "Executive" is exactly the hat+accessories-off pair, so it reads back off the
    // recipe rather than needing its own stored flag — an admin who sets those two
    // slots by hand in the picker gets the chip lit, which is the truth.
    const isExecutive = useMemo(() => {
        const parsed = parseRecipe(defaultAvatarId);
        return parsed?.features.hat === null && parsed?.features.accessories === null;
    }, [defaultAvatarId]);

    const toggleExecutive = () => {
        const base = resolveRecipe(defaultAvatarId, SAMPLE_SEEDS[0]);
        const value = isExecutive ? undefined : null;
        setDefaultAvatarId(serializeRecipe(
            setFeature(setFeature(base, 'hat', value), 'accessories', value)));
    };

    const handleSubmit = async () => {
        setError('');
        if (!name.trim()) {
            setError('Role name is required');
            return;
        }
        setSubmitting(true);
        const res = await onSubmit({
            name: name.trim(),
            description: description.trim() || null,
            permission_ids: permissionIds,
            allowed_work_center_types: allowedWcTypes.length ? allowedWcTypes : null,
            allowed_categories: allowedCategories.length ? allowedCategories : null,
            allowed_locations: allowedLocations.length ? allowedLocations : null,
            // A template that pins nothing is not a default — store '' (→ null) so
            // the role reads as unconfigured instead of holding a recipe that
            // resolves identically to having none.
            default_avatar_id: avatarPins ? defaultAvatarId : '',
        });
        setSubmitting(false);
        if (res.ok) {
            onClose();
        } else {
            setError(res.error || 'Something went wrong');
        }
    };

    return (
        <ModalWrapper
            isOpen={isOpen}
            modeless
            onClose={onClose}
            title={<span><i className="bi bi-shield-lock me-2"></i>{mode === 'create' ? 'Add Role' : `Edit Role — ${role?.name}`}</span>}
            variant={mode === 'create' ? 'success' : 'primary'}
            /* Permission matrix needs the width: at md every resource row wrapped
               its action chips onto three lines. */
            size="xl"
            footer={
                <ModalFooterActions
                    onCancel={onClose}
                    onSubmit={handleSubmit}
                    submitting={submitting}
                    submitLabel={mode === 'create' ? 'Create Role' : 'Save Changes'}
                    variant={mode === 'create' ? 'success' : 'primary'}
                />
            }
        >
            <FormError>{error}</FormError>

            <div className="mb-3">
                <FieldLabel>Role Name</FieldLabel>
                <input
                    style={xpInput({ width: '100%' })}
                    placeholder="e.g. Warehouse Supervisor"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />
            </div>

            <div className="mb-3">
                <FieldLabel>Description</FieldLabel>
                <input
                    style={xpInput({ width: '100%' })}
                    placeholder="Optional"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />
            </div>

            <div className="mb-1">
                <FieldLabel>Permissions</FieldLabel>
                <PermissionsPicker
                    allPermissions={allPermissions}
                    selectedIds={permissionIds}
                    onChange={setPermissionIds}
                />
            </div>

            {hasWorkOrderPerm && wcTypes.length > 0 && (
                <div className="mt-3">
                    <FieldLabel hint="Leave all off to allow this role's Work Order actions on any station. Turn one or more on to restrict.">
                        Work Order Station Scope
                    </FieldLabel>
                    <ScopePicker title="Station types" anyLabel="any station" selected={allowedWcTypes} onChange={setAllowedWcTypes}
                        options={wcTypes.map(t => ({ id: t, path: [t] }))} />
                </div>
            )}

            {hasCategoryScopedPerm && categories.length > 0 && (
                <div className="mt-3">
                    <FieldLabel hint="Leave all off to allow Item/Stock actions on any category. Turn one or more on to restrict.">
                        Item/Stock Category Scope
                    </FieldLabel>
                    <ScopePicker title="Categories" anyLabel="any category" selected={allowedCategories} onChange={setAllowedCategories}
                        options={categories.map((c: any) => ({ id: c.id, path: c.path_names?.length ? c.path_names : [c.name] }))} />
                </div>
            )}

            {hasLocationScopedPerm && locations.length > 0 && (
                <div className="mt-3">
                    <FieldLabel hint="Leave all off to allow Lot actions at any location. Turn one or more on to restrict.">
                        Lot Management Location Scope
                    </FieldLabel>
                    <ScopePicker title="Locations" anyLabel="any location" selected={allowedLocations} onChange={setAllowedLocations}
                        options={locations.map((l: any) => ({ id: l.id, path: (l.full_path || l.name).split(' / ') }))} />
                </div>
            )}

            {/* Cosmetic, so it sits last and folded — it used to wedge a full-height
                picker between the permissions and the scopes they gate. */}
            {/* display:flex drops the native disclosure marker, so the caret is
                drawn here — same one the permission sections collapse with. */}
            <details className="mt-3" onToggle={e => setAvatarOpen(e.currentTarget.open)}>
                <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className={`bi ${avatarOpen ? 'bi-caret-down-fill' : 'bi-caret-right-fill'}`} style={{ fontSize: 10, color: '#5a6472' }} />
                    <PixelAvatarFromRecipe recipe={resolveRecipe(null, SAMPLE_SEEDS[0], defaultAvatarId)} size={24} />
                    <b style={{ fontSize: 12 }}>Default Avatar</b>
                    <span style={{ fontSize: 11, color: '#6b6558' }}>{avatarPins ? (isExecutive ? 'Executive template' : 'Template set') : 'Not set — users seeded from their username'}</span>
                </summary>
                <FieldLabel
                    hint="Applies only to users in this role who haven't saved an avatar of their own; their own choice always wins. Only the pinned slots are stored — every user keeps their own face, so set the slots that must not be left to chance (hat and accessories on an executive role) and leave the rest on Auto."
                >
                    Template
                </FieldLabel>
                {/* The one-click answer to "don't put a party hat on a director".
                    Hat and accessories are the two slots that carry the novelty
                    variants; everything else in pixel-art is a plain face, so this
                    is the whole professional constraint and it leaves hair, eyes,
                    mouth and clothing to each user's own seed. */}
                <div style={{ marginBottom: 6 }}>
                    <ToggleChip on={isExecutive} onClick={toggleExecutive}
                        title="Pin hat and accessories off, leaving every other slot to the user's own seed">
                        <i className="bi bi-briefcase-fill" style={{ marginRight: 4 }} />Executive
                    </ToggleChip>
                </div>
                <AvatarPicker
                    value={defaultAvatarId}
                    onChange={setDefaultAvatarId}
                    seed={SAMPLE_SEEDS[0]}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    {/* The point of a template, shown rather than explained: three
                        different people under the same pins. */}
                    {SAMPLE_SEEDS.map(sample => (
                        <span key={sample} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <PixelAvatarFromRecipe recipe={resolveRecipe(null, sample, defaultAvatarId)} size={40} />
                            <span style={{ fontSize: 10, color: '#6b6558' }}>{sample}</span>
                        </span>
                    ))}
                    <span style={{ fontSize: 11, color: '#6b6558', flex: '1 1 200px', minWidth: 0 }}>
                        {avatarPins
                            ? 'Three sample users under this template — different faces, same pinned slots.'
                            : 'Nothing pinned, so this role sets no default: each user is seeded from their username.'}
                    </span>
                </div>
            </details>

        </ModalWrapper>
    );
}

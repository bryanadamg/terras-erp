'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { xpInput, FieldLabel, FormError, ToggleChip, ModalFooterActions } from '../shared/xpTheme';
import PermissionsPicker, { PermissionOption } from './PermissionsPicker';
import AvatarPicker from '../shared/AvatarPicker';
import { PixelAvatarFromRecipe } from '../shared/PixelAvatar';
import { hasPins, parseRecipe, resolveRecipe, serializeRecipe, setFeature } from '../shared/avatarRecipe';
import { useData } from '../../context/DataContext';

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

    const toggleWcType = (t: string) => {
        setAllowedWcTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
    };

    const toggleCategory = (id: string) => {
        setAllowedCategories(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleLocation = (id: string) => {
        setAllowedLocations(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    /* Scope pickers use the app-wide on/off chip (ToggleChip) rather than bare
       checkboxes — a wall of checkboxes made a restricted role hard to read
       back, and a per-view selected state would be a fourth chip look. */
    const scopeBox = (scroll: boolean, children: React.ReactNode) => (
        <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 4,
            background: '#ffffff',
            border: '1px solid #b0a898',
            borderRadius: 0,
            padding: 6,
            ...(scroll ? { maxHeight: 160, overflowY: 'auto' as const } : {}),
        }}>{children}</div>
    );

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
                    classic
                    onCancel={onClose}
                    onSubmit={handleSubmit}
                    submitting={submitting}
                    submitLabel={mode === 'create' ? 'Create Role' : 'Save Changes'}
                    variant={mode === 'create' ? 'success' : 'primary'}
                />
            }
        >
            <FormError classic>{error}</FormError>

            <div className="mb-3">
                <FieldLabel classic>Role Name</FieldLabel>
                <input
                    style={xpInput({ width: '100%' })}
                    placeholder="e.g. Warehouse Supervisor"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />
            </div>

            <div className="mb-3">
                <FieldLabel classic>Description</FieldLabel>
                <input
                    style={xpInput({ width: '100%' })}
                    placeholder="Optional"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />
            </div>

            <div className="mb-1">
                <FieldLabel classic>Permissions</FieldLabel>
                <PermissionsPicker
                    allPermissions={allPermissions}
                    selectedIds={permissionIds}
                    onChange={setPermissionIds}
                />
            </div>

            <div className="mt-3">
                <FieldLabel
                    classic
                    hint="Applies only to users in this role who haven't saved an avatar of their own; their own choice always wins. Only the pinned slots are stored — every user keeps their own face, so set the slots that must not be left to chance (hat and accessories on an executive role) and leave the rest on Auto."
                >
                    Default Avatar
                </FieldLabel>
                {/* The one-click answer to "don't put a party hat on a director".
                    Hat and accessories are the two slots that carry the novelty
                    variants; everything else in pixel-art is a plain face, so this
                    is the whole professional constraint and it leaves hair, eyes,
                    mouth and clothing to each user's own seed. */}
                <div style={{ marginBottom: 6 }}>
                    <ToggleChip on={isExecutive} onClick={toggleExecutive} classic
                        title="Pin hat and accessories off, leaving every other slot to the user's own seed">
                        <i className="bi bi-briefcase-fill" style={{ marginRight: 4 }} />Executive
                    </ToggleChip>
                </div>
                <AvatarPicker
                    value={defaultAvatarId}
                    onChange={setDefaultAvatarId}
                    seed={SAMPLE_SEEDS[0]}
                    classic
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
            </div>

            {hasWorkOrderPerm && wcTypes.length > 0 && (
                <div className="mt-3">
                    <FieldLabel classic hint="Leave all off to allow this role's Work Order actions on any station. Turn one or more on to restrict.">
                        Work Order Station Scope
                    </FieldLabel>
                    {scopeBox(false, wcTypes.map(t => (
                        <ToggleChip key={t} on={allowedWcTypes.includes(t)} onClick={() => toggleWcType(t)} classic>{t}</ToggleChip>
                    )))}
                </div>
            )}

            {hasCategoryScopedPerm && categories.length > 0 && (
                <div className="mt-3">
                    <FieldLabel classic hint="Leave all off to allow Item/Stock actions on any category. Turn one or more on to restrict.">
                        Item/Stock Category Scope
                    </FieldLabel>
                    {scopeBox(true, categories.map((c: any) => (
                        <ToggleChip key={c.id} on={allowedCategories.includes(c.id)} onClick={() => toggleCategory(c.id)} classic>
                            {(c.path_names || [c.name]).join(' / ')}
                        </ToggleChip>
                    )))}
                </div>
            )}

            {hasLocationScopedPerm && locations.length > 0 && (
                <div className="mt-3">
                    <FieldLabel classic hint="Leave all off to allow Lot actions at any location. Turn one or more on to restrict.">
                        Lot Management Location Scope
                    </FieldLabel>
                    {scopeBox(true, locations.map((l: any) => (
                        <ToggleChip key={l.id} on={allowedLocations.includes(l.id)} onClick={() => toggleLocation(l.id)} classic>
                            {l.full_path || l.name}
                        </ToggleChip>
                    )))}
                </div>
            )}
        </ModalWrapper>
    );
}

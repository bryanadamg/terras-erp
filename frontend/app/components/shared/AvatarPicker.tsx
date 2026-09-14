'use client';
import React, { useMemo, useState } from 'react';
import { PixelAvatarFromRecipe } from './PixelAvatar';
import { Tabs, TabDef } from './Tabs';
import {
    BUTTON_RADIUS,
    Chip,
    ToggleChip,
    XP_BTN,
    modernFont,
    xpBtn,
    xpFont,
} from './xpTheme';
import {
    AvatarRecipe,
    COLOR_SLOTS,
    ColorKey,
    FEATURE_SLOTS,
    FeatureSlot,
    parseRecipe,
    resolveRecipe,
    serializeRecipe,
    setColor,
    setFeature,
    shuffleRecipe,
} from './avatarRecipe';

const THUMB = 32;
const SWATCH = 26;
const STAGE = 84;

type TabKey = FeatureSlot['key'] | 'colors';

// One icon per slot so the tab strip is scannable at 11px — eight same-length
// words in a row are not. Bootstrap Icons has no hat/shirt/beard glyph, so these
// are the nearest reads (cone = headwear, person-fill = torso, mask = face).
const SLOT_ICON: Record<TabKey, string> = {
    hat: 'bi-cone-striped',
    hair: 'bi-scissors',
    glasses: 'bi-eyeglasses',
    clothing: 'bi-person-fill',
    eyes: 'bi-eye',
    mouth: 'bi-emoji-smile',
    beard: 'bi-mask',
    accessories: 'bi-gem',
    colors: 'bi-palette',
};

// Entrance stagger on tab switch, capped: past a dozen thumbnails the tail would
// arrive after the user has already moved the cursor onto one.
const STAGGER_MS = 16;
const STAGGER_CAP = 12;
const optionDelay = (i: number) => `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms`;

/** Selected / idle face of one option cell. Same bevel language as ToggleChip. */
function optionChrome(isSelected: boolean, classic?: boolean): React.CSSProperties {
    if (true) {
        return {
            background: isSelected ? '#c8d8f0' : 'linear-gradient(to bottom,#ffffff,#e4e0d8)',
            border: '2px solid',
            borderColor: isSelected ? '#0a246a #00184a #00184a #0a246a' : '#fff #aaa #aaa #fff',
            boxShadow: isSelected ? 'inset 1px 1px 0 #3a6ea8' : undefined,
        };
    }
    return {
        background: isSelected ? '#e8f0fe' : '#fff',
        border: isSelected ? '2px solid #0d6efd' : '2px solid #e4e8ee',
        borderRadius: BUTTON_RADIUS,
    };
}

/**
 * One thumbnail / swatch. `onPreview` is the hover contract: every option
 * previews itself on the stage before it is committed, so the grid is browsable
 * without clicking through 45 variants and undoing 44 of them. Keyboard focus
 * previews too — the same affordance, since the hover is the only thing telling
 * you what a variant name means.
 */
function OptionCell({ title, isSelected, classic, width, delay, onClick, onPreview, children }: {
    title: string;
    isSelected: boolean;
    classic?: boolean;
    width: number;
    delay: string;
    onClick: () => void;
    onPreview: (on: boolean) => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            onMouseEnter={() => onPreview(true)}
            onMouseLeave={() => onPreview(false)}
            onFocus={() => onPreview(true)}
            onBlur={() => onPreview(false)}
            className="av-opt av-opt-in"
            style={{
                width, height: THUMB + 10, padding: 3, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, position: 'relative', animationDelay: delay,
                ...optionChrome(isSelected, classic),
            }}
        >
            {children}
        </button>
    );
}

interface AvatarPickerProps {
    value: string | null | undefined;
    onChange: (recipe: string) => void;
    /** Identity to seed from when `value` holds no recipe yet — usually username. */
    seed?: string | null;
    /**
     * Role default template applied while `value` is empty, so the picker opens on
     * the face the rest of the app is already drawing for this user. Editing any
     * slot commits the merged recipe, which is what promotes the role's pins into
     * the user's own choice — after that the template no longer applies to them.
     */
    template?: string | null;
    classic?: boolean;
}

/**
 * Avatar editor: preview stage + one tab per DiceBear slot.
 *
 * The stage lives HERE rather than in the two call sites (account settings and
 * the admin user modal), which each drew their own frame at their own size — so
 * the same control had two different previews. It is also load-bearing now that
 * hovering an option previews it: a preview the picker doesn't own can't show a
 * candidate.
 */
export default function AvatarPicker({ value, onChange, seed, template, classic }: AvatarPickerProps) {
    const [tab, setTab] = useState<TabKey>('hat');
    const recipe = useMemo(() => resolveRecipe(value, seed, template), [value, seed, template]);

    // The candidate under the cursor, or null when the stage is showing the real
    // avatar. Held as a whole recipe rather than a slot+value pair because a
    // colour and a feature preview the same way.
    const [preview, setPreview] = useState<{ recipe: AvatarRecipe; label: string } | null>(null);
    // Remount counter for the stage face: a committed change has to replay its
    // animation even when the recipe string round-trips to the same value.
    const [nonce, setNonce] = useState(0);
    const [rolled, setRolled] = useState(false);

    const emit = (next: AvatarRecipe, roll = false) => {
        setNonce(n => n + 1);
        setRolled(roll);
        setPreview(null);
        onChange(serializeRecipe(next));
    };

    /**
     * Reset stores NOTHING rather than a pin-less recipe. The difference matters:
     * `resolveRecipe` treats any stored recipe as "the user chose this" and stops
     * before the role template, so a pin-less recipe would silently opt someone out
     * of their role's default — the opposite of what a button called Reset means.
     * Empty hands them back to whatever the default is (role template, else their
     * username seed).
     */
    const clear = () => {
        setNonce(n => n + 1);
        setRolled(false);
        setPreview(null);
        onChange('');
    };

    const pinnedFeatures = FEATURE_SLOTS.filter(s => recipe.features[s.key] !== undefined);
    const pinnedColors = COLOR_SLOTS.filter(s => recipe.colors[s.key] !== undefined);
    const pinnedCount = pinnedFeatures.length + pinnedColors.length;

    const isPinned = (key: TabKey) => key === 'colors'
        ? pinnedColors.length > 0
        : recipe.features[key as FeatureSlot['key']] !== undefined;

    const tabs: TabDef<TabKey>[] = [...FEATURE_SLOTS.map(s => s.key as TabKey), 'colors' as TabKey]
        .map(key => {
            const label = key === 'colors' ? 'Colors' : FEATURE_SLOTS.find(s => s.key === key)!.label;
            return {
                key,
                icon: SLOT_ICON[key],
                // A dot on the tab is the only way to see, without opening all nine
                // of them, which slots you have actually pinned and which are still
                // riding the seed.
                label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {label}
                        {isPinned(key) && (
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                                    background: '#0a246a',
                                }}
                            />
                        )}
                    </span>
                ),
            };
        });

    const activeSlot = FEATURE_SLOTS.find(s => s.key === tab);
    const stageRecipe = preview?.recipe ?? recipe;

    const font = xpFont;
    const muted = '#6b6558';

    const smallBtn = (label: string, icon: string, title: string, onClick: () => void) => (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={XP_BTN}
            style={xpBtn({ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%' })}
        >
            <i className={`bi ${icon}`} style={{ fontSize: 10 }} />{label}
        </button>
    );

    return (
        <div style={{
            border: `1px solid ${'#c0bdb5'}`,
            borderRadius: BUTTON_RADIUS,
            // Must clip, or the square tab strip pokes out of the rounded corners
            // — same rule as FormSection.
            overflow: 'hidden',
            background: '#ece9d8',
            fontFamily: font,
            minWidth: 0,
        }}>
            {/* Nine tabs don't fit every width this picker renders at (settings
                page, xl modal, both at 1024). The strip scrolls instead of being
                clipped by the frame's `overflow: hidden` — which is also why
                Shuffle/Reset are NOT in the strip's `right` slot: pushed off the
                end of a scroller, the picker's main action would be invisible. */}
            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <Tabs<TabKey>
                    tabs={tabs}
                    activeKey={tab}
                    onChange={setTab}
                    classic
                />
            </div>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, padding: 10, minWidth: 0 }}>
                {/* ── Stage ─────────────────────────────────────────────────── */}
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    flexShrink: 0, width: STAGE + 24,
                }}>
                    <div
                        className={preview ? 'av-stage-live' : undefined}
                        style={{
                            width: STAGE + 12, height: STAGE + 12, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            border: '2px solid', borderColor: '#888 #fff #fff #888',
                            background: '#fff',
                        }}
                    >
                        <span
                            // Remounting is what replays the animation, so the key
                            // tracks COMMITTED changes only — the nonce, because the
                            // recipe string can round-trip to the same value. Hover
                            // swaps the face inside this element without remounting:
                            // otherwise sweeping 45 thumbnails fires 45 animations,
                            // and leaving one would replay the last commit's.
                            key={`${serializeRecipe(recipe)}#${nonce}`}
                            className={rolled ? 'av-face-roll' : 'av-face-in'}
                            style={{ display: 'block', lineHeight: 0 }}
                        >
                            <PixelAvatarFromRecipe recipe={stageRecipe} size={STAGE} />
                        </span>
                    </div>
                    <div style={{
                        fontSize: 10, color: preview ? ('#00006e') : muted,
                        textAlign: 'center', lineHeight: 1.25, minHeight: 26, width: '100%',
                        fontWeight: preview ? 700 : 400,
                    }}>
                        {preview ? preview.label : 'Preview'}
                    </div>
                    <Chip
                        classic
                        size="xs"
                        icon={pinnedCount ? 'bi-pin-angle-fill' : 'bi-dice-3'}
                        title={pinnedCount
                            ? `${pinnedCount} slot${pinnedCount === 1 ? '' : 's'} pinned; the rest follow seed "${recipe.seed}"`
                            : `Every slot follows seed "${recipe.seed}"`}
                    >
                        {pinnedCount ? `${pinnedCount} pinned` : 'All auto'}
                    </Chip>
                    {/* Both act on the whole face, so they sit under the face rather
                        than in the slot tabs. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', marginTop: 1 }}>
                        {smallBtn('Shuffle', 'bi-shuffle', 'Roll a brand new avatar', () => emit(shuffleRecipe(), true))}
                        {/* Shown whenever there is anything to undo — a pinned slot, or a
                            stored recipe that is only a shuffled seed (which pins nothing
                            but is still a stored choice). */}
                        {(pinnedCount > 0 || !!parseRecipe(value)) && smallBtn(
                            'Reset',
                            'bi-arrow-counterclockwise',
                            template
                                ? 'Clear this avatar and go back to the role default'
                                : 'Clear this avatar and go back to the default face',
                            clear,
                        )}
                    </div>
                </div>

                {/* ── Options ───────────────────────────────────────────────── */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activeSlot ? (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                {/* Auto / None are decisions about the slot, not variants of
                                    it, so they are chips beside the grid rather than two odd
                                    text cells inside it. */}
                                <ToggleChip
                                    on={recipe.features[activeSlot.key] === undefined}
                                    onClick={() => emit(setFeature(recipe, activeSlot.key, undefined))}
                                    classic
                                    title="Let the seed choose this slot"
                                >
                                    Auto
                                </ToggleChip>
                                {activeSlot.optional && (
                                    <ToggleChip
                                        on={recipe.features[activeSlot.key] === null}
                                        onClick={() => emit(setFeature(recipe, activeSlot.key, null))}
                                        classic
                                        title={`No ${activeSlot.label.toLowerCase()} at all`}
                                    >
                                        None
                                    </ToggleChip>
                                )}
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: muted }}>
                                    {activeSlot.variants.length} {activeSlot.label.toLowerCase()} options
                                </span>
                            </div>
                            {/* Wrapping grid, not one horizontal scroller: hair has 45
                                variants, which off the end of a single row is a scrollbar
                                the user has to discover before they can see the choices. */}
                            <div
                                key={activeSlot.key}
                                style={{
                                    display: 'grid',
                                    // Fixed tracks, not `minmax(…, 1fr)`: 1fr stretches the
                                    // tracks to fill the row while each thumbnail keeps its
                                    // own 42px, so ten options across a wide panel drifted
                                    // apart into a sparse line instead of reading as a block.
                                    gridTemplateColumns: `repeat(auto-fill, ${THUMB + 10}px)`,
                                    justifyContent: 'start',
                                    gap: 5, maxHeight: 138, overflowY: 'auto', overflowX: 'hidden',
                                    // Room for the hover lift/scale, which would otherwise
                                    // be clipped by the scroll container's own edge.
                                    padding: 3,
                                }}
                            >
                                {activeSlot.variants.map((variant, i) => {
                                    // Each thumbnail previews this avatar with only the one
                                    // slot swapped, so what you see is what you get.
                                    const candidate = setFeature(recipe, activeSlot.key, variant);
                                    return (
                                        <OptionCell
                                            key={variant}
                                            title={`${activeSlot.label} — ${variant}`}
                                            isSelected={recipe.features[activeSlot.key] === variant}
                                            classic
                                            width={THUMB + 10}
                                            delay={optionDelay(i)}
                                            onClick={() => emit(candidate)}
                                            onPreview={on => setPreview(on
                                                ? { recipe: candidate, label: `${activeSlot.label}: ${variant}` }
                                                : null)}
                                        >
                                            <PixelAvatarFromRecipe recipe={candidate} size={THUMB} />
                                        </OptionCell>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <div key="colors" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {COLOR_SLOTS.map(slot => (
                                <div key={slot.key} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                    <span style={{
                                        fontSize: 11, width: 86, flexShrink: 0,
                                        fontWeight: 'bold', color: '#2b2822',
                                    }}>
                                        {slot.label}
                                    </span>
                                    <ToggleChip
                                        on={recipe.colors[slot.key] === undefined}
                                        onClick={() => emit(setColor(recipe, slot.key, undefined))}
                                        classic
                                        title={`Let the seed choose the ${slot.label.toLowerCase()}`}
                                    >
                                        Auto
                                    </ToggleChip>
                                    <div style={{
                                        display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0, padding: 3,
                                    }}>
                                        {slot.palette.map((hex, i) => {
                                            const candidate = setColor(recipe, slot.key as ColorKey, hex);
                                            return (
                                                <OptionCell
                                                    key={hex}
                                                    title={`${slot.label} — #${hex}`}
                                                    isSelected={recipe.colors[slot.key] === hex}
                                                    classic
                                                    width={SWATCH + 8}
                                                    delay={optionDelay(i)}
                                                    onClick={() => emit(candidate)}
                                                    onPreview={on => setPreview(on
                                                        ? { recipe: candidate, label: `${slot.label}: #${hex}` }
                                                        : null)}
                                                >
                                                    <span style={{
                                                        display: 'block', width: '100%', height: '100%',
                                                        background: `#${hex}`,
                                                        border: '1px solid rgba(0,0,0,0.25)',
                                                    }} />
                                                </OptionCell>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

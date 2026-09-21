/**
 * The curated rope speeds, read off the `Dyeing Speed` system attribute.
 *
 * A value says a label AND a number — "Tua (3)", "Sedang (4)", "Muda (5)" — because
 * the floor picks by shade depth, not by a bare figure, and `attribute_values` has
 * one string column to carry both. The number is simply the first one in the string,
 * so any spelling the plant later types still resolves ("3 - Tua", "Tua 3 y/m"); the
 * depth labels themselves never contain digits. A plain "60" keeps working, which is
 * what every pre-label value is.
 *
 * Lives here because two screens pick a speed — the monitor's rate modal and the
 * Dyeing Orders bath panel — and a parser that disagrees between them would put two
 * different rates on the same vessel.
 */

export interface SpeedPreset {
    id: string;
    /** The value exactly as curated, e.g. "Tua (3)". What the operator reads. */
    label: string;
    /** Yards per minute, per rope. What the monitor's rate chain multiplies. */
    n: number;
}

/** The yd/min in a curated value, or null when it carries no number at all. */
export function parseSpeed(value: unknown): number | null {
    const m = String(value ?? '').match(/\d+(?:[.,]\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0].replace(',', '.'));
    return isNaN(n) ? null : n;
}

/**
 * The speed list, numeric and ascending. Takes the `attributes` master array every
 * page already holds — a dedicated fetch for five rows would be a second source of
 * the same values.
 *
 * A value with no number is skipped rather than shown: picking it would leave the
 * run with no rate, which is the failure the picker exists to prevent.
 */
export function speedPresets(attributes: any[] | null | undefined): SpeedPreset[] {
    const attr = (attributes || []).find((a: any) => a.system_role === 'dyeing_speed');
    const out: SpeedPreset[] = [];
    for (const v of (attr?.values || [])) {
        const n = parseSpeed(v?.value);
        if (n !== null && n > 0) out.push({ id: String(v.id), label: String(v.value), n });
    }
    return out.sort((a, b) => a.n - b.n);
}

/** The preset a stored yd/min came from, so a saved run shows "Tua (3)" and not "3". */
export function presetFor(presets: SpeedPreset[], speed: number | string | null | undefined): SpeedPreset | null {
    const n = typeof speed === 'number' ? speed : parseSpeed(speed);
    if (n === null) return null;
    return presets.find(p => p.n === n) || null;
}

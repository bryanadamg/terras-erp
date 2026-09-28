// Number formatting for the whole app.
//
// Six views had grown their own `fmtQty`/`num`/`fmtNum`/`money` helper and they
// disagreed: 2, 3 and 4 decimal places, one pinned to `id-ID` and one to
// `en-US`, one rounding to 2dp before formatting, one falling back to `—` and
// the rest to `0`. The same kilo of yarn therefore rendered four different ways
// depending on which page you opened.
//
// Precision stays a per-view decision — a machine-output report legitimately
// wants 3dp where a carton count wants 0 — so views declare it ONCE with
// `qtyFmt(dp)` instead of repeating a literal at every call site. What is shared
// is the implementation: safe parsing, thousands grouping, and locale handling.

/** Parse anything to a finite number; non-numeric input is 0, never NaN. */
export const toNum = (v: any): number => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Quantity: grouped thousands, at most `dp` decimals, trailing zeros dropped.
 * `locale` is only for printed documents that must keep Indonesian formatting
 * regardless of the browser (Surat Jalan); on screen, leave it undefined so the
 * number follows the user's own locale.
 */
export const fmtQty = (v: any, dp = 2, locale?: string): string =>
    toNum(v).toLocaleString(locale, { maximumFractionDigits: dp });

/** Quantity in a numeric column: always `dp` decimals, so the decimal points line up. */
export const fmtQtyFixed = (v: any, dp = 2, locale?: string): string =>
    toNum(v).toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Bind a precision (and locale) once per view: `const fmtQty = qtyFmt(3);`. */
export const qtyFmt = (dp = 2, locale?: string) => (v: any): string => fmtQty(v, dp, locale);

/** Whole count — cartons, pieces, ends. */
export const fmtInt = (v: any, locale?: string): string =>
    Math.round(toNum(v)).toLocaleString(locale, { maximumFractionDigits: 0 });

/** A value already expressed in percent units: 12.5 → "12.5%". */
export const fmtPct = (v: any, dp = 1): string =>
    `${toNum(v).toLocaleString(undefined, { maximumFractionDigits: dp })}%`;

/**
 * Money on a document. Pinned to `en-US` grouping with exactly two decimals
 * because purchase orders and invoices are printed for suppliers and must not
 * change shape with the reader's browser locale.
 */
export const fmtMoney = (v: any): string =>
    toNum(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Dense cells (the shop-floor work queue): 1,240 rather than 1,240.0, but small
 * numbers keep their decimal so 0.4 kg short is not shown as "0".
 */
export const fmtQtyCompact = (v: any, dp = 1): string => {
    const n = toNum(v);
    return Math.abs(n) >= 1000 ? fmtInt(n) : n.toFixed(dp);
};

/**
 * A Date to the `YYYY-MM-DD` an <input type="date"> expects, read off the date's
 * own calendar fields. `toISOString().slice(0, 10)` is the trap this replaces:
 * it converts to UTC first, so a local evening east of Greenwich yields
 * yesterday. For "today" specifically, prefer `useTimezone().todayInput()`,
 * which answers in the user's *display* timezone.
 */
export const isoDate = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A duration in minutes as the floor reads it: 45m, 3h 20m, 2d 4h. Blank is a dash. */
export const fmtMinutes = (mins: any): string => {
    const v = Number(mins);
    if (mins === null || mins === undefined || mins === '' || Number.isNaN(v)) return '—';
    if (v < 60) return `${Math.round(v)}m`;
    const h = Math.floor(v / 60);
    if (h < 24) return `${h}h ${Math.round(v % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** Blank/non-numeric renders as an em dash instead of 0 — for optional fields. */
export const orDash = (v: any, fmt: (x: any) => string = fmtQty): string =>
    v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : fmt(v);

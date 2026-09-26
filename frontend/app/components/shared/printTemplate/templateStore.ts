/**
 * Layout resolution: saved template beats built-in default.
 *
 * A missing row is the normal case, not an error — the backend only stores doc
 * types the client has actually customised (see api/print_templates.py).
 */

import type { PrintLayout, PrintTemplateRecord } from './types';
import { KARTU_KERJA_DEFAULTS, KARTU_KERJA_DOC_TYPE_LABELS } from './defaults/kartuKerja';
import { SURAT_JALAN_DEFAULTS, SURAT_JALAN_DOC_TYPE_LABELS } from './defaults/suratJalan';
import { PURCHASE_ORDER_DEFAULTS, PURCHASE_ORDER_DOC_TYPE_LABELS } from './defaults/purchaseOrder';

/** Every doc type with a built-in default, i.e. everything the designer can edit. */
export const DEFAULT_LAYOUTS: Record<string, PrintLayout> = {
    ...KARTU_KERJA_DEFAULTS,
    ...SURAT_JALAN_DEFAULTS,
    ...PURCHASE_ORDER_DEFAULTS,
};

export const DOC_TYPE_LABELS: Record<string, string> = {
    ...KARTU_KERJA_DOC_TYPE_LABELS,
    ...SURAT_JALAN_DOC_TYPE_LABELS,
    ...PURCHASE_ORDER_DOC_TYPE_LABELS,
};

export const EDITABLE_DOC_TYPES: string[] = Object.keys(DEFAULT_LAYOUTS);

export function defaultLayout(docType: string): PrintLayout | undefined {
    return DEFAULT_LAYOUTS[docType];
}

/**
 * The layout to render for `docType`. Falls back to the built-in default when the
 * client has not customised it, and again if a saved row is somehow malformed —
 * a broken template must never stop the floor from printing.
 */
export function resolveLayout(
    docType: string,
    saved: PrintTemplateRecord[] | null | undefined,
): PrintLayout | undefined {
    const record = (saved || []).find(t => t.doc_type === docType);
    const builtIn = DEFAULT_LAYOUTS[docType];

    if (record?.layout && Array.isArray((record.layout as any).bands)) {
        const layout = record.layout;
        // `paper` is stored separately so the designer can change page size without
        // rewriting the band list; the column wins when present.
        return record.paper ? { ...layout, paper: record.paper } : layout;
    }
    return builtIn;
}

/** True when this doc type is running a client-edited layout rather than the built-in. */
export function isCustomised(docType: string, saved: PrintTemplateRecord[] | null | undefined): boolean {
    return (saved || []).some(t => t.doc_type === docType);
}

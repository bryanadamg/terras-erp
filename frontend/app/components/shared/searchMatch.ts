// Client-side twin of the backend search contract (backend/tests/search_contract.py)
// for boards filtered in memory: a row matches when ANY code or name on it — its
// own, its lines', its nested orders' — contains the query. Walking the row instead
// of listing fields means a code added to the row later is searchable for free,
// which is the gap the hand-picked field lists kept leaving.
const SEARCHABLE_KEY = /(^code$|_code$|_number$|^po_number$|customer_po_ref$|vendor_lot$|(^|_)name$)/;
const SKIP_KEY = /(location|packaging_type|uom)/;

export function rowMatches(row: unknown, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const walk = (node: unknown, depth: number): boolean => {
        if (depth > 6 || node == null) return false;
        if (Array.isArray(node)) return node.some(n => walk(n, depth + 1));
        if (typeof node !== 'object') return false;
        return Object.entries(node as Record<string, unknown>).some(([k, v]) =>
            typeof v === 'string'
                ? SEARCHABLE_KEY.test(k) && !SKIP_KEY.test(k) && v.toLowerCase().includes(q)
                : typeof v === 'object' && walk(v, depth + 1));
    };
    return walk(row, 0);
}

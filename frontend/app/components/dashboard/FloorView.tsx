'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { API_BASE } from '../shared/apiBase';
import { XPEmptyState } from '../shared/xpTheme';

/**
 * The mill as a pixel-art floor plan: stores stacked on a rail on the left,
 * three stage lanes (preparation, weaving, finishing) on the right, every
 * machine a fixed tile in its TYPE's room — animated and blinking while
 * something is being worked on it, dimmed in place while idle.
 *
 * Deliberately ambient: it is the landing view, not a report. Counts on the
 * title bars are all it says; the monitors stay the place to read detail.
 *
 * Drawn on a small logical canvas (W cells wide) and scaled up unsmoothed for
 * the pixel look; text is painted afterwards at device resolution so it stays
 * crisp. Shape comes from GET /dashboard/floor and reloads on live events.
 */

type Machine = { id: string; code: string; running: boolean };
type FloorType = { id: string; code: string; name: string; center_type: string; machines: Machine[] };
type Store = { id: string; name: string; system_code: string | null; lines: number; qty_by_uom: Record<string, number>; fed_by: string[] };
type Floor = { types: FloorType[]; stores: Store[] };

type Kind = 'loom' | 'crochet' | 'braider' | 'dbed' | 'spindle' | 'beam' | 'vessel' | 'roller' | 'press' | 'box';
type StoreItem = 'cone' | 'beam' | 'roll' | 'carton' | 'crate';
type Room = { x: number; y: number; w: number; h: number; title: string; sub: string; store?: boolean;
    kind?: Kind; machines?: Machine[]; pitch?: number; item?: StoreItem; fill?: number };

const W = 320;          // logical width in cells; height follows the content
const GAP = 4;
const HEADER = 16;      // title bar + count line, in cells

const NAVY = '#003080', GREEN = '#2ecc71', YARN = '#f2d28a', RUST = '#c2621a';
const BODY: Record<Kind, string> = {
    loom: '#4a7ddb', crochet: '#2a9d8f', braider: '#7b5cd6', dbed: '#2c5bb8', spindle: '#4a7ddb',
    beam: '#2c5bb8', vessel: '#4a7ddb', roller: '#4a7ddb', press: '#4a7ddb', box: '#c89a5a',
};
const DYES = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#9b5de5', '#06d6a0'];
const SMALL_KINDS: Kind[] = ['loom', 'crochet', 'braider', 'dbed'];

// ponytail: lane + sprite are guessed from center_type and the TYPE's name, since
// GENERAL covers both prep (covering/twist) and finishing (printing/packing).
// A per-TYPE floor setting is the upgrade if a plant's names don't fit.
const label = (t: FloorType) => `${t.code} ${t.name}`.toUpperCase();
function laneOf(t: FloorType): number {
    const ct = (t.center_type || '').toUpperCase();
    if (ct === 'WEAVING' || ct === 'TENUN') return 1;
    if (['DYEING', 'CELUP', 'SETTING', 'FINISHING', 'PACKING', 'CUTTING'].includes(ct)) return 2;
    return /PACK|PRINT|TIP|FINISH|CUT/.test(label(t)) ? 2 : 0;
}
function kindOf(t: FloorType): Kind {
    const ct = (t.center_type || '').toUpperCase(), n = label(t);
    if (ct === 'WEAVING' || ct === 'TENUN') return /CROCHET/.test(n) ? 'crochet' : /BRAID/.test(n) ? 'braider' : /DOUBLE/.test(n) ? 'dbed' : 'loom';
    if (ct === 'BEAMING' || ct === 'WARPING') return 'beam';
    if (ct === 'DYEING' || ct === 'CELUP') return 'vessel';
    if (ct === 'SETTING') return 'roller';
    if (/PACK/.test(n)) return 'box';
    if (/PRINT|TIP/.test(n)) return 'press';
    return 'spindle';
}
// Upstream-first inside a lane: covering/twist before warping, dye before setting before packing.
const KIND_ORDER: Kind[] = ['spindle', 'beam', 'vessel', 'roller', 'press', 'box'];

function itemOf(s: Store): StoreItem {
    const n = `${s.system_code || ''} ${s.name}`.toUpperCase();
    if (/GREIGE|LOOM/.test(n) || s.fed_by.some(f => f === 'WEAVING' || f === 'DYEING')) return 'roll';
    if (/BEAM/.test(n) || s.fed_by.includes('BEAMING')) return 'beam';
    if (/^FG|FINISH|DISPATCH/.test(n)) return 'carton';
    if (/^RM|MATERIAL|COVER|RAW/.test(n)) return 'cone';
    return 'crate';
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
function storeSub(s: Store): string {
    const [uom, qty] = Object.entries(s.qty_by_uom).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const more = Object.keys(s.qty_by_uom).length - 1;
    return `${compact.format(qty)} ${uom}${more > 0 ? ` +${more}` : ''}`;
}

// ── Layout ───────────────────────────────────────────────────────────────────
function layout(floor: Floor, runningLabel: string): { rooms: Room[]; belts: number[][]; H: number } {
    const rooms: Room[] = [];
    const stores = floor.stores;
    const railCols = stores.length > 5 ? 2 : 1;
    const railColW = railCols === 2 ? 40 : 58;
    const railW = stores.length ? railCols * railColW + (railCols - 1) * GAP : 0;
    const beltX = stores.length ? GAP + railW + 3 : 0;
    const laneX = stores.length ? beltX + 4 : GAP;
    const laneW = W - laneX - GAP;

    const lanes: FloorType[][] = [[], [], []];
    floor.types.filter(t => t.machines.length).forEach(t => lanes[laneOf(t)].push(t));
    lanes[0].sort((a, b) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)));
    lanes[1].sort((a, b) => b.machines.length - a.machines.length);
    lanes[2].sort((a, b) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)));

    let y = GAP;
    const belts: number[][] = [];
    lanes.filter(l => l.length).forEach((lane, li) => {
        if (li > 0) belts.push([laneX, y - GAP / 2, W - GAP, li % 2 ? -1 : 1]);
        const avail = laneW - GAP * (lane.length - 1);
        const minW = Math.min(36, Math.floor(avail / lane.length));
        const pitch = (t: FloorType) => (t.machines.length > 40 ? 5 : 7);
        const area = lane.map(t => t.machines.length * pitch(t) ** 2);
        const total = area.reduce((a, b) => a + b, 0) || 1;
        const rest = avail - minW * lane.length;
        let x = laneX, laneH = 36;
        const laneRooms = lane.map((t, i) => {
            const w = i === lane.length - 1 ? laneX + laneW - x : minW + Math.floor(rest * area[i] / total);
            const p = pitch(t), cols = Math.max(1, Math.floor((w - 4) / p));
            const h = HEADER + Math.ceil(t.machines.length / cols) * p + 3;
            laneH = Math.max(laneH, h);
            const on = t.machines.filter(m => m.running).length;
            const room: Room = { x, y, w, h: 0, title: t.name.toUpperCase(), sub: `${on}/${t.machines.length} ${runningLabel}`,
                kind: kindOf(t), machines: t.machines, pitch: p };
            x += w + GAP;
            return room;
        });
        laneRooms.forEach(r => { r.h = laneH; rooms.push(r); });
        y += laneH + GAP;
    });

    let H = Math.max(y, 60);
    if (stores.length) {
        const perCol = Math.ceil(stores.length / railCols);
        let sh = Math.floor((H - GAP - GAP * perCol) / perCol);
        if (sh < 30) { sh = 30; H = GAP + perCol * (sh + GAP); }
        const maxLines = Math.max(...stores.map(s => s.lines), 1);
        stores.forEach((s, i) => {
            const col = Math.floor(i / perCol), row = i % perCol;
            rooms.push({ x: GAP + col * (railColW + GAP), y: GAP + row * (sh + GAP), w: railColW, h: sh, store: true,
                title: s.name.toUpperCase(), sub: storeSub(s), item: itemOf(s), fill: Math.sqrt(s.lines / maxLines) });  // sqrt: one huge store shouldn't leave the rest looking empty
        });
        belts.push([beltX, GAP, H - GAP, 1, 1]);
    }
    return { rooms, belts, H };
}

// ── Pixel painting ───────────────────────────────────────────────────────────
type Ctx = CanvasRenderingContext2D;
const R = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };
function disc(c: Ctx, cx: number, cy: number, r: number, col: string) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.8) R(c, cx + dx, cy + dy, 1, 1, col);
}

function sprite(c: Ctx, k: Kind, x: number, y: number, on: boolean, ph: number, i: number) {
    const b = on ? BODY[k] : '#a9b3c4', d = on ? '#ffffff' : '#cfd6e2', dk = on ? NAVY : '#8a94a6', yn = on ? YARN : '#cfd6e2';
    const f = on ? ph + i * 3 : 0;
    if (SMALL_KINDS.includes(k)) {  // 4x4 hall tile
        R(c, x, y, 4, 1, dk); R(c, x, y + 1, 4, 3, b); R(c, x, y + 1, 1, 2, d); R(c, x + 2, y + 1, 1, 2, d);
        R(c, x, y + 3, 4, 1, on ? '#efe6d2' : '#bfc7d4');
        if (on) R(c, x + (f % 4), y + 2, 1, 1, YARN);
        return;
    }
    switch (k) {
        case 'spindle':
            R(c, x, y, 6, 6, dk); R(c, x + 1, y + 1, 4, 4, b); R(c, x + 1, y + 1, 1, 4, yn); R(c, x + 4, y + 1, 1, 4, yn);
            if (on) { R(c, x + 1, y + 1 + (f % 4), 1, 1, RUST); R(c, x + 4, y + 1 + ((f + 2) % 4), 1, 1, RUST); }
            break;
        case 'beam': {
            R(c, x, y + 5, 6, 1, dk); R(c, x + 1, y, 4, 5, on ? '#8a5a2b' : '#8a94a6'); R(c, x, y + 1, 6, 3, on ? '#8a5a2b' : '#8a94a6'); R(c, x + 1, y + 1, 4, 3, yn);
            if (on) { const P = [[1, 1], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [3, 3], [2, 3], [1, 3], [1, 2]][f % 10]; R(c, x + P[0], y + P[1], 1, 1, RUST); }
            break;
        }
        case 'vessel':
            R(c, x + 1, y, 4, 6, dk); R(c, x, y + 1, 6, 4, dk); R(c, x + 1, y + 1, 4, 4, b); R(c, x + 1, y + 1, 4, 1, on ? DYES[i % DYES.length] : d);
            if (on) R(c, x + 1 + (i % 3), y + 4 - (f % 3), 1, 1, '#ffffff');
            break;
        case 'roller':
            R(c, x, y, 6, 6, dk); R(c, x, y + 1, 6, 4, b); R(c, x, y + 2, 6, 1, d); R(c, x, y + 4, 6, 1, d);
            if (on) { R(c, x + (f % 6), y + 2, 1, 1, RUST); R(c, x + ((f + 3) % 6), y + 4, 1, 1, RUST); }
            break;
        case 'press':
            R(c, x, y + 3, 6, 3, dk); R(c, x + 1, y + 3, 4, 2, b); R(c, x + 2, y + (on ? f % 2 : 1), 2, 2, dk);
            break;
        case 'box':
            R(c, x, y + 1, 6, 5, on ? '#8a6a3a' : '#8a94a6'); R(c, x + 1, y + 2, 4, 3, b); if (on && f % 2) R(c, x, y, 3, 1, b);
            break;
    }
    if (on && ph % 12 < 8) R(c, x + 5, y, 1, 1, GREEN);
}

function storeItem(c: Ctx, k: StoreItem, x: number, y: number) {
    if (k === 'cone') { R(c, x + 2, y, 1, 1, '#fff'); R(c, x + 1, y + 1, 3, 2, '#f28c28'); R(c, x, y + 3, 5, 2, '#f28c28'); R(c, x, y + 4, 5, 1, RUST); }
    if (k === 'beam') { R(c, x, y + 1, 5, 3, '#8a5a2b'); R(c, x + 1, y, 3, 5, '#8a5a2b'); R(c, x + 1, y + 1, 3, 3, YARN); }
    if (k === 'roll') { disc(c, x + 2, y + 2, 2, '#c9b994'); R(c, x + 1, y + 1, 3, 3, '#efe6d2'); R(c, x + 2, y + 2, 1, 1, '#8a7a5a'); }
    if (k === 'carton') { R(c, x, y, 5, 5, '#8a6a3a'); R(c, x + 1, y + 1, 3, 3, '#c89a5a'); R(c, x + 2, y, 1, 5, '#e8d5a8'); }
    if (k === 'crate') { R(c, x, y, 5, 5, '#6b7f99'); R(c, x + 1, y + 1, 3, 3, '#9fb0c8'); }
}

function paintCells(c: Ctx, rooms: Room[], belts: number[][], H: number, ph: number) {
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) R(c, x, y, 4, 4, ((x + y) / 4) % 2 ? '#d6e2f6' : '#cfdcf2');
    for (const [a, b, e, dir, vertical] of belts) {
        const len = e - (vertical ? b : a);
        if (vertical) R(c, a - 1, b, 3, len, '#b8c8e4'); else R(c, a, b - 1, len, 3, '#b8c8e4');
        for (let i = 0; i < len; i++) if (((i - dir * ph) % 6 + 6) % 6 === 0) {
            if (vertical) R(c, a, b + i, 1, 2, '#f28c28'); else R(c, a + i, b, 2, 1, '#f28c28');
        }
    }
    for (const r of rooms) {
        R(c, r.x, r.y, r.w, r.h, NAVY); R(c, r.x + 1, r.y + 1, r.w - 2, r.h - 2, r.store ? '#f4f1ea' : '#eef3fb');
        if (r.store) {
            const cols = Math.max(1, Math.floor((r.w - 4) / 6)), rows = Math.max(1, Math.floor((r.h - HEADER - 2) / 8));
            const n = r.fill! > 0 ? Math.max(1, Math.round(r.fill! * cols * rows)) : 0;
            for (let s = 0; s < rows; s++) R(c, r.x + 1, r.y + r.h - 2 - s * 8, r.w - 2, 1, '#b9a98a');
            for (let i = 0; i < n; i++) storeItem(c, r.item!, r.x + 3 + (i % cols) * 6, r.y + r.h - 8 - Math.floor(i / cols) * 8);
            continue;
        }
        const p = r.pitch!, cols = Math.max(1, Math.floor((r.w - 4) / p));
        r.machines!.forEach((m, i) => sprite(c, r.kind!, r.x + 3 + (i % cols) * p, r.y + HEADER + Math.floor(i / cols) * p, m.running, ph, i));
    }
}

function paintText(c: Ctx, rooms: Room[], s: number) {
    const titlePx = Math.max(9, Math.min(15, s * 3.6)), subPx = Math.max(8, Math.min(13, s * 3.2));
    const fit = (text: string, max: number) => {
        if (c.measureText(text).width <= max) return text;
        let t = text;
        while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
        return t + '…';
    };
    for (const r of rooms) {
        const g = c.createLinearGradient(0, (r.y + 1) * s, 0, (r.y + 9) * s);
        if (r.store) { g.addColorStop(0, '#3a9a52'); g.addColorStop(1, '#25733a'); } else { g.addColorStop(0, '#3a8cff'); g.addColorStop(1, '#0058e6'); }
        c.fillStyle = g; c.fillRect((r.x + 1) * s, (r.y + 1) * s, (r.w - 2) * s, 8 * s);
        const max = (r.w - 4) * s;
        c.font = `bold ${titlePx}px ui-monospace, Menlo, monospace`; c.fillStyle = '#fff'; c.textBaseline = 'middle';
        c.fillText(fit(r.title, max), (r.x + 3) * s, (r.y + 5) * s);
        c.font = `${subPx}px ui-monospace, Menlo, monospace`; c.fillStyle = NAVY;
        c.fillText(fit(r.sub, max), (r.x + 3) * s, (r.y + 12) * s);
    }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function FloorView() {
    const { authFetch, subscribeLiveEvents } = useData();
    const { t } = useLanguage();
    const [floor, setFloor] = useState<Floor | null>(null);
    const [width, setWidth] = useState(0);
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const load = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/dashboard/floor`);
        if (res.ok) setFloor(await res.json());
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => subscribeLiveEvents(['production', 'weaving', 'dyeing', 'stock'], () => load()), [subscribeLiveEvents, load]);

    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!floor || !canvas || !width) return;
        const { rooms, belts, H } = layout(floor, t('floor_running'));
        // Fit the whole floor on screen: width-bound unless that would push it below the fold.
        const availH = window.innerHeight - canvas.getBoundingClientRect().top - 8;
        const s = Math.min(width / W, availH > 200 ? availH / H : Infinity), dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${Math.round(W * s)}px`; canvas.style.height = `${Math.round(H * s)}px`;
        canvas.width = Math.round(W * s * dpr); canvas.height = Math.round(H * s * dpr);
        const big = canvas.getContext('2d')!;
        const small = document.createElement('canvas'); small.width = W; small.height = H;
        const c = small.getContext('2d')!;

        const draw = (ph: number) => {
            paintCells(c, rooms, belts, H, ph);
            big.setTransform(1, 0, 0, 1, 0, 0); big.imageSmoothingEnabled = false;
            big.drawImage(small, 0, 0, canvas.width, canvas.height);
            big.setTransform(dpr, 0, 0, dpr, 0, 0);
            paintText(big, rooms, s);
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(0); return; }
        let raf = 0, last = -1;
        const tick = (ms: number) => {
            const ph = Math.floor(ms / 90);  // ~11 fps: retro step, and cheap
            if (ph !== last) { last = ph; draw(ph); }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [floor, width, t]);

    const empty = floor && !floor.types.length && !floor.stores.length;
    return (
        <div ref={boxRef} style={{ width: '100%' }}>
            {empty
                ? <XPEmptyState message={t('floor_empty')} icon="bi-building" />
                : <canvas ref={canvasRef} role="img" aria-label={t('floor_aria')} style={{ display: 'block', margin: '0 auto', imageRendering: 'pixelated' }} />}
        </div>
    );
}

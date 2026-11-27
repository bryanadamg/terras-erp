// The Dashboard > Floor painting from frontend/app/components/dashboard/FloorView.tsx, ported 1:1
// (layout, sprites, store items, text bands) with demo data and the clock replaced by film time.
(function () {
  const W = 320, GAP = 4, HEADER = 16;
  const NAVY = '#003080', GREEN = '#2ecc71', YARN = '#f2d28a', RUST = '#c2621a';
  const BODY = { loom: '#4a7ddb', crochet: '#2a9d8f', braider: '#7b5cd6', dbed: '#2c5bb8', spindle: '#4a7ddb',
    beam: '#2c5bb8', vessel: '#4a7ddb', roller: '#4a7ddb', press: '#4a7ddb', box: '#c89a5a' };
  const DYES = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#9b5de5', '#06d6a0'];
  const SMALL = ['loom', 'crochet', 'braider', 'dbed'];

  // Demo mill. `lane` + `kind` are what laneOf/kindOf would derive from each TYPE.
  const m = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  const TYPES = [
    { lane: 0, kind: 'spindle', title: 'COVERING', machines: m(8) },
    { lane: 0, kind: 'beam', title: 'WARPING', machines: m(4) },
    { lane: 1, kind: 'loom', title: 'LOOMS', machines: m(48) },
    { lane: 2, kind: 'vessel', title: 'DYEING', machines: m(6) },
    { lane: 2, kind: 'roller', title: 'SETTING', machines: m(2) },
    { lane: 2, kind: 'box', title: 'PACKING', machines: m(4) },
  ];
  const STORES = [
    { title: 'YARN STORE', sub: '18.4K kg +1', item: 'cone', fill: 1 },
    { title: 'COVERING STORE', sub: '3.2K kg', item: 'cone', fill: 0.55 },
    { title: 'BEAM STORE', sub: '14 pcs', item: 'beam', fill: 0.5 },
    { title: 'GREIGE STORE', sub: '9.6K kg', item: 'roll', fill: 0.8 },
    { title: 'CHEMICAL STORE', sub: '1.1K kg +2', item: 'crate', fill: 0.45 },
    { title: 'FG STORE', sub: '640 pcs +1', item: 'carton', fill: 0.7 },
  ];

  function layout() {
    const rooms = [], belts = [];
    const railCols = STORES.length > 5 ? 2 : 1, railColW = railCols === 2 ? 40 : 58;
    const railW = railCols * railColW + (railCols - 1) * GAP;
    const beltX = GAP + railW + 3, laneX = beltX + 4, laneW = W - laneX - GAP;
    const lanes = [[], [], []];
    TYPES.forEach(t => lanes[t.lane].push(t));
    let y = GAP;
    lanes.forEach((lane, li) => {
      if (li > 0) belts.push([laneX, y - GAP / 2, W - GAP, li % 2 ? -1 : 1]);
      const avail = laneW - GAP * (lane.length - 1);
      const minW = Math.min(36, Math.floor(avail / lane.length));
      const pitch = t => (t.machines.length > 40 ? 5 : 7);
      const area = lane.map(t => t.machines.length * pitch(t) ** 2);
      const total = area.reduce((a, b) => a + b, 0) || 1;
      const rest = avail - minW * lane.length;
      let x = laneX, laneH = 36;
      const lr = lane.map((t, i) => {
        const w = i === lane.length - 1 ? laneX + laneW - x : minW + Math.floor(rest * area[i] / total);
        const p = pitch(t), cols = Math.max(1, Math.floor((w - 4) / p));
        laneH = Math.max(laneH, HEADER + Math.ceil(t.machines.length / cols) * p + 3);
        const room = { x, y, w, h: 0, title: t.title, kind: t.kind, machines: t.machines, pitch: p, lane: li };
        x += w + GAP;
        return room;
      });
      lr.forEach(r => { r.h = laneH; rooms.push(r); });
      y += laneH + GAP;
    });
    const H = Math.max(y, 60);
    const perCol = Math.ceil(STORES.length / railCols);
    const sh = Math.floor((H - GAP - GAP * perCol) / perCol);
    STORES.forEach((s, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      rooms.push({ x: GAP + col * (railColW + GAP), y: GAP + row * (sh + GAP), w: railColW, h: sh, store: true, ...s });
    });
    belts.push([beltX, GAP, H - GAP, 1, 1]);
    return { rooms, belts, H };
  }

  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };
  function disc(c, cx, cy, r, col) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.8) R(c, cx + dx, cy + dy, 1, 1, col);
  }
  function sprite(c, k, x, y, on, ph, i) {
    const b = on ? BODY[k] : '#a9b3c4', d = on ? '#ffffff' : '#cfd6e2', dk = on ? NAVY : '#8a94a6', yn = on ? YARN : '#cfd6e2';
    const f = on ? ph + i * 3 : 0;
    if (SMALL.includes(k)) {
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
      case 'box':
        R(c, x, y + 1, 6, 5, on ? '#8a6a3a' : '#8a94a6'); R(c, x + 1, y + 2, 4, 3, b); if (on && f % 2) R(c, x, y, 3, 1, b);
        break;
    }
    if (on && ph % 12 < 8) R(c, x + 5, y, 1, 1, GREEN);
  }
  function storeItem(c, k, x, y) {
    if (k === 'cone') { R(c, x + 2, y, 1, 1, '#fff'); R(c, x + 1, y + 1, 3, 2, '#f28c28'); R(c, x, y + 3, 5, 2, '#f28c28'); R(c, x, y + 4, 5, 1, RUST); }
    if (k === 'beam') { R(c, x, y + 1, 5, 3, '#8a5a2b'); R(c, x + 1, y, 3, 5, '#8a5a2b'); R(c, x + 1, y + 1, 3, 3, YARN); }
    if (k === 'roll') { disc(c, x + 2, y + 2, 2, '#c9b994'); R(c, x + 1, y + 1, 3, 3, '#efe6d2'); R(c, x + 2, y + 2, 1, 1, '#8a7a5a'); }
    if (k === 'carton') { R(c, x, y, 5, 5, '#8a6a3a'); R(c, x + 1, y + 1, 3, 3, '#c89a5a'); R(c, x + 2, y, 1, 5, '#e8d5a8'); }
    if (k === 'crate') { R(c, x, y, 5, 5, '#6b7f99'); R(c, x + 1, y + 1, 3, 3, '#9fb0c8'); }
  }

  // onAt(room, machineIndex) → seconds when that machine starts running (Infinity = idle).
  function mount(canvas, scale, onAt) {
    const { rooms, belts, H } = layout();
    canvas.width = W * scale; canvas.height = H * scale;
    const big = canvas.getContext('2d');
    const small = document.createElement('canvas'); small.width = W; small.height = H;
    const c = small.getContext('2d');
    const titlePx = Math.round(scale * 4.6), subPx = Math.round(scale * 4.2);
    function draw(t) {
      const ph = Math.floor(t / 0.09); // the app's ~11 fps step
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
          const n = r.fill > 0 ? Math.max(1, Math.round(r.fill * cols * rows)) : 0;
          for (let s = 0; s < rows; s++) R(c, r.x + 1, r.y + r.h - 2 - s * 8, r.w - 2, 1, '#b9a98a');
          for (let i = 0; i < n; i++) storeItem(c, r.item, r.x + 3 + (i % cols) * 6, r.y + r.h - 8 - Math.floor(i / cols) * 8);
          continue;
        }
        const p = r.pitch, cols = Math.max(1, Math.floor((r.w - 4) / p));
        r.machines.forEach((mc, i) => sprite(c, r.kind, r.x + 3 + (i % cols) * p, r.y + HEADER + Math.floor(i / cols) * p, t >= onAt(r, i), ph, i));
      }
      big.imageSmoothingEnabled = false;
      big.drawImage(small, 0, 0, canvas.width, canvas.height);
      const s = scale;
      for (const r of rooms) {
        const g = big.createLinearGradient(0, (r.y + 1) * s, 0, (r.y + 9) * s);
        if (r.store) { g.addColorStop(0, '#3a9a52'); g.addColorStop(1, '#25733a'); } else { g.addColorStop(0, '#3a8cff'); g.addColorStop(1, '#0058e6'); }
        big.fillStyle = g; big.fillRect((r.x + 1) * s, (r.y + 1) * s, (r.w - 2) * s, 8 * s);
        const max = (r.w - 4) * s;
        const fit = (text) => { if (big.measureText(text).width <= max) return text; let x = text; while (x.length > 1 && big.measureText(x + '…').width > max) x = x.slice(0, -1); return x + '…'; };
        big.font = `bold ${titlePx}px Consolas, "Courier New", monospace`; big.fillStyle = '#fff'; big.textBaseline = 'middle';
        big.fillText(fit(r.title), (r.x + 3) * s, (r.y + 5) * s);
        let sub = r.sub;
        if (!r.store) { const on = r.machines.filter((_, i) => t >= onAt(r, i)).length; sub = `${on}/${r.machines.length} running`; }
        big.font = `${subPx}px Consolas, "Courier New", monospace`; big.fillStyle = NAVY;
        big.fillText(fit(sub), (r.x + 3) * s, (r.y + 12.5) * s);
      }
    }
    return { draw, rooms, W, H };
  }
  window.TerrasFloor = { mount };
})();

// math.js
import { CONFIG } from './config.js';
import { state } from './state.js';

const HEX_R = CONFIG.HEX_R;
const SQRT3 = CONFIG.SQRT3;

export function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

export function hexKey(q, r) { return (q << 16) ^ r; }

export function hashQR(q, r) {
    let h = (q * 374761393 + r * 668265263 + state.randomSeed * 1013904223 + 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return Math.abs(h ^ (h >>> 16));
}

export function hashRot(q, r) {
    let h = (q * 374761393 + r * 668265263 + state.rotSeed * 1013904223 + 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return Math.abs(h ^ (h >>> 16));
}

export function isTileAlter(q, r) {
    if (state.alterTilesRatio <= 0) return false;
    return (hashQR(q, r) % 10000) / 10000 < state.alterTilesRatio;
}

export function baseRot(q, r) {
    if (state.rotMode === 'zero') return 0;
    const ROT_STEP = CONFIG.ROT_STEP;
    const ROT_MOD = 360 / ROT_STEP;
    return (hashRot(q, r) % ROT_MOD) * ROT_STEP;
}

export function tileRot(q, r) {
    const k = hexKey(q, r);
    return state.rotOverrides.has(k) ? state.rotOverrides.get(k) : baseRot(q, r);
}

export function nearestTarget(from, target) {
    const diff = ((target - from) % 360 + 540) % 360 - 180;
    return from + diff;
}

export function displayRot(q, r, now) {
    const k = hexKey(q, r);
    const a = state.animMap.get(k);
    if (!a) return tileRot(q, r);
    const elapsed = now - a.start;
    if (elapsed >= a.duration) return tileRot(q, r);
    const t = elapsed / a.duration;
    const ease = 1 - Math.pow(1 - t, 3);
    return a.from + (a.to - a.from) * ease;
}

export function hexToPix(q, r, z, px, py) {
    return {
        x: HEX_R * 1.5 * q * z + px,
        y: HEX_R * (SQRT3 * 0.5 * q + SQRT3 * r) * z + py
    };
}

export function pixToHex(sx, sy, z, px, py) {
    const x = (sx - px) / (HEX_R * z);
    const y = (sy - py) / (HEX_R * z);
    const fq = x * 2 / 3;
    const fr = -x / 3 + SQRT3 / 3 * y;
    return hexRound(fq, fr);
}

export function hexRound(fq, fr) {
    const fs = -fq - fr;
    let rq = Math.round(fq),
        rr = Math.round(fr),
        rs = Math.round(fs);
    const dq = Math.abs(rq - fq),
        dr = Math.abs(rr - fr),
        ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
}

export function traceHexPath(c, cx, cy, sz) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = CONFIG.PI_DIV_3 * i;
        const vx = cx + sz * Math.cos(a);
        const vy = cy + sz * Math.sin(a);
        i === 0 ? c.moveTo(vx, vy) : c.lineTo(vx, vy);
    }
    c.closePath();
}

export function traceHexGridBatch(c, hexes, sz) {
    c.beginPath();
    for (const h of hexes) {
        for (let i = 0; i < 3; i++) {
            const a1 = CONFIG.PI_DIV_3 * i;
            const a2 = CONFIG.PI_DIV_3 * (i + 1);
            const x1 = h.x + sz * Math.cos(a1);
            const y1 = h.y + sz * Math.sin(a1);
            const x2 = h.x + sz * Math.cos(a2);
            const y2 = h.y + sz * Math.sin(a2);
            if (i === 0) c.moveTo(x1, y1);
            c.lineTo(x2, y2);
        }
    }
}

export function traceHexGrid(c, cx, cy, sz) {
    c.beginPath();
    for (let i = 0; i < 3; i++) {
        const a1 = CONFIG.PI_DIV_3 * i;
        const a2 = CONFIG.PI_DIV_3 * (i + 1);
        const x1 = cx + sz * Math.cos(a1);
        const y1 = cy + sz * Math.sin(a1);
        const x2 = cx + sz * Math.cos(a2);
        const y2 = cy + sz * Math.sin(a2);
        if (i === 0) c.moveTo(x1, y1);
        c.lineTo(x2, y2);
    }
}

export function visibleHexes(z, px, py, W, H) {
    const margin = HEX_R * z * CONFIG.VISIBLE_BOUND_MULT;
    const tl = pixToHex(-margin, -margin, z, px, py);
    const tr = pixToHex(W + margin, -margin, z, px, py);
    const bl = pixToHex(-margin, H + margin, z, px, py);
    const br = pixToHex(W + margin, H + margin, z, px, py);
    const minQ = Math.min(tl.q, tr.q, bl.q, br.q);
    const maxQ = Math.max(tl.q, tr.q, bl.q, br.q);
    const minR = Math.min(tl.r, tr.r, bl.r, br.r);
    const maxR = Math.max(tl.r, tr.r, bl.r, br.r);
    
    let count = 0;
    for (let q = minQ; q <= maxQ; q++) {
        for (let r = minR; r <= maxR; r++) {
            const p = hexToPix(q, r, z, px, py);
            if (p.x > -margin && p.x < W + margin && p.y > -margin && p.y < H + margin) {
                if (count >= state.visibleHexesArray.length) {
                    state.visibleHexesArray.push({ q: 0, r: 0, x: 0, y: 0 });
                }
                const h = state.visibleHexesArray[count];
                h.q = q;
                h.r = r;
                h.x = p.x;
                h.y = p.y;
                count++;
            }
        }
    }
    state.visibleHexesArray.length = count; 
    return state.visibleHexesArray;
}

export function hash2D(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
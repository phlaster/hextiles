// curves.js
import { CONFIG, COLORS } from './config.js';
import { state } from './state.js';
import { dom } from './dom.js';
import { hexToRgb, colorDistance } from './utils.js';
import { hexToPix, pixToHex, hexDistance, hexKey, tileRot, isTileAlter } from './math.js';

export function getNeighbor(q, r, e) {
    if (e === 0) return { q: q + 1, r: r, edge: 3 };
    if (e === 1) return { q: q, r: r + 1, edge: 4 };
    if (e === 2) return { q: q - 1, r: r + 1, edge: 5 };
    if (e === 3) return { q: q - 1, r: r, edge: 0 };
    if (e === 4) return { q: q, r: r - 1, edge: 1 };
    if (e === 5) return { q: q + 1, r: r - 1, edge: 2 };
}

export function edgeID(q, r, e) {
    const n = getNeighbor(q, r, e);
    const id1 = (q + 100000) * 10000000 + (r + 100000) * 10 + e;
    const id2 = (n.q + 100000) * 10000000 + (n.r + 100000) * 10 + n.edge;
    return id1 < id2 ? id1 : id2;
}

export function decodeEdgeID(id) {
    const e = id % 10;
    let rem = Math.floor(id / 10);
    const r = (rem % 1000000) - 100000;      
    const q = Math.floor(rem / 1000000) - 100000;
    return [q, r, e];
}

export function getOtherEdge(k, e, isAlter = false) {
    const eb = (e - k + 6) % 6;
    let ob;
    if (!isAlter) {
        if (eb === 2) ob = 3;
        else if (eb === 3) ob = 2;
        else if (eb === 4) ob = 0;
        else if (eb === 0) ob = 4;
        else if (eb === 1) ob = 5;
        else if (eb === 5) ob = 1;
    } else {
        ob = eb ^ 1; 
    }
    return (ob + k) % 6;
}

export function mergeCurves(c1, c2) {
    if (c1 === c2) return;
    let curve1 = state.curves.get(c1);
    let curve2 = state.curves.get(c2);
    if (!curve1 || !curve2) return;
    let target, source;
    
    if (curve1.size > curve2.size) {
        target = curve1;
        source = curve2;
    } else if (curve2.size > curve1.size) {
        target = curve2;
        source = curve1;
    } else {
        if (Math.random() < 0.5) {
            target = curve1;
            source = curve2;
        } else {
            target = curve2;
            source = curve1;
        }
    }
    
    for (let id of source.edges) {
        state.curveMap.set(id, target.id);
        target.edges.add(id);
    }
    target.size = target.edges.size;
    if (source.locked) target.locked = true;
    
    source.edges.clear(); 
    source.edges = null; 
    
    state.curves.delete(source.id);
}

export function processQueue(customBounds, noCull = false) {
    let bounds = customBounds || getVisibleBounds();
    let margin = noCull ? 1000000 : CONFIG.TRACE_QUEUE_MARGIN;
    let processed = 0;
    let maxPerFrame = CONFIG.TRACE_MAX_PER_FRAME;
    
    while (state.queue.length > 0 && processed < maxPerFrame) {
        let item = state.queue.pop();
        processed++;
        
        if (!noCull && (item.q < bounds.minQ - margin || item.q > bounds.maxQ + margin ||
            item.r < bounds.minR - margin || item.r > bounds.maxR + margin)) continue;
            
        let id = edgeID(item.q, item.r, item.e);
        if (!state.curveMap.has(id)) continue;
        
        let curveID = state.curveMap.get(id);
        let curve = state.curves.get(curveID);
        if (!curve) continue;
        
        let k = (tileRot(item.q, item.r) / 60) % 6;
        let pe = getOtherEdge(k, item.e, isTileAlter(item.q, item.r));
        let pid = edgeID(item.q, item.r, pe);
        
        if (state.curveMap.has(pid)) {
            let existingCurve = state.curveMap.get(pid);
            if (existingCurve === curveID) curve.locked = true;
            else mergeCurves(curveID, existingCurve);
        } else {
            state.curveMap.set(pid, curveID);
            curve.edges.add(pid);
            curve.size++;
            let n = getNeighbor(item.q, item.r, pe);
            state.queue.push({ q: n.q, r: n.r, e: n.edge });
        }
    }
}

export function findUncoloredTileInHexes(hexes) {
    for (const h of hexes) {
        for (let i = 0; i < 6; i++) {
            if (!state.curveMap.has(edgeID(h.q, h.r, i))) {
                recalculateTile(h.q, h.r);
                return true;
            }
        }
    }
    return false;
}

export function findNextUncoloredTile() {
    let bounds = getVisibleBounds();
    let margin = CONFIG.TRACE_SEARCH_MARGIN;
    for (let q = bounds.minQ - margin; q <= bounds.maxQ + margin; q++) {
        for (let r = bounds.minR - margin; r <= bounds.maxR + margin; r++) {
            for (let i = 0; i < 6; i++) {
                if (!state.curveMap.has(edgeID(q, r, i))) {
                    recalculateTile(q, r);
                    return true;
                }
            }
        }
    }
    return false;
}

export function getVisibleBounds() {
    let W = dom.cvs.width,
        H = dom.cvs.height;
    let z = state.zoom,
        px = state.panX,
        py = state.panY;
    let margin = CONFIG.HEX_R * z * CONFIG.VISIBLE_BOUND_MULT;
    let tl = pixToHex(-margin, -margin, z, px, py);
    let tr = pixToHex(W + margin, -margin, z, px, py);
    let bl = pixToHex(-margin, H + margin, z, px, py);
    let br = pixToHex(W + margin, H + margin, z, px, py);
    return {
        minQ: Math.min(tl.q, tr.q, bl.q, br.q),
        maxQ: Math.max(tl.q, tr.q, bl.q, br.q),
        minR: Math.min(tl.r, tr.r, bl.r, br.r),
        maxR: Math.max(tl.r, tr.r, bl.r, br.r)
    };
}

export function initializeCentralTile() {
    if (state.curveColors.length <= 1) return;
    if (state.curveMap.size > 0) return;
    let center = pixToHex(dom.cvs.width / 2, dom.cvs.height / 2, state.zoom, state.panX, state.panY);
    recalculateTile(center.q, center.r);
}

export function getCurveColorIndex(curveID) {
    const c = state.curves.get(curveID);
    if (!c) return -1;
    return (typeof c.color === 'number') ? c.color : state.curveColors.indexOf(c.color);
}

export function getAdjacentColors(edgeSet, excludeCurveID) {
    const adjColors = new Set();
    for (const id of edgeSet) {
        const [q, r, e] = decodeEdgeID(id);
        
        const adjEdgesInTile = [(e + 1) % 6, (e + 5) % 6];
        for (const ae of adjEdgesInTile) {
            const adjID = edgeID(q, r, ae);
            if (state.curveMap.has(adjID)) {
                const cid = state.curveMap.get(adjID);
                if (cid !== excludeCurveID) {
                    const c = state.curves.get(cid);
                    if (c) adjColors.add(c.color); 
                }
            }
        }
        
        const n = getNeighbor(q, r, e);
        const adjEdgesInNeighbor = [(n.edge + 1) % 6, (n.edge + 5) % 6];
        for (const ae of adjEdgesInNeighbor) {
            const adjID = edgeID(n.q, n.r, ae);
            if (state.curveMap.has(adjID)) {
                const cid = state.curveMap.get(adjID);
                if (cid !== excludeCurveID) {
                    const c = state.curves.get(cid);
                    if (c) adjColors.add(c.color);
                }
            }
        }
    }
    return adjColors;
}

export function getBackgroundColorAt(x, y, coordScale = 1, offsetX = 0, offsetY = 0) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return null;
    let totalWeight = 0, r = 0, g = 0, b = 0;
    
    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        const mx = (m.x - offsetX) * coordScale;
        const my = (m.y - offsetY) * coordScale;
        const dx = x - mx;
        const dy = y - my;
        const distSq = dx * dx + dy * dy + 0.5 * coordScale * coordScale;
        const weight = (1 / (distSq * distSq)) * (m.weight || 0);
        totalWeight += weight;
        r += m.r * weight;
        g += m.g * weight;
        b += m.b * weight;
    }
    for (let i = 0; i < state.fadingMarkersRGB.length; i++) {
        const m = state.fadingMarkersRGB[i];
        const mx = (m.x - offsetX) * coordScale;
        const my = (m.y - offsetY) * coordScale;
        const dx = x - mx;
        const dy = y - my;
        const distSq = dx * dx + dy * dy + 0.5 * coordScale * coordScale;
        const weight = (1 / (distSq * distSq)) * (m.weight || 0);
        totalWeight += weight;
        r += m.r * weight;
        g += m.g * weight;
        b += m.b * weight;
    }
    
    if (totalWeight === 0) return null;
    return [r / totalWeight, g / totalWeight, b / totalWeight];
}

export function pickColorForNewCurve(adjColors, avoidColor = -1, seed1 = 0, seed2 = 0, bgColor = null) {
    if (state.curveColors.length === 1) return 0;
    if (!adjColors) adjColors = new Set();
    
    const candidates = [];
    for (let i = 0; i < state.curveColors.length; i++) {
        if (!adjColors.has(i) && i !== avoidColor) candidates.push(i);
    }
    
    let pool = candidates;
    if (pool.length === 0) {
        const fallback = [];
        for (let i = 0; i < state.curveColors.length; i++) {
            if (!adjColors.has(i)) fallback.push(i);
        }
        pool = fallback;
    }
    
    if (pool.length === 0) {
        return (avoidColor + 1) % state.curveColors.length;
    }

    if (bgColor && pool.length > 1) {
        let bestContrast = 0;
        const contrasts = new Array(pool.length);
        
        for (let i = 0; i < pool.length; i++) {
            const cIdx = pool[i];
            const curveRgb = hexToRgb(state.curveColors[cIdx]);
            const contrast = colorDistance(curveRgb, bgColor);
            contrasts[i] = contrast;
            if (contrast > bestContrast) bestContrast = contrast;
        }
        
        const threshold = bestContrast * 0.7;
        const goodCandidates = [];
        for (let i = 0; i < pool.length; i++) {
            if (contrasts[i] >= threshold) goodCandidates.push(pool[i]);
        }
        
        if (goodCandidates.length > 0) {
            pool = goodCandidates;
        }
    }

    let h = Math.imul(seed1 ^ (seed2 * 2654435761), 0x9E3779B1) >>> 0;
    return pool[h % pool.length];
}

export function splitCurve(curveID) {
    let curve = state.curves.get(curveID);
    if (!curve || curve.size <= 1) return;
    let visited = new Set();
    let components = [];
    for (let id of curve.edges) {
        if (visited.has(id)) continue;
        let comp = [];
        let q = [id];
        visited.add(id);
        while (q.length > 0) {
            let curr = q.pop();
            comp.push(curr);
            let [q1, r1, e1] = decodeEdgeID(curr);
            let n1 = getNeighbor(q1, r1, e1);
            let k1 = (tileRot(q1, r1) / 60) % 6;
            let pe1 = getOtherEdge(k1, e1, isTileAlter(q1, r1));
            let pid1 = edgeID(q1, r1, pe1);
            if (curve.edges.has(pid1) && !visited.has(pid1)) {
                visited.add(pid1);
                q.push(pid1);
            }
            let q2 = n1.q, r2 = n1.r, e2 = n1.edge;
            let k2 = (tileRot(q2, r2) / 60) % 6;
            let pe2 = getOtherEdge(k2, e2, isTileAlter(q2, r2));
            let pid2 = edgeID(q2, r2, pe2);
            if (curve.edges.has(pid2) && !visited.has(pid2)) {
                visited.add(pid2);
                q.push(pid2);
            }
        }
        components.push(comp);
    }
    if (components.length > 1) {
        components.sort((a, b) => b.length - a.length);
        curve.edges = new Set(components[0]);
        curve.size = curve.edges.size;
        
        for (let i = 1; i < components.length; i++) {
            let newID = state.nextCurveID++;
            let compSet = new Set(components[i]);
            let adjColors = (state.curveColors.length <= 1) ? null : getAdjacentColors(compSet, curve.id);
            
            const [eq, er, ee] = decodeEdgeID(components[i][0]);
            const p = hexToPix(eq, er, state.zoom, state.panX, state.panY);
            const bgColor = getBackgroundColorAt(p.x, p.y);
            
            let newColor;
            if (state.curveColors.length > 1) {
                let validCandidates = [];
                const origColorIdx = (typeof curve.color === 'number') ? (curve.color % state.curveColors.length) : 0;
                
                for (let i = 0; i < state.curveColors.length; i++) {
                    if (!adjColors.has(i) && i !== origColorIdx) {
                        validCandidates.push(i);
                    }
                }
                if (validCandidates.length === 0) {
                    for (let i = 0; i < state.curveColors.length; i++) {
                        if (!adjColors.has(i)) validCandidates.push(i);
                    }
                }
                newColor = (origColorIdx + 1) % state.curveColors.length;
                
                if (validCandidates.length > 0) {
                    let maxDist = -1;
                    const origRgb = hexToRgb(state.curveColors[origColorIdx]);
                    for (const cIdx of validCandidates) {
                        const cRgb = hexToRgb(state.curveColors[cIdx]);
                        const dist = colorDistance(origRgb, cRgb);
                        if (dist > maxDist) {
                            maxDist = dist;
                            newColor = cIdx;
                        }
                    }
                }
            } else {
                newColor = 0;
            }
            
            let newCurve = {
                id: newID, color: newColor, size: components[i].length, locked: false,
                edges: compSet
            };
            state.curves.set(newID, newCurve);
            for (let id of newCurve.edges) state.curveMap.set(id, newID);
        }
    }
}

export function updateLocalCurves(q, r) {
    let affectedCurves = new Set();
    let ids = [];
    for (let i = 0; i < 6; i++) {
        let id = edgeID(q, r, i);
        ids.push(id);
        if (state.curveMap.has(id)) affectedCurves.add(state.curveMap.get(id));
    }
    if (affectedCurves.size === 0) { recalculateTile(q, r); return; }
    if (affectedCurves.size === 1) {
        let cid = [...affectedCurves][0];
        let allEdgesSame = true;
        for (let i = 0; i < 6; i++) {
            if (!state.curveMap.has(ids[i]) || state.curveMap.get(ids[i]) !== cid) { allEdgesSame = false; break; }
        }
        if (allEdgesSame) return;
    }
    
    for (let i = 0; i < 6; i++) {
        let id = ids[i];
        if (state.curveMap.has(id)) {
            let cid = state.curveMap.get(id);
            let curve = state.curves.get(cid);
            if (curve) {
                curve.edges.delete(id);
                curve.size = curve.edges.size;
            }
            state.curveMap.delete(id);
        }
    }
    let validAffected = [];
    for (let cid of affectedCurves) {
        let curve = state.curves.get(cid);
        if (curve) {
            if (curve.size === 0) state.curves.delete(cid);
            else validAffected.push(cid);
        }
    }
    for (let cid of validAffected) splitCurve(cid);
    let k = (tileRot(q, r) / 60) % 6;
    let alter = isTileAlter(q, r);
    let pairs = alter ? [
        [(0 + k) % 6, (1 + k) % 6],
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (5 + k) % 6]
    ] : [
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (0 + k) % 6],
        [(1 + k) % 6, (5 + k) % 6]
    ];
    for (let pair of pairs) {
        let e1 = pair[0],
            e2 = pair[1];
        let id1 = ids[e1],
            id2 = ids[e2];
        let n1 = getNeighbor(q, r, e1);
        let k1 = (tileRot(n1.q, n1.r) / 60) % 6;
        let n1_other = getOtherEdge(k1, n1.edge, isTileAlter(n1.q, n1.r));
        let n1_other_id = edgeID(n1.q, n1.r, n1_other);
        let c1 = state.curveMap.has(n1_other_id) ? state.curveMap.get(n1_other_id) : -1;
        let n2 = getNeighbor(q, r, e2);
        let k2 = (tileRot(n2.q, n2.r) / 60) % 6;
        let n2_other = getOtherEdge(k2, n2.edge, isTileAlter(n2.q, n2.r));
        let n2_other_id = edgeID(n2.q, n2.r, n2_other);
        let c2 = state.curveMap.has(n2_other_id) ? state.curveMap.get(n2_other_id) : -1;
        if (c1 !== -1 && c2 !== -1) {
            if (c1 !== c2) {
                mergeCurves(c1, c2);
            }
            let targetCurveID = state.curveMap.get(n1_other_id);
            state.curveMap.set(id1, targetCurveID);
            state.curveMap.set(id2, targetCurveID);
            state.curves.get(targetCurveID).edges.add(id1);
            state.curves.get(targetCurveID).edges.add(id2);
            state.curves.get(targetCurveID).size = state.curves.get(targetCurveID).edges.size;
        } else if (c1 !== -1) {
            state.curveMap.set(id1, c1);
            state.curveMap.set(id2, c1);
            state.curves.get(c1).edges.add(id1);
            state.curves.get(c1).edges.add(id2);
            state.curves.get(c1).size = state.curves.get(c1).edges.size;
            state.queue.push({ q: n2.q, r: n2.r, e: n2.edge });
        } else if (c2 !== -1) {
            state.curveMap.set(id1, c2);
            state.curveMap.set(id2, c2);
            state.curves.get(c2).edges.add(id1);
            state.curves.get(c2).edges.add(id2);
            state.curves.get(c2).size = state.curves.get(c2).edges.size;
            state.queue.push({ q: n1.q, r: n1.r, e: n1.edge });
        } else {
            let tempSet = new Set([id1, id2]);
            let adjColors = (state.curveColors.length <= 1) ? null : getAdjacentColors(tempSet, -1);
            
            const p = hexToPix(q, r, state.zoom, state.panX, state.panY);
            const bgColor = getBackgroundColorAt(p.x, p.y);
            let color = pickColorForNewCurve(adjColors, -1, q, r * 6 + e1, bgColor);
            
            let curveID = state.nextCurveID++;
            
            state.curves.set(curveID, { id: curveID, color: color, size: 0, locked: false, edges: new Set() });
            state.curveMap.set(id1, curveID);
            state.curveMap.set(id2, curveID);
            state.curves.get(curveID).edges.add(id1);
            state.curves.get(curveID).edges.add(id2);
            state.curves.get(curveID).size = 2;
            state.queue.push({ q: n1.q, r: n1.r, e: n1.edge });
            state.queue.push({ q: n2.q, r: n2.r, e: n2.edge });
        }
    }
}

export function recalculateTile(q, r) {
    let k = (tileRot(q, r) / 60) % 6;
    let alter = isTileAlter(q, r);
    let pairs = alter ? [
        [(0 + k) % 6, (1 + k) % 6],
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (5 + k) % 6]
    ] : [
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (0 + k) % 6],
        [(1 + k) % 6, (5 + k) % 6]
    ];
    for (let pair of pairs) {
        let e1 = pair[0],
            e2 = pair[1];
        let id1 = edgeID(q, r, e1);
        let id2 = edgeID(q, r, e2);
        let c1 = state.curveMap.has(id1) ? state.curveMap.get(id1) : -1;
        let c2 = state.curveMap.has(id2) ? state.curveMap.get(id2) : -1;
        if (c1 !== -1 && c2 !== -1) {
            if (c1 !== c2) mergeCurves(c1, c2);
        } else if (c1 !== -1) {
            state.curveMap.set(id2, c1);
            state.curves.get(c1).edges.add(id2);
            state.curves.get(c1).size++;
            let n = getNeighbor(q, r, e2);
            state.queue.push({ q: n.q, r: n.r, e: n.edge });
        } else if (c2 !== -1) {
            state.curveMap.set(id1, c2);
            state.curves.get(c2).edges.add(id1);
            state.curves.get(c2).size++;
            let n = getNeighbor(q, r, e1);
            state.queue.push({ q: n.q, r: n.r, e: n.edge });
        } else {
            let curveID = state.nextCurveID++;
            let tempSet = new Set([id1, id2]);
            let adjColors = (state.curveColors.length <= 1) ? null : getAdjacentColors(tempSet, -1);
            const p = hexToPix(q, r, state.zoom, state.panX, state.panY);
            const bgColor = getBackgroundColorAt(p.x, p.y);
            let color = pickColorForNewCurve(adjColors, -1, q, r * 6 + e1, bgColor);
            
            state.curves.set(curveID, { id: curveID, color: color, size: 0, locked: false, edges: new Set() });
            state.curveMap.set(id1, curveID);
            state.curves.get(curveID).edges.add(id1);
            state.curves.get(curveID).size++;
            let n1 = getNeighbor(q, r, e1);
            state.queue.push({ q: n1.q, r: n1.r, e: n1.edge });
            
            state.curveMap.set(id2, curveID);
            state.curves.get(curveID).edges.add(id2);
            state.curves.get(curveID).size++;
            let n2 = getNeighbor(q, r, e2);
            state.queue.push({ q: n2.q, r: n2.r, e: n2.edge });
        }
    }
}
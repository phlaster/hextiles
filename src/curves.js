import {
    CONFIG,
    COLORS
} from './config.js';
import {
    state
} from './state.js';
import {
    dom
} from './dom.js';
import {
    hexToRgb,
    colorDistance
} from './utils.js';
import {
    hexToPix,
    pixToHex,
    hexDistance,
    hexKey,
    tileRot,
    isTileAlter
} from './math.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORE EDGE & NEIGHBOR MATH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getNeighbor(q, r, e) {
    if (e === 0) return {
        q: q + 1,
        r: r,
        edge: 3
    };
    if (e === 1) return {
        q: q,
        r: r + 1,
        edge: 4
    };
    if (e === 2) return {
        q: q - 1,
        r: r + 1,
        edge: 5
    };
    if (e === 3) return {
        q: q - 1,
        r: r,
        edge: 0
    };
    if (e === 4) return {
        q: q,
        r: r - 1,
        edge: 1
    };
    if (e === 5) return {
        q: q + 1,
        r: r - 1,
        edge: 2
    };
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

export function getTileEdgePairs(q, r) {
    const k = (tileRot(q, r) / 60) % 6;
    const alter = isTileAlter(q, r);
    return alter ? [
        [(0 + k) % 6, (1 + k) % 6],
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (5 + k) % 6]
    ] : [
        [(2 + k) % 6, (3 + k) % 6],
        [(4 + k) % 6, (0 + k) % 6],
        [(1 + k) % 6, (5 + k) % 6]
    ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CURVE MERGING & QUEUE PROCESSING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function mergeCurves(c1, c2) {
    if (c1 === c2) return;
    let curve1 = state.curves.get(c1);
    let curve2 = state.curves.get(c2);
    if (!curve1 || !curve2) return;

    const {
        target,
        source
    } = determineTargetAndSource(curve1, curve2);

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

function determineTargetAndSource(curve1, curve2) {
    if (curve1.size > curve2.size) return {
        target: curve1,
        source: curve2
    };
    if (curve2.size > curve1.size) return {
        target: curve2,
        source: curve1
    };

    if (curve1.id < curve2.id) return {
        target: curve1,
        source: curve2
    };
    return {
        target: curve2,
        source: curve1
    };
}

export function processQueue(customBounds, noCull = false) {
    let bounds = customBounds || getVisibleBounds();
    let margin = noCull ? 1000000 : CONFIG.TRACE_QUEUE_MARGIN;
    let processed = 0;
    let maxPerFrame = CONFIG.TRACE_MAX_PER_FRAME;

    while (state.queue.length > 0 && processed < maxPerFrame) {
        let item = state.queue.pop();
        processed++;

        if (!noCull && isOutOfBoundaries(item, bounds, margin)) continue;
        processQueueItem(item);
    }
}

function isOutOfBoundaries(item, bounds, margin) {
    return item.q < bounds.minQ - margin || item.q > bounds.maxQ + margin ||
        item.r < bounds.minR - margin || item.r > bounds.maxR + margin;
}

function processQueueItem(item) {
    let id = edgeID(item.q, item.r, item.e);
    if (!state.curveMap.has(id)) return;

    let curveID = state.curveMap.get(id);
    let curve = state.curves.get(curveID);
    if (!curve) return;

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
        state.queue.push({
            q: n.q,
            r: n.r,
            e: n.edge
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CURVE DISCOVERY & VISIBILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

export function initializeCentralTile(q, r) {
    if (state.curveColors.length <= 1) return;
    if (state.curveMap.size > 0) return;

    if (q === undefined || r === undefined) {
        let center = pixToHex(dom.cvs.width / 2, dom.cvs.height / 2, state.zoom, state.panX, state.panY);
        q = center.q;
        r = center.r;
    }
    recalculateTile(q, r);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  COLOR & GRADIENT HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getCurveColorIndex(curveID) {
    const c = state.curves.get(curveID);
    if (!c) return -1;
    return (typeof c.color === 'number') ? c.color : state.curveColors.indexOf(c.color);
}

export function getAdjacentColors(edgeSet, excludeCurveID) {
    const adjColors = new Set();
    for (const id of edgeSet) {
        const [q, r, e] = decodeEdgeID(id);

        checkAdjacentEdge(q, r, (e + 1) % 6, excludeCurveID, adjColors);
        checkAdjacentEdge(q, r, (e + 5) % 6, excludeCurveID, adjColors);

        const n = getNeighbor(q, r, e);
        checkAdjacentEdge(n.q, n.r, (n.edge + 1) % 6, excludeCurveID, adjColors);
        checkAdjacentEdge(n.q, n.r, (n.edge + 5) % 6, excludeCurveID, adjColors);
    }
    return adjColors;
}

function checkAdjacentEdge(q, r, e, excludeCurveID, adjColors) {
    const adjID = edgeID(q, r, e);
    if (state.curveMap.has(adjID)) {
        const cid = state.curveMap.get(adjID);
        if (cid !== excludeCurveID) {
            const c = state.curves.get(cid);
            if (c) {
                let col = c.color;
                if (typeof col === 'string') {
                    const lowerCol = col.toLowerCase();
                    col = state.curveColors.findIndex(c => c.toLowerCase() === lowerCol);
                    if (col === -1) col = -2; 
                }
                adjColors.add(col);
            }
        }
    }
}

export function getBackgroundColorAt(x, y, coordScale = 1, offsetX = 0, offsetY = 0) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return null;
    let totalWeight = 0,
        r = 0,
        g = 0,
        b = 0;

    const processMarker = (m) => {
        const mx = (m.x - offsetX) * coordScale;
        const my = (m.y - offsetY) * coordScale;
        const dx = x - mx;
        const dy = y - my;
        const distSq = dx * dx + dy * dy + 0.5 * coordScale * coordScale;
        const weight = (1 / (distSq * distSq)) * (m.weight || 0);
        return {
            weight,
            r: m.r,
            g: m.g,
            b: m.b
        };
    };

    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const res = processMarker(state.gradientMarkersRGB[i]);
        totalWeight += res.weight;
        r += res.r * res.weight;
        g += res.g * res.weight;
        b += res.b * res.weight;
    }
    for (let i = 0; i < state.fadingMarkersRGB.length; i++) {
        const res = processMarker(state.fadingMarkersRGB[i]);
        totalWeight += res.weight;
        r += res.r * res.weight;
        g += res.g * res.weight;
        b += res.b * res.weight;
    }

    if (totalWeight === 0) return null;
    return [r / totalWeight, g / totalWeight, b / totalWeight];
}

export function pickColorForNewCurve(adjColors, avoidColor = -1, seed1 = 0, seed2 = 0, bgColor = null) {
    if (state.curveColors.length === 1) return 0;
    if (!adjColors) adjColors = new Set();

    let pool = buildCandidatePool(adjColors, avoidColor);
    if (pool.length === 0) return (avoidColor + 1) % state.curveColors.length;

    if (bgColor && pool.length > 1) {
        pool = filterPoolByContrast(pool, bgColor);
    }

    return selectColorFromPool(pool, seed1, seed2);
}

function buildCandidatePool(adjColors, avoidColor) {
    const candidates = [];
    for (let i = 0; i < state.curveColors.length; i++) {
        if (!adjColors.has(i) && i !== avoidColor) candidates.push(i);
    }
    if (candidates.length === 0) {
        const fallback = [];
        for (let i = 0; i < state.curveColors.length; i++) {
            if (!adjColors.has(i)) fallback.push(i);
        }
        return fallback;
    }
    return candidates;
}

function filterPoolByContrast(pool, bgColor) {
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

    return goodCandidates.length > 0 ? goodCandidates : pool;
}

function selectColorFromPool(pool, seed1, seed2) {
    let h = Math.imul(seed1 ^ (seed2 * 2654435761), 0x9E3779B1) >>> 0;
    return pool[h % pool.length];
}

export function getCurveRgb(curveID) {
    if (curveID === -2 || (state.curveColors.length === 1 && curveID === -1)) {
        const c = state.curveColorsRGB[0];
        if (c) return {
            r: c.tr ?? c.r,
            g: c.tg ?? c.g,
            b: c.tb ?? c.b
        };
        const rgb = hexToRgb(state.curveColors[0]);
        return {
            r: rgb[0],
            g: rgb[1],
            b: rgb[2]
        };
    }

    const curve = state.curves.get(curveID);
    if (!curve) return null;

    let c = curve.color;
    if (typeof c === 'number') {
        const cc = state.curveColorsRGB[c % state.curveColorsRGB.length];
        if (cc) return {
            r: cc.tr ?? cc.r,
            g: cc.tg ?? cc.g,
            b: cc.tb ?? cc.b
        };
    }

    if (typeof c === 'string') {
        const rgb = hexToRgb(c);
        return {
            r: rgb[0],
            g: rgb[1],
            b: rgb[2]
        };
    }

    return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CURVE SPLITTING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function splitCurve(curveID) {
    let curve = state.curves.get(curveID);
    if (!curve || curve.size <= 1) return;

    const components = findCurveComponents(curve);
    if (components.length > 1) {
        reassignSplitComponents(curve, components);
    }
}

function findCurveComponents(curve) {
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

            pushConnectedEdge(q1, r1, e1, curve, visited, q);
            pushConnectedEdge(n1.q, n1.r, n1.edge, curve, visited, q);
        }
        components.push(comp);
    }
    return components;
}

function pushConnectedEdge(q, r, e, curve, visited, queue) {
    let k = (tileRot(q, r) / 60) % 6;
    let pe = getOtherEdge(k, e, isTileAlter(q, r));
    let pid = edgeID(q, r, pe);
    if (curve.edges.has(pid) && !visited.has(pid)) {
        visited.add(pid);
        queue.push(pid);
    }
}

function reassignSplitComponents(curve, components) {
    components.sort((a, b) => b.length - a.length);
    curve.edges = new Set(components[0]);
    curve.size = curve.edges.size;

    for (let i = 1; i < components.length; i++) {
        createNewCurveFromComponent(curve, components[i]);
    }
}

function createNewCurveFromComponent(originalCurve, componentEdges) {
    let newID = state.nextCurveID++;
    let compSet = new Set(componentEdges);
    let newColor = pickColorForSplitCurve(originalCurve, compSet);

    let newCurve = {
        id: newID,
        color: newColor,
        size: componentEdges.length,
        locked: false,
        edges: compSet
    };
    state.curves.set(newID, newCurve);
    for (let id of newCurve.edges) state.curveMap.set(id, newID);
}

function pickColorForSplitCurve(originalCurve, compSet) {
    if (state.curveColors.length <= 1) return 0;

    let adjColors = getAdjacentColors(compSet, originalCurve.id);
    const [eq, er, ee] = decodeEdgeID([...compSet][0]);
    const p = hexToPix(eq, er, state.zoom, state.panX, state.panY);
    const bgColor = getBackgroundColorAt(p.x, p.y);

    const origColorIdx = (typeof originalCurve.color === 'number') ? (originalCurve.color % state.curveColors.length) : 0;
    const validCandidates = buildValidCandidates(adjColors, origColorIdx);

    if (validCandidates.length === 0) return (origColorIdx + 1) % state.curveColors.length;

    let maxDist = -1;
    let newColor = (origColorIdx + 1) % state.curveColors.length;
    const origRgb = hexToRgb(state.curveColors[origColorIdx]);
    for (const cIdx of validCandidates) {
        const cRgb = hexToRgb(state.curveColors[cIdx]);
        const dist = colorDistance(origRgb, cRgb);
        if (dist > maxDist) {
            maxDist = dist;
            newColor = cIdx;
        }
    }
    return newColor;
}

function buildValidCandidates(adjColors, origColorIdx) {
    const valid = [];
    for (let i = 0; i < state.curveColors.length; i++) {
        if (!adjColors.has(i) && i !== origColorIdx) valid.push(i);
    }
    if (valid.length === 0) {
        for (let i = 0; i < state.curveColors.length; i++) {
            if (!adjColors.has(i)) valid.push(i);
        }
    }
    return valid;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TILE RECALCULATION & UPDATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function updateLocalCurves(q, r) {
    const affectedCurves = clearTileEdges(q, r);

    if (affectedCurves.size === 0) {
        recalculateTile(q, r);
        return;
    }
    if (affectedCurves.size === 1 && isSingleCurveComplete(q, r, affectedCurves)) return;

    splitAffectedCurves(affectedCurves);
    applyTilePairs(q, r, false);
}

function clearTileEdges(q, r) {
    const affectedCurves = new Set();
    for (let i = 0; i < 6; i++) {
        let id = edgeID(q, r, i);
        if (state.curveMap.has(id)) {
            affectedCurves.add(state.curveMap.get(id));
            removeEdgeFromCurve(id);
        }
    }
    return affectedCurves;
}

function removeEdgeFromCurve(id) {
    const cid = state.curveMap.get(id);
    const curve = state.curves.get(cid);
    if (curve) {
        curve.edges.delete(id);
        curve.size = curve.edges.size;
    }
    state.curveMap.delete(id);
}

function isSingleCurveComplete(q, r, affectedCurves) {
    const cid = [...affectedCurves][0];
    for (let i = 0; i < 6; i++) {
        const id = edgeID(q, r, i);
        if (!state.curveMap.has(id) || state.curveMap.get(id) !== cid) return false;
    }
    return true;
}

function splitAffectedCurves(affectedCurves) {
    const validAffected = [];
    for (let cid of affectedCurves) {
        let curve = state.curves.get(cid);
        if (curve) {
            if (curve.size === 0) state.curves.delete(cid);
            else validAffected.push(cid);
        }
    }
    for (let cid of validAffected) splitCurve(cid);
}

export function recalculateTile(q, r) {
    applyTilePairs(q, r, true);
}

function applyTilePairs(q, r, isRecalculate) {
    const pairs = getTileEdgePairs(q, r);
    for (let pair of pairs) {
        const [e1, e2] = pair;
        const id1 = edgeID(q, r, e1);
        const id2 = edgeID(q, r, e2);
        const n1 = getNeighbor(q, r, e1);
        const n2 = getNeighbor(q, r, e2);

        let c1, c2, cont1, cont2;
        if (isRecalculate) {
            c1 = state.curveMap.has(id1) ? state.curveMap.get(id1) : -1;
            c2 = state.curveMap.has(id2) ? state.curveMap.get(id2) : -1;
        } else {
            const res1 = getNeighborContinuation(n1);
            const res2 = getNeighborContinuation(n2);
            c1 = res1.cid;
            cont1 = res1.contID;
            c2 = res2.cid;
            cont2 = res2.contID;
        }

        processCurvePair(q, r, e1, id1, id2, c1, c2, n1, n2, cont1, isRecalculate);
    }
}

function getNeighborContinuation(n) {
    const k1 = (tileRot(n.q, n.r) / 60) % 6;
    const n1_other = getOtherEdge(k1, n.edge, isTileAlter(n.q, n.r));
    const n1_other_id = edgeID(n.q, n.r, n1_other);
    const cid = state.curveMap.has(n1_other_id) ? state.curveMap.get(n1_other_id) : -1;
    return {
        cid,
        contID: n1_other_id
    };
}

function processCurvePair(q, r, e1, id1, id2, c1, c2, n1, n2, cont1, isRecalculate) {
    if (c1 !== -1 && c2 !== -1) {
        if (c1 !== c2) mergeCurves(c1, c2);
        if (!isRecalculate) {
            const targetCurveID = state.curveMap.get(cont1);
            assignEdgesToCurve([id1, id2], targetCurveID);
        }
    } else if (c1 !== -1) {
        const idsToAdd = isRecalculate ? [id2] : [id1, id2];
        assignEdgesToCurve(idsToAdd, c1);
        if (n2) state.queue.push({
            q: n2.q,
            r: n2.r,
            e: n2.edge
        });
    } else if (c2 !== -1) {
        const idsToAdd = isRecalculate ? [id1] : [id1, id2];
        assignEdgesToCurve(idsToAdd, c2);
        if (n1) state.queue.push({
            q: n1.q,
            r: n1.r,
            e: n1.edge
        });
    } else {
        createNewCurveForEdges(q, r, e1, id1, id2, n1, n2);
    }
}

function assignEdgesToCurve(ids, cid) {
    const curve = state.curves.get(cid);
    if (!curve) return;
    for (const id of ids) {
        state.curveMap.set(id, cid);
        curve.edges.add(id);
    }
    curve.size = curve.edges.size;
}

function createNewCurveForEdges(q, r, e1, id1, id2, n1, n2) {
    let tempSet = new Set([id1, id2]);
    let adjColors = (state.curveColors.length <= 1) ? null : getAdjacentColors(tempSet, -1);

    const p = hexToPix(q, r, state.zoom, state.panX, state.panY);
    const bgColor = getBackgroundColorAt(p.x, p.y);
    let color = pickColorForNewCurve(adjColors, -1, q, r * 6 + e1, bgColor);

    let curveID = state.nextCurveID++;
    state.curves.set(curveID, {
        id: curveID,
        color: color,
        size: 0,
        locked: false,
        edges: new Set()
    });
    assignEdgesToCurve([id1, id2], curveID);

    if (n1) state.queue.push({
        q: n1.q,
        r: n1.r,
        e: n1.edge
    });
    if (n2) state.queue.push({
        q: n2.q,
        r: n2.r,
        e: n2.edge
    });
}
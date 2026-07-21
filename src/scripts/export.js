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
    hexToRgb
} from './utils.js';
import {
    hexToPix,
    pixToHex,
    hexDistance,
    tileRot,
    visibleHexes,
    hexKey,
    hash2D,
    isTileAlter,
    traceHexPath,
    traceHexGridBatch,
    getBlazeState
} from './math.js';
import {
    processQueue,
    findUncoloredTileInHexes,
    edgeID,
    getNeighbor,
    decodeEdgeID,
    getOtherEdge,
    getBackgroundColorAt,
    getCurveRgb
} from './curves.js';
import {
    requestRender,
    drawTile,
    drawBackgroundStars,
    drawIDWGradient,
    updateIDWGradientCanvas
} from './render.js';
import {
    toast
} from './ui.js';

const HEX_R = CONFIG.HEX_R;
const SQRT3 = CONFIG.SQRT3;
const PI_DIV_3 = CONFIG.PI_DIV_3;
const TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3;
const FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SETUP EXPORT ORCHESTRATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function setupExport() {
    setupOverlayToggles();
    setupAspectLockAndDimensions();
    setupExportFormatButtons();
    setupExportFrameDragging();
}

function setupOverlayToggles() {
    dom.exportBtn.onclick = openExportOverlay;
    dom.closeExportBtn.onclick = closeExportOverlay;
    dom.exportBackdrop.onclick = closeExportOverlay;
}

function setupAspectLockAndDimensions() {
    dom.aspectLockBtn.addEventListener('click', () => {
        state.aspectLocked = !state.aspectLocked;
        dom.aspectLockBtn.classList.toggle('active', state.aspectLocked);
        dom.exportFrame.classList.toggle('locked-aspect', state.aspectLocked);
        if (state.aspectLocked) {
            let valW = parseInt(dom.exportW.value) || 50,
                valH = parseInt(dom.exportH.value) || 50;
            state.targetRatio = valW / valH;
            let newW = state.efRect.w,
                newH = newW / state.targetRatio;
            if (newH > state.efRect.h) {
                newH = state.efRect.h;
                newW = newH * state.targetRatio;
            }
            state.efRect.x += (state.efRect.w - newW) / 2;
            state.efRect.y += (state.efRect.h - newH) / 2;
            state.efRect.w = newW;
            state.efRect.h = newH;
            clampFrameToCanvas();
            updateExportFrameDOM();
            dom.exportW.value = Math.round(state.efRect.w);
            dom.exportH.value = Math.round(state.efRect.h);
        }
    });

    dom.exportW.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let val = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) {
            let valH = val / state.targetRatio;
            if (valH > cr.height) {
                valH = cr.height;
                val = valH * state.targetRatio;
            }
            if (val > cr.width) {
                val = cr.width;
                valH = val / state.targetRatio;
            }
            dom.exportH.value = Math.round(valH);
            dom.exportW.value = Math.round(val);
            state.efRect.w = val;
            state.efRect.h = valH;
        } else {
            val = Math.min(val, cr.width);
            const prev = parseFloat(dom.exportW.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                state.efRect.w *= ratio;
            }
            dom.exportW.value = val;
            dom.exportW.dataset.prev = val;
        }
        clampFrameToCanvas();
        updateExportFrameDOM();
    });

    dom.exportH.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let val = parseInt(dom.exportH.value) || 50;
        if (state.aspectLocked) {
            let valW = val * state.targetRatio;
            if (valW > cr.width) {
                valW = cr.width;
                val = valW / state.targetRatio;
            }
            if (val > cr.height) {
                val = cr.height;
                valW = val * state.targetRatio;
            }
            dom.exportW.value = Math.round(valW);
            dom.exportH.value = Math.round(val);
            state.efRect.w = valW;
            state.efRect.h = val;
        } else {
            val = Math.min(val, cr.height);
            const prev = parseFloat(dom.exportH.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                state.efRect.h *= ratio;
            }
            dom.exportH.value = val;
            dom.exportH.dataset.prev = val;
        }
        clampFrameToCanvas();
        updateExportFrameDOM();
    });

    dom.exportW.addEventListener('input', () => {
        let val = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) dom.exportH.value = Math.round(val / state.targetRatio);
    });
    dom.exportH.addEventListener('input', () => {
        let val = parseInt(dom.exportH.value) || 50;
        if (state.aspectLocked) dom.exportW.value = Math.round(val * state.targetRatio);
    });
}

function setupExportFormatButtons() {
    dom.exportImageBtn.onclick = () => {
        dom.exportImageBtn.classList.add('active');
        dom.exportEmbedBtn.classList.remove('active');
        dom.imageExportWrap.classList.add('visible');
        dom.embedCodeWrap.classList.remove('visible');
    };

    dom.exportEmbedBtn.onclick = async () => {
        dom.exportImageBtn.classList.remove('active');
        dom.exportEmbedBtn.classList.add('active');
        dom.imageExportWrap.classList.remove('visible');
        dom.embedCodeWrap.classList.add('visible');
        await generateEmbedCode();
    };

    dom.copyEmbedBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(dom.embedCode.value);
            toast('Copied to clipboard');
        } catch (err) {
            console.error('Failed to copy: ', err);
            toast('Failed to copy');
        }
    };

    dom.fmtPdfBtn.onclick = exportToPDF;
    dom.fmtSvgBtn.onclick = exportToSVG;
    dom.fmtPngBtn.onclick = exportToPNG;
}

function setupExportFrameDragging() {
    function simulateMouseEvent(e) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        if (e.type === 'touchmove' && e.touches.length > 1) return;
        const t = e.touches[0] || e.changedTouches[0];
        if (!t) return;
        const type = {
            touchstart: 'mousedown',
            touchmove: 'mousemove',
            touchend: 'mouseup'
        } [e.type];
        if (!type) return;
        const evt = new MouseEvent(type, {
            clientX: t.clientX,
            clientY: t.clientY,
            bubbles: true,
            cancelable: true
        });
        e.target.dispatchEvent(evt);
        e.preventDefault();
    }

    dom.exportOverlay.addEventListener('touchstart', simulateMouseEvent, {
        passive: false
    });
    dom.exportOverlay.addEventListener('touchmove', simulateMouseEvent, {
        passive: false
    });
    dom.exportOverlay.addEventListener('touchend', simulateMouseEvent, {
        passive: false
    });

    dom.exportFrame.addEventListener('mousedown', e => {
        const h = e.target.dataset.h;
        if (h) state.efDrag = {
            mode: h,
            mx: e.clientX,
            my: e.clientY,
            x: state.efRect.x,
            y: state.efRect.y,
            w: state.efRect.w,
            h: state.efRect.h,
            exportW: parseInt(dom.exportW.value),
            exportH: parseInt(dom.exportH.value)
        };
        else state.efDrag = {
            mode: 'move',
            mx: e.clientX,
            my: e.clientY,
            x: state.efRect.x,
            y: state.efRect.y,
            exportW: parseInt(dom.exportW.value),
            exportH: parseInt(dom.exportH.value)
        };
        e.preventDefault();
        e.stopPropagation();
    });

    dom.exportBackdrop.addEventListener('mousedown', e => {
        state.efDrag = {
            mode: 'draw',
            mx: e.clientX,
            my: e.clientY,
            startX: e.clientX,
            startY: e.clientY,
            prevRect: {
                ...state.efRect
            },
            exportW: parseInt(dom.exportW.value),
            exportH: parseInt(dom.exportH.value)
        };
        state.efRect.x = e.clientX;
        state.efRect.y = e.clientY;
        state.efRect.w = 0;
        state.efRect.h = 0;
        updateExportFrameDOM();
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('mousemove', e => {
        if (!state.efDrag) return;
        const dx = e.clientX - state.efDrag.mx,
            dy = e.clientY - state.efDrag.my;
        const cr = dom.cvs.getBoundingClientRect();
        if (state.efDrag.mode === 'move') {
            state.efRect.x = state.efDrag.x + dx;
            state.efRect.y = state.efDrag.y + dy;
            if (state.efRect.w <= cr.width) {
                const maxX = cr.left + cr.width - state.efRect.w;
                if (state.efRect.x < cr.left) {
                    state.efDrag.x = cr.left - dx;
                    state.efRect.x = cr.left;
                } else if (state.efRect.x > maxX) {
                    state.efDrag.x = maxX - dx;
                    state.efRect.x = maxX;
                }
            } else {
                state.efDrag.x = cr.left - dx;
                state.efRect.x = cr.left;
            }
            if (state.efRect.h <= cr.height) {
                const maxY = cr.top + cr.height - state.efRect.h;
                if (state.efRect.y < cr.top) {
                    state.efDrag.y = cr.top - dy;
                    state.efRect.y = cr.top;
                } else if (state.efRect.y > maxY) {
                    state.efDrag.y = maxY - dy;
                    state.efRect.y = maxY;
                }
            } else {
                state.efDrag.y = cr.top - dy;
                state.efRect.y = cr.top;
            }
        } else if (state.efDrag.mode === 'draw') {
            let rawW = Math.abs(e.clientX - state.efDrag.startX),
                rawH = Math.abs(e.clientY - state.efDrag.startY);
            let startX = Math.min(state.efDrag.startX, e.clientX),
                startY = Math.min(state.efDrag.startY, e.clientY);
            if (state.aspectLocked) {
                if (rawW / rawH > state.targetRatio) rawW = rawH * state.targetRatio;
                else rawH = rawW / state.targetRatio;
            }
            state.efRect.x = (e.clientX < state.efDrag.startX) ? state.efDrag.startX - rawW : startX;
            state.efRect.y = (e.clientY < state.efDrag.startY) ? state.efDrag.startY - rawH : startY;
            state.efRect.w = rawW;
            state.efRect.h = rawH;
            dom.exportW.value = Math.round(state.efRect.w);
            dom.exportH.value = Math.round(state.efRect.h);
            updateExportFrameDOM();
            return;
        } else {
            let {
                x,
                y,
                w,
                h
            } = state.efDrag, newW = w, newH = h;
            if (state.efDrag.mode.includes('r')) newW = state.efDrag.w + dx;
            if (state.efDrag.mode.includes('l')) {
                newW = state.efDrag.w - dx;
                x = state.efDrag.x + dx;
            }
            if (state.efDrag.mode.includes('b')) newH = state.efDrag.h + dy;
            if (state.efDrag.mode.includes('t')) {
                newH = state.efDrag.h - dy;
                y = state.efDrag.y + dy;
            }
            if (state.aspectLocked) {
                let scale = Math.max(newW / state.efDrag.w, newH / state.efDrag.h);
                scale = Math.max(0.1, scale);
                newW = state.efDrag.w * scale;
                newH = state.efDrag.h * scale;
                if (state.efDrag.mode.includes('l')) x = state.efDrag.x + (state.efDrag.w - newW);
                if (state.efDrag.mode.includes('t')) y = state.efDrag.y + (state.efDrag.h - newH);
            }
            if (newW < 50) {
                newW = 50;
                if (state.efDrag.mode.includes('l')) x = state.efDrag.x + state.efDrag.w - 50;
                if (state.aspectLocked) newH = newW / state.targetRatio;
            }
            if (newH < 50) {
                newH = 50;
                if (state.efDrag.mode.includes('t')) y = state.efDrag.y + state.efDrag.h - 50;
                if (state.aspectLocked) newW = newH * state.targetRatio;
            }
            state.efRect.x = x;
            state.efRect.y = y;
            state.efRect.w = newW;
            state.efRect.h = newH;
            dom.exportW.value = Math.round(state.efRect.w);
            dom.exportH.value = Math.round(state.efRect.h);
            clampFrameToCanvas();
        }
        updateExportFrameDOM();
    });

    window.addEventListener('mouseup', () => {
        if (state.efDrag && state.efDrag.mode === 'draw' && (state.efRect.w < 50 || state.efRect.h < 50)) closeExportOverlay();
        state.efDrag = null;
        requestRender();
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EXPORT FORMAT HANDLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getExportParams() {
    const cr = dom.cvs.getBoundingClientRect(),
        fx = state.efRect.x - cr.left,
        fy = state.efRect.y - cr.top;

    const targetLong = parseInt(dom.exportSide.value) || 1920,
        currentLong = Math.max(state.efRect.w, state.efRect.h),
        scale = targetLong / currentLong;

    const eW = Math.round(state.efRect.w * scale),
        eH = Math.round(state.efRect.h * scale),
        eZoom = state.zoom * scale,
        ePanX = (state.panX - fx) * scale,
        ePanY = (state.panY - fy) * scale;

    const expStarPans = {
        x5: (state.starPanX5 - fx) * scale,
        y5: (state.starPanY5 - fy) * scale,
        x2: (state.starPanX2 - fx) * scale,
        y2: (state.starPanY2 - fy) * scale,
        x3: (state.starPanX3 - fx) * scale,
        y3: (state.starPanY3 - fy) * scale
    };

    return {
        fx,
        fy,
        scale,
        eW,
        eH,
        eZoom,
        ePanX,
        ePanY,
        expStarPans
    };
}

async function exportToPDF() {
    const {
        jsPDF
    } = await import('jspdf');
    await import('svg2pdf.js');

    const params = getExportParams();
    const svgString = buildExportSVG(params);
    const parser = new DOMParser(),
        svgDoc = parser.parseFromString(svgString, "image/svg+xml"),
        svgElement = svgDoc.documentElement;

    const orientation = params.eW > params.eH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
        orientation,
        unit: 'px',
        format: [params.eW, params.eH],
        compress: true
    });
    await pdf.svg(svgElement, {
        x: 0,
        y: 0,
        width: params.eW,
        height: params.eH
    });
    pdf.save('hex-tiles-export.pdf');
    toast('Scene exported as PDF');
}

function exportToSVG() {
    const params = getExportParams();
    const svg = buildExportSVG(params);
    const blob = new Blob([svg], {
            type: 'image/svg+xml'
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
    a.href = url;
    a.download = 'hex-tiles-export.svg';
    a.click();
    URL.revokeObjectURL(url);
    toast('Scene exported as SVG');
}

async function exportToPNG() {
    const params = getExportParams();
    const off = document.createElement('canvas');
    renderToOffscreen(off, params);
    const blob = await canvasToBlob(off, 'image/png'),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
    a.href = url;
    a.download = 'hex-tiles-export.png';
    a.click();
    URL.revokeObjectURL(url);
    toast('Scene exported as PNG');
}

function encodeCurveCompact(curve) {
    const edges = curve.edges;
    if (edges.size === 0) return null;

    let startID = -1;
    for (const id of edges) {
        const [q, r, e] = decodeEdgeID(id);
        const k = (tileRot(q, r) / 60) % 6;
        const alter = isTileAlter(q, r);
        const pe = getOtherEdge(k, e, alter);
        const pid = edgeID(q, r, pe);

        if (!edges.has(pid)) {
            startID = id;
            break;
        }
    }

    // If no endpoint is found, it's a closed loop. Just pick the first edge.
    if (startID === -1) {
        startID = edges.values().next().value;
    }

    const [sq, sr, se] = decodeEdgeID(startID);
    // Return [startQ, startR, startEdge, totalEdges]
    return [sq, sr, se, edges.size];
}

async function generateEmbedCode() {
    const {
        fx,
        fy,
        scale,
        eW,
        eH,
        eZoom,
        ePanX,
        ePanY,
        expStarPans
    } = getExportParams();

    const r1 = n => Math.round(n * 10) / 10;
    const r4 = n => Math.round(n * 10000) / 10000;
    const r2 = n => Math.round(n * 100) / 100;

    const mainCenter = pixToHex(dom.cvs.width / 2, dom.cvs.height / 2, state.zoom, state.panX, state.panY);
    const targetHexSize = Math.round(HEX_R * eZoom);
    const maxAllowed = parseInt(dom.exportSide.value) || 1920;
    const rasterSize = Math.max(64, Math.min(targetHexSize, maxAllowed));

    // Convert markers to compact tuple arrays [x, y, color]
    const eMarkers = state.gradientMarkers.map(m => [
        r1((m.x - fx) * scale),
        r1((m.y - fy) * scale),
        m.color
    ]);

    const EMBED_BAKE_MARGIN = 0.5;
    const padW = eW * (1 + 2 * EMBED_BAKE_MARGIN);
    const padH = eH * (1 + 2 * EMBED_BAKE_MARGIN);
    const padPanX = ePanX + (padW - eW) / 2;
    const padPanY = ePanY + (padH - eH) / 2;
    const exportHexes = visibleHexes(eZoom, padPanX, padPanY, padW, padH);
    const exportHexesSet = new Set(exportHexes.map(h => hexKey(h.q, h.r)));

    const isBlazerZoom = state.zoom <= CONFIG.ZOOM_BLAZE_FADE_START;
    const serializeFlow = state.flowEnabled && isBlazerZoom && state.showBgStars;

    // 1. Extract Grid Bounds & Serialize Rotations
    let gridMinQ = 0,
        gridMinR = 0,
        gridRCount = 1;
    let serializedRots = [0, 0, 1, ""];
    let serializedCurves = [];
    let hasCurves = false;

    if (!serializeFlow) {
        if (exportHexes.length > 0) {
            let minQ = Infinity,
                maxQ = -Infinity,
                minR = Infinity,
                maxR = -Infinity;
            for (const h of exportHexes) {
                if (h.q < minQ) minQ = h.q;
                if (h.q > maxQ) maxQ = h.q;
                if (h.r < minR) minR = h.r;
                if (h.r > maxR) maxR = h.r;
            }

            const expMinQ = minQ - 1;
            const expMaxQ = maxQ + 1;
            const expMinR = minR - 1;
            const expMaxR = maxR + 1;

            gridMinQ = expMinQ;
            gridMinR = expMinR;
            gridRCount = expMaxR - expMinR + 1;

            let rotsStr = "";
            for (let q = expMinQ; q <= expMaxQ; q++) {
                for (let r = expMinR; r <= expMaxR; r++) {
                    const rot = tileRot(q, r);
                    const mult = Math.round(rot / 60) % 6;
                    rotsStr += mult;
                }
            }
            serializedRots = [expMinQ, expMinR, gridRCount, rotsStr];
        }

        // 2. Baking
        if (!state.texImg && state.curveColors.length > 1 && exportHexes.length > 0) {
            processExportCurves(getHexBounds(exportHexes), exportHexes);
        }

        // 3. Serialize Curves
        if (!state.texImg) {
            const visibleCurveIDs = new Set();
            for (const h of exportHexes) {
                for (let e = 0; e < 6; e++) {
                    const id = edgeID(h.q, h.r, e);
                    if (state.curveMap.has(id)) {
                        visibleCurveIDs.add(state.curveMap.get(id));
                    }
                }
            }

            let componentIDCounter = 0;
            for (const cid of visibleCurveIDs) {
                const curve = state.curves.get(cid);
                if (curve && curve.edges.size > 0) {
                    let colorIdx = 0;
                    if (typeof curve.color === 'number') {
                        colorIdx = curve.color % state.curveColors.length;
                    } else if (typeof curve.color === 'string') {
                        const lowerCol = curve.color.toLowerCase();
                        colorIdx = state.curveColors.findIndex(c => c.toLowerCase() === lowerCol);
                        if (colorIdx === -1) colorIdx = 0;
                    }

                    const filteredEdges = [];
                    for (const id of curve.edges) {
                        const [q, r, e] = decodeEdgeID(id);
                        const n = getNeighbor(q, r, e);
                        if (exportHexesSet.has(hexKey(q, r)) || exportHexesSet.has(hexKey(n.q, n.r))) {
                            filteredEdges.push(id);
                        }
                    }
                    if (filteredEdges.length === 0) continue;

                    const edgeSet = new Set(filteredEdges);
                    const visited = new Set();

                    for (const id of edgeSet) {
                        if (visited.has(id)) continue;
                        const comp = [];
                        const queue = [id];
                        visited.add(id);

                        while (queue.length > 0) {
                            const curr = queue.pop();
                            comp.push(curr);
                            const [q, r, e] = decodeEdgeID(curr);

                            const k = (tileRot(q, r) / 60) % 6;
                            const alter = isTileAlter(q, r);
                            const pe = getOtherEdge(k, e, alter);
                            const pid = edgeID(q, r, pe);
                            if (edgeSet.has(pid) && !visited.has(pid)) {
                                visited.add(pid);
                                queue.push(pid);
                            }

                            const n = getNeighbor(q, r, e);
                            const nk = (tileRot(n.q, n.r) / 60) % 6;
                            const nAlter = isTileAlter(n.q, n.r);
                            const npe = getOtherEdge(nk, n.edge, nAlter);
                            const npid = edgeID(n.q, n.r, npe);
                            if (edgeSet.has(npid) && !visited.has(npid)) {
                                visited.add(npid);
                                queue.push(npid);
                            }
                        }

                        const compSet = new Set(comp);
                        let startQ = 0,
                            startR = 0,
                            startE = 0;
                        let found = false;

                        for (const eid of compSet) {
                            const [q1, r1, e1] = decodeEdgeID(eid);
                            const n1 = getNeighbor(q1, r1, e1);

                            const k1 = (tileRot(q1, r1) / 60) % 6;
                            const alter1 = isTileAlter(q1, r1);
                            const pe1 = getOtherEdge(k1, e1, alter1);
                            const pid1 = edgeID(q1, r1, pe1);
                            const has1 = compSet.has(pid1);

                            const k2 = (tileRot(n1.q, n1.r) / 60) % 6;
                            const alter2 = isTileAlter(n1.q, n1.r);
                            const pe2 = getOtherEdge(k2, n1.edge, alter2);
                            const pid2 = edgeID(n1.q, n1.r, pe2);
                            const has2 = compSet.has(pid2);

                            if (!has1 || !has2) {
                                if (has2) {
                                    startQ = n1.q;
                                    startR = n1.r;
                                    startE = n1.edge;
                                } else {
                                    startQ = q1;
                                    startR = r1;
                                    startE = e1;
                                }
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            const firstEid = compSet.values().next().value;
                            const [q1, r1, e1] = decodeEdgeID(firstEid);
                            startQ = q1;
                            startR = r1;
                            startE = e1;
                        }

                        const startIdx = (startQ - gridMinQ) * gridRCount + (startR - gridMinR);
                        serializedCurves.push(startIdx, startE, compSet.size, colorIdx);
                    }
                }
            }
            hasCurves = serializedCurves.length > 0;
        }
    }

    const data = {
        w: eW,
        h: eH,
        zoom: r4(eZoom),
        panX: r1(ePanX),
        panY: r1(ePanY),
        origZoom: r4(state.zoom),
        flowEnabled: serializeFlow ? true : undefined,
        liveTwistsEnabled: !serializeFlow ? state.liveTwistsEnabled : undefined,
        showGrid: !serializeFlow ? state.showGrid : undefined,
        markersVisible: state.markersVisible,
        showBgStars: state.showBgStars,
        starPanX5: r1(expStarPans.x5),
        starPanY5: r1(expStarPans.y5),
        starPanX2: r1(expStarPans.x2),
        starPanY2: r1(expStarPans.y2),
        starPanX3: r1(expStarPans.x3),
        starPanY3: r1(expStarPans.y3),
        markers: eMarkers,
        curveColors: !serializeFlow ? [...state.curveColors] : undefined,
        rotOverrides: !serializeFlow ? serializedRots : undefined,
        rotMode: !serializeFlow ? state.rotMode : undefined,
        rotSeed: !serializeFlow ? state.rotSeed : undefined,
        randomSeed: !serializeFlow ? state.randomSeed : undefined,
        curves: (!serializeFlow && !state.texImg) ? serializedCurves : undefined,
        centerQ: (!serializeFlow && !hasCurves) ? mainCenter.q : undefined,
        centerR: (!serializeFlow && !hasCurves) ? mainCenter.r : undefined,
        curveLineWidth: !serializeFlow ? r2(state.curveLineWidth) : undefined,
        alterTilesRatio: !serializeFlow ? r2(state.alterTilesRatio) : undefined,
        texTf: (!serializeFlow && state.texImg) ? state.texTf : undefined,
        texBaseSize: (!serializeFlow && state.texImg) ? rasterSize : undefined,
        texture: (!serializeFlow && state.texImg) ? getTextureDataUrl(rasterSize) : undefined
    };

    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    let encoded;
    try {
        const jsonStr = JSON.stringify(data);
        console.log(jsonStr)
        if (typeof CompressionStream !== 'undefined') {
            const inputStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(jsonStr));
                    controller.close();
                }
            });
            const compressedStream = inputStream.pipeThrough(new CompressionStream('gzip'));
            const compressedBuffer = await new Response(compressedStream).arrayBuffer();
            const bytes = new Uint8Array(compressedBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } else {
            encoded = btoa(unescape(encodeURIComponent(jsonStr)));
        }
    } catch (e) {
        console.error('Embed compression error', e);
        toast('Too much data to encode');
        return;
    }

    const baseUrl = location.href.split('#')[0];
    dom.embedCode.value = `<iframe src="${baseUrl}#embed=${encoded}" frameborder="0" style="border:none;width:100%;height:100%;"></iframe>`;
    toast('Embed code generated');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OVERLAY & EXPORT FRAME UI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function openExportOverlay() {
    let safety = 10000;
    while (safety-- > 0 && state.queue.length > 0) processQueue();
    processEdgeRgbMap();

    const cr = dom.cvs.getBoundingClientRect(),
        fw = cr.width / 2,
        fh = cr.height / 2;
    state.targetRatio = fw / fh;
    state.efRect = {
        x: cr.left + (cr.width - fw) / 2,
        y: cr.top + (cr.height - fh) / 2,
        w: fw,
        h: fh
    };
    dom.exportOverlay.classList.add('active');

    state.sidebarWasCollapsed = document.body.classList.contains('sidebar-collapsed');
    if (!state.sidebarWasCollapsed) {
        dom.sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        dom.sidebarToggle.classList.add('collapsed');
    }
    document.body.classList.add('exporting');
    state.isExporting = true;
    state.panVX = 0;
    state.panVY = 0;

    dom.exportW.value = Math.round(fw);
    dom.exportH.value = Math.round(fh);
    state.aspectLocked = false;
    dom.aspectLockBtn.classList.remove('active');
    dom.exportFrame.classList.remove('locked-aspect');
    dom.exportImageBtn.classList.remove('active');
    dom.exportEmbedBtn.classList.remove('active');
    dom.imageExportWrap.classList.remove('visible');
    dom.embedCodeWrap.classList.remove('visible');
    dom.exportMenu.style.display = 'block';
    updateExportFrameDOM();
}

export function closeExportOverlay() {
    dom.exportOverlay.classList.remove('active');
    document.body.classList.remove('exporting');
    if (!state.sidebarWasCollapsed) {
        dom.sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
        dom.sidebarToggle.classList.remove('collapsed');
        dom.sidebar.style.pointerEvents = 'auto';
    }
    state.isExporting = false;
    dom.embedCodeWrap.classList.remove('visible');
    dom.imageExportWrap.classList.remove('visible');
}

function updateExportFrameDOM() {
    const f = dom.exportFrame;
    f.style.left = state.efRect.x + 'px';
    f.style.top = state.efRect.y + 'px';
    f.style.width = state.efRect.w + 'px';
    f.style.height = state.efRect.h + 'px';
    if (state.efRect.w < 50 || state.efRect.h < 50) {
        dom.exportMenu.style.display = 'none';
        return;
    }
    dom.exportMenu.style.display = 'block';
    const menuW = 280,
        menuH = 320;
    let mx = 0,
        my = 0,
        placed = false;

    if (state.efRect.x + state.efRect.w + 16 + menuW <= window.innerWidth - 16) {
        mx = state.efRect.x + state.efRect.w + 16;
        my = state.efRect.y;
        my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
        placed = true;
    }
    if (!placed && state.efRect.x - menuW - 16 >= 16) {
        mx = state.efRect.x - menuW - 16;
        my = state.efRect.y;
        my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
        placed = true;
    }
    if (!placed && state.efRect.y - menuH - 16 >= 16) {
        my = state.efRect.y - menuH - 16;
        mx = state.efRect.x + (state.efRect.w / 2) - (menuW / 2);
        mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
        placed = true;
    }
    if (!placed && state.efRect.y + state.efRect.h + 16 + menuH <= window.innerHeight - 16) {
        my = state.efRect.y + state.efRect.h + 16;
        mx = state.efRect.x + (state.efRect.w / 2) - (menuW / 2);
        mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
        placed = true;
    }
    if (!placed) {
        mx = state.efRect.x + 16;
        my = state.efRect.y + 16;
        mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
        my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
    }
    dom.exportMenu.style.left = mx + 'px';
    dom.exportMenu.style.top = my + 'px';
    const sideLabel = document.getElementById('exportSideLabel');
    if (sideLabel) sideLabel.textContent = state.efRect.w >= state.efRect.h ? 'Exported width (px)' : 'Exported height (px)';
}

function clampFrameToCanvas() {
    const cr = dom.cvs.getBoundingClientRect();
    state.efRect.x = Math.max(cr.left, Math.min(state.efRect.x, cr.left + cr.width - 80));
    state.efRect.y = Math.max(cr.top, Math.min(state.efRect.y, cr.top + cr.height - 80));
    state.efRect.w = Math.max(50, Math.min(state.efRect.w, cr.left + cr.width - state.efRect.x));
    state.efRect.h = Math.max(50, Math.min(state.efRect.h, cr.top + cr.height - state.efRect.y));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SVG EXPORT RENDERING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildExportSVG(params) {
    const {
        fx,
        fy,
        scale,
        eW,
        eH,
        eZoom,
        ePanX,
        ePanY,
        expStarPans
    } = params;
    const now = state.exportFreezeTime || Date.now();
    const exportHexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);
    const exportBounds = getHexBounds(exportHexes);
    processExportCurves(exportBounds, exportHexes);
    const eSz = HEX_R * eZoom;

    const eCurveAlpha = state.elementsFade;
    const eGridAlpha = eCurveAlpha;

    if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
        processExportCurves(exportBounds, exportHexes);
    }

    let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${eW}" height="${eH}" viewBox="0 0 ${eW} ${eH}" preserveAspectRatio="xMidYMid slice"><rect width="${eW}" height="${eH}" fill="${COLORS.bg}"/>`;

    svg += buildSvgGradient(eW, eH, scale, fx, fy);

    if (state.showBgStars) {
        svg += buildSvgStars(eW, eH, scale, fx, fy, eZoom, now, expStarPans);
    }

    svg += buildSvgCurvesAndGrid(exportHexes, eSz, eCurveAlpha, eGridAlpha);

    svg += `</svg>`;
    return svg;
}

function buildSvgGradient(eW, eH, scale, fx, fy) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return '';
    updateIDWGradientCanvas(eW, eH, scale, fx, fy, 0.5);
    const gradUrl = state.gradientCanvas.toDataURL('image/png');
    return `<image href="${gradUrl}" xlink:href="${gradUrl}" width="${eW}" height="${eH}" preserveAspectRatio="none"/>`;
}

function buildSvgStars(eW, eH, scale, fx, fy, eZoom, now, expStarPans) {
    let svg = '';
    const {
        x5: expStarPanX5,
        y5: expStarPanY5,
        x2: expStarPanX2,
        y2: expStarPanY2,
        x3: expStarPanX3,
        y3: expStarPanY3
    } = expStarPans;
    const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * scale;
    const spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * scale;
    const spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * scale;

    svg += addSvgStarLayer(spacing5, CONFIG.STAR_SIZE_LARGE, 1, expStarPanX5, expStarPanY5, eW, eH, scale, now, false, 1, 0, fx, fy);
    svg += addSvgStarLayer(spacing2, CONFIG.STAR_SIZE_MED, 2, expStarPanX2, expStarPanY2, eW, eH, scale, now, false, 1, 0, fx, fy);

    let l3Alpha = Math.max(0, Math.min(1, (CONFIG.ZOOM_BLAZE_FADE_START - (eZoom / scale)) / CONFIG.ZOOM_BLAZE_FADE_RANGE));
    if (l3Alpha > 0) {
        let canBlaze = state.zoomOutStartTime > 0 && (now - state.zoomOutStartTime) > CONFIG.STAR_BLAZE_DELAY;
        svg += addSvgStarLayer(spacing3, CONFIG.STAR_SIZE_SMALL, 3, expStarPanX3, expStarPanY3, eW, eH, scale, now, canBlaze, l3Alpha, state.zoomOutStartTime, fx, fy, 1.0);
    }
    return svg;
}

function addSvgStarLayer(spacing, size, seed, panX, panY, eW, eH, coordScale, now, allowBlazing, alphaMult, zoomOutTime, offsetX, offsetY, blazeFade = 1.0) {
    if (spacing < CONFIG.STAR_MIN_SPACING) return '';
    let svg = '';
    const kMin = Math.floor((0 - panX) / spacing) - 2,
        kMax = Math.ceil((eW - panX) / spacing) + 2;
    const jMin = Math.floor((0 - panY) / spacing) - 2,
        jMax = Math.ceil((eH - panY) / spacing) + 2;
    for (let k = kMin; k <= kMax; k++) {
        for (let j = jMin; j <= jMax; j++) {
            const gx = panX + k * spacing,
                gy = panY + j * spacing;
            const rx = (hash2D(k * seed + 123, j * seed + 456) - 0.5) * spacing;
            const ry = (hash2D(k * seed + 789, j * seed + 101) - 0.5) * spacing;
            const x = gx + rx,
                y = gy + ry;
            if (x < -spacing || x > eW + spacing || y < -spacing || y > eH + spacing) continue;
            const bg = getBackgroundColorAt(x, y, coordScale, offsetX, offsetY);
            if (!bg) continue;
            const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
            let t = (lum - CONFIG.STAR_LUM_MIN) / CONFIG.STAR_LUM_RANGE;
            t = Math.max(0, Math.min(1, t));
            t = t * t * (3 - 2 * t);
            let sR = Math.round(255 * (1 - t)),
                sA = (0.6 * (1 - t) + 0.5 * t) * alphaMult,
                r = Math.max(0.1, (size * coordScale) / 2);
            if (allowBlazing && zoomOutTime > 0) {
                const blazeState = getBlazeState(k, j, seed, now, zoomOutTime, blazeFade, sR, sA, r);
                if (blazeState) {
                    sR = blazeState.sR;
                    sA = blazeState.sA;
                    r = blazeState.size;

                    if (blazeState.blazeGlow > 0) {
                        const glowRadius = (180 + hash2D(k * seed + 777, j * seed + 888) * 120) * coordScale;
                        const steps = 90;
                        for (let s = steps; s > 0; s--) {
                            const stepT = s / steps,
                                stepR = glowRadius * stepT,
                                stepA = (0.05 * blazeState.blazeGlow) * Math.pow(1 - stepT, 1.5);
                            svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(150, 200, 255)" fill-opacity="${stepA.toFixed(3)}"/>`;
                        }
                        const steps2 = 45;
                        for (let s = steps2; s > 0; s--) {
                            const stepT = s / steps2,
                                stepR = glowRadius * 0.5 * stepT,
                                stepA = (0.1 * blazeState.blazeGlow) * Math.pow(1 - stepT, 1.5);
                            svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(255, 255, 240)" fill-opacity="${stepA.toFixed(3)}"/>`;
                        }
                    }
                }
            }
            const coreFill = `rgb(${sR},${sR},${sR})`;
            svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${coreFill}" fill-opacity="${sA.toFixed(3)}"/>`;
        }
    }
    return svg;
}


function buildSvgCurvesAndGrid(exportHexes, eSz, eCurveAlpha, eGridAlpha) {
    const ext = eSz > CONFIG.LOD_HIGH_SZ ? CONFIG.LOD_EXT_HIGH :
        (eSz > CONFIG.LOD_MED_HIGH_SZ ? CONFIG.LOD_EXT_MED_HIGH :
            (eSz > CONFIG.LOD_MED_LOW_SZ ? CONFIG.LOD_EXT_MED_LOW : CONFIG.LOD_EXT_LOW));

    const pathsByColor = {};
    const gridPaths = [];
    const curveColorCache = new Map();

    const pushPath = (color, pathData) => {
        if (!color) return;
        if (!pathsByColor[color]) pathsByColor[color] = [];
        pathsByColor[color].push(pathData);
    };

    function getCachedCurveColorStr(curveID) {
        let cached = curveColorCache.get(curveID);
        if (cached !== undefined) return cached;

        const rgb = getCurveRgb(curveID);
        if (!rgb) {
            curveColorCache.set(curveID, null);
            return null;
        }

        const colorStr = `rgb(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)})`;
        curveColorCache.set(curveID, colorStr);
        return colorStr;
    }

    function getSvgEdgeColor(q, r, e) {
        let curveID;
        if (state.curveColors.length === 1) {
            curveID = -2;
        } else {
            const id = edgeID(q, r, e);
            if (!state.curveMap.has(id)) return null;
            curveID = state.curveMap.get(id);
        }
        return getCachedCurveColorStr(curveID);
    }

    function arcToPath(tx, ty, rot, cx, cy, r, startAngle, endAngle, anticlockwise) {
        const rad = rot * Math.PI / 180.0,
            cos = Math.cos(rad),
            sin = Math.sin(rad);
        const p1x = cx + r * Math.cos(startAngle),
            p1y = cy + r * Math.sin(startAngle),
            p2x = cx + r * Math.cos(endAngle),
            p2y = cy + r * Math.sin(endAngle);
        const tx1 = tx + p1x * cos - p1y * sin,
            ty1 = ty + p1x * sin + p1y * cos,
            tx2 = tx + p2x * cos - p2y * sin,
            ty2 = ty + p2x * sin + p2y * cos;
        const sweep = anticlockwise ? 0 : 1,
            largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
        return `M ${tx1.toFixed(2)} ${ty1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweep} ${tx2.toFixed(2)} ${ty2.toFixed(2)}`;
    }

    // 1. Generate Curves (Skip entirely if texture is present)
    if (!state.texImg && eCurveAlpha > 0) {
        for (const h of exportHexes) {
            const rot = tileRot(h.q, h.r),
                k = (rot / 60) % 6,
                alter = isTileAlter(h.q, h.r);
            const rad = rot * Math.PI / 180.0,
                cos = Math.cos(rad),
                sin = Math.sin(rad);

            const a = eSz * SQRT3 / 2;
            if (alter) {
                pushPath(getSvgEdgeColor(h.q, h.r, (0 + k) % 6), arcToPath(h.x, h.y, rot, eSz / 2, a, eSz / 2, Math.PI - ext, 5 * PI_DIV_3 + ext, false));
                pushPath(getSvgEdgeColor(h.q, h.r, (2 + k) % 6), arcToPath(h.x, h.y, rot, -eSz, 0, eSz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false));
                pushPath(getSvgEdgeColor(h.q, h.r, (4 + k) % 6), arcToPath(h.x, h.y, rot, eSz / 2, -a, eSz / 2, PI_DIV_3 - ext, Math.PI + ext, false));
            } else {
                pushPath(getSvgEdgeColor(h.q, h.r, (2 + k) % 6), arcToPath(h.x, h.y, rot, -eSz, 0, eSz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false));
                pushPath(getSvgEdgeColor(h.q, h.r, (4 + k) % 6), arcToPath(h.x, h.y, rot, 1.5 * eSz, -a, 1.5 * eSz, TWO_PI_DIV_3 - ext, Math.PI + ext, false));
                pushPath(getSvgEdgeColor(h.q, h.r, (1 + k) % 6), arcToPath(h.x, h.y, rot, 1.5 * eSz, a, 1.5 * eSz, Math.PI - ext, FOUR_PI_DIV_3 + ext, false));
            }
        }
    }

    // 2. Generate Grid Paths (UNROTATED, matching Canvas2D behavior)
    if (state.showGrid) {
        for (const h of exportHexes) {
            let hexPath = "M ";
            for (let i = 0; i < 6; i++) {
                const ang = PI_DIV_3 * i;
                const vx = eSz * Math.cos(ang);
                const vy = eSz * Math.sin(ang);
                const tx_v = h.x + vx;
                const ty_v = h.y + vy;
                hexPath += `${tx_v.toFixed(2)} ${ty_v.toFixed(2)} `;
                if (i < 5) hexPath += "L ";
            }
            hexPath += "Z ";
            gridPaths.push(hexPath);
        }
    }

    let svg = '';

    // 3. Add Texture (Rasterized raw, clipped via SVG clipPath)
    if (state.texImg && eCurveAlpha > 0) {
        const {
            dataUrl,
            width,
            height
        } = rasterizeRawTexture(eSz);

        svg += `<defs>`;
        svg += `<image id="hexTexRaw" href="${dataUrl}" width="${width}" height="${height}" x="${-width / 2}" y="${-height / 2}"/>`;

        let hexClipPath = "M ";
        for (let i = 0; i < 6; i++) {
            const a = PI_DIV_3 * i;
            const vx = eSz * Math.cos(a);
            const vy = eSz * Math.sin(a);
            hexClipPath += `${vx.toFixed(2)} ${vy.toFixed(2)} `;
            if (i < 5) hexClipPath += "L ";
        }
        hexClipPath += "Z";
        svg += `<clipPath id="hexClip"><path d="${hexClipPath}"/></clipPath>`;
        svg += `</defs>`;

        const texOpacityAttr = eCurveAlpha < 0.999 ? ` opacity="${eCurveAlpha.toFixed(3)}"` : '';
        svg += `<g${texOpacityAttr}>`;

        // Draw each hex: translate to center, apply unrotated clip, then rotate the raw texture inside
        for (const h of exportHexes) {
            const rot = tileRot(h.q, h.r);
            svg += `<g transform="translate(${h.x.toFixed(2)}, ${h.y.toFixed(2)})" clip-path="url(#hexClip)">`;
            svg += `<use href="#hexTexRaw" transform="rotate(${rot})"/>`;
            svg += `</g>`;
        }
        svg += `</g>`;
    }

    // 4. Add Curves
    const lw = (eSz / 3 * state.curveLineWidth).toFixed(2);
    const curveOpacityAttr = eCurveAlpha < 0.999 ? ` stroke-opacity="${eCurveAlpha.toFixed(3)}"` : '';
    for (const color in pathsByColor) {
        svg += `<path d="${pathsByColor[color].join(' ')}" stroke="${color}" stroke-width="${lw}" fill="none" stroke-linecap="butt"${curveOpacityAttr}/>`;
    }

    // 5. Add Grid
    const gridOpacityAttr = eGridAlpha < 0.999 ? ` stroke-opacity="${eGridAlpha.toFixed(3)}"` : '';
    if (state.showGrid && eGridAlpha > 0 && gridPaths.length > 0) {
        svg += `<path d="${gridPaths.join(' ')}" stroke="${COLORS.gridLine}" stroke-width="1" fill="none" stroke-linecap="butt"${gridOpacityAttr}/>`;
    }

    return svg;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OFFSCREEN RENDERING (PNG)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function renderToOffscreen(offCanvas, params) {
    const {
        fx,
        fy,
        scale,
        eW,
        eH,
        eZoom,
        ePanX,
        ePanY,
        expStarPans
    } = params;
    const offCtx = offCanvas.getContext('2d');
    const eSz = HEX_R * eZoom;

    offCanvas.width = eW;
    offCanvas.height = eH;

    const eCurveAlpha = state.elementsFade;
    const eGridAlpha = eCurveAlpha;

    const hexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);
    const centerHex = pixToHex(eW / 2, eH / 2, eZoom, ePanX, ePanY);
    hexes.sort((a, b) => hexDistance(a.q, a.r, centerHex.q, centerHex.r) - hexDistance(b.q, b.r, centerHex.q, centerHex.r));
    const exportBounds = getHexBounds(hexes);

    if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
        processExportCurves(exportBounds, hexes);
    }

    const oldCtx = state.ctx;
    state.ctx = offCtx;
    const now = state.exportFreezeTime || Date.now();

    drawOffscreenBackground(offCtx, eW, eH, scale, fx, fy, now, eZoom, expStarPans);
    drawOffscreenHexTiles(offCtx, hexes, eSz, now, eCurveAlpha, eGridAlpha);

    state.ctx = oldCtx;
    return offCanvas;
}

function drawOffscreenBackground(offCtx, eW, eH, scale, fx, fy, now, eZoom, expStarPans) {
    offCtx.fillStyle = COLORS.bg;
    offCtx.fillRect(0, 0, eW, eH);
    drawIDWGradient(eW, eH, scale, fx, fy);

    const oldCtx = state.ctx;
    state.ctx = offCtx;
    const {
        x5,
        y5,
        x2,
        y2,
        x3,
        y3
    } = expStarPans;
    drawBackgroundStars(eW, eH, scale, x5, y5, x2, y2, x3, y3, now, eZoom / scale, state.zoomOutStartTime, fx, fy);
    state.ctx = oldCtx;
}

function drawOffscreenHexTiles(offCtx, hexes, eSz, now, eCurveAlpha, eGridAlpha) {
    const oldCtx = state.ctx;
    state.ctx = offCtx;
    for (const h of hexes) {
        const rot = tileRot(h.q, h.r);
        drawTile(h.x, h.y, eSz, rot, false, state.texImg, state.texTf, h.q, h.r, now, eCurveAlpha, 0.0);
    }
    if (state.showGrid && eGridAlpha > 0.01) {
        traceHexGridBatch(offCtx, hexes, eSz);
        offCtx.globalAlpha = eGridAlpha;
        offCtx.strokeStyle = COLORS.gridLine;
        offCtx.lineWidth = 1;
        offCtx.stroke();
        offCtx.globalAlpha = 1.0;
    }
    state.ctx = oldCtx;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SHARED EXPORT UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getHexBounds(hexes) {
    let bounds = {
        minQ: Infinity,
        maxQ: -Infinity,
        minR: Infinity,
        maxR: -Infinity
    };
    for (const h of hexes) {
        if (h.q < bounds.minQ) bounds.minQ = h.q;
        if (h.q > bounds.maxQ) bounds.maxQ = h.q;
        if (h.r < bounds.minR) bounds.minR = h.r;
        if (h.r > bounds.maxR) bounds.maxR = h.r;
    }
    return bounds;
}

function processExportCurves(exportBounds, exportHexes) {
    let safety = 2000;
    while (safety-- > 0) {
        processQueue(exportBounds, false);
        if (state.queue.length === 0) {
            if (!findUncoloredTileInHexes(exportHexes)) break;
        }
    }
}

function processEdgeRgbMap() {
    for (const [id, edgeData] of state.edgeRgbMap.entries()) {
        let targetCurveID = -1,
            targetRgb = null;
        if (state.curveColors.length === 1) {
            targetCurveID = -2;
            targetRgb = getCurveRgb(-2);
        } else if (state.curveMap.has(id)) {
            targetCurveID = state.curveMap.get(id);
            targetRgb = getCurveRgb(targetCurveID);
        }
        if (targetRgb) {
            if (!edgeData) state.edgeRgbMap.set(id, {
                rgb: [targetRgb.r, targetRgb.g, targetRgb.b],
                alpha: 1,
                targetCurveID,
                rippleTime: 0,
                rippleQ: 0,
                rippleR: 0,
                rippleActive: false,
                colorStr: ''
            });
            else {
                edgeData.rgb[0] = targetRgb.r;
                edgeData.rgb[1] = targetRgb.g;
                edgeData.rgb[2] = targetRgb.b;
                edgeData.alpha = 1.0;
                edgeData.targetCurveID = targetCurveID;
                edgeData.rippleActive = false;
                edgeData.colorStr = '';
            }
        } else state.edgeRgbMap.delete(id);
    }
}

function canvasToBlob(canvas, type) {
    return new Promise(resolve => canvas.toBlob(resolve, type));
}

function rasterizeTexture(baseHexSize, options = {}) {
    const {
        clipToHex = false, maxDim = 4096, preferWebP = false
    } = options;
    if (!state.texImg) return {
        dataUrl: null,
        width: 0,
        height: 0
    };

    const iSz = baseHexSize * 2.6;
    let targetSize = Math.ceil(iSz);

    let drawScale = 1;
    if (targetSize > maxDim) {
        drawScale = maxDim / targetSize;
    }

    const W = Math.ceil(targetSize * drawScale);
    const H = W; // Force square canvas

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(drawScale, drawScale);

    // Apply hexagonal clip if requested (used for Embed mode)
    if (clipToHex) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = CONFIG.PI_DIV_3 * i;
            const vx = baseHexSize * Math.cos(a);
            const vy = baseHexSize * Math.sin(a);
            if (i === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.clip();
    }

    // Apply texture transform
    const tf = state.texTf;

    // FIX: The texture offsets (ox, oy) are defined in the reference coordinate system 
    // where the hex radius is 88. We must scale them to match the current baseHexSize.
    const sizeScale = baseHexSize / 88;

    ctx.rotate(tf.rot * CONFIG.DEG2RAD);
    ctx.scale(tf.sx * tf.scale, tf.sy * tf.scale);
    ctx.translate(tf.ox * sizeScale, tf.oy * sizeScale);

    ctx.drawImage(state.texImg, -iSz / 2, -iSz / 2, iSz, iSz);
    ctx.restore();

    // Generate Data URL with optional WebP fallback
    let dataUrl;
    if (preferWebP) {
        let url = c.toDataURL('image/webp', 0.8);
        if (url.startsWith('data:image/webp') && url.length < 1500000) {
            dataUrl = url;
        } else {
            dataUrl = c.toDataURL('image/png');
        }
    } else {
        dataUrl = c.toDataURL('image/png');
    }

    return {
        dataUrl,
        width: W,
        height: H
    };
}

function rasterizeRawTexture(eSz) {
    return rasterizeTexture(eSz, {
        clipToHex: false,
        maxDim: 4096,
        preferWebP: false
    });
}

function getTextureDataUrl(rasterSize) {
    try {
        const {
            dataUrl
        } = rasterizeTexture(rasterSize, {
            clipToHex: true,
            maxDim: Infinity,
            preferWebP: true
        });
        return dataUrl;
    } catch (e) {
        return null;
    }
}

export function getScreenSVG() {
    const eW = dom.cvs.width;
    const eH = dom.cvs.height;
    const params = {
        fx: 0,
        fy: 0,
        scale: 1,
        eW,
        eH,
        eZoom: state.zoom,
        ePanX: state.panX,
        ePanY: state.panY,
        expStarPans: {
            x5: state.starPanX5,
            y5: state.starPanY5,
            x2: state.starPanX2,
            y2: state.starPanY2,
            x3: state.starPanX3,
            y3: state.starPanY3
        }
    };

    return buildExportSVG(params);
}
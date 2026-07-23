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
    hexKey,
    tileRot,
    displayRot,
    traceHexPath,
    traceHexGrid,
    traceHexGridBatch,
    visibleHexes,
    hash2D,
    isTileAlter,
    getBlazeState
} from './math.js';
import {
    processQueue,
    findUncoloredTileInHexes,
    edgeID,
    decodeEdgeID,
    getBackgroundColorAt,
    initializeCentralTile,
    getCurveRgb
} from './curves.js';
import {
    renderGradientList,
    renderCurveList
} from './ui.js';
import {
    getRandomMarkerPosition,
    applyPanDelta
} from './events.js';
import {
    initGradientGL,
    renderGradientGL
} from './gradientGL.js';

const hasGL = initGradientGL();

state.ctx = dom.cvs.getContext('2d');

const HEX_R = CONFIG.HEX_R;
const SQRT3 = CONFIG.SQRT3;
const PI_DIV_3 = CONFIG.PI_DIV_3;
const TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3;
const FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;

export function requestRender() {
    if (state.isPausedHidden) return;
    if (!state.isRenderScheduled) {
        state.isRenderScheduled = true;
        requestAnimationFrame(() => {
            state.isRenderScheduled = false;
            render();
        });
    }
}

export function resize() {
    state.isGradientDirty = true;

    if (state.isEmbedMode) {
        const w = dom.wrap.clientWidth || window.innerWidth;
        const h = dom.wrap.clientHeight || window.innerHeight;

        if (state.isInitialized && state.embedPrevW > 0 && state.embedPrevH > 0) {
            const dx = (w - state.embedPrevW) / 2;
            const dy = (h - state.embedPrevH) / 2;
            if (dx !== 0 || dy !== 0) {
                applyPanDelta(dx, dy, false);
                for (let i = 0; i < state.gradientMarkers.length; i++) {
                    state.gradientMarkers[i].x += dx;
                    state.gradientMarkers[i].y += dy;
                }
                state.updateGradientMarkersCache();
            }
        }
        state.embedPrevW = w;
        state.embedPrevH = h;
        dom.cvs.width = w;
        dom.cvs.height = h;

        if (!state.isInitialized) {
            state.isInitialized = true;
            if (state.gradientMarkers.length === 0) {
                const pos = getRandomMarkerPosition();
                state.gradientMarkers.push({ x: pos.x, y: pos.y, color: '#cccccc' });
                state.updateGradientMarkersCache();
                renderGradientList();
                renderCurveList();
            }
            initializeCentralTile();
        }
        requestRender();
        return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    dom.cvs.width = w;
    dom.cvs.height = h;

    if (!state.isInitialized) {
        if (w > 0 && h > 0) {
            const isCollapsed = document.body.classList.contains('sidebar-collapsed');
            const effectiveW = isCollapsed ? w : Math.max(0, w - CONFIG.SIDEBAR_WIDTH);
            state.panX = effectiveW / 2;
            state.panY = h / 2;

            state.starPanX2 = state.panX;
            state.starPanY2 = state.panY;
            state.starPanX3 = state.panX;
            state.starPanY3 = state.panY;
            state.starPanX5 = state.panX;
            state.starPanY5 = state.panY;

            state.starZoom2 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_MED);
            state.starZoom3 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
            state.starZoom5 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_LARGE);

            state.isInitialized = true;

            if (state.gradientMarkers.length === 0) {
                const pos = getRandomMarkerPosition();
                state.gradientMarkers.push({ x: pos.x, y: pos.y, color: '#cccccc' });
                state.updateGradientMarkersCache();
                renderGradientList();
                renderCurveList();
            }
            initializeCentralTile();
        } else {
            requestAnimationFrame(resize);
        }
    }
}

export function checkIfSolved() {
    function performSolvedCheck() {
        if (state.curveColors.length <= 1) return;
        if (state.zoom <= CONFIG.ZOOM_FADE_MID) {
            window.dispatchEvent(new CustomEvent('hexCurveSolved', {
                detail: {
                    solved: false
                }
            }));
            try {
                if (state.isEmbedMode) window.parent.postMessage({
                    type: 'HEX_CURVE_SOLVED',
                    solved: false
                }, '*');
            } catch (e) {}
            return;
        }

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const effectiveW = (isCollapsed || state.isEmbedMode) ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
        const H = dom.cvs.height;
        const hexes = visibleHexes(state.zoom, state.panX, state.panY, dom.cvs.width, H);
        if (hexes.length === 0) return;

        const apothem = (HEX_R * state.zoom * SQRT3) / 2;
        const visibleEdges = new Set();
        for (const h of hexes) {
            if (h.x >= apothem && h.x <= effectiveW - apothem && h.y >= apothem && h.y <= H - apothem) {
                for (let e = 0; e < 6; e++) visibleEdges.add(edgeID(h.q, h.r, e));
            }
        }

        let totalColored = 0,
            maxColorCount = 0;
        const colorCounts = {};
        for (const id of visibleEdges) {
            if (state.curveMap.has(id)) {
                const curve = state.curves.get(state.curveMap.get(id));
                if (curve) {
                    let c = curve.color;
                    if (typeof c === 'number') c = state.curveColors[c % state.curveColors.length];
                    c = c.toLowerCase();
                    totalColored++;
                    colorCounts[c] = (colorCounts[c] || 0) + 1;
                    if (colorCounts[c] > maxColorCount) maxColorCount = colorCounts[c];
                }
            }
        }

        let isSolved = false;
        if (totalColored >= visibleEdges.size * 0.85 && totalColored > 0) {
            isSolved = (maxColorCount / totalColored) >= 0.98;
        }

        window.dispatchEvent(new CustomEvent('hexCurveSolved', {
            detail: {
                solved: isSolved
            }
        }));
        try {
            if (state.isEmbedMode) window.parent.postMessage({
                type: 'HEX_CURVE_SOLVED',
                solved: isSolved
            }, '*');
        } catch (e) {}
    }

    if (state.solvedCheckTimeout) return;
    state.solvedCheckTimeout = setTimeout(() => {
        state.solvedCheckTimeout = null;
        performSolvedCheck();
    }, CONFIG.STATS_UPDATE_INTERVAL);
}

export function drawBackgroundStars(W, H, coordScale, dPanX5, dPanY5, dPanX2, dPanY2, dPanX3, dPanY3, now, currentZoom, zoomOutTime, offsetX = 0, offsetY = 0) {
    const starVisualScale = state.isEmbedMode ?
        (state.zoom / (state.embedData.origZoom || state.zoom)) :
        coordScale;

    const effectiveZoom = state.isEmbedMode ? (state.embedData.origZoom || state.zoom) : currentZoom;

    function drawDotLayer(W, H, spacing, size, seed, coordScale, panX, panY, now, allowBlazing, alphaMult, zoomOutTime, offsetX = 0, offsetY = 0, blazeFade = 1.0) {
        if (spacing < CONFIG.STAR_MIN_SPACING) return;
        const kMin = Math.floor((0 - panX) / spacing) - 2;
        const kMax = Math.ceil((W - panX) / spacing) + 2;
        const jMin = Math.floor((0 - panY) / spacing) - 2;
        const jMax = Math.ceil((H - panY) / spacing) + 2;
        for (let k = kMin; k <= kMax; k++) {
            for (let j = jMin; j <= jMax; j++) {
                const gx = panX + k * spacing;
                const gy = panY + j * spacing;
                const rx = (hash2D(k * seed + 123, j * seed + 456) - 0.5) * spacing;
                const ry = (hash2D(k * seed + 789, j * seed + 101) - 0.5) * spacing;
                const x = gx + rx;
                const y = gy + ry;
                if (x < -spacing || x > W + spacing || y < -spacing || y > H + spacing) continue;
                const bg = getBackgroundColorAt(x, y, coordScale, offsetX, offsetY);
                if (!bg) continue;
                const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
                let t = (lum - CONFIG.STAR_LUM_MIN) / CONFIG.STAR_LUM_RANGE;
                t = Math.max(0, Math.min(1, t));
                t = t * t * (3 - 2 * t);
                let sR = Math.round(255 * (1 - t));
                let sA = (0.6 * (1 - t) + 0.5 * t) * alphaMult;

                let drawSize = (size * starVisualScale) / 2;
                if (allowBlazing && zoomOutTime > 0) {
                    const blazeState = getBlazeState(k, j, seed, now, zoomOutTime, blazeFade, sR, sA, drawSize);
                    if (blazeState) {
                        sR = blazeState.sR;
                        sA = blazeState.sA;
                        drawSize = blazeState.size;

                        if (blazeState.blazeGlow > 0) {
                            const glowRadius = (180 + hash2D(k * seed + 777, j * seed + 888) * 120) * starVisualScale;
                            const glow = state.ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
                            glow.addColorStop(0, `rgba(255, 255, 240, ${0.4 * blazeState.blazeGlow})`);
                            glow.addColorStop(0.4, `rgba(150, 200, 255, ${0.2 * blazeState.blazeGlow})`);
                            glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                            state.ctx.save();
                            state.ctx.globalCompositeOperation = 'lighter';
                            state.ctx.fillStyle = glow;
                            state.ctx.beginPath();
                            state.ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
                            state.ctx.fill();
                            state.ctx.restore();
                        }
                    }
                }
                let fillKey = `${sR},${sA.toFixed(3)}`;
                let fillStyle = state.starColorCache.get(fillKey);
                if (!fillStyle) {
                    fillStyle = `rgba(${sR},${sR},${sR},${sA.toFixed(3)})`;
                    state.starColorCache.set(fillKey, fillStyle);
                }
                state.ctx.fillStyle = fillStyle;
                state.ctx.beginPath();
                state.ctx.arc(x, y, drawSize, 0, Math.PI * 2);
                state.ctx.fill();
            }
        }
    }

    if (!state.showBgStars) return;
    state.ctx.save();

    const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * starVisualScale;
    drawDotLayer(W, H, spacing5, CONFIG.STAR_SIZE_LARGE, 1, coordScale, dPanX5, dPanY5, now, false, 1, 0, offsetX, offsetY);

    const spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * starVisualScale;
    drawDotLayer(W, H, spacing2, CONFIG.STAR_SIZE_MED, 2, coordScale, dPanX2, dPanY2, now, false, 1, 0, offsetX, offsetY);

    let layer3Alpha = 0,
        canBlaze = false,
        blazeFade = 1.0;

    if (effectiveZoom < CONFIG.ZOOM_BLAZE_FADE_START + 0.001) {
        layer3Alpha = Math.max(0, Math.min(1, (CONFIG.ZOOM_BLAZE_FADE_START - effectiveZoom) / CONFIG.ZOOM_BLAZE_FADE_RANGE));
        if (layer3Alpha > 0 && zoomOutTime > 0 && (now - zoomOutTime) > CONFIG.STAR_BLAZE_DELAY) {
            canBlaze = true;
            const fadeInDur = 3000;
            let fadeT = (now - zoomOutTime - CONFIG.STAR_BLAZE_DELAY) / fadeInDur;
            blazeFade = Math.max(0, Math.min(1, fadeT));
            blazeFade = blazeFade * blazeFade * (3 - 2 * blazeFade);
        }
    }

    if (layer3Alpha > 0) {
        const spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * starVisualScale;
        drawDotLayer(W, H, spacing3, CONFIG.STAR_SIZE_SMALL, 3, coordScale, dPanX3, dPanY3, now, canBlaze, layer3Alpha, zoomOutTime, offsetX, offsetY, blazeFade);
    }
    state.ctx.restore();
}

export function updateIDWGradientCanvas(W, H, coordScale = 1, offsetX = 0, offsetY = 0, qualityScale = 0.2) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return;
    const lowW = Math.max(2, Math.ceil(W * qualityScale));
    const lowH = Math.max(2, Math.ceil(H * qualityScale));

    if (!state.gradientCanvas) state.gradientCanvas = document.createElement('canvas');
    if (state.gradientCanvas.width !== lowW || state.gradientCanvas.height !== lowH) {
        state.gradientCanvas.width = lowW;
        state.gradientCanvas.height = lowH;
    }
    const gctx = state.gradientCanvas.getContext('2d');
    const imgData = gctx.createImageData(lowW, lowH);
    const data = imgData.data;

    const bgR = parseInt(COLORS.bg.slice(1, 3), 16);
    const bgG = parseInt(COLORS.bg.slice(3, 5), 16);
    const bgB = parseInt(COLORS.bg.slice(5, 7), 16);

    let avgR = 0,
        avgG = 0,
        avgB = 0,
        avgW = 0;
    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        const w = m.weight !== undefined ? m.weight : 1;
        avgR += m.r * w;
        avgG += m.g * w;
        avgB += m.b * w;
        avgW += w;
    }
    if (avgW > 0) {
        avgR /= avgW;
        avgG /= avgW;
        avgB /= avgW;
    } else {
        avgR = bgR;
        avgG = bgG;
        avgB = bgB;
    }

    const allMarkers = [];
    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        const w = Math.max(0, Math.min(1, m.weight !== undefined ? m.weight : 1));
        allMarkers.push({
            x: (m.x - offsetX) * coordScale,
            y: (m.y - offsetY) * coordScale,
            r: m.r,
            g: m.g,
            b: m.b,
            weight: w
        });
    }
    for (let i = 0; i < state.fadingMarkersRGB.length; i++) {
        const m = state.fadingMarkersRGB[i];
        const w = Math.max(0, Math.min(1, m.weight !== undefined ? m.weight : 0));
        allMarkers.push({
            x: (m.x - offsetX) * coordScale,
            y: (m.y - offsetY) * coordScale,
            r: m.r,
            g: m.g,
            b: m.b,
            weight: w
        });
    }

    const n = allMarkers.length;
    if (n === 0) return;

    const mathScale = 0.5; 
    
    for (let py = 0; py < lowH; py++) {
        for (let px = 0; px < lowW; px++) {
            let totalWeight = 0,
                r = 0,
                g = 0,
                b = 0;
            for (let i = 0; i < n; i++) {
                const m = allMarkers[i];
                const dx = (px - (m.x * qualityScale)) * mathScale;
                const dy = (py - (m.y * qualityScale)) * mathScale;
                const distSq = dx * dx + dy * dy + 0.5;
                const weight = (1 / (distSq * distSq)) * m.weight;
                totalWeight += weight;
                r += m.r * weight;
                g += m.g * weight;
                b += m.b * weight;
            }
            const idx = (py * lowW + px) * 4;
            if (totalWeight > 0) {
                data[idx] = r / totalWeight;
                data[idx + 1] = g / totalWeight;
                data[idx + 2] = b / totalWeight;
                data[idx + 3] = 255;
            } else {
                data[idx] = bgR;
                data[idx + 1] = bgG;
                data[idx + 2] = bgB;
                data[idx + 3] = 255;
            }
        }
    }
    gctx.putImageData(imgData, 0, 0);
}

export function drawIDWGradient(W, H, coordScale = 1, offsetX = 0, offsetY = 0) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return;

    if (hasGL) {
        renderGradientGL(state.ctx, W, H, coordScale, offsetX, offsetY);
        return;
    }

    const targetLowW = Math.max(2, Math.ceil(W * 0.2));
    const targetLowH = Math.max(2, Math.ceil(H * 0.2));
    if (state.isGradientDirty || coordScale !== 1 || !state.gradientCanvas || state.gradientCanvas.width !== targetLowW || state.gradientCanvas.height !== targetLowH) {
        updateIDWGradientCanvas(W, H, coordScale, offsetX, offsetY);
        state.isGradientDirty = false;
    }
    state.ctx.imageSmoothingEnabled = true;
    state.ctx.imageSmoothingQuality = 'high';
    state.ctx.drawImage(state.gradientCanvas, 0, 0, state.gradientCanvas.width, state.gradientCanvas.height, 0, 0, W, H);
}

export function drawTile(cx, cy, sz, rot, grid, img, tf, hq, hr, now, curveAlpha = 1, gridAlpha = 1) {
    function applyCurveStyle(q, r, e, sz, now) {
        state.ctx.setLineDash([]);
        const id = edgeID(q, r, e);
        let targetRgb = null,
            targetCurveID = -1;
        if (state.curveColors.length === 1) {
            targetCurveID = -2;
            targetRgb = getCurveRgb(-2);
        } else if (state.curveMap.has(id)) {
            targetCurveID = state.curveMap.get(id);
            targetRgb = getCurveRgb(targetCurveID);
        }

        if (targetRgb) {
            let edgeData = state.edgeRgbMap.get(id);
            if (!edgeData) {
                edgeData = {
                    rgb: [targetRgb.r, targetRgb.g, targetRgb.b],
                    alpha: 1,
                    targetCurveID,
                    rippleTime: 0,
                    rippleQ: 0,
                    rippleR: 0,
                    rippleActive: false,
                    colorStr: ''
                };
                state.edgeRgbMap.set(id, edgeData);
            }
            if (state.isExporting) {
                edgeData.rgb[0] = targetRgb.r;
                edgeData.rgb[1] = targetRgb.g;
                edgeData.rgb[2] = targetRgb.b;
                edgeData.alpha = 1.0;
                edgeData.rippleActive = false;
                edgeData.colorStr = '';
            } else {
                if (state.previousUnassignedEdges.has(id)) {
                    edgeData.alpha = 0; // Reset width multiplier for smooth thickening
                    edgeData.rippleActive = true;
                    edgeData.rippleTime = 0;
                    edgeData.rippleQ = 0;
                    edgeData.rippleR = 0;
                    edgeData.colorStr = '';
                }
                if (edgeData.targetCurveID !== targetCurveID) {
                    edgeData.targetCurveID = targetCurveID;
                    let needsRipple = Math.abs(targetRgb.r - edgeData.rgb[0]) > 5 || Math.abs(targetRgb.g - edgeData.rgb[1]) > 3 || Math.abs(targetRgb.b - edgeData.rgb[2]) > 5;
                    if (needsRipple && state.lastRipple.time > 0 && (now - state.lastRipple.time < 3000)) {
                        edgeData.rippleTime = state.lastRipple.time;
                        edgeData.rippleQ = state.lastRipple.q;
                        edgeData.rippleR = state.lastRipple.r;
                        edgeData.rippleActive = true;
                        edgeData.colorStr = '';
                    }
                }
                let canTransition = true;
                if (edgeData.rippleActive && edgeData.rippleTime > 0) {
                    const [eq, er] = decodeEdgeID(id);
                    const dist = hexDistance(eq, er, edgeData.rippleQ, edgeData.rippleR);
                    const delay = dist * 35;
                    if (now - edgeData.rippleTime < delay) {
                        canTransition = false;
                        state.edgeColorAnimating = true;
                    }
                }
                if (canTransition) {
                    let diff = false;
                    const targets = [targetRgb.r, targetRgb.g, targetRgb.b];
                    for (let i = 0; i < 3; i++) {
                        const newVal = edgeData.rgb[i] + (targets[i] - edgeData.rgb[i]) * 0.08;
                        if (Math.abs(targets[i] - newVal) > 0.5) diff = true;
                        edgeData.rgb[i] = newVal;
                    }
                    const newAlpha = edgeData.alpha + (1 - edgeData.alpha) * 0.1;
                    if (Math.abs(1 - newAlpha) > 0.01) diff = true;
                    edgeData.alpha = newAlpha;
                    if (diff) {
                        state.edgeColorAnimating = true;
                        edgeData.colorStr = '';
                    } else {
                        edgeData.rippleActive = false;
                    }
                }
            }
            if (!edgeData.colorStr) {
                edgeData.colorStr = `rgb(${Math.round(edgeData.rgb[0])},${Math.round(edgeData.rgb[1])},${Math.round(edgeData.rgb[2])})`;
            }
            state.ctx.strokeStyle = edgeData.colorStr;
            // Apply alpha to line width for thickness blending, exactly as in the original
            state.ctx.lineWidth = Math.max(0.1, (sz / 3) * state.curveLineWidth * edgeData.alpha);
            return true;
        }
        state.currentUnassignedEdges.add(id);
        state.ctx.strokeStyle = `rgba(110, 110, 144, 0.55)`;
        state.ctx.lineWidth = Math.max(1, (sz / 10) * state.curveLineWidth);
        const dash = Math.max(2, sz / 8);
        state.ctx.setLineDash([dash, dash]);
        return true;
    }
    const rSz = grid ? sz * 0.95 : sz;
    state.ctx.save();

    state.ctx.globalAlpha = curveAlpha;

    if (img) {
        traceHexPath(state.ctx, cx, cy, rSz);
        state.ctx.clip();
        state.ctx.translate(cx, cy);
        state.ctx.rotate(rot * CONFIG.DEG2RAD);

        const needsAlpha = curveAlpha < 0.999;
        if (needsAlpha) state.ctx.globalAlpha = curveAlpha;

        if (state.isEmbedMode) {
            const drawSz = sz * 2.6;
            state.ctx.drawImage(img, -drawSz / 2, -drawSz / 2, drawSz, drawSz);
        } else {
            state.ctx.rotate(tf.rot * CONFIG.DEG2RAD);
            const baseHexSize = 88;
            const sizeScale = sz / baseHexSize;
            state.ctx.scale(sizeScale, sizeScale);
            state.ctx.scale(tf.sx * tf.scale, tf.sy * tf.scale);
            state.ctx.translate(tf.ox, tf.oy);
            const iSz = baseHexSize * 2.6;
            state.ctx.drawImage(img, -iSz / 2, -iSz / 2, iSz, iSz);
        }

        if (needsAlpha) state.ctx.globalAlpha = 1.0;
    } else {
        state.ctx.translate(cx, cy);
        state.ctx.rotate(rot * CONFIG.DEG2RAD);
        const a = sz * SQRT3 / 2;
        state.ctx.lineCap = 'butt';
        const ext = sz > CONFIG.LOD_HIGH_SZ ? CONFIG.LOD_EXT_HIGH :
            (sz > CONFIG.LOD_MED_HIGH_SZ ? CONFIG.LOD_EXT_MED_HIGH :
                (sz > CONFIG.LOD_MED_LOW_SZ ? CONFIG.LOD_EXT_MED_LOW : CONFIG.LOD_EXT_LOW));
        const logicalRot = tileRot(hq, hr);
        const k = (logicalRot / 60) % 6;
        if (curveAlpha > 0.01) {
            const alter = isTileAlter(hq, hr);
            if (alter) {
                if (applyCurveStyle(hq, hr, (0 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(sz / 2, a, sz / 2, Math.PI - ext, 5 * PI_DIV_3 + ext, false);
                    state.ctx.stroke();
                }
                if (applyCurveStyle(hq, hr, (2 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(-sz, 0, sz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false);
                    state.ctx.stroke();
                }
                if (applyCurveStyle(hq, hr, (4 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(sz / 2, -a, sz / 2, PI_DIV_3 - ext, Math.PI + ext, false);
                    state.ctx.stroke();
                }
            } else {
                if (applyCurveStyle(hq, hr, (2 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(-sz, 0, sz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false);
                    state.ctx.stroke();
                }
                if (applyCurveStyle(hq, hr, (4 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(1.5 * sz, -a, 1.5 * sz, TWO_PI_DIV_3 - ext, Math.PI + ext, false);
                    state.ctx.stroke();
                }
                if (applyCurveStyle(hq, hr, (1 + k) % 6, sz, now)) {
                    state.ctx.beginPath();
                    state.ctx.arc(1.5 * sz, a, 1.5 * sz, Math.PI - ext, FOUR_PI_DIV_3 + ext, false);
                    state.ctx.stroke();
                }
            }
            state.ctx.setLineDash([]);
        }
    }
    state.ctx.restore();
}

function initRenderState(now) {
    const W = dom.cvs.width,
        H = dom.cvs.height;
    if (state.isExporting) {
        if (!state.exportFreezeTime) state.exportFreezeTime = now;
        now = state.exportFreezeTime;
    } else {
        state.exportFreezeTime = 0;
    }
    const z = state.zoom,
        px = state.panX,
        py = state.panY,
        grid = state.showGrid,
        img = state.texImg,
        tf = state.texTf;

    const visZoom = z;

    for (const [k, a] of state.animMap) {
        if (now - a.start >= a.duration) state.animMap.delete(k);
    }
    return {
        W,
        H,
        now,
        z,
        px,
        py,
        grid,
        img,
        tf,
        visZoom
    };
}

function drawBackground(W, H, visZoom, now) {
    state.ctx.fillStyle = COLORS.bg;
    state.ctx.fillRect(0, 0, W, H);
    drawIDWGradient(W, H);
    drawBackgroundStars(
        W, H, 1,
        state.starPanX5, state.starPanY5,
        state.starPanX2, state.starPanY2,
        state.starPanX3, state.starPanY3,
        now, visZoom, state.zoomOutStartTime
    );
}

function updateGradientAnimations(now) {
    let gradAnimating = false;

    let avgR = 0,
        avgG = 0,
        avgB = 0,
        avgW = 0;
    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        const w = m.weight !== undefined ? m.weight : 1;
        avgR += m.tr * w;
        avgG += m.tg * w;
        avgB += m.tb * w;
        avgW += w;
    }
    if (avgW > 0) {
        state.currentAvgR = avgR / avgW;
        state.currentAvgG = avgG / avgW;
        state.currentAvgB = avgB / avgW;
    } else {
        state.currentAvgR = parseInt(COLORS.bg.slice(1, 3), 16);
        state.currentAvgG = parseInt(COLORS.bg.slice(3, 5), 16);
        state.currentAvgB = parseInt(COLORS.bg.slice(5, 7), 16);
    }

    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        let diff = false;
        const nWeight = m.weight + (1 - m.weight) * 0.05;
        if (Math.abs(1 - nWeight) > 0.01) diff = true;
        m.weight = nWeight;
        const targetR = state.currentAvgR + (m.tr - state.currentAvgR) * m.weight;
        const targetG = state.currentAvgG + (m.tg - state.currentAvgG) * m.weight;
        const targetB = state.currentAvgB + (m.tb - state.currentAvgB) * m.weight;
        const nr = m.r + (targetR - m.r) * 0.1,
            ng = m.g + (targetG - m.g) * 0.1,
            nb = m.b + (targetB - m.b) * 0.1;
        if (Math.abs(m.r - nr) > 0.5 || Math.abs(m.g - ng) > 0.5 || Math.abs(m.b - nb) > 0.5) diff = true;
        m.r = nr;
        m.g = ng;
        m.b = nb;
        if (diff) {
            gradAnimating = true;
            state.isGradientDirty = true;
        }
    }

    for (let i = state.fadingMarkersRGB.length - 1; i >= 0; i--) {
        const m = state.fadingMarkersRGB[i];
        m.weight += (0 - m.weight) * 0.05;
        if (m.weight <= 0.00008) {
            state.fadingMarkersRGB.splice(i, 1);
            gradAnimating = true;
            state.isGradientDirty = true;
            continue;
        }
        const targetR = state.currentAvgR + (m.origR - state.currentAvgR) * m.weight;
        const targetG = state.currentAvgG + (m.origG - state.currentAvgG) * m.weight;
        const targetB = state.currentAvgB + (m.origB - state.currentAvgB) * m.weight;
        m.r += (targetR - m.r) * 0.1;
        m.g += (targetG - m.g) * 0.1;
        m.b += (targetB - m.b) * 0.1;
        gradAnimating = true;
        state.isGradientDirty = true;
    }

    return gradAnimating;
}

function updateFlowAnimation(now, visZoom, isPanning) {
    if (state.isEmbedMode && !state.flowEnabled) {
        state.currentFlowVX = 0;
        state.currentFlowVY = 0;
        return { driftX: 0, driftY: 0, flowAnimating: false };
    }
    function getHippopedeAngle() {
        // Samples an angle from the normalized Hippopede distribution: r^2 = 2.8(1 - 0.7*sin^2(theta))
        // Uses Newton-Raphson to invert the exact CDF: F(theta) = (0.65*theta + 0.175*sin(2*theta)) / (1.3*PI)
        const U = Math.random();
        let theta = U * 2 * Math.PI; // Initial guess
        for (let i = 0; i < 5; i++) {
            const sin2t = Math.sin(2 * theta);
            const cos2t = Math.cos(2 * theta);
            const F = (0.65 * theta + 0.175 * sin2t) / (1.3 * Math.PI);
            const f = (0.65 + 0.35 * cos2t) / (1.3 * Math.PI); // Derivative
            theta -= (F - U) / f;
        }
        return ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    }
    const targetFlowIntensity = state.flowEnabled && !state.isExporting ? 1 : 0;
    if (state.flowIntensity !== targetFlowIntensity) {
        state.flowIntensity += (targetFlowIntensity - state.flowIntensity) * 0.05;
        if (Math.abs(state.flowIntensity - targetFlowIntensity) < 0.001) {
            state.flowIntensity = targetFlowIntensity;
        }
    }

    if (state.flowIntensity <= 0 || state.isExporting || isPanning) {
        state.currentFlowVX = 0;
        state.currentFlowVY = 0;
        return {
            driftX: 0,
            driftY: 0,
            flowAnimating: false
        };
    }

    if (!state.flowCycleStarted) {
        state.flowCycleStarted = true;
        state.flowTargetAngle = getHippopedeAngle();
        state.flowStartAngle = state.flowTargetAngle;
        state.flowCurrentAngle = state.flowTargetAngle;
        state.flowTime = 0;
        state.flowLastTime = now;
        state.flowLastCycle = 0;
        state.flowMaxSpeed = CONFIG.DRIFT_SPEED_BASE + Math.random() * CONFIG.DRIFT_SPEED_RANGE;
    }

    const dtMs = Math.min(now - state.flowLastTime, 50);
    state.flowLastTime = now;
    state.flowTime += dtMs;

    const cycleDuration = 20000; // 20 seconds
    const t = (state.flowTime % cycleDuration) / cycleDuration * 2 * Math.PI;
    const currentCycle = Math.floor(state.flowTime / cycleDuration);

    if (currentCycle > state.flowLastCycle) {
        state.flowLastCycle = currentCycle;
        state.flowStartAngle = state.flowCurrentAngle;
        state.flowTargetAngle = getHippopedeAngle();
        state.flowMaxSpeed = CONFIG.DRIFT_SPEED_BASE + Math.random() * CONFIG.DRIFT_SPEED_RANGE;
    }

    const halfPi = Math.PI / 2;
    if (t <= halfPi) {
        const lerpFactor = t / halfPi;
        let diff = state.flowTargetAngle - state.flowStartAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        state.flowCurrentAngle = state.flowStartAngle + diff * lerpFactor;
    } else {
        state.flowCurrentAngle = state.flowTargetAngle;
    }

    const timeSpeedMult = 1 - Math.pow(1 + Math.cos(t), 3) / 9;
    const zoomSpeedMult = (visZoom <= CONFIG.ZOOM_FADE_MID) ? CONFIG.FLOW_SPEED_MULT_LOW_ZOOM : 1.0;
    const finalSpeed = state.flowMaxSpeed * zoomSpeedMult * timeSpeedMult * state.flowIntensity;

    const driftX = Math.cos(state.flowCurrentAngle) * finalSpeed;
    const driftY = Math.sin(state.flowCurrentAngle) * finalSpeed;
    state.currentFlowVX = driftX;
    state.currentFlowVY = driftY;

    return {
        driftX,
        driftY,
        flowAnimating: true
    };
}

function applyPanAndDrift(driftX, driftY, visZoom) {
    let panAnimating = false;

    // Dampen active pan velocity when dragging/touching
    if ((state.isDrag || state.touchState.mode === 'pan' || state.touchState.mode === 'pan_wait') &&
        Date.now() - state.lastPanMoveTime > 60) {
        state.panVX *= 0.6;
        state.panVY *= 0.6;
        if (Math.abs(state.panVX) < 0.5) state.panVX = 0;
        if (Math.abs(state.panVY) < 0.5) state.panVY = 0;
    }

    if (!state.isEmbedMode && state.inertiaEnabled && !state.isDrag && !state.isExporting) {
        applyPanDelta(state.panVX, state.panVY);

        const damping = (visZoom < CONFIG.ZOOM_FADE_START_MULT) ?
            CONFIG.INERTIA_DAMPING_LOW :
            CONFIG.INERTIA_DAMPING_NORMAL;
        state.panVX *= damping;
        state.panVY *= damping;

        if (Math.abs(state.panVX) < CONFIG.INERTIA_THRESHOLD) state.panVX = 0;
        if (Math.abs(state.panVY) < CONFIG.INERTIA_THRESHOLD) state.panVY = 0;
        if (state.panVX !== 0 || state.panVY !== 0) panAnimating = true;
    }

    const isPanning = (state.isDrag && state.dragMoved && !state.isMouseDrawMode && !state.isEmbedMode) ||
        state.touchState.mode === 'pan';
    if (state.flowEnabled && state.flowIntensity > 0 && !state.isExporting && !isPanning) {
        if (state.isDrag) {
            state.dragPX += driftX;
            state.dragPY += driftY;
        }
        if (state.touchState.mode === 'pan_wait' || state.touchState.mode === 'draw') {
            state.touchState.startPanX += driftX;
            state.touchState.startPanY += driftY;
        }
        applyPanDelta(driftX, driftY);
        panAnimating = true;
    }

    return panAnimating;
}

function updateZoomAnimation() {
    if (state.isExporting || Math.abs(state.targetZoom - state.zoom) <= 0.0001) return false;
    let step = (state.targetZoom - state.zoom) * 0.15;
    if (Math.abs(step) < 0.0005) step = state.targetZoom - state.zoom;
    state.setZoom(state.zoom + step, state.zoomCx, state.zoomCy);
    return true;
}

function updateZoomOutTime(visZoom, now) {
    const effectiveZoom = state.isEmbedMode && state.embedData ? (state.embedData.origZoom || visZoom) : visZoom;
    if (effectiveZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
        if (state.zoomOutStartTime === 0) state.zoomOutStartTime = now;
    } else {
        state.zoomOutStartTime = 0;
    }
}

function computeAlphas(visZoom) {
    const ZOOM_THRESHOLD = 0.24;
    const effectiveZoom = state.isEmbedMode && state.embedData ? state.embedData.origZoom : visZoom;

    // Trigger at 24% zoom, but animate the transition
    state.targetElementsFade = effectiveZoom < ZOOM_THRESHOLD ? 0.0 : 1.0;

    const fadeSpeed = state.targetElementsFade > state.elementsFade ? 0.3 : 0.5;
    state.elementsFade += (state.targetElementsFade - state.elementsFade) * fadeSpeed;
    if (Math.abs(state.targetElementsFade - state.elementsFade) < 0.005) {
        state.elementsFade = state.targetElementsFade;
    }

    // Interaction fade (driven by targetInteractionFade)
    const intFadeSpeed = state.targetInteractionFade > state.interactionFade ? 0.3 : 0.5;
    state.interactionFade += (state.targetInteractionFade - state.interactionFade) * intFadeSpeed;

    const finalCurveAlpha = state.elementsFade * state.interactionFade;
    const finalGridAlpha = state.elementsFade * state.interactionFade;

    const fadeAnimating = Math.abs(state.targetInteractionFade - state.interactionFade) > 0.001 ||
        Math.abs(state.targetElementsFade - state.elementsFade) > 0.005;

    return {
        curveAlpha: finalCurveAlpha,
        gridAlpha: finalGridAlpha,
        fadeAnimating
    };
}

function processVisibleHexes(z, px, py, W, H, img, curveAlpha) {
    let hexes = [];
    if (img || curveAlpha > 0.01) {
        hexes = visibleHexes(z, px, py, W, H);
        const centerHex = pixToHex(W / 2, H / 2, z, px, py);
        hexes.sort((a, b) =>
            hexDistance(a.q, a.r, centerHex.q, centerHex.r) -
            hexDistance(b.q, b.r, centerHex.q, centerHex.r)
        );
    }

    let curveWorkRemaining = false;
    if (state.curveColors.length > 1 && curveAlpha > 0.01 && hexes.length > 0) {
        let startTime = performance.now();
        let didWork = true;
        while (didWork && performance.now() - startTime < 16) {
            if (state.queue.length > 0) {
                processQueue();
            } else if (!state.embedBakedOnly && findUncoloredTileInHexes(hexes)) {
                processQueue();
            } else {
                didWork = false;
            }
        }
        if (didWork) {
            curveWorkRemaining = true;
            state.curveWorkWasRemaining = true;
        } else if (state.curveWorkWasRemaining) {
            state.curveWorkWasRemaining = false;
            state.lastStatsUpdate = 0;
        }
    }

    return {
        hexes,
        curveWorkRemaining
    };
}

function renderHexGrid(hexes, z, px, py, W, H, grid, img, tf, curveAlpha, gridAlpha, now) {
    const sz = HEX_R * z;

    if (img) {
        for (const h of hexes) {
            const rot = displayRot(h.q, h.r, now);
            drawTile(h.x, h.y, sz, rot, grid, img, tf, h.q, h.r, now, curveAlpha, gridAlpha);
        }
        if (state.showGrid && gridAlpha > 0.01) {
            state.ctx.globalAlpha = gridAlpha;
            traceHexGridBatch(state.ctx, hexes, sz);
            state.ctx.strokeStyle = COLORS.gridLine;
            state.ctx.lineWidth = 1;
            state.ctx.stroke();
            state.ctx.globalAlpha = 1.0;
        }
        return;
    }

    if (curveAlpha < 0.05) {
        if (state.showGrid && gridAlpha > 0.05) {
            state.ctx.globalAlpha = gridAlpha;
            traceHexGridBatch(state.ctx, hexes, sz);
            state.ctx.strokeStyle = COLORS.gridLine;
            state.ctx.lineWidth = 1;
            state.ctx.stroke();
            state.ctx.globalAlpha = 1.0;
        }
        return;
    }

    if (curveAlpha < 0.95 || gridAlpha < 0.95) {
        if (state.curveCanvas.width !== W || state.curveCanvas.height !== H) {
            state.curveCanvas.width = W;
            state.curveCanvas.height = H;
        }
        state.curveCtx.clearRect(0, 0, W, H);
        const oldCtx = state.ctx;
        state.ctx = state.curveCtx;
        for (const h of hexes) {
            const rot = displayRot(h.q, h.r, now);
            drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
        }
        if (state.showGrid && gridAlpha > 0.01) {
            traceHexGridBatch(state.curveCtx, hexes, sz);
            state.curveCtx.strokeStyle = COLORS.gridLine;
            state.curveCtx.lineWidth = 1;
            state.curveCtx.globalAlpha = gridAlpha;
            state.curveCtx.stroke();
            state.curveCtx.globalAlpha = 1.0;
        }
        state.ctx = oldCtx;
        state.ctx.globalAlpha = Math.max(curveAlpha, gridAlpha);
        state.ctx.drawImage(state.curveCanvas, 0, 0);
        state.ctx.globalAlpha = 1.0;
    } else {
        for (const h of hexes) {
            const rot = displayRot(h.q, h.r, now);
            drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
        }
        if (state.showGrid) {
            traceHexGridBatch(state.ctx, hexes, sz);
            state.ctx.strokeStyle = COLORS.gridLine;
            state.ctx.lineWidth = 1;
            state.ctx.stroke();
        }
    }
}

function updateLODIndicator(visZoom) {
    const visSz = HEX_R * visZoom;
    const lod = visSz > CONFIG.LOD_HIGH_SZ ? 3 :
        (visSz > CONFIG.LOD_MED_HIGH_SZ ? 2 :
            (visSz > CONFIG.LOD_MED_LOW_SZ ? 1 : 0));
    const _lodEl = document.getElementById('lodCurrentStatus');
    if (_lodEl) {
        const _txt = `LOD: ${lod} | visSz: ${visSz.toFixed(1)}`;
        if (_lodEl.textContent !== _txt) {
            _lodEl.textContent = _txt;
            _lodEl.style.color = lod === 3 ? 'var(--col-accent)' :
                lod === 2 ? 'var(--col-fg)' :
                lod === 1 ? 'var(--col-muted)' : 'rgba(150,150,150,0.5)';
        }
    }
}

function renderHoverAndTouchOutlines(hexes, z, px, py, W, H, grid, gridAlpha, now) {
    function drawHoverStroke(cx, cy, sz, grid, alpha = 1) {
        if (state.interactionFade < 0.01 || alpha < 0.01) return;
        const rSz = grid ? sz * 0.95 : sz;
        state.ctx.save();
        state.ctx.globalAlpha = state.interactionFade * alpha;
        traceHexPath(state.ctx, cx, cy, rSz);
        state.ctx.lineWidth = 3;
        state.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        state.ctx.stroke();
        state.ctx.lineWidth = 1.5;
        state.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        state.ctx.stroke();
        state.ctx.restore();
    }
    if (state.isExporting) return false;
    let animating = false;

    const shouldShowHover =
        (!state.isEmbedMode && !state.isDrag && state.hoveredQ !== null && state.hoveredR !== null) ||
        (state.isEmbedMode && state.hoveredQ !== null && state.hoveredR !== null);

    if (shouldShowHover) {
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const sidebarHidden = isCollapsed || state.isEmbedMode;
        const effectiveW = sidebarHidden ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
        if (state.mouseScreenX >= 0 && state.mouseScreenX <= effectiveW &&
            state.mouseScreenY >= 0 && state.mouseScreenY <= dom.cvs.height) {
            const h = pixToHex(state.mouseScreenX, state.mouseScreenY, z, px, py);
            state.hoveredQ = h.q;
            state.hoveredR = h.r;
        }

        const p = hexToPix(state.hoveredQ, state.hoveredR, z, px, py);
        if (state.visHoverX === null) {
            state.visHoverX = p.x;
            state.visHoverY = p.y;
        } else {
            state.visHoverX += (p.x - state.visHoverX) * CONFIG.HOVER_LERP;
            state.visHoverY += (p.y - state.visHoverY) * CONFIG.HOVER_LERP;
            if (Math.abs(p.x - state.visHoverX) > 0.5 || Math.abs(p.y - state.visHoverY) > 0.5) {
                animating = true;
            } else {
                state.visHoverX = p.x;
                state.visHoverY = p.y;
            }
        }
        drawHoverStroke(state.visHoverX, state.visHoverY, HEX_R * z, grid, gridAlpha);
    }

    if (state.touchOutlines.length > 0) {
        animating = true;
        const sz = HEX_R * z;
        for (let i = state.touchOutlines.length - 1; i >= 0; i--) {
            const t = state.touchOutlines[i];
            t.alpha -= CONFIG.TOUCH_OUTLINE_FADE;
            if (t.alpha <= 0) {
                state.touchOutlines.splice(i, 1);
                continue;
            }
            const p = hexToPix(t.q, t.r, z, px, py);
            state.ctx.save();
            traceHexPath(state.ctx, p.x, p.y, grid ? sz * 0.95 : sz);
            state.ctx.globalAlpha = t.alpha * gridAlpha;
            state.ctx.lineWidth = 3;
            state.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            state.ctx.stroke();
            state.ctx.lineWidth = 1.5;
            state.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            state.ctx.stroke();
            state.ctx.globalAlpha = 1.0;
            state.ctx.restore();
        }
    }

    return animating;
}

function renderMarkers(now) {
    function drawSunMarker(c, x, y, color, outline, scale = 1) {
        const r = 10 * scale,
            rayLen = 9 * scale,
            rayW = 4 * scale,
            outlineW = 3 * scale,
            gap = 2 * scale;
        c.save();
        c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI / 4) * i;
            const r1 = r + gap,
                r2 = r + gap + rayLen;
            c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
            c.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
        }
        c.strokeStyle = outline;
        c.lineWidth = rayW + outlineW * 2;
        c.stroke();
        c.strokeStyle = color;
        c.lineWidth = rayW;
        c.stroke();
        c.beginPath();
        c.arc(x, y, r + outlineW, 0, Math.PI * 2);
        c.fillStyle = outline;
        c.fill();
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        c.restore();
    }

    function getContrastColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum > 140 ? COLORS.black : COLORS.white;
    }

    if (!state.markersVisible) return false;
    let animating = false;
    for (let i = 0; i < state.gradientMarkers.length; i++) {
        const m = state.gradientMarkers[i];
        const outline = getContrastColor(m.color);
        let scale = 1.0;
        if (state.touchState.mode === 'marker_wait' &&
            i === state.touchState.markerIdx &&
            state.touchState.startTime) {
            scale = 1.0 + 2.0 * Math.min(1, (now - state.touchState.startTime) / CONFIG.LONG_PRESS_DUR);
            animating = true;
        }
        drawSunMarker(state.ctx, m.x, m.y, m.color, outline, scale);
    }
    return animating;
}

function updateStatsIfNeeded(hexes, W, H, visZoom, curveAlpha, now) {
    if (now - state.lastStatsUpdate <= CONFIG.STATS_UPDATE_INTERVAL) return;
    state.lastStatsUpdate = now;

    if (visZoom <= CONFIG.ZOOM_FADE_MID || state.curveColors.length <= 1 || state.texImg) {
        dom.statCurvesWrap.style.display = 'none';
        dom.statColorsWrap.style.display = 'none';
    } else {
        dom.statCurvesWrap.style.display = '';
        dom.statColorsWrap.style.display = '';
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const effectiveW = (isCollapsed || state.isEmbedMode) ? W : Math.max(0, W - CONFIG.SIDEBAR_WIDTH);
        const apothem = (HEX_R * visZoom * SQRT3) / 2;
        let visCurveIDs = new Set();
        for (const h of hexes) {
            if (h.x >= apothem && h.x <= effectiveW - apothem && h.y >= apothem && h.y <= H - apothem) {
                for (let e = 0; e < 6; e++) {
                    const id = edgeID(h.q, h.r, e);
                    if (state.curveMap.has(id)) visCurveIDs.add(state.curveMap.get(id));
                }
            }
        }
        let visColors = new Set();
        for (const cid of visCurveIDs) {
            const c = state.curves.get(cid);
            if (c) {
                let col = c.color;
                if (typeof col === 'number') col = state.curveColors[col % state.curveColors.length];
                visColors.add(col.toLowerCase());
            }
        }
        dom.statCurves.textContent = visCurveIDs.size;
        dom.statColors.textContent = visColors.size;
    }

    // Clean non‑visible edge colour data
    if (curveAlpha === 0) {
        state.edgeRgbMap.clear();
    } else {
        const visibleEdgeIDs = new Set();
        for (const h of hexes) {
            for (let e = 0; e < 6; e++) visibleEdgeIDs.add(edgeID(h.q, h.r, e));
        }
        for (const id of state.edgeRgbMap.keys()) {
            if (!visibleEdgeIDs.has(id)) state.edgeRgbMap.delete(id);
        }
    }
}

function swapEdgeBuffers() {
    const tempUnassigned = state.previousUnassignedEdges;
    state.previousUnassignedEdges = state.currentUnassignedEdges;
    state.currentUnassignedEdges = tempUnassigned;
    state.currentUnassignedEdges.clear();
}

export function render() {
    if (state.isPausedHidden) return; 
    
    // 1. Initialise frame and time
    const {
        W,
        H,
        now,
        z,
        px,
        py,
        grid,
        img,
        tf,
        visZoom
    } = initRenderState(Date.now());

    // 2. Draw background layer
    drawBackground(W, H, visZoom, now);

    // 3. Start collecting “keep rendering” flags
    let keepRendering = (state.animMap.size > 0 || state.isDrag || state.isDragMarker);
    if (state.showBgStars && visZoom <= CONFIG.ZOOM_FADE_MID) keepRendering = true;
    if (state.isExporting) keepRendering = false;

    state.edgeColorAnimating = false;

    // 4. Animate gradient markers
    const gradColorAnimating = updateGradientAnimations(now);

    // 5. Flow animation
    const isPanning = (state.isDrag && state.dragMoved && !state.isMouseDrawMode && !state.isEmbedMode) ||
        state.touchState.mode === 'pan';
    const {
        driftX,
        driftY,
        flowAnimating
    } = updateFlowAnimation(now, visZoom, isPanning);
    keepRendering ||= flowAnimating;

    // 6. Pan inertia & drift application
    const panAnimating = applyPanAndDrift(driftX, driftY, visZoom);
    keepRendering ||= panAnimating;

    // 7. Zoom smoothing
    const zoomAnimating = updateZoomAnimation();
    keepRendering ||= zoomAnimating;

    // 8. Zoom‑out time management (for star blaze)
    updateZoomOutTime(visZoom, now);

    // 9. Compute fade/alpha values
    const {
        curveAlpha,
        gridAlpha,
        fadeAnimating
    } = computeAlphas(visZoom);
    keepRendering ||= fadeAnimating;

    // 10. Gather visible hexes and process curve colouring
    const {
        hexes,
        curveWorkRemaining
    } = processVisibleHexes(z, px, py, W, H, img, curveAlpha);
    keepRendering ||= curveWorkRemaining;

    // 11. Draw the hex grid (tiles or curves)
    if (hexes.length > 0) {
        renderHexGrid(hexes, z, px, py, W, H, grid, img, tf, curveAlpha, gridAlpha, now);
    }

    // 12. LOD indicator update
    updateLODIndicator(visZoom);

    // 13. Hover & touch overlays
    const overlaysAnimating = renderHoverAndTouchOutlines(hexes, z, px, py, W, H, grid, gridAlpha, now);
    keepRendering ||= overlaysAnimating;

    // 14. Gradient markers
    const markersAnimating = renderMarkers(now);
    keepRendering ||= markersAnimating;

    // 15. Stats update
    updateStatsIfNeeded(hexes, W, H, visZoom, curveAlpha, now);

    // 16. Continue rendering if any subsystem is still animating
    keepRendering ||= state.edgeColorAnimating || gradColorAnimating;

    // 17. Swap edge buffer for ripple detection
    swapEdgeBuffers();

    if (keepRendering) requestRender();
}
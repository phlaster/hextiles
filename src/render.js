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
    isTileAlter
} from './math.js';
import {
    processQueue,
    findUncoloredTileInHexes,
    edgeID,
    decodeEdgeID,
    getBackgroundColorAt,
    initializeCentralTile
} from './curves.js';
import {
    renderGradientList,
    renderCurveList
} from './ui.js';
import {
    getRandomMarkerPosition
} from './events.js';

state.ctx = dom.cvs.getContext('2d');

const HEX_R = CONFIG.HEX_R;
const SQRT3 = CONFIG.SQRT3;
const PI_DIV_3 = CONFIG.PI_DIV_3;
const TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3;
const FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;

export function computeFadeAlpha(zoom) {
    const visSz = HEX_R * zoom;
    const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT;
    const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
    if (visSz <= fadeEndSz + 0.5) return 0;
    if (visSz >= fadeStartSz) return 1;
    const t = (visSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
    return t * t * (3 - 2 * t);
}

export function requestRender() {
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
        if (state.embedData) {
            dom.cvs.width = state.embedData.w;
            dom.cvs.height = state.embedData.h;
        }
        if (!state.isInitialized) {
            state.isInitialized = true;
            if (state.gradientMarkers.length === 0) {
                const pos = getRandomMarkerPosition();
                state.gradientMarkers.push({
                    x: pos.x,
                    y: pos.y,
                    color: '#cccccc'
                });
                state.updateGradientMarkersCache();
                renderGradientList();
                renderCurveList();
            }
            initializeCentralTile();
        }
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
            
            state.starPanX2 = state.panX; state.starPanY2 = state.panY;
            state.starPanX3 = state.panX; state.starPanY3 = state.panY;
            state.starPanX5 = state.panX; state.starPanY5 = state.panY;
            
            state.starZoom2 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_MED);
            state.starZoom3 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
            state.starZoom5 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_LARGE);
            
            state.isInitialized = true;

            if (state.gradientMarkers.length === 0) {
                const pos = getRandomMarkerPosition();
                state.gradientMarkers.push({
                    x: pos.x,
                    y: pos.y,
                    color: '#cccccc'
                });
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
    if (state.solvedCheckTimeout) return;
    state.solvedCheckTimeout = setTimeout(() => {
        state.solvedCheckTimeout = null;
        performSolvedCheck();
    }, CONFIG.STATS_UPDATE_INTERVAL);
}

export function drawBackgroundStars(W, H, coordScale, dPanX5, dPanY5, dPanX2, dPanY2, dPanX3, dPanY3, now, currentZoom, zoomOutTime, offsetX = 0, offsetY = 0) {
    if (!state.showBgStars) return;
    state.ctx.save();
    const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * coordScale;
    drawDotLayer(W, H, spacing5, CONFIG.STAR_SIZE_LARGE, 1, coordScale, dPanX5, dPanY5, now, false, 1, 0, offsetX, offsetY);
    const spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * coordScale;
    drawDotLayer(W, H, spacing2, CONFIG.STAR_SIZE_MED, 2, coordScale, dPanX2, dPanY2, now, false, 1, 0, offsetX, offsetY);

    let layer3Alpha = 0,
        canBlaze = false,
        blazeFade = 1.0;
    if (currentZoom < CONFIG.ZOOM_BLAZE_FADE_START + 0.001) {
        layer3Alpha = Math.max(0, Math.min(1, (CONFIG.ZOOM_BLAZE_FADE_START - currentZoom) / CONFIG.ZOOM_BLAZE_FADE_RANGE));
        if (layer3Alpha > 0 && zoomOutTime > 0 && (now - zoomOutTime) > CONFIG.STAR_BLAZE_DELAY) {
            canBlaze = true;
            const fadeInDur = 3000;
            let fadeT = (now - zoomOutTime - CONFIG.STAR_BLAZE_DELAY) / fadeInDur;
            blazeFade = Math.max(0, Math.min(1, fadeT));
            blazeFade = blazeFade * blazeFade * (3 - 2 * blazeFade);
        }
    }
    if (layer3Alpha > 0) {
        const spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * coordScale;
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

    for (let py = 0; py < lowH; py++) {
        for (let px = 0; px < lowW; px++) {
            let totalWeight = 0,
                r = 0,
                g = 0,
                b = 0;
            for (let i = 0; i < n; i++) {
                const m = allMarkers[i];
                const dx = px - (m.x * qualityScale);
                const dy = py - (m.y * qualityScale);
                const distSq = dx * dx + dy * dy + 0.5 * coordScale * coordScale;
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
                data[idx] = avgR;
                data[idx + 1] = avgG;
                data[idx + 2] = avgB;
                data[idx + 3] = 255;
            }
        }
    }
    gctx.putImageData(imgData, 0, 0);
}

export function drawIDWGradient(W, H, coordScale = 1, offsetX = 0, offsetY = 0) {
    if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return;
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
    const rSz = grid ? sz * 0.95 : sz;
    state.ctx.save();
    if (img) {
        traceHexPath(state.ctx, cx, cy, rSz);
        state.ctx.clip();
        state.ctx.translate(cx, cy);
        state.ctx.rotate(rot * CONFIG.DEG2RAD);
        state.ctx.rotate(tf.rot * CONFIG.DEG2RAD);
        state.ctx.scale(tf.sx * tf.scale, tf.sy * tf.scale);
        state.ctx.translate(tf.ox, tf.oy);
        const iSz = sz * 2.6;
        state.ctx.drawImage(img, -iSz / 2, -iSz / 2, iSz, iSz);
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
            state.ctx.globalAlpha = curveAlpha;
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
            state.ctx.globalAlpha = 1.0;
        }
    }
    state.ctx.restore();
}

export function render() {
    const W = dom.cvs.width,
        H = dom.cvs.height;
    let now = Date.now();
    if (state.isExporting) {
        if (!state.exportFreezeTime) state.exportFreezeTime = now;
        now = state.exportFreezeTime;
    } else {
        state.exportFreezeTime = 0;
    }
    const z = state.zoom,
        px = state.panX,
        py = state.panY;
    const grid = state.showGrid,
        img = state.texImg,
        tf = state.texTf;
    const visZoom = (state.isEmbedMode && state.embedData && state.embedData.origZoom) ? state.embedData.origZoom : z;

    for (const [k, a] of state.animMap) {
        if (now - a.start >= a.duration) state.animMap.delete(k);
    }

    state.ctx.fillStyle = COLORS.bg;
    state.ctx.fillRect(0, 0, W, H);
    drawIDWGradient(W, H);
    drawBackgroundStars(W, H, 1, state.starPanX5, state.starPanY5, state.starPanX2, state.starPanY2, state.starPanX3, state.starPanY3, now, visZoom, state.zoomOutStartTime);

    let keepRendering = (state.animMap.size > 0 || state.isDrag || state.isDragMarker);
    if (state.showBgStars && visZoom <= CONFIG.ZOOM_FADE_MID) keepRendering = true;
    if (state.isExporting) keepRendering = false;

    state.edgeColorAnimating = false;
    let gradColorAnimating = false,
        curveColorAnimating = false;
    state.currentUnassignedEdges.clear();

    if (!state.isExporting) {
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
                gradColorAnimating = true;
                state.isGradientDirty = true;
            }
        }
        for (let i = state.fadingMarkersRGB.length - 1; i >= 0; i--) {
            const m = state.fadingMarkersRGB[i];
            m.weight += (0 - m.weight) * 0.05;
            if (m.weight <= 0.00008) {
                state.fadingMarkersRGB.splice(i, 1);
                gradColorAnimating = true;
                state.isGradientDirty = true;
                continue;
            }
            const targetR = state.currentAvgR + (m.origR - state.currentAvgR) * m.weight;
            const targetG = state.currentAvgG + (m.origG - state.currentAvgG) * m.weight;
            const targetB = state.currentAvgB + (m.origB - state.currentAvgB) * m.weight;
            m.r += (targetR - m.r) * 0.1;
            m.g += (targetG - m.g) * 0.1;
            m.b += (targetB - m.b) * 0.1;
            gradColorAnimating = true;
            state.isGradientDirty = true;
        }
    }

    let driftX = 0,
        driftY = 0;
    if (state.flowEnabled && !state.isExporting) {
        let speedMult = (visZoom <= CONFIG.ZOOM_FADE_MID) ? CONFIG.FLOW_SPEED_MULT_LOW_ZOOM : 1.0;
        let isHovering = state.hoveredQ !== null && state.hoveredR !== null;
        if (isHovering && state.flowState === 'drift' && (state.flowStateEndTime - now) > 2000) state.flowStateEndTime = now + 2000;
        if (now > state.flowStateEndTime) {
            if (state.flowState === 'drift') {
                state.flowState = 'turn';
                state.flowStateEndTime = now + (isHovering ? 1000 : CONFIG.FLOW_TURN_DURATION);
                let baseAngle = state.driftAngle;
                if (isHovering) {
                    baseAngle = Math.atan2(state.mouseScreenY - H / 2, state.mouseScreenX - W / 2) + Math.PI;
                }
                let turnAmount = 0;
                while (true) {
                    let theta = (Math.random() - 0.5) * Math.PI * 2;
                    if (Math.random() <= (1 + Math.cos(theta)) / 2) {
                        turnAmount = theta;
                        break;
                    }
                }
                state.driftTargetAngle = baseAngle + turnAmount;
            } else {
                state.flowState = 'drift';
                state.driftAngle = state.driftTargetAngle;
                state.flowStateEndTime = now + (isHovering ? 5000 : (CONFIG.DRIFT_TIMER_MIN + Math.random() * CONFIG.DRIFT_TIMER_RANGE));
                state.driftTargetSpeed = (CONFIG.DRIFT_SPEED_BASE + Math.random() * CONFIG.DRIFT_SPEED_RANGE) * speedMult;
            }
        }
        if (state.flowState === 'turn') {
            let angleDiff = state.driftTargetAngle - state.driftAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            state.driftAngle += angleDiff * 0.03;
        }
        let fluctuation = Math.sin(now / 800) * 0.2 + Math.sin(now / 350) * 0.1;
        state.driftSpeed += ((state.driftTargetSpeed + (state.driftTargetSpeed * fluctuation)) - state.driftSpeed) * 0.02;
        driftX = Math.cos(state.driftAngle) * state.driftSpeed;
        driftY = Math.sin(state.driftAngle) * state.driftSpeed;
    }

    if ((state.isDrag || state.touchState.mode === 'pan' || state.touchState.mode === 'pan_wait') && Date.now() - state.lastPanMoveTime > 60) {
        state.panVX *= 0.6;
        state.panVY *= 0.6;
        if (Math.abs(state.panVX) < 0.5) state.panVX = 0;
        if (Math.abs(state.panVY) < 0.5) state.panVY = 0;
    }

    if (!state.isEmbedMode && state.inertiaEnabled && !state.isDrag && !state.isExporting) {
        state.panX += state.panVX;
        state.panY += state.panVY;
        state.starPanX5 += state.panVX * CONFIG.STAR_PARALLAX_LARGE;
        state.starPanY5 += state.panVY * CONFIG.STAR_PARALLAX_LARGE;
        state.starPanX2 += state.panVX * CONFIG.STAR_PARALLAX_MED;
        state.starPanY2 += state.panVY * CONFIG.STAR_PARALLAX_MED;
        state.starPanX3 += state.panVX * CONFIG.STAR_PARALLAX_SMALL;
        state.starPanY3 += state.panVY * CONFIG.STAR_PARALLAX_SMALL;
        let damping = (visZoom < CONFIG.ZOOM_FADE_START_MULT) ? CONFIG.INERTIA_DAMPING_LOW : CONFIG.INERTIA_DAMPING_NORMAL;
        state.panVX *= damping;
        state.panVY *= damping;
        if (Math.abs(state.panVX) < CONFIG.INERTIA_THRESHOLD) state.panVX = 0;
        if (Math.abs(state.panVY) < CONFIG.INERTIA_THRESHOLD) state.panVY = 0;
        if (state.panVX !== 0 || state.panVY !== 0) keepRendering = true;
    }
    if (state.flowEnabled && (!state.isDrag || state.isEmbedMode) && !state.isExporting) {
        state.panX += driftX;
        state.panY += driftY;
        state.starPanX5 += driftX * CONFIG.STAR_PARALLAX_LARGE;
        state.starPanY5 += driftY * CONFIG.STAR_PARALLAX_LARGE;
        state.starPanX2 += driftX * CONFIG.STAR_PARALLAX_MED;
        state.starPanY2 += driftY * CONFIG.STAR_PARALLAX_MED;
        state.starPanX3 += driftX * CONFIG.STAR_PARALLAX_SMALL;
        state.starPanY3 += driftY * CONFIG.STAR_PARALLAX_SMALL;
        keepRendering = true;
    }

    if (!state.isExporting && Math.abs(state.targetZoom - state.zoom) > 0.0001) {
        let step = (state.targetZoom - state.zoom) * 0.15;
        if (Math.abs(step) < 0.0005) step = state.targetZoom - state.zoom;
        state.setZoom(state.zoom + step, state.zoomCx, state.zoomCy);
        keepRendering = true;
    }

    if (visZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
        if (state.zoomOutStartTime === 0) state.zoomOutStartTime = now;
    } else {
        state.zoomOutStartTime = 0;
    }

    const sz = HEX_R * z, visSz = HEX_R * visZoom;
    let curveAlpha = computeFadeAlpha(visZoom);
    let gridAlpha = curveAlpha;

    const fadeSpeed = state.targetInteractionFade > state.interactionFade ? 0.3 : 0.4;
    state.interactionFade += (state.targetInteractionFade - state.interactionFade) * fadeSpeed;
    if (Math.abs(state.targetInteractionFade - state.interactionFade) > 0.001) keepRendering = true;
    curveAlpha *= state.interactionFade;
    gridAlpha *= state.interactionFade;

    let hexes = [];
    if (img || curveAlpha > 0 || gridAlpha > 0) {
        hexes = visibleHexes(z, px, py, W, H);
        const centerHex = pixToHex(W / 2, H / 2, z, px, py);
        hexes.sort((a, b) => hexDistance(a.q, a.r, centerHex.q, centerHex.r) - hexDistance(b.q, b.r, centerHex.q, centerHex.r));
    }

    if (state.curveColors.length > 1 && curveAlpha > 0.01 && hexes.length > 0) {
        let startTime = performance.now();
        let didWork = true;
        while (didWork && performance.now() - startTime < 16) {
            if (state.queue.length > 0) processQueue();
            else if (findUncoloredTileInHexes(hexes)) processQueue();
            else didWork = false;
        }
        if (didWork) keepRendering = true;
    }

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
    } else if (curveAlpha > 0.01 || gridAlpha > 0.01) {
        if (curveAlpha < 0.99 || gridAlpha < 0.99) {
            if (state.curveCanvas.width !== W || state.curveCanvas.height !== H) {
                state.curveCanvas.width = W;
                state.curveCanvas.height = H;
            }
            state.curveCtx.clearRect(0, 0, W, H);
            const oldCtx = state.ctx;
            state.ctx = state.curveCtx; // Swap context
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
            state.ctx = oldCtx; // Restore context
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

    const lod = visSz > CONFIG.LOD_HIGH_SZ ? 3 : 
                (visSz > CONFIG.LOD_MED_HIGH_SZ ? 2 : 
                (visSz > CONFIG.LOD_MED_LOW_SZ ? 1 : 0));

    // ──── Debug LOD Indicator ────
    const _lodEl = document.getElementById('lodCurrentStatus');
    if (_lodEl) {
        const _txt = `LOD: ${lod} | visSz: ${visSz.toFixed(1)}`;
        if (_lodEl.textContent !== _txt) {
            _lodEl.textContent = _txt;
            _lodEl.style.color = lod === 3 ? 'var(--col-accent)' :
                (lod === 2 ? 'var(--col-fg)' :
                (lod === 1 ? 'var(--col-muted)' :
                'rgba(150,150,150,0.5)'));
        }
    }

    if (lod >= 1 && visZoom > CONFIG.ZOOM_FADE_MID + 0.001 && !state.isExporting) {
        if (!state.isTouchDevice && state.hoveredQ !== null && state.hoveredR !== null) {
            const p = hexToPix(state.hoveredQ, state.hoveredR, z, px, py);
            if (state.visHoverX === null) {
                state.visHoverX = p.x;
                state.visHoverY = p.y;
            } else {
                state.visHoverX += (p.x - state.visHoverX) * CONFIG.HOVER_LERP;
                state.visHoverY += (p.y - state.visHoverY) * CONFIG.HOVER_LERP;
                if (Math.abs(p.x - state.visHoverX) > 0.5 || Math.abs(p.y - state.visHoverY) > 0.5) keepRendering = true;
                else {
                    state.visHoverX = p.x;
                    state.visHoverY = p.y;
                }
            }
            drawHoverStroke(state.visHoverX, state.visHoverY, sz, grid);
        }
        if (state.touchOutlines.length > 0) {
            keepRendering = true;
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
                state.ctx.globalAlpha = t.alpha;
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
    }

    if (state.markersVisible) {
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            const m = state.gradientMarkers[i];
            const outline = getContrastColor(m.color);
            let scale = 1.0;
            if (state.touchState.mode === 'marker_wait' && i === state.touchState.markerIdx && state.touchState.startTime) {
                scale = 1.0 + 2.0 * Math.min(1, (now - state.touchState.startTime) / CONFIG.LONG_PRESS_DUR);
                keepRendering = true;
            }
            drawSunMarker(state.ctx, m.x, m.y, m.color, outline, scale);
        }
    }

    if (now - state.lastStatsUpdate > CONFIG.STATS_UPDATE_INTERVAL) {
        state.lastStatsUpdate = now;
        if (visZoom <= CONFIG.ZOOM_FADE_MID || state.curveColors.length <= 1) {
            dom.statCurvesWrap.style.display = 'none';
            dom.statColorsWrap.style.display = 'none';
        } else {
            dom.statCurvesWrap.style.display = '';
            dom.statColorsWrap.style.display = '';
            const isCollapsed = document.body.classList.contains('sidebar-collapsed');
            const effectiveW = isCollapsed ? W : Math.max(0, W - CONFIG.SIDEBAR_WIDTH);
            let visCurveIDs = new Set();
            for (const h of hexes) {
                if (h.x >= 0 && h.x <= effectiveW && h.y >= 0 && h.y <= H) {
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
        if (curveAlpha === 0) state.edgeRgbMap.clear();
        else {
            const visibleEdgeIDs = new Set();
            for (const h of hexes) {
                for (let e = 0; e < 6; e++) visibleEdgeIDs.add(edgeID(h.q, h.r, e));
            }
            for (const id of state.edgeRgbMap.keys())
                if (!visibleEdgeIDs.has(id)) state.edgeRgbMap.delete(id);
        }
    }

    if (keepRendering || state.edgeColorAnimating || gradColorAnimating || curveColorAnimating) requestRender();
    const tempUnassigned = state.previousUnassignedEdges;
    state.previousUnassignedEdges = state.currentUnassignedEdges;
    state.currentUnassignedEdges = tempUnassigned;
}

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

    const visibleEdges = new Set();
    for (const h of hexes) {
        if (h.x >= 0 && h.x <= effectiveW && h.y >= 0 && h.y <= H) {
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
            let drawSize = (size * coordScale) / 2;

            if (allowBlazing && zoomOutTime > 0) {
                const cycleDuration = CONFIG.STAR_BLAZE_MIN_INTERVAL + hash2D(k * seed + 555, j * seed + 999) * CONFIG.STAR_BLAZE_MAX_INTERVAL_ADD;
                const offset = hash2D(k * seed + 111, j * seed + 222) * cycleDuration;
                const phase = (now + offset) % cycleDuration;
                const blazeDuration = 1200 + hash2D(k * seed + 333, j * seed + 444) * 1800;

                if (phase < blazeDuration) {
                    let blazeT = phase / blazeDuration;
                    let blazeGlow = 0;
                    const origSR = sR,
                        origSA = sA,
                        origDrawSize = drawSize;
                    if (blazeT < 0.25) {
                        let t2 = blazeT / 0.25;
                        drawSize = origDrawSize * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * t2 * blazeFade);
                        sR = Math.round(origSR + (255 - origSR) * t2 * blazeFade);
                        sA = origSA + (Math.min(1, origSA + 0.5) - origSA) * t2 * blazeFade;
                        blazeGlow = t2 * blazeFade;
                    } else if (blazeT < 0.55) {
                        let t2 = (blazeT - 0.25) / 0.30;
                        drawSize = origDrawSize * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * blazeFade);
                        sR = Math.round(origSR + (255 - origSR) * blazeFade);
                        sA = (origSA + (Math.min(1, origSA + 0.5) - origSA) * blazeFade) * (1 - t2);
                        blazeGlow = (1 - t2) * blazeFade;
                    } else if (blazeT < 0.65) {
                        sA = 0;
                        blazeGlow = 0;
                    } else {
                        let t2 = (blazeT - 0.65) / 0.35;
                        drawSize = origDrawSize;
                        sR = origSR;
                        sA = origSA * t2;
                        blazeGlow = 0;
                    }
                    if (blazeGlow > 0) {
                        const glowRadius = (180 + hash2D(k * seed + 777, j * seed + 888) * 120) * coordScale;
                        const glow = state.ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
                        glow.addColorStop(0, `rgba(255, 255, 240, ${0.4 * blazeGlow})`);
                        glow.addColorStop(0.4, `rgba(150, 200, 255, ${0.2 * blazeGlow})`);
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

function getContrastColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140 ? COLORS.black : COLORS.white;
}

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

function applyCurveStyle(q, r, e, sz, now) {
    state.ctx.setLineDash([]);
    const id = edgeID(q, r, e);
    let targetRgb = null,
        targetCurveID = -1;
    if (state.curveColors.length === 1) {
        const c = state.curveColorsRGB[0];
        if (c) targetRgb = {
            r: c.tr !== undefined ? c.tr : c.r,
            g: c.tg !== undefined ? c.tg : c.g,
            b: c.tb !== undefined ? c.tb : c.b
        };
        else {
            const rgb = hexToRgb(state.curveColors[0]);
            targetRgb = {
                r: rgb[0],
                g: rgb[1],
                b: rgb[2]
            };
        }
        targetCurveID = -2;
    } else if (state.curveMap.has(id)) {
        targetCurveID = state.curveMap.get(id);
        let curve = state.curves.get(targetCurveID);
        if (curve) {
            let c = curve.color;
            if (typeof c === 'number') {
                const cc = state.curveColorsRGB[c % state.curveColorsRGB.length];
                targetRgb = {
                    r: cc.tr !== undefined ? cc.tr : cc.r,
                    g: cc.tg !== undefined ? cc.tg : cc.g,
                    b: cc.tb !== undefined ? cc.tb : cc.b
                };
            } else {
                const rgb = hexToRgb(c);
                targetRgb = {
                    r: rgb[0],
                    g: rgb[1],
                    b: rgb[2]
                };
            }
        }
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
                edgeData.alpha = 0; // Reset width multiplier
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
        state.ctx.lineWidth = Math.max(0.1, (sz / 3) * state.curveLineWidth * edgeData.alpha);
        return true;
    }
    state.currentUnassignedEdges.add(id);
    if (state.showUnrenderedDotted) {
        state.ctx.strokeStyle = `rgba(110, 110, 144, 0.55)`;
        state.ctx.lineWidth = Math.max(1, (sz / 10) * state.curveLineWidth);
        const dash = Math.max(2, sz / 8);
        state.ctx.setLineDash([dash, dash]);
        return true;
    }
    return false;
}

function drawHoverStroke(cx, cy, sz, grid) {
    if (state.interactionFade < 0.01) return;
    
    const rSz = grid ? sz * 0.95 : sz;
    state.ctx.save();
    
    state.ctx.globalAlpha = state.interactionFade;
    
    traceHexPath(state.ctx, cx, cy, rSz);
    state.ctx.lineWidth = 3;
    state.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    state.ctx.stroke();
    state.ctx.lineWidth = 1.5;
    state.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    state.ctx.stroke();
    state.ctx.restore();
}

import {
    CONFIG,
    COLORS
} from './config.js';
import {
    generateDistinctThemePool,
    hexToRgb
} from './utils.js';
import {
    state
} from './state.js';
import {
    dom
} from './dom.js';
import {
    renderGradientList,
    renderCurveList
} from './ui.js';
import {
    hexKey,
    tileRot,
    isTileAlter
} from './math.js';
import {
    initializeCentralTile,
    edgeID,
    getNeighbor,
    getOtherEdge
} from './curves.js';
import {
    setupEvents,
    scheduleLiveTwist
} from './events.js';
import {
    requestRender,
    resize,
    render
} from './render.js';
import {
    setupExport,
    getScreenSVG
} from './export.js';

async function initializeApp() {
    injectCssVariables();
    setupLodTuner();
    await parseEmbedData();
    setupCacheBridges();
    setupDeployInfo();
    startMemoryMonitor();

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'REQUEST_FRAME') {
            try {
                const svgString = getScreenSVG();
                window.parent.postMessage({
                    type: 'SEND_FRAME',
                    svg: svgString
                }, '*');
            } catch (e) {
                console.error("SVG capture failed:", e);
                window.parent.postMessage({
                    type: 'SEND_FRAME',
                    error: e.message
                }, '*');
            }
        }
    });
    state.curveColorPool = generateDistinctThemePool();
    state.gradientColorPool = generateDistinctThemePool();

    setupEvents();
    setupExport();

    if (state.isEmbedMode && state.embedData) {
        initializeEmbedMode();
    } else {
        initializeStandardMode();
    }

    setupFaviconAndGhLink();
}

function injectCssVariables() {
    const root = document.documentElement.style;
    const map = {
        '--col-bg': COLORS.bg,
        '--col-fg': COLORS.fg,
        '--col-muted': COLORS.muted,
        '--col-accent': COLORS.accent,
        '--col-accent-dim': COLORS.accentDim,
        '--col-card': COLORS.card,
        '--col-card2': COLORS.card2,
        '--col-border': COLORS.border,
        '--col-hover-border': COLORS.hoverBorder,
    };
    for (const [key, val] of Object.entries(map)) root.setProperty(key, val);
}

function setupLodTuner() {
    const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '';
    if (!isLocalDev) {
        document.getElementById('lod-tuner')?.remove();
        return;
    }

    const lodTuner = {
        HighSz: document.getElementById('lodHighSz'),
        MedHighSz: document.getElementById('lodMedHighSz'),
        MedLowSz: document.getElementById('lodMedLowSz'),
        ExtHigh: document.getElementById('lodExtHigh'),
        ExtMedHigh: document.getElementById('lodExtMedHigh'),
        ExtMedLow: document.getElementById('lodExtMedLow'),
        ExtLow: document.getElementById('lodExtLow')
    };

    const lodLabels = {
        HighSz: document.getElementById('vLodHighSz'),
        MedHighSz: document.getElementById('vLodMedHighSz'),
        MedLowSz: document.getElementById('vLodMedLowSz'),
        ExtHigh: document.getElementById('vLodExtHigh'),
        ExtMedHigh: document.getElementById('vLodExtMedHigh'),
        ExtMedLow: document.getElementById('vLodExtMedLow'),
        ExtLow: document.getElementById('vLodExtLow')
    };

    Object.keys(lodTuner).forEach(key => {
        lodTuner[key].addEventListener('input', () => {
            lodLabels[key].textContent = lodTuner[key].value;
        });
    });

    document.getElementById('lodApplyBtn').addEventListener('click', () => {
        CONFIG.LOD_HIGH_SZ = +lodTuner.HighSz.value;
        CONFIG.LOD_MED_HIGH_SZ = +lodTuner.MedHighSz.value;
        CONFIG.LOD_MED_LOW_SZ = +lodTuner.MedLowSz.value;
        CONFIG.LOD_EXT_HIGH = +lodTuner.ExtHigh.value;
        CONFIG.LOD_EXT_MED_HIGH = +lodTuner.ExtMedHigh.value;
        CONFIG.LOD_EXT_MED_LOW = +lodTuner.ExtMedLow.value;
        CONFIG.LOD_EXT_LOW = +lodTuner.ExtLow.value;
        requestRender();
    });
}

async function parseEmbedData() {
    const embedMatch = location.hash.match(/^#embed=(.+)$/);
    state.isEmbedMode = !!embedMatch;

    if (state.isEmbedMode) {
        try {
            const raw = embedMatch[1];
            let jsonStr = '';

            let decompressed = false;

            // 1. Restore standard Base64 from URL-safe Base64
            let base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '='; // Restore padding
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            if (typeof DecompressionStream !== 'undefined') {
                // Try GZIP first (Stronger compression for new embeds)
                try {
                    const inputStream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(bytes);
                            controller.close();
                        }
                    });
                    const stream = inputStream.pipeThrough(new DecompressionStream('gzip'));
                    jsonStr = await new Response(stream).text();
                    decompressed = true;
                } catch (e) {
                    // Try DEFLATE fallback (For older embeds generated before the upgrade)
                    try {
                        const inputStream = new ReadableStream({
                            start(controller) {
                                controller.enqueue(bytes);
                                controller.close();
                            }
                        });
                        const stream = inputStream.pipeThrough(new DecompressionStream('deflate'));
                        jsonStr = await new Response(stream).text();
                        decompressed = true;
                    } catch (e2) {
                        // Failed both compressed formats
                    }
                }
            }

            // Final Fallback: Legacy uncompressed embeds or very old browsers
            if (!decompressed) {
                try {
                    jsonStr = decodeURIComponent(escape(atob(raw)));
                } catch (e) {
                    throw new Error('Failed to parse embed data');
                }
            }

            state.embedData = JSON.parse(jsonStr);
        } catch (e) {
            console.error('Embed parse error', e);
            state.isEmbedMode = false;
        }
    }

    if (state.isEmbedMode) document.body.classList.add('embed-mode');
}

function setupCacheBridges() {
    state.updateCurveColorsCache = function() {
        while (state.curveColorsRGB.length < state.curveColors.length) {
            const rgb = hexToRgb(state.curveColors[state.curveColorsRGB.length]);
            state.curveColorsRGB.push({
                r: rgb[0],
                g: rgb[1],
                b: rgb[2],
                tr: rgb[0],
                tg: rgb[1],
                tb: rgb[2]
            });
        }
        if (state.curveColorsRGB.length > state.curveColors.length) state.curveColorsRGB.length = state.curveColors.length;
        for (let i = 0; i < state.curveColors.length; i++) {
            const rgb = hexToRgb(state.curveColors[i]);
            state.curveColorsRGB[i].tr = rgb[0];
            state.curveColorsRGB[i].tg = rgb[1];
            state.curveColorsRGB[i].tb = rgb[2];
        }
    };

    state.updateGradientMarkersCache = function() {
        while (state.gradientMarkersRGB.length < state.gradientMarkers.length) {
            const m = state.gradientMarkers[state.gradientMarkersRGB.length];
            const rgb = hexToRgb(m.color);
            state.gradientMarkersRGB.push({
                x: m.x,
                y: m.y,
                r: rgb[0],
                g: rgb[1],
                b: rgb[2],
                tr: rgb[0],
                tg: rgb[1],
                tb: rgb[2],
                weight: 0
            });
        }
        if (state.gradientMarkersRGB.length > state.gradientMarkers.length) state.gradientMarkersRGB.length = state.gradientMarkers.length;
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            const m = state.gradientMarkers[i];
            state.gradientMarkersRGB[i].x = m.x;
            state.gradientMarkersRGB[i].y = m.y;
            const rgb = hexToRgb(m.color);
            state.gradientMarkersRGB[i].tr = rgb[0];
            state.gradientMarkersRGB[i].tg = rgb[1];
            state.gradientMarkersRGB[i].tb = rgb[2];
        }
        state.isGradientDirty = true;
    };
}

function setupDeployInfo() {
    try {
        const hostParts = location.hostname.split('.');
        if (hostParts.length === 3 && hostParts[1] === 'github' && hostParts[2] === 'io') {
            const user = hostParts[0],
                path = location.pathname.split('/')[1];
            dom.ghLink.href = path ? `https://github.com/${user}/${path}` : `https://github.com/${user}/${user}.github.io`;
        }
    } catch (e) {}

    const deployInfoEl = document.getElementById('deployInfo');
    if (deployInfoEl) {
        const currentText = deployInfoEl.innerHTML;
        if (!currentText || currentText.includes('VITE_DEPLOY_INFO')) {
            deployInfoEl.innerHTML = 'LOCAL DEVELOPMENT';
        }
    }
}

function startMemoryMonitor() {
    setInterval(() => {
        if (performance.memory) {
            const usedRAM = performance.memory.usedJSHeapSize;
            if (usedRAM > 200 * 1024 * 1024) {
                if (window.gc) {
                    try {
                        window.gc();
                        console.log("GC has been successfully called");
                    } catch (e) {}
                } else console.log("RAM is above 200MB, but window.gc is not exposed in this browser.");
            }
        }
    }, 15000);
}

function setupFaviconAndGhLink() {
    const generatedFaviconUrl = generateFavicon();
    if (state.isEmbedMode) {
        dom.ghLink.href = location.href.split('#')[0];
        dom.ghLink.title = 'Open Full Interface';
        const img = document.createElement('img');
        img.src = generatedFaviconUrl;
        img.style.width = '14px';
        img.style.height = '14px';
        img.style.verticalAlign = 'middle';
        img.style.position = 'relative';
        img.style.top = '-1px';
        dom.ghLink.innerHTML = '';
        dom.ghLink.appendChild(img);
    }
}

function initializeStandardMode() {
    dom.gridToggle.checked = true;
    dom.bgStarsToggle.checked = true;
    dom.markersToggle.checked = false;
    dom.flowToggle.checked = false;
    dom.liveTwistsToggle.checked = false;
    dom.inertiaToggle.checked = true;
    dom.sCurveW.value = 1.0;
    dom.vCurveW.textContent = '1.00x';
    dom.sAlterTiles.value = 0;
    dom.vAlterTiles.textContent = '0.00';
    state.showGrid = true;
    state.showBgStars = true;
    state.markersVisible = false;
    state.flowEnabled = false;
    state.inertiaEnabled = true;
    state.curveLineWidth = 1.0;
    state.alterTilesRatio = 0;
    state.liveTwistsEnabled = false;

    state.curveColors.length = 0;
    state.curveColors.push('#444444');
    state.gradientMarkers.length = 0;
    state.updateCurveColorsCache();
    state.updateGradientMarkersCache();

    resize();
    render();
}

function initializeEmbedMode() {
    const d = state.embedData;
    state.zoom = d.zoom;
    state.targetZoom = d.zoom;
    state.panX = d.panX;
    state.panY = d.panY;

    const origZoom = d.origZoom || d.zoom;
    state.starPanX5 = d.starPanX5 !== undefined ? d.starPanX5 : state.panX;
    state.starPanY5 = d.starPanY5 !== undefined ? d.starPanY5 : state.panY;
    state.starPanX2 = d.starPanX2 !== undefined ? d.starPanX2 : state.panX;
    state.starPanY2 = d.starPanY2 !== undefined ? d.starPanY2 : state.panY;
    state.starPanX3 = d.starPanX3 !== undefined ? d.starPanX3 : state.panX;
    state.starPanY3 = d.starPanY3 !== undefined ? d.starPanY3 : state.panY;

    state.starZoom5 = Math.pow(origZoom, CONFIG.STAR_ZOOM_EXP_LARGE);
    state.starZoom2 = Math.pow(origZoom, CONFIG.STAR_ZOOM_EXP_MED);
    state.starZoom3 = Math.pow(origZoom, CONFIG.STAR_ZOOM_EXP_SMALL);

    state.showGrid = d.showGrid;
    state.markersVisible = d.markersVisible !== undefined ? d.markersVisible : false;
    state.showBgStars = d.showBgStars !== undefined ? d.showBgStars : true;

    // FORCE DISABLE MOVEMENT & INTERACTION ANIMATIONS (except flow if explicitly enabled)
    state.flowEnabled = d.flowEnabled || false;
    state.liveTwistsEnabled = false;
    state.inertiaEnabled = false;

    state.curveLineWidth = d.curveLineWidth || 1;
    state.alterTilesRatio = d.alterTilesRatio || 0;
    state.rotMode = d.rotMode || 'hash';
    state.rotSeed = d.rotSeed || 0;
    state.randomSeed = d.randomSeed || 0;

    state.texTf = d.texTf || {
        rot: 0,
        scale: 1,
        sx: 1,
        sy: 1,
        ox: 0,
        oy: 0
    };
    state.embedTexBaseSize = d.texBaseSize || 88;

    state.curveColors.length = 0;
    state.curveColors.push(...(d.curveColors && d.curveColors.length > 0 ? [...d.curveColors].slice(0, CONFIG.MAX_CURVE_COLORS) : ['#444444']));

    state.gradientMarkers.length = 0;
    // Handle both new array format [x, y, color] and old object format {x, y, color}
    state.gradientMarkers.push(...(d.markers || []).slice(0, CONFIG.MAX_MARKERS).map(m => {
        if (Array.isArray(m)) return {
            x: m[0],
            y: m[1],
            color: m[2]
        };
        return {
            ...m
        };
    }));
    state.markersVisible = false;

    state.updateCurveColorsCache();
    state.updateGradientMarkersCache();

    dom.gridToggle.checked = state.showGrid;
    dom.bgStarsToggle.checked = state.showBgStars;
    dom.markersToggle.checked = state.markersVisible;
    dom.flowToggle.checked = state.flowEnabled;
    dom.sCurveW.value = state.curveLineWidth;
    dom.vCurveW.textContent = state.curveLineWidth.toFixed(2) + 'x';
    dom.sAlterTiles.value = state.alterTilesRatio;
    dom.vAlterTiles.textContent = state.alterTilesRatio.toFixed(2);
    dom.liveTwistsToggle.checked = state.liveTwistsEnabled;

    // --- ROTATION DESERIALIZATION WITH FORMATTING FALLBACKS ---
    if (d.rotOverrides && d.rotOverrides.length > 0) {
        if (Array.isArray(d.rotOverrides[0])) {
            // Legacy fallback 1: [[q, r, rot], ...]
            for (const [q, r, rot] of d.rotOverrides) {
                state.rotOverrides.set(hexKey(q, r), rot);
            }
        } else if (typeof d.rotOverrides[3] === 'string') {
            // NEW Optimized string format: [minQ, minR, rCount, "41340..."]
            const [minQ, minR, rCount, rotsStr] = d.rotOverrides;
            if (rotsStr.length > 0 && rCount > 0) {
                const qCount = rotsStr.length / rCount;
                let idx = 0;

                for (let i = 0; i < qCount; i++) {
                    const q = minQ + i;
                    for (let j = 0; j < rCount; j++) {
                        const r = minR + j;
                        const mult = +rotsStr[idx];
                        state.rotOverrides.set(hexKey(q, r), mult * 60);
                        idx++;
                    }
                }
            }
        } else {
            // Legacy fallback 2: [minQ, minR, rCount, 4, 1, 3, 4] (Previous flat array)
            const [minQ, minR, rCount, ...rots] = d.rotOverrides;
            if (rots.length > 0 && rCount > 0) {
                const qCount = rots.length / rCount;
                let idx = 0;

                for (let i = 0; i < qCount; i++) {
                    const q = minQ + i;
                    for (let j = 0; j < rCount; j++) {
                        const r = minR + j;
                        state.rotOverrides.set(hexKey(q, r), rots[idx] * 60);
                        idx++;
                    }
                }
            }
        }
    }

    if (d.texture) {
        const img = new Image();
        img.onload = () => {
            state.texImg = img;
            dom.resetTexBtn.style.display = 'block';
            startEmbedRender();
        };
        img.onerror = startEmbedRender;
        img.src = d.texture;
    } else {
        startEmbedRender();
    }
}

function startEmbedRender() {
    const d = state.embedData;
    dom.cvs.width = d.w;
    dom.cvs.height = d.h;
    state.embedPrevW = d.w;
    state.embedPrevH = d.h;
    state.isInitialized = true;

    state.curveMap.clear();
    state.edgeRgbMap.clear();
    state.curves.clear();
    state.queue.length = 0;

    if (d.curves && d.curves.length > 0) {
        const gMinQ = d.rotOverrides[0];
        const gMinR = d.rotOverrides[1];
        const gRCount = d.rotOverrides[2];

        // Check if it's the new flat array format (starts with a number) 
        // or legacy array-of-arrays/object format
        const isFlatFormat = typeof d.curves[0] === 'number';

        const loopCount = isFlatFormat ? d.curves.length / 4 : d.curves.length;

        for (let i = 0; i < loopCount; i++) {
            const newID = state.nextCurveID++;
            const edgeSet = new Set();

            let sq, sr, se, size, finalColor;

            if (isFlatFormat) {
                // NEW Flat format: [startIdx, se, size, colorIdx, ...]
                const startIdx = d.curves[i * 4];
                se = d.curves[i * 4 + 1];
                size = d.curves[i * 4 + 2];
                finalColor = d.curves[i * 4 + 3];

                sq = gMinQ + Math.floor(startIdx / gRCount);
                sr = gMinR + (startIdx % gRCount);
            } else {
                // Legacy format fallback (array of objects or arrays)
                const sc = d.curves[i];
                finalColor = sc.c;
                if (sc.e) {
                    for (const id of sc.e) edgeSet.add(id);
                    sq = null; // Skip walking
                } else if (sc.s) {
                    if (sc.s.length === 4) {
                        [sq, sr, se, size] = sc.s;
                    } else {
                        const startIdx = sc.s[0];
                        se = sc.s[1];
                        size = sc.s[2];
                        sq = gMinQ + Math.floor(startIdx / gRCount);
                        sr = gMinR + (startIdx % gRCount);
                    }
                }
            }

            if (sq !== null && sq !== undefined) {
                let curr = {
                    q: sq,
                    r: sr,
                    e: se
                };
                edgeSet.add(edgeID(sq, sr, se));

                for (let j = 1; j < size; j++) {
                    const k = (tileRot(curr.q, curr.r) / 60) % 6;
                    const alter = isTileAlter(curr.q, curr.r);
                    const pe = getOtherEdge(k, curr.e, alter);
                    const n = getNeighbor(curr.q, curr.r, pe);
                    curr = {
                        q: n.q,
                        r: n.r,
                        e: n.edge
                    };
                    edgeSet.add(edgeID(curr.q, curr.r, curr.e));
                }
            }

            if (typeof finalColor === 'string') {
                // Legacy hex string color fallback
                const lowerC = finalColor.toLowerCase();
                const idx = state.curveColors.findIndex(c => c.toLowerCase() === lowerC);
                finalColor = (idx !== -1) ? idx : 0;
            } else {
                finalColor = (finalColor >= 0 && finalColor < state.curveColors.length) ? finalColor : 0;
            }

            state.curves.set(newID, {
                id: newID,
                color: finalColor,
                size: edgeSet.size,
                locked: false,
                edges: edgeSet
            });

            for (const id of edgeSet) {
                state.curveMap.set(id, newID);
            }
        }
    } else {
        initializeCentralTile(d.centerQ, d.centerR);
    }

    if (d.origZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
        state.zoomOutStartTime = Date.now() - CONFIG.STAR_BLAZE_DELAY - 1000;
    }

    render();
}

function generateFavicon() {
    const favCanvas = document.createElement('canvas');
    favCanvas.width = 64;
    favCanvas.height = 64;
    const fctx = favCanvas.getContext('2d');
    const sz = 32,
        cx = 32,
        cy = 32,
        rSz = sz * 0.95;
    const PI_DIV_3 = CONFIG.PI_DIV_3,
        TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3,
        FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;
    const SQRT3 = CONFIG.SQRT3,
        a = sz * SQRT3 / 2;
    const randomAngle = Math.floor(Math.random() * 6) * PI_DIV_3;

    fctx.save();
    fctx.translate(cx, cy);
    fctx.rotate(randomAngle);
    fctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = PI_DIV_3 * i,
            vx = rSz * Math.cos(angle),
            vy = rSz * Math.sin(angle);
        i === 0 ? fctx.moveTo(vx, vy) : fctx.lineTo(vx, vy);
    }
    fctx.closePath();
    fctx.fillStyle = '#CCCCCC';
    fctx.fill();
    fctx.strokeStyle = '#444444';
    fctx.lineWidth = 2;
    fctx.stroke();
    fctx.clip();
    fctx.lineCap = 'round';
    fctx.strokeStyle = '#444444';
    fctx.lineWidth = sz / 3.5;
    fctx.beginPath();
    fctx.arc(-sz, 0, sz / 2, -PI_DIV_3, PI_DIV_3, false);
    fctx.stroke();
    fctx.beginPath();
    fctx.arc(1.5 * sz, -a, 1.5 * sz, TWO_PI_DIV_3, Math.PI, false);
    fctx.stroke();
    fctx.beginPath();
    fctx.arc(1.5 * sz, a, 1.5 * sz, Math.PI, FOUR_PI_DIV_3, false);
    fctx.stroke();
    fctx.restore();

    const url = favCanvas.toDataURL('image/png');
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = url;
    return url;
}

//  START APP
initializeApp();
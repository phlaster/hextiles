import { CONFIG, COLORS } from './config.js';
import { generateDistinctThemePool, hexToRgb } from './utils.js';
import { state } from './state.js';
import { dom } from './dom.js';
import { renderGradientList, renderCurveList } from './ui.js';
import { hexKey } from './math.js';
import { initializeCentralTile } from './curves.js';
import { setupEvents, scheduleLiveTwist } from './events.js';
import { requestRender, resize, render } from './render.js';
import { setupExport } from './export.js';

function initializeApp() {
    injectCssVariables();
    setupLodTuner();
    parseEmbedData();
    setupCacheBridges();
    setupDeployInfo();
    startMemoryMonitor();

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

function parseEmbedData() {
    const embedMatch = location.hash.match(/^#embed=(.+)$/);
    state.isEmbedMode = !!embedMatch;
    if (state.isEmbedMode) {
        try {
            state.embedData = JSON.parse(decodeURIComponent(escape(atob(embedMatch[1]))));
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
                r: rgb[0], g: rgb[1], b: rgb[2],
                tr: rgb[0], tg: rgb[1], tb: rgb[2]
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
                x: m.x, y: m.y,
                r: rgb[0], g: rgb[1], b: rgb[2],
                tr: rgb[0], tg: rgb[1], tb: rgb[2],
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
    state.showGrid = dom.gridToggle.checked;
    state.showBgStars = dom.bgStarsToggle.checked;
    state.markersVisible = dom.markersToggle.checked;
    state.flowEnabled = dom.flowToggle.checked;
    state.inertiaEnabled = dom.inertiaToggle.checked;
    state.curveLineWidth = +dom.sCurveW.value || 1;
    dom.vCurveW.textContent = state.curveLineWidth.toFixed(2) + 'x';
    state.alterTilesRatio = +dom.sAlterTiles.value || 0;
    dom.vAlterTiles.textContent = state.alterTilesRatio.toFixed(2);
    state.liveTwistsEnabled = dom.liveTwistsToggle.checked;
    if (state.liveTwistsEnabled) scheduleLiveTwist();
    
    state.curveColors.length = 0;
    state.curveColors.push('#444444');
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
    state.showGrid = d.showGrid;
    state.markersVisible = d.markersVisible;
    state.showBgStars = d.showBgStars !== undefined ? d.showBgStars : true;
    state.rotMode = d.rotMode || 'hash';
    state.randomSeed = d.randomSeed || 0;
    state.rotSeed = d.rotSeed || 0;
    state.curveLineWidth = d.curveLineWidth || 1;
    state.alterTilesRatio = d.alterTilesRatio || 0;
    state.flowEnabled = d.flowEnabled || false;
    state.liveTwistsEnabled = d.liveTwistsEnabled || false;
    state.inertiaEnabled = d.inertiaEnabled !== undefined ? d.inertiaEnabled : true;
    dom.inertiaToggle.checked = state.inertiaEnabled;
    state.texTf = d.texTf || { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
    
    state.curveColors.length = 0;
    state.curveColors.push(...(d.curveColors && d.curveColors.length > 0 ? [...d.curveColors].slice(0, CONFIG.MAX_CURVE_COLORS) : ['#444444']));
    state.gradientMarkers.length = 0;
    state.gradientMarkers.push(...(d.markers || []).slice(0, CONFIG.MAX_MARKERS).map(m => ({ ...m })));
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
    if (state.liveTwistsEnabled) scheduleLiveTwist();

    if (d.rotOverrides) {
        for (const [q, r, rot] of d.rotOverrides) state.rotOverrides.set(hexKey(q, r), rot);
    }

    if (d.texture) {
        const img = new Image();
        img.onload = () => {
            state.texImg = img;
            startEmbedRender();
        };
        img.onerror = startEmbedRender;
        img.src = d.texture;
    } else {
        startEmbedRender();
    }
}

function startEmbedRender() {
    dom.cvs.width = state.embedData.w;
    dom.cvs.height = state.embedData.h;
    state.isInitialized = true;
    state.curveMap.clear();
    state.edgeRgbMap.clear();
    state.curves.clear();
    state.queue.length = 0;
    initializeCentralTile();
    if (state.embedData.origZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
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
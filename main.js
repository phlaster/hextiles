import { CONFIG, COLORS, COLOR_THEMES } from './config.js';
import { hexToRgb, rgbToHex, colorDistance, shuffleArray, generateDistinctThemePool } from './utils.js';
import { state } from './state.js';

// ─── inject CSS custom properties from COLORS ───
(function injectColors() {
    const r = document.documentElement.style;
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
    for (const [key, val] of Object.entries(map)) {
        r.setProperty(key, val);
    }
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  APPLICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(() => {
    // ──── Embed mode detection ────
    const embedMatch = location.hash.match(/^#embed=(.+)$/);
    let isEmbedMode = !!embedMatch;
    let embedData = null;
    if (isEmbedMode) {
        try { embedData = JSON.parse(decodeURIComponent(escape(atob(embedMatch[1])))); }
        catch(e) { console.error('Embed parse error', e); isEmbedMode = false; }
    }
    if (isEmbedMode) document.body.classList.add('embed-mode');

    // ──── Local aliases for CONFIG constants (for brevity in code) ────
    const HEX_R = CONFIG.HEX_R;
    const SQRT3 = CONFIG.SQRT3;
    const MIN_Z = CONFIG.MIN_ZOOM;
    const MAX_Z = CONFIG.MAX_ZOOM;
    const CLICK_THRESH = CONFIG.CLICK_THRESH;
    const CLICK_DUR = CONFIG.CLICK_DUR;
    const BULK_DUR = CONFIG.BULK_DUR;
    const ROT_STEP = CONFIG.ROT_STEP;
    const ROT_MOD = 360 / ROT_STEP;
    const DEG2RAD = CONFIG.DEG2RAD;
    const PI_DIV_3 = CONFIG.PI_DIV_3;
    const TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3;
    const FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;

    const TRACE_QUEUE_MARGIN = CONFIG.TRACE_QUEUE_MARGIN;
    const TRACE_MAX_PER_FRAME = CONFIG.TRACE_MAX_PER_FRAME;
    const TRACE_SEARCH_MARGIN = CONFIG.TRACE_SEARCH_MARGIN;
    const VISIBLE_BOUND_MULT = CONFIG.VISIBLE_BOUND_MULT;

    // ──── State ────
    let zoom = 1,
        targetZoom = 1,
        panX = 0,
        panY = 0;
    let zoomCx = 0,
        zoomCy = 0;
    let zoomOutBlockedUntil = 0; 
    let magnetTimer = null;
    let isTouchDevice = false;
    let touchOutlines = [];
    let isDrag = false,
        dragSX = 0,
        dragSY = 0,
        dragPX = 0,
        dragPY = 0,
        dragMoved = false;
    let isExporting = false;
    let embedDragLastTile = null;
    let mouseScreenX = -9999,
        mouseScreenY = -9999;
    let hoveredQ = null,
        hoveredR = null;
    let visHoverX = null,
        visHoverY = null;
    let showGrid = true;
    let curveLineWidth = 1;
    let alterTilesRatio = 0;
    let showUnrenderedDotted = true;
    let showBgStars = true;
    let flowEnabled = false;
    let inertiaEnabled = true;
    let panVX = 0, panVY = 0;
    let lastPanMoveTime = 0;
    let driftAngle = Math.random() * Math.PI * 2;
    let driftTargetAngle = driftAngle;
    let flowState = 'drift';
    let flowStateEndTime = 0;
    let driftSpeed = 0.5;
    let driftTargetSpeed = 0.5;
    let isInitialized = false;
    let rotMode = 'hash';
    let randomSeed = 0;
    let rotSeed = 0; // Separate seed for rotation randomization
    let texImg = null;
    let pendImg = null;
    let texTf = { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
    const rotOverrides = new Map();
    const animMap = new Map();

    // ── use COLORS.markers and COLORS.curves directly ──
    let gradientMarkers = [];
    let gradientMarkersRGB = []; // Cached RGB values for gradient markers
    let fadingMarkersRGB = []; // Cached RGB values for markers currently fading out
    let currentAvgR = 0, currentAvgG = 0, currentAvgB = 0;
    let draggedMarkerIndex = -1;
    let isDragMarker = false;
    let dragMarkerOffsetX = 0;
    let dragMarkerOffsetY = 0;
    let interactionFade = 1.0;
    let targetInteractionFade = 1.0;
    let targetMarkerTouchScale = 1.0;
    let gradientCanvas = null;
    let curveCanvas = document.createElement('canvas');
    let curveCtx = curveCanvas.getContext('2d');
    const starColorCache = new Map();
    let markersVisible = true;

    let curveColors = ['#444444']; // Target colors
    let curveColorsRGB = []; // Cached RGB arrays for curve colors

    // Pre-parse and cache RGB values to avoid repeated string parsing in render loop
    function updateCurveColorsCache() {
        while (curveColorsRGB.length < curveColors.length) {
            const rgb = hexToRgb(curveColors[curveColorsRGB.length]);
            curveColorsRGB.push({ r: rgb[0], g: rgb[1], b: rgb[2], tr: rgb[0], tg: rgb[1], tb: rgb[2] });
        }
        if (curveColorsRGB.length > curveColors.length) {
            curveColorsRGB.length = curveColors.length;
        }
        for (let i = 0; i < curveColors.length; i++) {
            const rgb = hexToRgb(curveColors[i]);
            curveColorsRGB[i].tr = rgb[0];
            curveColorsRGB[i].tg = rgb[1];
            curveColorsRGB[i].tb = rgb[2];
        }
    }

    function updateGradientMarkersCache() {
        while (gradientMarkersRGB.length < gradientMarkers.length) {
            const m = gradientMarkers[gradientMarkersRGB.length];
            const rgb = hexToRgb(m.color);
            gradientMarkersRGB.push({ 
                x: m.x, y: m.y, 
                r: rgb[0], g: rgb[1], b: rgb[2], 
                tr: rgb[0], tg: rgb[1], tb: rgb[2],
                weight: 0 // Start at 0 for fade-in
            });
        }
        if (gradientMarkersRGB.length > gradientMarkers.length) {
            gradientMarkersRGB.length = gradientMarkers.length;
        }
        for (let i = 0; i < gradientMarkers.length; i++) {
            const m = gradientMarkers[i];
            gradientMarkersRGB[i].x = m.x;
            gradientMarkersRGB[i].y = m.y;
            const rgb = hexToRgb(m.color);
            gradientMarkersRGB[i].tr = rgb[0];
            gradientMarkersRGB[i].tg = rgb[1];
            gradientMarkersRGB[i].tb = rgb[2];
        }
        isGradientDirty = true;
    }

    let edgeRgbMap = new Map(); // Tracks current animated RGB for each individual edge
    let edgeColorAnimating = false; // Flag to keep rendering
    let lastRipple = { q: 0, r: 0, time: 0 }; // Epicenter for color wave
    let activeCurveIndex = 0;
    let nextCurveID = 0;
    const curveMap = new Map();
    const curves = new Map();
    let queue = [];
    
    let curveColorPool = { name: '', pool: [] };
    let gradientColorPool = { name: '', pool: [] };

    // ──── DOM Cache ────
    const dom = {
        cvs: document.getElementById('hexCanvas'),
        wrap: document.getElementById('canvas-wrap'),

        zoomLabel: document.getElementById('zoomLabel'),
        zoomIn: document.getElementById('zoomIn'),
        zoomOut: document.getElementById('zoomOut'),
        gridToggle: document.getElementById('gridToggle'),
        uploadZone: document.getElementById('uploadZone'),
        fileInput: document.getElementById('fileInput'),
        fileName: document.getElementById('fileName'),
        editorPanel: document.getElementById('editorPanel'),
        resetTexBtn: document.getElementById('resetTexBtn'),
        resetAllRot: document.getElementById('resetAllRot'),
        randAnglesBtn: document.getElementById('randAnglesBtn'),
        randLineColorsBtn: document.getElementById('randLineColorsBtn'),
        randGradColorsBtn: document.getElementById('randGradColorsBtn'),
        unrenderedToggle: document.getElementById('unrenderedToggle'),
        markersToggle: document.getElementById('markersToggle'),
        cancelEd: document.getElementById('cancelEd'),
        applyEd: document.getElementById('applyEd'),
        toast: document.getElementById('toast'),
        previewCanvas: document.getElementById('previewCanvas'),
        sRot: document.getElementById('sRot'),
        sScale: document.getElementById('sScale'),
        sSX: document.getElementById('sSX'),
        sSY: document.getElementById('sSY'),
        sOX: document.getElementById('sOX'),
        sOY: document.getElementById('sOY'),
        vRot: document.getElementById('vRot'),
        vScale: document.getElementById('vScale'),
        vSX: document.getElementById('vSX'),
        vSY: document.getElementById('vSY'),
        vOX: document.getElementById('vOX'),
        vOY: document.getElementById('vOY'),
        gradientList: document.getElementById('gradientList'),
        addMarkerBtn: document.getElementById('addMarkerBtn'),
        curveList: document.getElementById('curveList'),
        addCurveBtn: document.getElementById('addCurveBtn'),

        exportBtn: document.getElementById('exportBtn'),
        exportOverlay: document.getElementById('exportOverlay'),
        exportFrame: document.getElementById('exportFrame'),
        exportMenu: document.getElementById('exportMenu'),
        exportBackdrop: document.getElementById('exportBackdrop'),
        exportW: document.getElementById('exportW'),
        exportH: document.getElementById('exportH'),
        exportPngBtn: document.getElementById('exportPngBtn'),
        exportEmbedBtn: document.getElementById('exportEmbedBtn'),
        embedCodeWrap: document.getElementById('embedCodeWrap'),
        embedCode: document.getElementById('embedCode'),
        copyEmbedBtn: document.getElementById('copyEmbedBtn'),
        
        closeExportBtn: document.getElementById('closeExportBtn'),
        exportImageBtn: document.getElementById('exportImageBtn'),
        exportEmbedBtn: document.getElementById('exportEmbedBtn'),
        imageExportWrap: document.getElementById('imageExportWrap'),
        fmtPngBtn: document.getElementById('fmtPngBtn'),
        fmtPdfBtn: document.getElementById('fmtPdfBtn'),
        fmtSvgBtn: document.getElementById('fmtSvgBtn'),
        aspectLockBtn: document.getElementById('aspectLockBtn'),
        exportSide: document.getElementById('exportSide'),

        statCurves: document.getElementById('statCurves'),
        statColors: document.getElementById('statColors'),
        statCurvesWrap: document.getElementById('statCurvesWrap'),
        statColorsWrap: document.getElementById('statColorsWrap'),
        ghLink: document.getElementById('ghLink'),

        sCurveW: document.getElementById('sCurveW'),
        vCurveW: document.getElementById('vCurveW'),

        sAlterTiles: document.getElementById('sAlterTiles'),
        vAlterTiles: document.getElementById('vAlterTiles'),

        unrenderedToggle: document.getElementById('unrenderedToggle'),
        bgStarsToggle: document.getElementById('bgStarsToggle'),
        markersToggle: document.getElementById('markersToggle'),
        flowToggle: document.getElementById('flowToggle'),
        inertiaToggle: document.getElementById('inertiaToggle'),
    };

    // ──── Fullscreen Toggle ────
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                toast('Fullscreen mode not allowed');
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });

    let wasSidebarOpenBeforeFullscreen = false;

    document.addEventListener('fullscreenchange', () => {
        const icon = fullscreenBtn.querySelector('i');
        if (document.fullscreenElement) {
            icon.classList.remove('fa-expand');
            icon.classList.add('fa-compress');
            
            // Save sidebar state and hide it
            wasSidebarOpenBeforeFullscreen = !sidebar.classList.contains('collapsed');
            if (wasSidebarOpenBeforeFullscreen) {
                sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                sidebarToggle.classList.add('collapsed');
            }
        } else {
            icon.classList.remove('fa-compress');
            icon.classList.add('fa-expand');
            
            // Restore sidebar if it was open before fullscreen
            if (wasSidebarOpenBeforeFullscreen) {
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                sidebarToggle.classList.remove('collapsed');
            }
        }
        
        // Force a resize check so the canvas fills the new screen size
        resize();
        requestRender();
    });

    let ctx = dom.cvs.getContext('2d');

    // ──── helpers ────
    function hexDistance(q1, r1, q2, r2) {
        return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
    }

    function hexKey(q, r) { return (q << 16) ^ r; }

    function hashQR(q, r) {
        let h = (q * 374761393 + r * 668265263 + randomSeed * 1013904223 + 2654435761) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return Math.abs(h ^ (h >>> 16));
    }

    function hashRot(q, r) {
        let h = (q * 374761393 + r * 668265263 + rotSeed * 1013904223 + 2654435761) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return Math.abs(h ^ (h >>> 16));
    }

    function isTileAlter(q, r) {
        if (alterTilesRatio <= 0) return false;
        return (hashQR(q, r) % 10000) / 10000 < alterTilesRatio;
    }

    function baseRot(q, r) {
        if (rotMode === 'zero') return 0;
        return (hashRot(q, r) % ROT_MOD) * ROT_STEP;
    }

    function tileRot(q, r) {
        const k = hexKey(q, r);
        return rotOverrides.has(k) ? rotOverrides.get(k) : baseRot(q, r);
    }

    function nearestTarget(from, target) {
        const diff = ((target - from) % 360 + 540) % 360 - 180;
        return from + diff;
    }

    function displayRot(q, r, now) {
        const k = hexKey(q, r);
        const a = animMap.get(k);
        if (!a) return tileRot(q, r);
        const elapsed = now - a.start;
        if (elapsed >= a.duration) return tileRot(q, r);
        const t = elapsed / a.duration;
        const ease = 1 - Math.pow(1 - t, 3);
        return a.from + (a.to - a.from) * ease;
    }

    function hexToPix(q, r, z, px, py) {
        return {
            x: HEX_R * 1.5 * q * z + px,
            y: HEX_R * (SQRT3 * 0.5 * q + SQRT3 * r) * z + py
        };
    }

    function pixToHex(sx, sy, z, px, py) {
        const x = (sx - px) / (HEX_R * z);
        const y = (sy - py) / (HEX_R * z);
        const fq = x * 2 / 3;
        const fr = -x / 3 + SQRT3 / 3 * y;
        return hexRound(fq, fr);
    }

    function hexRound(fq, fr) {
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

    function traceHexPath(c, cx, cy, sz) {
        c.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = PI_DIV_3 * i;
            const vx = cx + sz * Math.cos(a);
            const vy = cy + sz * Math.sin(a);
            i === 0 ? c.moveTo(vx, vy) : c.lineTo(vx, vy);
        }
        c.closePath();
    }

    function traceHexPathBatch(c, hexes, sz) {
        c.beginPath();
        for (const h of hexes) {
            for (let i = 0; i < 6; i++) {
                const a = PI_DIV_3 * i;
                const vx = h.x + sz * Math.cos(a);
                const vy = h.y + sz * Math.sin(a);
                i === 0 ? c.moveTo(vx, vy) : c.lineTo(vx, vy);
            }
            c.closePath();
        }
    }

    function traceHexGrid(c, cx, cy, sz) {
        c.beginPath();
        for (let i = 0; i < 3; i++) {
            const a1 = PI_DIV_3 * i;
            const a2 = PI_DIV_3 * (i + 1);
            const x1 = cx + sz * Math.cos(a1);
            const y1 = cy + sz * Math.sin(a1);
            const x2 = cx + sz * Math.cos(a2);
            const y2 = cy + sz * Math.sin(a2);
            if (i === 0) c.moveTo(x1, y1);
            c.lineTo(x2, y2);
        }
    }

    function visibleHexes(z, px, py, W, H) {
        const margin = HEX_R * z * VISIBLE_BOUND_MULT;
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
                    // Reuse existing object from pool or push a new one if pool is too small
                    if (count >= visibleHexesArray.length) {
                        visibleHexesArray.push({ q: 0, r: 0, x: 0, y: 0 });
                    }
                    const h = visibleHexesArray[count];
                    h.q = q;
                    h.r = r;
                    h.x = p.x;
                    h.y = p.y;
                    count++;
                }
            }
        }
        // Truncate array length so iterators only see active elements
        visibleHexesArray.length = count; 
        return visibleHexesArray;
    }

    function hash2D(x, y) {
        let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
                    // Blazing interval
                    const cycleDuration = CONFIG.STAR_BLAZE_MIN_INTERVAL + hash2D(k * seed + 555, j * seed + 999) * CONFIG.STAR_BLAZE_MAX_INTERVAL_ADD;
                    const offset = hash2D(k * seed + 111, j * seed + 222) * cycleDuration;
                    const phase = (now + offset) % cycleDuration;
                    
                    // Randomized blazing duration (1.2s to 3.0s)
                    const blazeDuration = 1200 + hash2D(k * seed + 333, j * seed + 444) * 1800;
                    
                    if (phase < blazeDuration) { 
                        let blazeT = phase / blazeDuration;
                        let blazeGlow = 0;
                        const origSR = sR;
                        const origSA = sA;
                        const origDrawSize = drawSize;
                        
                        if (blazeT < 0.25) {
                            // Phase 1: Grow to white
                            let t2 = blazeT / 0.25;
                            drawSize = origDrawSize * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * t2 * blazeFade);
                            sR = Math.round(origSR + (255 - origSR) * t2 * blazeFade);
                            sA = origSA + (Math.min(1, origSA + 0.5) - origSA) * t2 * blazeFade;
                            blazeGlow = t2 * blazeFade;
                        } else if (blazeT < 0.55) {
                            // Phase 2: Stay full size, keep white, fade alpha to 0
                            let t2 = (blazeT - 0.25) / 0.30;
                            drawSize = origDrawSize * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * blazeFade);
                            sR = Math.round(origSR + (255 - origSR) * blazeFade);
                            sA = (origSA + (Math.min(1, origSA + 0.5) - origSA) * blazeFade) * (1 - t2);
                            blazeGlow = (1 - t2) * blazeFade;
                        } else if (blazeT < 0.65) {
                            // Phase 3: Invisible
                            sA = 0;
                            blazeGlow = 0;
                        } else {
                            // Phase 4: Slowly put the little dot back
                            let t2 = (blazeT - 0.65) / 0.35;
                            drawSize = origDrawSize;
                            sR = origSR;
                            sA = origSA * t2;
                            blazeGlow = 0;
                        }
                        
                        if (blazeGlow > 0) {
                            // Affect gradient around star with a generous radius
                            const glowRadius = (180 + hash2D(k * seed + 777, j * seed + 888) * 120) * coordScale; 
                            const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
                            glow.addColorStop(0, `rgba(255, 255, 240, ${0.4 * blazeGlow})`);
                            glow.addColorStop(0.4, `rgba(150, 200, 255, ${0.2 * blazeGlow})`);
                            glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                            
                            ctx.save();
                            ctx.globalCompositeOperation = 'lighter'; 
                            ctx.fillStyle = glow;
                            ctx.beginPath();
                            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.restore();
                        }
                    }
                }
                
                // Cache fill style string to avoid GC stutter
                let fillKey = `${sR},${sA.toFixed(3)}`;
                let fillStyle = starColorCache.get(fillKey);
                if (!fillStyle) {
                    fillStyle = `rgba(${sR},${sR},${sR},${sA.toFixed(3)})`;
                    starColorCache.set(fillKey, fillStyle);
                }
                ctx.fillStyle = fillStyle;
                
                ctx.beginPath();
                ctx.arc(x, y, drawSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawBackgroundStars(W, H, coordScale, dPanX5, dPanY5, dPanX2, dPanY2, dPanX3, dPanY3, now, currentZoom, zoomOutTime, offsetX = 0, offsetY = 0) {
        if (!showBgStars) return;
        
        ctx.save();
        
        // Layer 1: Size 7, medium spacing, fastest parallax
        const spacing5 = CONFIG.STAR_SPACING_LARGE * starZoom5 * coordScale;
        drawDotLayer(W, H, spacing5, CONFIG.STAR_SIZE_LARGE, 1, coordScale, dPanX5, dPanY5, now, false, 1, 0, offsetX, offsetY);
        
        // Layer 2: Size 4, densest spacing, medium parallax
        const spacing2 = CONFIG.STAR_SPACING_MED * starZoom2 * coordScale;
        drawDotLayer(W, H, spacing2, CONFIG.STAR_SIZE_MED, 2, coordScale, dPanX2, dPanY2, now, false, 1, 0, offsetX, offsetY);
        
        // Layer 3: Size 2, least dense, slowest parallax. Fades in at low zoom.
        let layer3Alpha = 0;
        let canBlaze = false;
        let blazeFade = 1.0;
        if (currentZoom < CONFIG.ZOOM_BLAZE_FADE_START + 0.001) {
            // Fade in smoothly
            layer3Alpha = Math.max(0, Math.min(1, (CONFIG.ZOOM_BLAZE_FADE_START - currentZoom) / CONFIG.ZOOM_BLAZE_FADE_RANGE));
            // Allow blazing only if delay has passed
            if (layer3Alpha > 0 && zoomOutTime > 0 && (now - zoomOutTime) > CONFIG.STAR_BLAZE_DELAY) {
                canBlaze = true;
                // Calculate global fade-in for blazing effect (3 seconds)
                const fadeInDur = 3000;
                let fadeT = (now - zoomOutTime - CONFIG.STAR_BLAZE_DELAY) / fadeInDur;
                blazeFade = Math.max(0, Math.min(1, fadeT));
                blazeFade = blazeFade * blazeFade * (3 - 2 * blazeFade); // Smoothstep
            }
        }
        
        if (layer3Alpha > 0) {
            const spacing3 = CONFIG.STAR_SPACING_SMALL * starZoom3 * coordScale;
            drawDotLayer(W, H, spacing3, CONFIG.STAR_SIZE_SMALL, 3, coordScale, dPanX3, dPanY3, now, canBlaze, layer3Alpha, zoomOutTime, offsetX, offsetY, blazeFade);
        }
        
        ctx.restore();
    }

    // ──── IDW Gradient ────
    function updateIDWGradientCanvas(W, H, coordScale = 1, offsetX = 0, offsetY = 0, qualityScale = 0.2) {
        if (gradientMarkersRGB.length === 0 && fadingMarkersRGB.length === 0) return;
        const lowW = Math.max(2, Math.ceil(W * qualityScale));
        const lowH = Math.max(2, Math.ceil(H * qualityScale));

        if (!gradientCanvas) gradientCanvas = document.createElement('canvas');
        if (gradientCanvas.width !== lowW || gradientCanvas.height !== lowH) {
            gradientCanvas.width = lowW;
            gradientCanvas.height = lowH;
        }
        const gctx = gradientCanvas.getContext('2d');
        const imgData = gctx.createImageData(lowW, lowH);
        const data = imgData.data;

        const bgR = parseInt(COLORS.bg.slice(1, 3), 16);
        const bgG = parseInt(COLORS.bg.slice(3, 5), 16);
        const bgB = parseInt(COLORS.bg.slice(5, 7), 16);
        
        // 1. Calculate the weighted average color of active markers
        let avgR = 0, avgG = 0, avgB = 0, avgW = 0;
        for (let i = 0; i < gradientMarkersRGB.length; i++) {
            const m = gradientMarkersRGB[i];
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
            avgR = bgR; avgG = bgG; avgB = bgB;
        }

        // 2. Combine active and fading markers.
        const allMarkers = [];
        for (let i = 0; i < gradientMarkersRGB.length; i++) {
            const m = gradientMarkersRGB[i];
            const w = Math.max(0, Math.min(1, m.weight !== undefined ? m.weight : 1));
            allMarkers.push({
                x: (m.x - offsetX) * coordScale,
                y: (m.y - offsetY) * coordScale,
                r: m.r, // Use pre-blended color
                g: m.g,
                b: m.b,
                weight: w
            });
        }
        for (let i = 0; i < fadingMarkersRGB.length; i++) {
            const m = fadingMarkersRGB[i];
            const w = Math.max(0, Math.min(1, m.weight !== undefined ? m.weight : 0));
            allMarkers.push({
                x: (m.x - offsetX) * coordScale,
                y: (m.y - offsetY) * coordScale,
                r: m.r, // Use pre-blended color
                g: m.g,
                b: m.b,
                weight: w // Let it shrink to 0!
            });
        }

        const n = allMarkers.length;
        if (n === 0) return;

        for (let py = 0; py < lowH; py++) {
            for (let px = 0; px < lowW; px++) {
                let totalWeight = 0, r = 0, g = 0, b = 0;
                
                for (let i = 0; i < n; i++) {
                    const m = allMarkers[i];
                    // m.x is already in high-res space, just scale down to low-res by 'qualityScale' (0.2)
                    const dx = px - (m.x * qualityScale);
                    const dy = py - (m.y * qualityScale);
                    const distSq = dx * dx + dy * dy + 0.5;
                    const weight = (1 / (distSq * distSq)) * m.weight;
                    totalWeight += weight;
                    r += m.r * weight;
                    g += m.g * weight;
                    b += m.b * weight;
                }
                
                const idx = (py * lowW + px) * 4;
                if (totalWeight > 0) {
                    r /= totalWeight;
                    g /= totalWeight;
                    b /= totalWeight;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
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
    
    function drawIDWGradient(W, H, coordScale = 1, offsetX = 0, offsetY = 0) {
        if (gradientMarkersRGB.length === 0 && fadingMarkersRGB.length === 0) return;
        
        const targetLowW = Math.max(2, Math.ceil(W * 0.2));
        const targetLowH = Math.max(2, Math.ceil(H * 0.2));
        if (isGradientDirty || coordScale !== 1 || !gradientCanvas || gradientCanvas.width !== targetLowW || gradientCanvas.height !== targetLowH) {
            updateIDWGradientCanvas(W, H, coordScale, offsetX, offsetY);
            isGradientDirty = false;
        }
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(gradientCanvas, 0, 0, gradientCanvas.width, gradientCanvas.height, 0, 0, W, H);
    }

    function getContrastColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum > 140 ? COLORS.black : COLORS.white;
    }

    function drawSunMarker(c, x, y, color, outline, scale = 1) {
        const r = 10 * scale;          // Inner circle radius
        const rayLen = 9 * scale;      // Ray length
        const rayW = 4 * scale;        // Ray thickness
        const outlineW = 3 * scale;    // Outline thickness
        const gap = 2 * scale;         // Gap between circle and rays
        
        c.save();
        c.lineCap = 'round';
        
        // 1. Draw rays (outline first, then color on top)
        c.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI / 4) * i;
            const r1 = r + gap;
            const r2 = r + gap + rayLen;
            c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
            c.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
        }
        c.strokeStyle = outline;
        c.lineWidth = rayW + outlineW * 2;
        c.stroke();
        c.strokeStyle = color;
        c.lineWidth = rayW;
        c.stroke();

        // 2. Draw central circle (outer ring for outline, inner fill)
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

    // ──── Curve Engine ────
    function getNeighbor(q, r, e) {
        if (e === 0) return { q: q + 1, r: r, edge: 3 };
        if (e === 1) return { q: q, r: r + 1, edge: 4 };
        if (e === 2) return { q: q - 1, r: r + 1, edge: 5 };
        if (e === 3) return { q: q - 1, r: r, edge: 0 };
        if (e === 4) return { q: q, r: r - 1, edge: 1 };
        if (e === 5) return { q: q + 1, r: r - 1, edge: 2 };
    }

    function edgeID(q, r, e) {
        const n = getNeighbor(q, r, e);
        const id1 = (q + 100000) * 10000000 + (r + 100000) * 10 + e;
        const id2 = (n.q + 100000) * 10000000 + (n.r + 100000) * 10 + n.edge;
        return id1 < id2 ? id1 : id2;
    }

    function decodeEdgeID(id) {
        const e = id % 10;
        let rem = Math.floor(id / 10);
        const r = (rem % 1000000) - 100000;      
        const q = Math.floor(rem / 1000000) - 100000;
        return [q, r, e];
    }

    function getOtherEdge(k, e, isAlter = false) {
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

    function mergeCurves(c1, c2) {
        if (c1 === c2) return;
        let curve1 = curves.get(c1);
        let curve2 = curves.get(c2);
        if (!curve1 || !curve2) return;
        let target, source;
        
        // Union by size: iterate the smaller set
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
            curveMap.set(id, target.id);
            target.edges.add(id);
        }
        target.size = target.edges.size;
        if (source.locked) target.locked = true;
        
        // Explicitly clear the Set so the GC reclaims the memory immediately
        source.edges.clear(); 
        source.edges = null; 
        
        curves.delete(source.id);
    }

    function processQueue(customBounds, noCull = false) {
        let bounds = customBounds || getVisibleBounds();
        let margin = noCull ? 1000000 : TRACE_QUEUE_MARGIN;
        let processed = 0;
        let maxPerFrame = TRACE_MAX_PER_FRAME;
        
        while (queue.length > 0 && processed < maxPerFrame) {
            let item = queue.pop();
            processed++;
            
            if (!noCull && (item.q < bounds.minQ - margin || item.q > bounds.maxQ + margin ||
                item.r < bounds.minR - margin || item.r > bounds.maxR + margin)) continue;
                
            let id = edgeID(item.q, item.r, item.e);
            if (!curveMap.has(id)) continue;
            
            let curveID = curveMap.get(id);
            let curve = curves.get(curveID);
            if (!curve) continue;
            
            let k = (tileRot(item.q, item.r) / 60) % 6;
            let pe = getOtherEdge(k, item.e, isTileAlter(item.q, item.r));
            let pid = edgeID(item.q, item.r, pe);
            
            if (curveMap.has(pid)) {
                let existingCurve = curveMap.get(pid);
                if (existingCurve === curveID) curve.locked = true;
                else mergeCurves(curveID, existingCurve);
            } else {
                curveMap.set(pid, curveID);
                curve.edges.add(pid);
                curve.size++;
                let n = getNeighbor(item.q, item.r, pe);
                queue.push({ q: n.q, r: n.r, e: n.edge });
            }
        }
    }

    function findUncoloredTileInHexes(hexes) {
        for (const h of hexes) {
            for (let i = 0; i < 6; i++) {
                if (!curveMap.has(edgeID(h.q, h.r, i))) {
                    recalculateTile(h.q, h.r);
                    return true;
                }
            }
        }
        return false;
    }

    function findNextUncoloredTile() {
        let bounds = getVisibleBounds();
        let margin = TRACE_SEARCH_MARGIN;
        for (let q = bounds.minQ - margin; q <= bounds.maxQ + margin; q++) {
            for (let r = bounds.minR - margin; r <= bounds.maxR + margin; r++) {
                for (let i = 0; i < 6; i++) {
                    if (!curveMap.has(edgeID(q, r, i))) {
                        recalculateTile(q, r);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function getVisibleBounds() {
        let W = dom.cvs.width,
            H = dom.cvs.height;
        let z = zoom,
            px = panX,
            py = panY;
        let margin = HEX_R * z * VISIBLE_BOUND_MULT;
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

    function initializeCentralTile() {
        if (curveColors.length <= 1) return;
        if (curveMap.size > 0) return;
        let center = pixToHex(dom.cvs.width / 2, dom.cvs.height / 2, zoom, panX, panY);
        recalculateTile(center.q, center.r);
    }

    // ──── Curve Color Helpers ────
    function hashString(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h ^ s.charCodeAt(i), 16777619);
        }
        return Math.abs(h);
    }

    function getCurveColorIndex(curveID) {
        const c = curves.get(curveID);
        if (!c) return -1;
        return (typeof c.color === 'number') ? c.color : curveColors.indexOf(c.color);
    }

    function getAdjacentColors(edgeSet, excludeCurveID) {
        const adjColors = new Set();
        for (const id of edgeSet) {
            const [q, r, e] = decodeEdgeID(id);
            
            const adjEdgesInTile = [(e + 1) % 6, (e + 5) % 6];
            for (const ae of adjEdgesInTile) {
                const adjID = edgeID(q, r, ae);
                if (curveMap.has(adjID)) {
                    const cid = curveMap.get(adjID);
                    if (cid !== excludeCurveID) {
                        const c = curves.get(cid);
                        if (c) adjColors.add(c.color); 
                    }
                }
            }
            
            const n = getNeighbor(q, r, e);
            const adjEdgesInNeighbor = [(n.edge + 1) % 6, (n.edge + 5) % 6];
            for (const ae of adjEdgesInNeighbor) {
                const adjID = edgeID(n.q, n.r, ae);
                if (curveMap.has(adjID)) {
                    const cid = curveMap.get(adjID);
                    if (cid !== excludeCurveID) {
                        const c = curves.get(cid);
                        if (c) adjColors.add(c.color);
                    }
                }
            }
        }
        return adjColors;
    }

    function getBackgroundColorAt(x, y, coordScale = 1, offsetX = 0, offsetY = 0) {
        if (gradientMarkersRGB.length === 0 && fadingMarkersRGB.length === 0) return null;
        let totalWeight = 0, r = 0, g = 0, b = 0;
        
        for (let i = 0; i < gradientMarkersRGB.length; i++) {
            const m = gradientMarkersRGB[i];
            const mx = (m.x - offsetX) * coordScale;
            const my = (m.y - offsetY) * coordScale;
            const dx = x - mx;
            const dy = y - my;
            const distSq = dx * dx + dy * dy + 0.5;
            const weight = (1 / (distSq * distSq)) * (m.weight || 0);
            totalWeight += weight;
            r += m.r * weight;
            g += m.g * weight;
            b += m.b * weight;
        }
        for (let i = 0; i < fadingMarkersRGB.length; i++) {
            const m = fadingMarkersRGB[i];
            const mx = (m.x - offsetX) * coordScale;
            const my = (m.y - offsetY) * coordScale;
            const dx = x - mx;
            const dy = y - my;
            const distSq = dx * dx + dy * dy + 0.5;
            const weight = (1 / (distSq * distSq)) * (m.weight || 0);
            totalWeight += weight;
            r += m.r * weight;
            g += m.g * weight;
            b += m.b * weight;
        }
        
        if (totalWeight === 0) return null;
        return [r / totalWeight, g / totalWeight, b / totalWeight];
    }

    function pickColorForNewCurve(adjColors, avoidColor = -1, seed1 = 0, seed2 = 0, bgColor = null) {
        if (curveColors.length === 1) return 0;
        if (!adjColors) adjColors = new Set();
        
        const candidates = [];
        for (let i = 0; i < curveColors.length; i++) {
            if (!adjColors.has(i) && i !== avoidColor) candidates.push(i);
        }
        
        let pool = candidates;
        if (pool.length === 0) {
            const fallback = [];
            for (let i = 0; i < curveColors.length; i++) {
                if (!adjColors.has(i)) fallback.push(i);
            }
            pool = fallback;
        }
        
        if (pool.length === 0) {
            return (avoidColor + 1) % curveColors.length;
        }

        if (bgColor && pool.length > 1) {
            let bestContrast = 0;
            const contrasts = new Array(pool.length);
            
            for (let i = 0; i < pool.length; i++) {
                const cIdx = pool[i];
                const curveRgb = hexToRgb(curveColors[cIdx]);
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

    function splitCurve(curveID) {
        let curve = curves.get(curveID);
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
                let newID = nextCurveID++;
                let compSet = new Set(components[i]);
                let adjColors = (curveColors.length <= 1) ? null : getAdjacentColors(compSet, curve.id);
                
                const [eq, er, ee] = decodeEdgeID(components[i][0]);
                const p = hexToPix(eq, er, zoom, panX, panY);
                const bgColor = getBackgroundColorAt(p.x, p.y);
                
                let newColor;
                if (curveColors.length > 1) {
                    // 1. Find candidates that aren't adjacent and aren't the original color
                    let validCandidates = [];
                    
                    // Safely get original color index in case array size changed
                    const origColorIdx = (typeof curve.color === 'number') ? (curve.color % curveColors.length) : 0;
                    
                    for (let i = 0; i < curveColors.length; i++) {
                        if (!adjColors.has(i) && i !== origColorIdx) {
                            validCandidates.push(i);
                        }
                    }
                    // 2. Fallback if all colors are adjacent
                    if (validCandidates.length === 0) {
                        for (let i = 0; i < curveColors.length; i++) {
                            if (!adjColors.has(i)) validCandidates.push(i);
                        }
                    }
                    // 3. Ultimate fallback (guarantees a different color)
                    newColor = (origColorIdx + 1) % curveColors.length;
                    
                    // 4. Pick the candidate with the maximum color distance from the original
                    if (validCandidates.length > 0) {
                        let maxDist = -1;
                        const origRgb = hexToRgb(curveColors[origColorIdx]);
                        for (const cIdx of validCandidates) {
                            const cRgb = hexToRgb(curveColors[cIdx]);
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
                curves.set(newID, newCurve);
                for (let id of newCurve.edges) curveMap.set(id, newID);
            }
        } else if (components.length === 1) {
            // Edges are still connected; existing Set and size are already correct.
            // No need to allocate a new Set.
        } else {
            curves.delete(curveID);
        }
    }

    function updateLocalCurves(q, r) {
        let affectedCurves = new Set();
        let ids = [];
        for (let i = 0; i < 6; i++) {
            let id = edgeID(q, r, i);
            ids.push(id);
            if (curveMap.has(id)) affectedCurves.add(curveMap.get(id));
        }
        if (affectedCurves.size === 0) { recalculateTile(q, r); return; }
        if (affectedCurves.size === 1) {
            let cid = [...affectedCurves][0];
            let allEdgesSame = true;
            for (let i = 0; i < 6; i++) {
                if (!curveMap.has(ids[i]) || curveMap.get(ids[i]) !== cid) { allEdgesSame = false; break; }
            }
            if (allEdgesSame) return;
        }
        
        for (let i = 0; i < 6; i++) {
            let id = ids[i];
            if (curveMap.has(id)) {
                let cid = curveMap.get(id);
                let curve = curves.get(cid);
                if (curve) {
                    curve.edges.delete(id);
                    curve.size = curve.edges.size;
                }
                curveMap.delete(id);
            }
        }
        let validAffected = [];
        for (let cid of affectedCurves) {
            let curve = curves.get(cid);
            if (curve) {
                if (curve.size === 0) curves.delete(cid);
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
            let c1 = curveMap.has(n1_other_id) ? curveMap.get(n1_other_id) : -1;
            let n2 = getNeighbor(q, r, e2);
            let k2 = (tileRot(n2.q, n2.r) / 60) % 6;
            let n2_other = getOtherEdge(k2, n2.edge, isTileAlter(n2.q, n2.r));
            let n2_other_id = edgeID(n2.q, n2.r, n2_other);
            let c2 = curveMap.has(n2_other_id) ? curveMap.get(n2_other_id) : -1;
            if (c1 !== -1 && c2 !== -1) {
                if (c1 !== c2) {
                    mergeCurves(c1, c2);
                }
                let targetCurveID = curveMap.get(n1_other_id);
                curveMap.set(id1, targetCurveID);
                curveMap.set(id2, targetCurveID);
                curves.get(targetCurveID).edges.add(id1);
                curves.get(targetCurveID).edges.add(id2);
                curves.get(targetCurveID).size = curves.get(targetCurveID).edges.size;
            } else if (c1 !== -1) {
                curveMap.set(id1, c1);
                curveMap.set(id2, c1);
                curves.get(c1).edges.add(id1);
                curves.get(c1).edges.add(id2);
                curves.get(c1).size = curves.get(c1).edges.size;
                queue.push({ q: n2.q, r: n2.r, e: n2.edge });
            } else if (c2 !== -1) {
                curveMap.set(id1, c2);
                curveMap.set(id2, c2);
                curves.get(c2).edges.add(id1);
                curves.get(c2).edges.add(id2);
                curves.get(c2).size = curves.get(c2).edges.size;
                queue.push({ q: n1.q, r: n1.r, e: n1.edge });
            } else {
                let tempSet = new Set([id1, id2]);
                let adjColors = (curveColors.length <= 1) ? null : getAdjacentColors(tempSet, -1);
                
                const p = hexToPix(q, r, zoom, panX, panY);
                const bgColor = getBackgroundColorAt(p.x, p.y);
                let color = pickColorForNewCurve(adjColors, -1, q, r * 6 + e1, bgColor);
                
                let curveID = nextCurveID++;
                
                curves.set(curveID, { id: curveID, color: color, size: 0, locked: false, edges: new Set() });
                curveMap.set(id1, curveID);
                curveMap.set(id2, curveID);
                curves.get(curveID).edges.add(id1);
                curves.get(curveID).edges.add(id2);
                curves.get(curveID).size = 2;
                queue.push({ q: n1.q, r: n1.r, e: n1.edge });
                queue.push({ q: n2.q, r: n2.r, e: n2.edge });
            }
        }
    }

    function recalculateTile(q, r) {
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
            let c1 = curveMap.has(id1) ? curveMap.get(id1) : -1;
            let c2 = curveMap.has(id2) ? curveMap.get(id2) : -1;
            if (c1 !== -1 && c2 !== -1) {
                if (c1 !== c2) mergeCurves(c1, c2);
            } else if (c1 !== -1) {
                curveMap.set(id2, c1);
                curves.get(c1).edges.add(id2);
                curves.get(c1).size++;
                let n = getNeighbor(q, r, e2);
                queue.push({ q: n.q, r: n.r, e: n.edge });
            } else if (c2 !== -1) {
                curveMap.set(id1, c2);
                curves.get(c2).edges.add(id1);
                curves.get(c2).size++;
                let n = getNeighbor(q, r, e1);
                queue.push({ q: n.q, r: n.r, e: n.edge });
            } else {
                let curveID = nextCurveID++;
                let tempSet = new Set([id1, id2]);
                let adjColors = (curveColors.length <= 1) ? null : getAdjacentColors(tempSet, -1);
                const p = hexToPix(q, r, zoom, panX, panY);
                const bgColor = getBackgroundColorAt(p.x, p.y);
                let color = pickColorForNewCurve(adjColors, -1, q, r * 6 + e1, bgColor);
                
                curves.set(curveID, { id: curveID, color: color, size: 0, locked: false, edges: new Set() });
                curveMap.set(id1, curveID);
                curves.get(curveID).edges.add(id1);
                curves.get(curveID).size++;
                let n1 = getNeighbor(q, r, e1);
                queue.push({ q: n1.q, r: n1.r, e: n1.edge });
                
                curveMap.set(id2, curveID);
                curves.get(curveID).edges.add(id2);
                curves.get(curveID).size++;
                let n2 = getNeighbor(q, r, e2);
                queue.push({ q: n2.q, r: n2.r, e: n2.edge });
            }
        }
    }

    function applyCurveStyle(q, r, e, sz, now) {
        ctx.setLineDash([]);
        const id = edgeID(q, r, e);
        
        let targetRgb = null;
        let targetCurveID = -1;
        if (curveColors.length === 1) {
            const c = curveColorsRGB[0];
            if (c) {
                targetRgb = { r: c.tr !== undefined ? c.tr : c.r, g: c.tg !== undefined ? c.tg : c.g, b: c.tb !== undefined ? c.tb : c.b };
            } else {
                const rgb = hexToRgb(curveColors[0]);
                targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
            }
            targetCurveID = -2; 
        } else if (curveMap.has(id)) {
            targetCurveID = curveMap.get(id);
            let curve = curves.get(targetCurveID);
            if (curve) {
                let c = curve.color;
                if (typeof c === 'number') {
                    const cc = curveColorsRGB[c % curveColorsRGB.length];
                    targetRgb = { r: cc.tr !== undefined ? cc.tr : cc.r, g: cc.tg !== undefined ? cc.tg : cc.g, b: cc.tb !== undefined ? cc.tb : cc.b };
                } else {
                    const rgb = hexToRgb(c); 
                    targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
                }
            }
        }

        if (targetRgb) {
            let edgeData = edgeRgbMap.get(id);
            if (!edgeData) {
                edgeData = { 
                    rgb: [targetRgb.r, targetRgb.g, targetRgb.b], 
                    alpha: 1, 
                    targetCurveID: targetCurveID, 
                    rippleTime: 0, 
                    rippleQ: 0, 
                    rippleR: 0,
                    rippleActive: false,
                    colorStr: '' 
                };
                edgeRgbMap.set(id, edgeData);
            }
            
            if (isExporting) {
                edgeData.rgb[0] = targetRgb.r;
                edgeData.rgb[1] = targetRgb.g;
                edgeData.rgb[2] = targetRgb.b;
                edgeData.alpha = 1.0;
                edgeData.rippleActive = false;
                edgeData.colorStr = '';
            } else {
                if (previousUnassignedEdges.has(id)) {
                    edgeData.alpha = 0;
                    edgeData.rippleActive = true;
                    edgeData.rippleTime = 0; 
                    edgeData.rippleQ = 0;
                    edgeData.rippleR = 0;
                    edgeData.colorStr = '';
                }
                
                if (edgeData.targetCurveID !== targetCurveID) {
                    edgeData.targetCurveID = targetCurveID;
                    
                    let needsRipple = Math.abs(targetRgb.r - edgeData.rgb[0]) > 5 || 
                                        Math.abs(targetRgb.g - edgeData.rgb[1]) > 3 || 
                                        Math.abs(targetRgb.b - edgeData.rgb[2]) > 5;
                    
                    if (needsRipple && lastRipple.time > 0 && (now - lastRipple.time < 3000)) {
                        edgeData.rippleTime = lastRipple.time;
                        edgeData.rippleQ = lastRipple.q;
                        edgeData.rippleR = lastRipple.r;
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
                        edgeColorAnimating = true; 
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
                        edgeColorAnimating = true;
                        edgeData.colorStr = ''; // Invalidate cache
                    } else {
                        edgeData.rippleActive = false;
                    }
                }
            }
            
            if (!edgeData.colorStr) {
                if (edgeData.alpha > 0.99) {
                    edgeData.colorStr = `rgb(${Math.round(edgeData.rgb[0])},${Math.round(edgeData.rgb[1])},${Math.round(edgeData.rgb[2])})`;
                } else {
                    edgeData.colorStr = `rgba(${Math.round(edgeData.rgb[0])},${Math.round(edgeData.rgb[1])},${Math.round(edgeData.rgb[2])},${edgeData.alpha.toFixed(3)})`;
                }
            }
            
            ctx.strokeStyle = edgeData.colorStr;
            ctx.lineWidth = sz / 3 * curveLineWidth;
            return true;
        }

        currentUnassignedEdges.add(id);
        if (showUnrenderedDotted) {
            ctx.strokeStyle = `rgba(110, 110, 144, 0.55)`;
            ctx.lineWidth = Math.max(1, (sz / 10) * curveLineWidth);
            const dash = Math.max(2, sz / 8);
            ctx.setLineDash([dash, dash]);
            return true;
        }
        return false;
    }

    // ──── Gradient List UI ────
    function renderGradientList() {
        const list = dom.gradientList;
        list.innerHTML = '';
        const canRemove = gradientMarkers.length > 1;

        gradientMarkers.forEach((m, i) => {
            const item = document.createElement('div');
            item.className = 'grad-item';

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = m.color;
            let originalColor = m.color;
            colorInput.addEventListener('input', (e) => {
                gradientMarkers[i].color = e.target.value;
                updateGradientMarkersCache();
                hexInput.value = e.target.value.toUpperCase();
            });
            colorInput.addEventListener('change', (e) => {
                const newColor = e.target.value.toLowerCase();
                gradientMarkers[i].color = newColor;
                originalColor = newColor;
                updateGradientMarkersCache();
            });
            colorInput.addEventListener('click', (e) => e.stopPropagation());

            const hexInput = document.createElement('input');
            hexInput.type = 'text';
            hexInput.className = 'hex-input';
            hexInput.value = m.color.toUpperCase();
            hexInput.maxLength = 7;
            hexInput.addEventListener('change', (e) => {
                let val = e.target.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9A-F]{6}$/i.test(val)) {
                    const newColor = val.toLowerCase();
                    gradientMarkers[i].color = newColor;
                    originalColor = newColor;
                    updateGradientMarkersCache();
                    colorInput.value = newColor;
                    e.target.value = newColor.toUpperCase();
                } else {
                    toast('Invalid hex color (e.g. #FF0000)');
                    e.target.value = gradientMarkers[i].color.toUpperCase();
                }
            });
            hexInput.addEventListener('click', (e) => e.stopPropagation());

            item.appendChild(colorInput);
            item.appendChild(hexInput);

            if (canRemove) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'grad-remove-btn';
                removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                removeBtn.title = 'Remove marker';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    const removedMarker = gradientMarkers[i];
                    const cached = gradientMarkersRGB[i];
                    if (cached) {
                        fadingMarkersRGB.push({
                            x: removedMarker.x,
                            y: removedMarker.y,
                            r: cached.r, g: cached.g, b: cached.b,
                            origR: cached.r, origG: cached.g, origB: cached.b,
                            weight: cached.weight || 1
                        });
                    }
                    
                    gradientMarkers.splice(i, 1);
                    gradientMarkersRGB.splice(i, 1); 
                    renderGradientList();
                    updateGradientMarkersCache();
                });
                item.appendChild(removeBtn);
            }

            list.appendChild(item);
        });
    }

    // ──── Curve List UI ────
    function renderCurveList() {
        const list = dom.curveList;
        list.innerHTML = '';
        const canRemove = curveColors.length > 1;

        curveColors.forEach((m, i) => {
            const item = document.createElement('div');
            item.className = 'grad-item';

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = m;
            let originalColor = m;
            colorInput.addEventListener('input', (e) => {
                curveColors[i] = e.target.value;
                updateCurveColorsCache();
                hexInput.value = e.target.value.toUpperCase();
            });
            colorInput.addEventListener('change', (e) => {
                const newColor = e.target.value.toLowerCase();
                const isDuplicate = curveColors.some((mm, idx) =>
                    idx !== i && mm.toLowerCase() === newColor);
                if (isDuplicate) {
                    curveColors[i] = originalColor;
                    e.target.value = originalColor;
                    hexInput.value = originalColor.toUpperCase();
                    toast('Color already exists in curve palette');
                    updateCurveColorsCache(); // Must revert target RGB!
                } else {
                    curveColors[i] = newColor; // Explicitly set
                    originalColor = newColor;
                    updateCurveColorsCache();
                }
            });
            colorInput.addEventListener('click', (e) => e.stopPropagation());

            const hexInput = document.createElement('input');
            hexInput.type = 'text';
            hexInput.className = 'hex-input';
            hexInput.value = m.toUpperCase();
            hexInput.maxLength = 7;
            hexInput.addEventListener('change', (e) => {
                let val = e.target.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9A-F]{6}$/i.test(val)) {
                    const newColor = val.toLowerCase();
                    const isDuplicate = curveColors.some((mm, idx) =>
                        idx !== i && mm.toLowerCase() === newColor);
                    if (isDuplicate) {
                        toast('Color already exists in curve palette');
                        e.target.value = curveColors[i].toUpperCase();
                    } else {
                        curveColors[i] = newColor;
                        originalColor = newColor;
                        updateCurveColorsCache();
                        colorInput.value = newColor;
                        e.target.value = newColor.toUpperCase();
                    }
                } else {
                    toast('Invalid hex color (e.g. #FF0000)');
                    e.target.value = curveColors[i].toUpperCase();
                }
            });
            hexInput.addEventListener('click', (e) => e.stopPropagation());

            item.appendChild(colorInput);
            item.appendChild(hexInput);

            if (canRemove) {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'grad-remove-btn';
                removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                removeBtn.title = 'Remove color';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    curveColors.splice(i, 1);
                    if (activeCurveIndex === i) {
                        activeCurveIndex = Math.min(i, curveColors.length - 1);
                    } else if (activeCurveIndex > i) {
                        activeCurveIndex--;
                    }
                    updateCurveColorsCache();
                    renderCurveList();
                });
                item.appendChild(removeBtn);
            }

            item.addEventListener('click', () => {
                activeCurveIndex = i;
                renderCurveList();
            });

            list.appendChild(item);
        });
    }

    // ──── drawTile ────
    function drawTile(cx, cy, sz, rot, grid, img, tf, hq, hr, now, curveAlpha = 1, gridAlpha = 1) {
        const rSz = grid ? sz * 0.95 : sz;
        ctx.save();
        
        if (img) {
            traceHexPath(ctx, cx, cy, rSz);
            ctx.clip();
            
            ctx.translate(cx, cy);
            ctx.rotate(rot * DEG2RAD);

            ctx.rotate(tf.rot * DEG2RAD);
            ctx.scale(tf.sx * tf.scale, tf.sy * tf.scale);
            ctx.translate(tf.ox, tf.oy);
            const iSz = sz * 2.6;
            ctx.drawImage(img, -iSz / 2, -iSz / 2, iSz, iSz);
        } else {
            ctx.translate(cx, cy);
            ctx.rotate(rot * DEG2RAD);

            const a = sz * SQRT3 / 2;
            ctx.lineCap = 'butt'; 
            
            // LOD: Use CONFIG thresholds for arc extension
            const ext = sz > CONFIG.LOD_HIGH_SZ ? CONFIG.LOD_EXT_HIGH : (sz > CONFIG.LOD_MED_SZ ? CONFIG.LOD_EXT_MED : CONFIG.LOD_EXT_LOW);
            
            const logicalRot = tileRot(hq, hr);
            const k = (logicalRot / 60) % 6;

            if (curveAlpha > 0.01) {
                ctx.globalAlpha = curveAlpha; // Use hardware acceleration for fade
                const alter = isTileAlter(hq, hr);
                if (alter) {
                    if (applyCurveStyle(hq, hr, (0 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(sz/2, a, sz/2, Math.PI - ext, 5 * PI_DIV_3 + ext, false);
                        ctx.stroke();
                    }
                    if (applyCurveStyle(hq, hr, (2 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(-sz, 0, sz/2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false);
                        ctx.stroke();
                    }
                    if (applyCurveStyle(hq, hr, (4 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(sz/2, -a, sz/2, PI_DIV_3 - ext, Math.PI + ext, false);
                        ctx.stroke();
                    }
                } else {
                    if (applyCurveStyle(hq, hr, (2 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(-sz, 0, sz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false);
                        ctx.stroke();
                    }
                    if (applyCurveStyle(hq, hr, (4 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(1.5 * sz, -a, 1.5 * sz, TWO_PI_DIV_3 - ext, Math.PI + ext, false);
                        ctx.stroke();
                    }
                    if (applyCurveStyle(hq, hr, (1 + k) % 6, sz, now)) {
                        ctx.beginPath();
                        ctx.arc(1.5 * sz, a, 1.5 * sz, Math.PI - ext, FOUR_PI_DIV_3 + ext, false);
                        ctx.stroke();
                    }
                }
                ctx.setLineDash([]);
                ctx.globalAlpha = 1.0;
            }
        }

        ctx.restore();

        if (grid && gridAlpha > 0.01) {
            traceHexGrid(ctx, cx, cy, sz);
            ctx.globalAlpha = gridAlpha;
            ctx.strokeStyle = COLORS.gridLine;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1.0; 
        }
    }

    function drawHoverStroke(cx, cy, sz, grid) {
        const rSz = grid ? sz * 0.95 : sz;
        ctx.save();
        
        traceHexPath(ctx, cx, cy, rSz);
        
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.stroke();
        
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.stroke();
        
        ctx.restore();
    }

    let solvedCheckTimeout = null;
    function checkIfSolved() {
        if (solvedCheckTimeout) return; 
        
        solvedCheckTimeout = setTimeout(() => {
            solvedCheckTimeout = null;
            performSolvedCheck();
        }, CONFIG.STATS_UPDATE_INTERVAL);
    }
    
    function performSolvedCheck() {
        if (curveColors.length <= 1) return;

        if (zoom <= CONFIG.ZOOM_FADE_MID) {
            window.dispatchEvent(new CustomEvent('hexCurveSolved', { detail: { solved: false } }));
            try { 
                if (isEmbedMode) window.parent.postMessage({ type: 'HEX_CURVE_SOLVED', solved: false }, '*'); 
            } catch(e) {}
            return;
        }

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const effectiveW = (isCollapsed || isEmbedMode) ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
        const H = dom.cvs.height;
        const hexes = visibleHexes(zoom, panX, panY, dom.cvs.width, H);
        if (hexes.length === 0) return;
        
        const visibleEdges = new Set();
        for (const h of hexes) {
            if (h.x >= 0 && h.x <= effectiveW && h.y >= 0 && h.y <= H) {
                for (let e = 0; e < 6; e++) {
                    visibleEdges.add(edgeID(h.q, h.r, e));
                }
            }
        }
        
        let totalColored = 0;
        const colorCounts = {};
        let maxColorCount = 0;

        for (const id of visibleEdges) {
            if (curveMap.has(id)) {
                const curveID = curveMap.get(id);
                const curve = curves.get(curveID);
                if (curve) {
                    let c = curve.color;
                    if (typeof c === 'number') c = curveColors[c % curveColors.length];
                    c = c.toLowerCase();
                    
                    totalColored++;
                    colorCounts[c] = (colorCounts[c] || 0) + 1;
                    if (colorCounts[c] > maxColorCount) {
                        maxColorCount = colorCounts[c];
                    }
                }
            }
        }
        
        let isSolved = false;
        if (totalColored >= visibleEdges.size * 0.85) {
            if (totalColored > 0) {
                isSolved = (maxColorCount / totalColored) >= 0.98;
            }
        }
        
        if (isSolved) {
            console.log("Curve solved (98% threshold reached)");
        }

        window.dispatchEvent(new CustomEvent('hexCurveSolved', { 
            detail: { solved: isSolved } 
        }));

        try {
            if (isEmbedMode) {
                window.parent.postMessage({ 
                    type: 'HEX_CURVE_SOLVED', 
                    solved: isSolved 
                }, '*'); 
            }
        } catch (e) {
            console.warn("PostMessage failed:", e);
        }
    }

    // ──── Main render loop ────
    let isRenderScheduled = false;
    let lastStatsUpdate = 0; 
    let isGradientDirty = true; 
    let starPanX5 = 0;
    let starPanY5 = 0;
    let starZoom5 = 1; 
    let starPanX2 = 0;
    let starPanY2 = 0;
    let starZoom2 = 1; 
    let starPanX3 = 0;
    let starPanY3 = 0;
    let starZoom3 = 1; 
    let zoomOutStartTime = 0;
    const visibleHexesArray = []; 
    let currentUnassignedEdges = new Set();
    let previousUnassignedEdges = new Set();
    function requestRender() {
        if (!isRenderScheduled) {
            isRenderScheduled = true;
            requestAnimationFrame(() => {
                isRenderScheduled = false;
                render();
            });
        }
    }
    
    let exportFreezeTime = 0;
    function render() {
        const W = dom.cvs.width,
            H = dom.cvs.height;
        let now = Date.now();
        
        if (isExporting) {
            if (!exportFreezeTime) exportFreezeTime = now;
            now = exportFreezeTime;
        } else {
            exportFreezeTime = 0;
        }

        const z = zoom,
            px = panX,
            py = panY;
        const grid = showGrid,
            img = texImg,
            tf = texTf;
        
        // Use original editor zoom for visual fades in embed mode
        const visZoom = (isEmbedMode && embedData && embedData.origZoom) ? embedData.origZoom : z;

        for (const [k, a] of animMap) {
            if (now - a.start >= a.duration) animMap.delete(k);
        }

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);
        drawIDWGradient(W, H);
        drawBackgroundStars(W, H, 1, starPanX5, starPanY5, starPanX2, starPanY2, starPanX3, starPanY3, now, visZoom, zoomOutStartTime);

        let keepRendering = (animMap.size > 0 || isDrag || isDragMarker);
        if (showBgStars && visZoom <= CONFIG.ZOOM_FADE_MID) keepRendering = true;
        
        if (isExporting) keepRendering = false;

        edgeColorAnimating = false;
        let gradColorAnimating = false;
        let curveColorAnimating = false;
        currentUnassignedEdges.clear();

        if (!isExporting) {
            // 1. Calculate target average color of ACTIVE markers
            let avgR = 0, avgG = 0, avgB = 0, avgW = 0;
            for (let i = 0; i < gradientMarkersRGB.length; i++) {
                const m = gradientMarkersRGB[i];
                const w = m.weight !== undefined ? m.weight : 1;
                avgR += m.tr * w;
                avgG += m.tg * w;
                avgB += m.tb * w;
                avgW += w;
            }
            if (avgW > 0) {
                currentAvgR = avgR / avgW;
                currentAvgG = avgG / avgW;
                currentAvgB = avgB / avgW;
            } else {
                currentAvgR = parseInt(COLORS.bg.slice(1, 3), 16);
                currentAvgG = parseInt(COLORS.bg.slice(3, 5), 16);
                currentAvgB = parseInt(COLORS.bg.slice(5, 7), 16);
            }

            for (let i = 0; i < gradientMarkersRGB.length; i++) {
                const m = gradientMarkersRGB[i];
                let diff = false;
                
                const nWeight = m.weight + (1 - m.weight) * 0.05;
                if (Math.abs(1 - nWeight) > 0.01) diff = true;
                m.weight = nWeight;
                
                // Calculate target color using IDW formula, then LERP towards it at 0.1
                const targetR = currentAvgR + (m.tr - currentAvgR) * m.weight;
                const targetG = currentAvgG + (m.tg - currentAvgG) * m.weight;
                const targetB = currentAvgB + (m.tb - currentAvgB) * m.weight;
                
                const nr = m.r + (targetR - m.r) * 0.1;
                const ng = m.g + (targetG - m.g) * 0.1;
                const nb = m.b + (targetB - m.b) * 0.1;
                
                if (Math.abs(m.r - nr) > 0.5 || Math.abs(m.g - ng) > 0.5 || Math.abs(m.b - nb) > 0.5) diff = true;
                m.r = nr; m.g = ng; m.b = nb;
                
                if (diff) {
                    gradColorAnimating = true;
                    isGradientDirty = true;
                }
            }
            
            for (let i = fadingMarkersRGB.length - 1; i >= 0; i--) {
                const m = fadingMarkersRGB[i];
                m.weight += (0 - m.weight) * 0.05; // Match fade-in speed!
                
                if (m.weight <= 0.00008) {
                    fadingMarkersRGB.splice(i, 1);
                    // Force one last update to clear it completely
                    gradColorAnimating = true;
                    isGradientDirty = true;
                    continue;
                }
                
                // Calculate target color using IDW formula, then LERP towards it at 0.1
                const targetR = currentAvgR + (m.origR - currentAvgR) * m.weight;
                const targetG = currentAvgG + (m.origG - currentAvgG) * m.weight;
                const targetB = currentAvgB + (m.origB - currentAvgB) * m.weight;
                
                const nr = m.r + (targetR - m.r) * 0.1;
                const ng = m.g + (targetG - m.g) * 0.1;
                const nb = m.b + (targetB - m.b) * 0.1;
                
                m.r = nr; m.g = ng; m.b = nb;
                
                // ALWAYS force rendering until it is completely gone
                gradColorAnimating = true;
                isGradientDirty = true;
            }
        }

        // Flow physics: drift and turn
        let driftX = 0, driftY = 0;
        if (flowEnabled && !isExporting) {
            let speedMult = (visZoom <= CONFIG.ZOOM_FADE_MID) ? CONFIG.FLOW_SPEED_MULT_LOW_ZOOM : 1.0;
            let isHovering = hoveredQ !== null && hoveredR !== null;
            
            // If hovering started during a long drift, interrupt it so the new angle picks quickly (within 2s)
            if (isHovering && flowState === 'drift' && (flowStateEndTime - now) > 2000) {
                flowStateEndTime = now + 2000;
            }
            
            if (now > flowStateEndTime) {
                if (flowState === 'drift') {
                    // Transition to turning
                    flowState = 'turn';
                    // 1s turn while hovering, normal 3s turn otherwise
                    flowStateEndTime = now + (isHovering ? 1000 : CONFIG.FLOW_TURN_DURATION);
                    
                    // Determine base angle: opposite of mouse vector if hovering, else current drift
                    let baseAngle = driftAngle;
                    if (isHovering) {
                        const cx = W / 2;
                        const cy = H / 2;
                        const dx = mouseScreenX - cx;
                        const dy = mouseScreenY - cy;
                        baseAngle = Math.atan2(dy, dx) + Math.PI; // Opposite of mouse vector
                    }
                    
                    // Pick new angle using a cardioid-like distribution around the baseAngle
                    let turnAmount = 0;
                    while (true) {
                        let theta = (Math.random() - 0.5) * Math.PI * 2; // -PI to PI
                        let y = Math.random();
                        // The cardioid probability function (1 + cos(theta)) / 2
                        if (y <= (1 + Math.cos(theta)) / 2) {
                            turnAmount = theta;
                            break;
                        }
                    }
                    driftTargetAngle = baseAngle + turnAmount;
                } else {
                    // Transition back to drifting
                    flowState = 'drift';
                    driftAngle = driftTargetAngle; // Snap to target to prevent residual drift
                    // 5s drift while hovering, normal 10-20s drift otherwise
                    flowStateEndTime = now + (isHovering ? 5000 : (CONFIG.DRIFT_TIMER_MIN + Math.random() * CONFIG.DRIFT_TIMER_RANGE));
                    
                    // Set new base speed for this drift segment
                    driftTargetSpeed = (CONFIG.DRIFT_SPEED_BASE + Math.random() * CONFIG.DRIFT_SPEED_RANGE) * speedMult;
                }
            }
            
            if (flowState === 'turn') {
                // Slow rotation of velocity vector
                let angleDiff = driftTargetAngle - driftAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                driftAngle += angleDiff * 0.03; 
            }
            
            // Random fluctuations of absolute speed during drift
            let fluctuation = Math.sin(now / 800) * 0.2 + Math.sin(now / 350) * 0.1;
            let currentTargetSpeed = driftTargetSpeed + (driftTargetSpeed * fluctuation);
            driftSpeed += (currentTargetSpeed - driftSpeed) * 0.02;
            
            driftX = Math.cos(driftAngle) * driftSpeed;
            driftY = Math.sin(driftAngle) * driftSpeed;
        }

        // Dampen residual velocity if the user holds the mouse/touch still before releasing
        if ((isDrag || touchState.mode === 'pan' || touchState.mode === 'pan_wait') && Date.now() - lastPanMoveTime > 60) {
            panVX *= 0.6;
            panVY *= 0.6;
            if (Math.abs(panVX) < 0.5) panVX = 0;
            if (Math.abs(panVY) < 0.5) panVY = 0;
        }

        // Apply inertia ONLY in normal mode and when not dragging
        if (!isEmbedMode && inertiaEnabled && !isDrag && !isExporting) {
            panX += panVX;
            panY += panVY;
            starPanX5 += panVX * CONFIG.STAR_PARALLAX_LARGE; 
            starPanY5 += panVY * CONFIG.STAR_PARALLAX_LARGE;
            starPanX2 += panVX * CONFIG.STAR_PARALLAX_MED;
            starPanY2 += panVY * CONFIG.STAR_PARALLAX_MED;
            starPanX3 += panVX * CONFIG.STAR_PARALLAX_SMALL;
            starPanY3 += panVY * CONFIG.STAR_PARALLAX_SMALL;
            
            let damping = (visZoom < CONFIG.ZOOM_FADE_START_MULT) ? CONFIG.INERTIA_DAMPING_LOW : CONFIG.INERTIA_DAMPING_NORMAL;
            panVX *= damping; 
            panVY *= damping;
            
            if (Math.abs(panVX) < CONFIG.INERTIA_THRESHOLD) panVX = 0;
            if (Math.abs(panVY) < CONFIG.INERTIA_THRESHOLD) panVY = 0;
            if (panVX !== 0 || panVY !== 0) keepRendering = true;
        }
        
        // Apply flow drift in BOTH normal and embed modes (when enabled)
        if (flowEnabled && (!isDrag || isEmbedMode) && !isExporting) {
            panX += driftX;
            panY += driftY;
            starPanX5 += driftX * CONFIG.STAR_PARALLAX_LARGE; 
            starPanY5 += driftY * CONFIG.STAR_PARALLAX_LARGE;
            starPanX2 += driftX * CONFIG.STAR_PARALLAX_MED;
            starPanY2 += driftY * CONFIG.STAR_PARALLAX_MED;
            starPanX3 += driftX * CONFIG.STAR_PARALLAX_SMALL;
            starPanY3 += driftY * CONFIG.STAR_PARALLAX_SMALL;
            keepRendering = true; 
        }

        // Smooth zoom interpolation
        if (!isExporting && Math.abs(targetZoom - zoom) > 0.0001) {
            let lerpFactor = 0.15; 
            let step = (targetZoom - zoom) * lerpFactor;
            if (Math.abs(step) < 0.0005) step = targetZoom - zoom; // Snap if very close
            setZoom(zoom + step, zoomCx, zoomCy);
            keepRendering = true;
        }

        // Track when user reaches exactly 20% zoom for blazing star delay
        if (visZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) { 
            if (zoomOutStartTime === 0) zoomOutStartTime = now;
        } else {
            zoomOutStartTime = 0; 
        }

        const sz = HEX_R * z;
        const visSz = HEX_R * visZoom;
        let curveAlpha = 1.0;
        let gridAlpha = 1.0;
        const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT;
        const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
        
        if (visSz <= fadeEndSz + 0.5) { 
            curveAlpha = 0.0;
            gridAlpha = 0.0;
        } else if (visSz < fadeStartSz) {
            let t = (visSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
            curveAlpha = t * t * (3 - 2 * t);
            gridAlpha = curveAlpha;
        }

        interactionFade += (targetInteractionFade - interactionFade) * 0.2;
        if (Math.abs(targetInteractionFade - interactionFade) > 0.001) keepRendering = true;

        curveAlpha *= interactionFade;
        gridAlpha *= interactionFade;

        let hexes = [];
        if (img || curveAlpha > 0 || gridAlpha > 0) {
            hexes = visibleHexes(z, px, py, W, H); 
            
            const centerHex = pixToHex(W / 2, H / 2, z, px, py);
            hexes.sort((a, b) => {
                return hexDistance(a.q, a.r, centerHex.q, centerHex.r) - 
                        hexDistance(b.q, b.r, centerHex.q, centerHex.r);
            });
        }

        if (curveColors.length > 1 && curveAlpha > 0.01 && hexes.length > 0) {
            let startTime = performance.now();
            let didWork = true;
            while (didWork && performance.now() - startTime < 16) {
                if (queue.length > 0) {
                    processQueue();
                } else if (findUncoloredTileInHexes(hexes)) {
                    processQueue();
                } else {
                    didWork = false;
                }
            }
            if (didWork) keepRendering = true;
        }

        const lod = visSz > CONFIG.LOD_HIGH_SZ ? 2 : (visSz > CONFIG.LOD_MED_SZ ? 1 : 0);

        if (img) {
            // Textures: draw directly (textures don't fade)
            for (const h of hexes) {
                const rot = displayRot(h.q, h.r, now);
                drawTile(h.x, h.y, sz, rot, grid, img, tf, h.q, h.r, now, curveAlpha, gridAlpha);
            }
        } else if (curveAlpha > 0.01 || gridAlpha > 0.01) {
            if (curveAlpha < 0.99 || gridAlpha < 0.99) {
                // Fading curves/grid: render to offscreen canvas to avoid per-tile alpha blending
                if (curveCanvas.width !== W || curveCanvas.height !== H) {
                    curveCanvas.width = W;
                    curveCanvas.height = H;
                }
                curveCtx.clearRect(0, 0, W, H);
                
                const oldCtx = ctx;
                ctx = curveCtx;
                
                // 1. Draw curves only
                for (const h of hexes) {
                    const rot = displayRot(h.q, h.r, now);
                    drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
                }
                
                // 2. Draw grid on top of curves as a single batched path
                if (showGrid && gridAlpha > 0.01) {
                    traceHexPathBatch(ctx, hexes, sz);
                    ctx.strokeStyle = COLORS.gridLine;
                    ctx.lineWidth = 1;
                    ctx.globalAlpha = gridAlpha;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
                
                ctx = oldCtx;
                ctx.globalAlpha = Math.max(curveAlpha, gridAlpha);
                ctx.drawImage(curveCanvas, 0, 0);
                ctx.globalAlpha = 1.0;
            } else {
                // Fully opaque: draw directly (fastest path)
                // 1. Draw curves only
                for (const h of hexes) {
                    const rot = displayRot(h.q, h.r, now);
                    drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
                }
                // 2. Draw grid on top
                if (showGrid) {
                    traceHexPathBatch(ctx, hexes, sz);
                    ctx.strokeStyle = COLORS.gridLine;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        if (lod >= 1 && visZoom > CONFIG.ZOOM_FADE_MID + 0.001 && !isExporting) {
            if (!isTouchDevice && hoveredQ !== null && hoveredR !== null) {
                const p = hexToPix(hoveredQ, hoveredR, z, px, py);
                const targetHX = p.x;
                const targetHY = p.y;
                
                if (visHoverX === null) {
                    visHoverX = targetHX;
                    visHoverY = targetHY;
                } else {
                    visHoverX += (targetHX - visHoverX) * CONFIG.HOVER_LERP; 
                    visHoverY += (targetHY - visHoverY) * CONFIG.HOVER_LERP;
                    
                    if (Math.abs(targetHX - visHoverX) > 0.5 || Math.abs(targetHY - visHoverY) > 0.5) {
                        keepRendering = true;
                    } else {
                        visHoverX = targetHX;
                        visHoverY = targetHY;
                    }
                }
                drawHoverStroke(visHoverX, visHoverY, sz, grid);
            }
            
            if (touchOutlines.length > 0) {
                keepRendering = true; 
                for (let i = touchOutlines.length - 1; i >= 0; i--) {
                    const t = touchOutlines[i];
                    t.alpha -= CONFIG.TOUCH_OUTLINE_FADE; 
                    if (t.alpha <= 0) {
                        touchOutlines.splice(i, 1);
                        continue;
                    }
                    const p = hexToPix(t.q, t.r, z, px, py);
                    ctx.save();
                    traceHexPath(ctx, p.x, p.y, grid ? sz * 0.95 : sz);
                    ctx.globalAlpha = t.alpha;
                    
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                    ctx.stroke();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                    ctx.stroke();
                    
                    ctx.globalAlpha = 1.0;
                    ctx.restore();
                }
            }
        }

        if (markersVisible) {
            for (let i = 0; i < gradientMarkers.length; i++) {
                const m = gradientMarkers[i];
                const outline = getContrastColor(m.color);
                let scale = 1.0;
                if (touchState.mode === 'marker_wait' && i === touchState.markerIdx && touchState.startTime) {
                    const progress = Math.min(1, (now - touchState.startTime) / CONFIG.LONG_PRESS_DUR);
                    scale = 1.0 + 2.0 * progress;
                    keepRendering = true;
                }
                drawSunMarker(ctx, m.x, m.y, m.color, outline, scale);
            }
        }

        if (now - lastStatsUpdate > CONFIG.STATS_UPDATE_INTERVAL) {
            lastStatsUpdate = now;
            if (visZoom <= CONFIG.ZOOM_FADE_MID || curveColors.length <= 1) {
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
                            if (curveMap.has(id)) visCurveIDs.add(curveMap.get(id));
                        }
                    }
                }
                let visColors = new Set();
                for (const cid of visCurveIDs) {
                    const c = curves.get(cid);
                    if (c) {
                        let col = c.color;
                        if (typeof col === 'number') col = curveColors[col % curveColors.length];
                        visColors.add(col.toLowerCase());
                    }
                }
                dom.statCurves.textContent = visCurveIDs.size;
                dom.statColors.textContent = visColors.size;
            }
            
            if (curveAlpha === 0) {
                edgeRgbMap.clear();
            } else {
                const visibleEdgeIDs = new Set();
                for (const h of hexes) {
                    for (let e = 0; e < 6; e++) {
                        visibleEdgeIDs.add(edgeID(h.q, h.r, e));
                    }
                }
                for (const id of edgeRgbMap.keys()) {
                    if (!visibleEdgeIDs.has(id)) {
                        edgeRgbMap.delete(id);
                    }
                }
            }
        }

        if (keepRendering || edgeColorAnimating || gradColorAnimating || curveColorAnimating) {
            requestRender();
        }
        
        const tempUnassigned = previousUnassignedEdges;
        previousUnassignedEdges = currentUnassignedEdges;
        currentUnassignedEdges = tempUnassigned;
    }

    // ──── Resize ────
    function resize() {
        isGradientDirty = true;
        
        if (isEmbedMode) {
            if (embedData) {
                dom.cvs.width = embedData.w;
                dom.cvs.height = embedData.h;
            }
            if (!isInitialized) {
                isInitialized = true;
                if (gradientMarkers.length === 0) {
                    const pos = getRandomMarkerPosition();
                    gradientMarkers.push({ x: pos.x, y: pos.y, color: '#cccccc' });
                    updateGradientMarkersCache();
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

        if (!isInitialized) {
            if (w > 0 && h > 0) {
                const isCollapsed = document.body.classList.contains('sidebar-collapsed');
                const effectiveW = isCollapsed ? w : Math.max(0, w - CONFIG.SIDEBAR_WIDTH);
                panX = effectiveW / 2;
                panY = h / 2;
                starPanX5 = panX;
                starPanY5 = panY;
                starZoom5 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_LARGE);
                starZoom2 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_MED);
                starPanX3 = panX;
                starPanY3 = panY;
                starZoom3 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
                isInitialized = true;

                if (gradientMarkers.length === 0) {
                    const pos = getRandomMarkerPosition();
                    gradientMarkers.push({
                        x: pos.x,
                        y: pos.y,
                        color: '#cccccc' 
                    });
                    updateGradientMarkersCache();
                    renderGradientList();
                    renderCurveList();
                }
                initializeCentralTile(); 
            } else {
                requestAnimationFrame(resize);
            }
        }
    }

    // ──── Sidebar Toggle & Resize Handling ────
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        sidebarToggle.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed');
    });

    if (typeof ResizeObserver !== 'undefined' && !isEmbedMode) {
        const ro = new ResizeObserver(() => {
            resize();
            requestRender();
        });
        ro.observe(dom.wrap);
    } else if (!isEmbedMode) {
        window.addEventListener('resize', resize);
    }

    // ──── Sidebar Swipe to Collapse ────
    let sbTouchStartX = null;
    let sbTouchStartY = null;
    let sbDragging = false;
    
    sidebar.addEventListener('touchstart', e => {
        if (sidebar.classList.contains('collapsed')) return;
        
        const targetTag = e.target.tagName;
        if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'BUTTON' || targetTag === 'SELECT') {
            sbTouchStartX = null; 
            return;
        }
        
        sbTouchStartX = e.touches[0].clientX;
        sbTouchStartY = e.touches[0].clientY;
        sbDragging = false;
        sidebar.style.transition = 'none';
    }, { passive: true });
    
    sidebar.addEventListener('touchmove', e => {
        if (sbTouchStartX === null) return;
        const dx = e.touches[0].clientX - sbTouchStartX;
        const dy = e.touches[0].clientY - sbTouchStartY;
        
        if (!sbDragging) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                sbDragging = true;
            } else if (Math.abs(dy) > 10) {
                sbTouchStartX = null; // Vertical scroll, abort swipe
                return;
            }
        }
        
        if (sbDragging) {
            e.preventDefault();
            if (dx > 0) {
                sidebar.style.transform = `translateX(${dx}px)`;
            } else {
                sidebar.style.transform = `translateX(0px)`;
            }
        }
    }, { passive: false });
    
    sidebar.addEventListener('touchend', e => {
        if (sbTouchStartX === null) return;
        const dx = e.changedTouches[0].clientX - sbTouchStartX;
        
        sidebar.style.transition = ''; // Re-enable transition
        
        if (sbDragging && dx > 80) {
            // Close it
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            sidebarToggle.classList.add('collapsed');
            // Explicitly animate to target to prevent snap
            sidebar.style.transform = 'translateX(calc(100% + 10px))';
            setTimeout(() => { sidebar.style.transform = ''; }, 300);
        } else {
            // Snap back to open
            sidebar.style.transform = '';
        }
        
        sbTouchStartX = null;
        sbDragging = false;
    });

    // ──── Chevron Button Drag (Open/Close) ────
    let sbToggleDragging = false;
    let sbToggleStartX = 0;
    let sbToggleCurrentX = 0;

    sidebarToggle.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        sbToggleDragging = true;
        sbToggleStartX = e.touches[0].clientX;
        sbToggleCurrentX = e.touches[0].clientX;
        
        sidebar.style.transition = 'none';
        sidebarToggle.style.transition = 'none';
        e.preventDefault();
    }, { passive: false });

    sidebarToggle.addEventListener('touchmove', e => {
        if (!sbToggleDragging) return;
        sbToggleCurrentX = e.touches[0].clientX;
        let dx = sbToggleCurrentX - sbToggleStartX;
        let isCollapsed = sidebar.classList.contains('collapsed');

        if (isCollapsed) {
            if (dx < 0) {
                let moveX = Math.max(dx, -CONFIG.SIDEBAR_WIDTH);
                sidebar.style.transform = `translateX(calc(100% + 10px + ${moveX}px))`;
                sidebarToggle.style.transform = `translateX(${moveX}px)`;
            }
        } else {
            if (dx > 0) {
                let moveX = Math.min(dx, CONFIG.SIDEBAR_WIDTH);
                sidebar.style.transform = `translateX(${moveX}px)`;
                sidebarToggle.style.transform = `translateX(calc(50% + ${moveX}px))`;
            }
        }
        e.preventDefault();
    }, { passive: false });

    sidebarToggle.addEventListener('touchend', e => {
        if (!sbToggleDragging) return;
        sbToggleDragging = false;
        let dx = sbToggleCurrentX - sbToggleStartX;
        let isCollapsed = sidebar.classList.contains('collapsed');

        // Restore transitions
        sidebar.style.transition = '';
        sidebarToggle.style.transition = '';

        // Handle as a tap if barely moved
        if (Math.abs(dx) < 10) {
            if (isCollapsed) {
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                sidebarToggle.classList.remove('collapsed');
            } else {
                sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                sidebarToggle.classList.add('collapsed');
            }
            sidebar.style.transform = '';
            sidebarToggle.style.transform = '';
        } else if (isCollapsed) {
            if (dx < -80) {
                // Open it
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                sidebarToggle.classList.remove('collapsed');
                sidebar.style.transform = '';
                sidebarToggle.style.transform = '';
            } else {
                // Snap back to closed
                sidebar.style.transform = 'translateX(calc(100% + 10px))';
                sidebarToggle.style.transform = 'translateX(0)';
                setTimeout(() => {
                    sidebar.style.transform = '';
                    sidebarToggle.style.transform = '';
                }, 300);
            }
        } else {
            if (dx > 80) {
                // Close it
                sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                sidebarToggle.classList.add('collapsed');
                sidebar.style.transform = 'translateX(calc(100% + 10px))';
                sidebarToggle.style.transform = 'translateX(0)';
                setTimeout(() => {
                    sidebar.style.transform = '';
                    sidebarToggle.style.transform = '';
                }, 300);
            } else {
                // Snap back to open
                sidebar.style.transform = '';
                sidebarToggle.style.transform = '';
            }
        }
        e.preventDefault();
    });

    function scheduleMagnetZoom() {
        clearTimeout(magnetTimer);
        magnetTimer = setTimeout(() => {
            // Postpone the magnet snap if the user is actively interacting
            if (isDrag || touchState.mode === 'pinch') {
                scheduleMagnetZoom(); 
                return;
            }
            if (targetZoom < 0.27 && targetZoom > CONFIG.MIN_ZOOM) {
                if (targetZoom < 0.22) {
                    targetZoom = 0.20; // Snap to 20%
                } else {
                    targetZoom = 0.25; // Snap to 25%
                }
                requestRender();
            }
        }, CONFIG.MAGNET_DELAY);
    }

    function setZoom(nz, cx, cy) {
        const oz = zoom;
        const oPanX = panX;
        const oPanY = panY;
        zoom = Math.max(MIN_Z, Math.min(MAX_Z, nz));
        if (cx !== undefined) {
            panX = cx - (cx - oPanX) * (zoom / oz);
            panY = cy - (cy - oPanY) * (zoom / oz);
            
            if (zoom !== oz) {
                const odz5 = starZoom5;
                const odz2 = starZoom2;
                const odz3 = starZoom3;

                starZoom5 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_LARGE);
                starZoom2 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_MED);
                starZoom3 = Math.pow(zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
                
                starPanX5 = cx - (cx - starPanX5) * (starZoom5 / odz5);
                starPanY5 = cy - (cy - starPanY5) * (starZoom5 / odz5);
                starPanX2 = cx - (cx - starPanX2) * (starZoom2 / odz2);
                starPanY2 = cy - (cy - starPanY2) * (starZoom2 / odz2);
                starPanX3 = cx - (cx - starPanX3) * (starZoom3 / odz3);
                starPanY3 = cy - (cy - starPanY3) * (starZoom3 / odz3);
            }
            
            if (isDrag) {
                const dx = mouseScreenX - dragSX;
                const dy = mouseScreenY - dragSY;
                dragPX = panX - dx;
                dragPY = panY - dy;
            }
        }
        dom.zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }

    // ──── Touch / Mobile Pinch Zoom & Pan ────
    let touchState = {
        mode: 'none', 
        startX: 0, startY: 0,
        startPanX: 0, startPanY: 0,
        startDist: 0,
        startZoom: 0,
        pinchCenterX: 0,
        pinchCenterY: 0,
        markerIdx: -1,
        startTime: 0,
        timer: null
    };

    dom.cvs.addEventListener('touchstart', e => {
        isTouchDevice = true;
        hoveredQ = null;
        hoveredR = null;
        visHoverX = null;
        visHoverY = null;

        // Auto-hide sidebar on canvas interaction
        if (!isEmbedMode && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            sidebarToggle.classList.add('collapsed');
        }

        if (e.touches.length === 1) {
            const r = dom.cvs.getBoundingClientRect();
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;

            if (!isEmbedMode && markersVisible) {
                let clickedMarkerIdx = -1;
                for (let i = 0; i < gradientMarkers.length; i++) {
                    const m = gradientMarkers[i];
                    const dx = tx - m.x;
                    const dy = ty - m.y;
                    if (dx * dx + dy * dy < CONFIG.MARKER_HIT_RADIUS * CONFIG.MARKER_HIT_RADIUS) { 
                        clickedMarkerIdx = i;
                        break;
                    }
                }
                if (clickedMarkerIdx !== -1) {
                    touchState.mode = 'marker_wait';
                    touchState.markerIdx = clickedMarkerIdx;
                    touchState.startX = tx;
                    touchState.startY = ty;
                    touchState.startTime = Date.now();
                    touchState.timer = setTimeout(() => {
                        if (touchState.mode === 'marker_wait') {
                            touchState.mode = 'marker_drag';
                            isDragMarker = true;
                            draggedMarkerIndex = touchState.markerIdx;
                            dragMarkerOffsetX = touchState.startX - gradientMarkers[touchState.markerIdx].x;
                            dragMarkerOffsetY = touchState.startY - gradientMarkers[touchState.markerIdx].y;
                            targetInteractionFade = 0.0; // Hide grid/curves ONLY when long-press completes
                            if (navigator.vibrate) navigator.vibrate(CONFIG.HAPTIC_DUR); 
                            requestRender();
                        }
                    }, CONFIG.LONG_PRESS_DUR);
                    e.preventDefault();
                    requestRender();
                    return;
                }
            }

            touchState.mode = 'pan_wait';
            touchState.startX = tx;
            touchState.startY = ty;
            touchState.startPanX = panX;
            touchState.startPanY = panY;
            touchState.startTime = Date.now();
            
            isDrag = false;
            dragMoved = false;
            dragSX = tx; dragSY = ty;
            embedDragLastTile = null;
            panVX = 0; panVY = 0;
            
            touchState.timer = setTimeout(() => {
                if (touchState.mode === 'pan_wait' && !dragMoved) {
                    touchState.mode = 'draw';
                    isDrag = false; 
                    if (navigator.vibrate) navigator.vibrate(CONFIG.HAPTIC_DUR);
                    const h = pixToHex(touchState.startX, touchState.startY, zoom, panX, panY);
                    const hk = hexKey(h.q, h.r);
                    if (hk !== embedDragLastTile) {
                        embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                    requestRender();
                }
            }, CONFIG.LONG_PRESS_DUR);
        } else if (e.touches.length === 2) {
            if (touchState.mode === 'marker_wait' || touchState.mode === 'pan_wait') {
                clearTimeout(touchState.timer);
            }
            targetInteractionFade = 1.0; // Restore grid/curves for pinch
            if (touchState.mode === 'marker_drag') {
                isDragMarker = false;
                draggedMarkerIndex = -1;
            }
            touchState.mode = 'pinch';
            isDrag = false; 
            
            panVX = 0; 
            panVY = 0;
            
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchState.startDist = Math.hypot(dx, dy);
            touchState.startZoom = targetZoom;
            
            const r = dom.cvs.getBoundingClientRect();
            touchState.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            touchState.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
            
            zoomCx = touchState.pinchCenterX;
            zoomCy = touchState.pinchCenterY;
            zoomOutBlockedUntil = 0; 
        }
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        if (touchState.mode === 'none') return; 
        const r = dom.cvs.getBoundingClientRect();
        
        if (touchState.mode === 'marker_drag' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;
            gradientMarkers[draggedMarkerIndex].x = tx - dragMarkerOffsetX;
            gradientMarkers[draggedMarkerIndex].y = ty - dragMarkerOffsetY;
            if (gradientMarkersRGB[draggedMarkerIndex]) {
                gradientMarkersRGB[draggedMarkerIndex].x = gradientMarkers[draggedMarkerIndex].x;
                gradientMarkersRGB[draggedMarkerIndex].y = gradientMarkers[draggedMarkerIndex].y;
            }
            isGradientDirty = true;
            requestRender();
            e.preventDefault();
            return;
        } else if (touchState.mode === 'marker_wait' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;
            const dx = tx - touchState.startX;
            const dy = ty - touchState.startY;
            
            if (Math.abs(dx) > CLICK_THRESH || Math.abs(dy) > CLICK_THRESH) {
                // Finger slid away, cancel marker hold and ignore the rest of the touch
                clearTimeout(touchState.timer);
                touchState.mode = 'cancelled';
            }
            e.preventDefault();
            return;
        } else if (touchState.mode === 'draw' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;
            const h = pixToHex(tx, ty, zoom, panX, panY);
            const hk = hexKey(h.q, h.r);
            if (hk !== embedDragLastTile) {
                embedDragLastTile = hk;
                rotateTile(h.q, h.r);
            }
            requestRender();
            e.preventDefault();
            return;
        } else if ((touchState.mode === 'pan' || touchState.mode === 'pan_wait') && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;
            const dx = tx - touchState.startX;
            const dy = ty - touchState.startY;
            
            if (Math.abs(dx) + Math.abs(dy) > CLICK_THRESH) {
                if (!dragMoved) dragMoved = true;
            }
            
            if (dragMoved && touchState.mode === 'pan_wait') {
                clearTimeout(touchState.timer);
                touchState.mode = 'pan';
                isDrag = true; 
            }
            
            if (touchState.mode === 'pan') {
                let targetPanX = touchState.startPanX + dx;
                let targetPanY = touchState.startPanY + dy;
                
                const dPanX = targetPanX - panX;
                const dPanY = targetPanY - panY;
                
                if (inertiaEnabled) {
                    panVX = dPanX;
                    panVY = dPanY;
                    lastPanMoveTime = Date.now();
                } else {
                    panVX = 0;
                    panVY = 0;
                }
                
                panX = targetPanX;
                panY = targetPanY;
                
                starPanX5 += dPanX * CONFIG.STAR_PARALLAX_LARGE;
                starPanY5 += dPanY * CONFIG.STAR_PARALLAX_LARGE;
                starPanX2 += dPanX * CONFIG.STAR_PARALLAX_MED;
                starPanY2 += dPanY * CONFIG.STAR_PARALLAX_MED;
                starPanX3 += dPanX * CONFIG.STAR_PARALLAX_SMALL;
                starPanY3 += dPanY * CONFIG.STAR_PARALLAX_SMALL;
            }
            requestRender();
        } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const newDist = Math.hypot(dx, dy);
            
            let scale = newDist / Math.max(1, touchState.startDist);
            let newTargetZoom = touchState.startZoom * scale;
            
            if (targetZoom < CONFIG.ZOOM_FADE_HIGH && newTargetZoom < targetZoom) {
                let delta = newTargetZoom - targetZoom;
                newTargetZoom = targetZoom + delta * 0.25;
            }
            
            targetZoom = Math.max(MIN_Z, Math.min(MAX_Z, newTargetZoom));
            checkIfSolved();
            scheduleMagnetZoom();
            requestRender();
        }
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchend', e => {
        if (touchState.mode === 'none') return;
        
        let wasMode = touchState.mode;
        
        if (wasMode === 'marker_wait') {
            clearTimeout(touchState.timer);
            const now = Date.now();
            if (now - lastTapTime < 300) {
                removeMarkerAt(touchState.startX, touchState.startY);
                lastTapTime = 0;
            } else {
                lastTapTime = now;
            }
        } else if (wasMode === 'marker_drag') {
            isDragMarker = false;
            draggedMarkerIndex = -1;
            targetInteractionFade = 1.0; // Bring back grid/curves
        } else if (wasMode === 'pan_wait') {
            clearTimeout(touchState.timer);
            
            // Single tap on empty grid - Rotate tile!
            const h = pixToHex(touchState.startX, touchState.startY, zoom, panX, panY);
            rotateTile(h.q, h.r);
            touchOutlines.push({ q: h.q, r: h.r, alpha: 1.0 }); 
        } else if (wasMode === 'pan') {
            if (dragMoved) {
                checkIfSolved();
            }
            // Do NOT zero panVX/panVY here so inertia can continue!
        } else if (wasMode === 'draw') {
            panVX = 0; panVY = 0; // Draw mode shouldn't have inertia
        }
        
        if (e.touches.length === 0) {
            touchState.mode = 'none';
            isDrag = false;
            // Only kill inertia if we weren't panning
            if (wasMode !== 'pan') {
                panVX = 0; panVY = 0;
            }
        } else if (wasMode === 'pinch' && e.touches.length === 1) {
            touchState.mode = 'none';
            isDrag = false;
            panVX = 0; panVY = 0; // Kill inertia when transitioning from pinch
        }
        
        requestRender();
        e.preventDefault();
    }, { passive: false });

    dom.cvs.addEventListener('wheel', e => {
        if (isEmbedMode) return;
        e.preventDefault();
        const r = dom.cvs.getBoundingClientRect();
        zoomCx = e.clientX - r.left;
        zoomCy = e.clientY - r.top;

        const now = Date.now();
        let delta = e.deltaY > 0 ? CONFIG.WHEEL_DELTA_OUT : CONFIG.WHEEL_DELTA_IN;

        if (e.deltaY > 0) { 
            if (targetZoom >= CONFIG.ZOOM_FADE_HIGH && targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
                if (now < zoomOutBlockedUntil) return;
                if (zoomOutBlockedUntil === 0) {
                    zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_WHEEL;
                    return;
                }
            }
            if (targetZoom < CONFIG.ZOOM_FADE_HIGH) {
                delta = 1 + (delta - 1) * CONFIG.WHEEL_SLOW_MULT;
            }
        } else { 
            if (targetZoom * delta >= CONFIG.ZOOM_FADE_HIGH) {
                zoomOutBlockedUntil = 0;
            }
        }

        targetZoom *= delta;
        targetZoom = Math.max(MIN_Z, Math.min(MAX_Z, targetZoom));
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    }, { passive: false });

    dom.cvs.addEventListener('mouseleave', () => {
        hoveredQ = null;
        hoveredR = null;
        visHoverX = null;
        visHoverY = null;
    });
    
    dom.cvs.addEventListener('mousedown', e => {
        const r = dom.cvs.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        
        if (isEmbedMode) {
            isDrag = true; dragMoved = false;
            dragSX = mx; dragSY = my;
            embedDragLastTile = null;
            return;
        }

        if (markersVisible) {
            let clickedMarkerIdx = -1;
            for (let i = 0; i < gradientMarkers.length; i++) {
                const m = gradientMarkers[i];
                const dx = mx - m.x;
                const dy = my - m.y;
                const hitR = CONFIG.MARKER_HIT_RADIUS;
                if (dx * dx + dy * dy < hitR * hitR) {
                    clickedMarkerIdx = i;
                    break;
                }
            }
            if (clickedMarkerIdx !== -1) {
                isDragMarker = true;
                draggedMarkerIndex = clickedMarkerIdx;
                dragMarkerOffsetX = mx - gradientMarkers[clickedMarkerIdx].x;
                dragMarkerOffsetY = my - gradientMarkers[clickedMarkerIdx].y;
                requestRender();
                return;
            }
        }

        isDrag = true;
        dragMoved = false;
        dragSX = e.clientX;
        dragSY = e.clientY;
        dragPX = panX;
        dragPY = panY;
        panVX = 0;
        panVY = 0;
        requestRender();
    });

    window.addEventListener('mousemove', e => {
        const r = dom.cvs.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;

        if (isDragMarker && draggedMarkerIndex !== -1) {
            gradientMarkers[draggedMarkerIndex].x = mx - dragMarkerOffsetX;
            gradientMarkers[draggedMarkerIndex].y = my - dragMarkerOffsetY;
            if (gradientMarkersRGB[draggedMarkerIndex]) {
                gradientMarkersRGB[draggedMarkerIndex].x = gradientMarkers[draggedMarkerIndex].x;
                gradientMarkersRGB[draggedMarkerIndex].y = gradientMarkers[draggedMarkerIndex].y;
            }
            isGradientDirty = true;
            targetInteractionFade = 0.0; // Hide grid/curves as soon as mouse drag starts
            requestRender();
            return;
        }

        mouseScreenX = mx;
        mouseScreenY = my;

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const sidebarHidden = isCollapsed || isEmbedMode;
        const effectiveW = sidebarHidden ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);

        const h = pixToHex(mouseScreenX, mouseScreenY, zoom, panX, panY);

        if (isTouchDevice) {
            hoveredQ = null;
            hoveredR = null;
        } else {
            if (!sidebarHidden && mx > effectiveW) {
                hoveredQ = null;
                hoveredR = null;
            } else {
                hoveredQ = h.q;
                hoveredR = h.r;
            }
        }
        if (isDrag) {
            const dx = mx - dragSX, dy = my - dragSY;
            if (Math.abs(dx) + Math.abs(dy) > CLICK_THRESH) { if (!dragMoved) dragMoved = true; }

            if (isEmbedMode) {
                if (dragMoved) {
                    const hk = hexKey(h.q, h.r);
                    if (hk !== embedDragLastTile) {
                        embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                }
            } else {
                let targetPanX = dragPX + dx;
                let targetPanY = dragPY + dy;

                const dPanX = targetPanX - panX;
                const dPanY = targetPanY - panY;

                if (inertiaEnabled) {
                    panVX = dPanX;
                    panVY = dPanY;
                    lastPanMoveTime = Date.now();
                } else {
                    panVX = 0;
                    panVY = 0;
                }

                panX = targetPanX;
                panY = targetPanY;
                
                starPanX5 += dPanX * CONFIG.STAR_PARALLAX_LARGE;
                starPanY5 += dPanY * CONFIG.STAR_PARALLAX_LARGE;
                starPanX2 += dPanX * CONFIG.STAR_PARALLAX_MED;
                starPanY2 += dPanY * CONFIG.STAR_PARALLAX_MED;
                starPanX3 += dPanX * CONFIG.STAR_PARALLAX_SMALL;
                starPanY3 += dPanY * CONFIG.STAR_PARALLAX_SMALL;
            }
        }
        requestRender();
    });
    window.addEventListener('mouseup', e => {
        if (isDragMarker) {
            isDragMarker = false;
            draggedMarkerIndex = -1;
            targetInteractionFade = 1.0; // Bring back grid/curves
            requestRender();
            return;
        }
        if (isDrag) {
            if (!dragMoved) {
                handleClick(e);
            } else {
                checkIfSolved();
            }
            isDrag = false;
            targetInteractionFade = 1.0; // Bring back grid/curves
        }
        requestRender();
    });

    function removeMarkerAt(mx, my) {
        let clickedMarkerIdx = -1;
        for (let i = 0; i < gradientMarkers.length; i++) {
            const m = gradientMarkers[i];
            const dx = mx - m.x;
            const dy = my - m.y;
            const hitR = CONFIG.MARKER_HIT_RADIUS;
            if (dx * dx + dy * dy < hitR * hitR) {
                clickedMarkerIdx = i;
                break;
            }
        }

        if (clickedMarkerIdx !== -1) {
            if (gradientMarkers.length > 1) {
                const removedMarker = gradientMarkers[clickedMarkerIdx];
                const cached = gradientMarkersRGB[clickedMarkerIdx];
                fadingMarkersRGB.push({
                    x: removedMarker.x,
                    y: removedMarker.y,
                    r: cached.r, g: cached.g, b: cached.b,
                    origR: cached.r, origG: cached.g, origB: cached.b,
                    weight: cached.weight || 1
                });
                
                gradientMarkers.splice(clickedMarkerIdx, 1);
                gradientMarkersRGB.splice(clickedMarkerIdx, 1); 
                
                isDragMarker = false;
                draggedMarkerIndex = -1;
                
                renderGradientList();
                updateGradientMarkersCache();
                requestRender();
                toast('Marker and color removed');
            } else {
                toast('At least one marker is required');
            }
        }
    }

    dom.cvs.addEventListener('dblclick', e => {
        if (isEmbedMode) return;
        const r = dom.cvs.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;

        let clickedMarkerIdx = -1;
        for (let i = 0; i < gradientMarkers.length; i++) {
            const m = gradientMarkers[i];
            const dx = mx - m.x;
            const dy = my - m.y;
            const hitR = CONFIG.MARKER_HIT_RADIUS;
            if (dx * dx + dy * dy < hitR * hitR) {
                clickedMarkerIdx = i;
                break;
            }
        }

        if (clickedMarkerIdx !== -1) {
            removeMarkerAt(mx, my);
        }
    });

    function rotateTile(q, r) {
        const k = hexKey(q, r);
        const now = Date.now();
        
        lastRipple = { q, r, time: now };

        const curDisplay = displayRot(q, r, now);
        const curLogical = tileRot(q, r);
        const nextLogical = (curLogical + ROT_STEP) % 360;
        rotOverrides.set(k, nextLogical);

        const target = nearestTarget(curDisplay, nextLogical);
        animMap.set(k, { start: now, from: curDisplay, to: target, duration: CLICK_DUR });
        
        // Only calculate curves if they are actually visible to prevent memory leaks
        const visZoom = (isEmbedMode && embedData && embedData.origZoom) ? embedData.origZoom : zoom;
        const visSz = HEX_R * visZoom;
        const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
        
        if (visSz > fadeEndSz) {
            if (curveColors.length > 1) {
                updateLocalCurves(q, r);
            }
        } else {
            queue.length = 0;
            curveMap.clear();
            curves.clear();
            edgeRgbMap.clear();
        }

        checkIfSolved();
        requestRender();
    }

    function handleClick(e) {
        const r = dom.cvs.getBoundingClientRect();
        const h = pixToHex(e.clientX - r.left, e.clientY - r.top, zoom, panX, panY);
        rotateTile(h.q, h.r);
    }

    dom.zoomIn.onclick = () => {
        zoomCx = dom.cvs.width / 2; 
        zoomCy = dom.cvs.height / 2;
        targetZoom = Math.min(MAX_Z, targetZoom * CONFIG.BTN_DELTA_IN);
        if (targetZoom >= CONFIG.ZOOM_FADE_HIGH) zoomOutBlockedUntil = 0;
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    };
    
    dom.zoomOut.onclick = () => {
        zoomCx = dom.cvs.width / 2; 
        zoomCy = dom.cvs.height / 2;
        const now = Date.now();
        let delta = CONFIG.BTN_DELTA_OUT;
        
        if (targetZoom >= CONFIG.ZOOM_FADE_HIGH && targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
            if (now < zoomOutBlockedUntil) return;
            if (zoomOutBlockedUntil === 0) {
                zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_BTN;
                return;
            }
        }
        if (targetZoom < CONFIG.ZOOM_FADE_HIGH) {
            delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
        }
        targetZoom = Math.max(MIN_Z, targetZoom * delta);
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    };

    window.addEventListener('keydown', e => {
        if (isEmbedMode) return;
        zoomCx = dom.cvs.width / 2; 
        zoomCy = dom.cvs.height / 2;
        const now = Date.now();
        
        if (e.key === '=' || e.key === '+') {
            targetZoom = Math.min(MAX_Z, targetZoom * CONFIG.KEY_DELTA_IN);
            if (targetZoom >= CONFIG.ZOOM_FADE_HIGH) zoomOutBlockedUntil = 0;
            checkIfSolved();
            scheduleMagnetZoom();
        }
        if (e.key === '-') {
            let delta = CONFIG.KEY_DELTA_OUT;
            if (targetZoom >= CONFIG.ZOOM_FADE_HIGH && targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
                if (now < zoomOutBlockedUntil) return;
                if (zoomOutBlockedUntil === 0) {
                    zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_BTN;
                    return;
                }
            }
            if (targetZoom < CONFIG.ZOOM_FADE_HIGH) {
                delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
            }
            targetZoom = Math.max(MIN_Z, targetZoom * delta);
            checkIfSolved();
            scheduleMagnetZoom(); 
        }
        requestRender();
    });

    dom.gridToggle.addEventListener('change', function() { showGrid = this.checked; requestRender();});
    dom.unrenderedToggle.addEventListener('change', function() { showUnrenderedDotted = this.checked; requestRender();});
    dom.bgStarsToggle.addEventListener('change', function() { showBgStars = this.checked; requestRender();});
    dom.markersToggle.addEventListener('change', function() { markersVisible = this.checked; requestRender();});
    dom.flowToggle.addEventListener('change', function() { 
        flowEnabled = this.checked; 
        requestRender(); 
    });
    dom.inertiaToggle.addEventListener('change', function() { 
        inertiaEnabled = this.checked; 
        if (!inertiaEnabled) {
            panVX = 0; 
            panVY = 0;
        }
        requestRender(); 
    });
    dom.sCurveW.addEventListener('input', function() {
        curveLineWidth = +dom.sCurveW.value;
        dom.vCurveW.textContent = curveLineWidth.toFixed(2) + 'x';
        requestRender();
    });

    let lastAlterRatio = 0;
    dom.sAlterTiles.addEventListener('input', function() {
        alterTilesRatio = +dom.sAlterTiles.value;
        dom.vAlterTiles.textContent = alterTilesRatio.toFixed(2);
        if (Math.abs(alterTilesRatio - lastAlterRatio) > 0.001) {
            lastAlterRatio = alterTilesRatio;
            curveMap.clear();
            edgeRgbMap.clear();
            curves.clear();
            queue.length = 0;
            initializeCentralTile();
        }
        requestRender();
        checkIfSolved();
    });

    function bulkAnimate(newMode, newSeed) {
        const now = Date.now();
        const hexes = visibleHexes(zoom, panX, panY, dom.cvs.width, dom.cvs.height);
        const snapshots = new Map();
        for (const h of hexes) snapshots.set(hexKey(h.q, h.r), displayRot(h.q, h.r, now));
        rotOverrides.clear();
        rotMode = newMode;
        rotSeed = newSeed; 
        for (const h of hexes) {
            const k = hexKey(h.q, h.r);
            const curDisplay = snapshots.get(k);
            const newBase = baseRot(h.q, h.r);
            const target = nearestTarget(curDisplay, newBase);
            if (Math.abs(target - curDisplay) > 0.5) {
                animMap.set(k, { start: now, from: curDisplay, to: target, duration: BULK_DUR });
            } else {
                animMap.delete(k);
            }
        }
        curveMap.clear();
        edgeRgbMap.clear();
        curves.clear();
        queue.length = 0;
        initializeCentralTile();
        checkIfSolved();
    }

    dom.randAnglesBtn.onclick = () => {
        bulkAnimate('hash', (rotSeed + 1) & 0x7FFFFFFF);
        toast('Angles randomized');
    };

    dom.randLineColorsBtn.onclick = () => {
        if (curveColors.length === 0) return;
        curveColorPool = generateDistinctThemePool();
        for (let i = 0; i < curveColors.length; i++) {
            curveColors[i] = curveColorPool.pool[i] || curveColors[i];
        }
        updateCurveColorsCache();
        renderCurveList();
        toast(`Theme "${curveColorPool.name}" applied to curves`);
        checkIfSolved();
        requestRender();
    };

    dom.randGradColorsBtn.onclick = () => {
        if (gradientMarkers.length === 0) return;
        gradientColorPool = generateDistinctThemePool();
        for (let i = 0; i < gradientMarkers.length; i++) {
            gradientMarkers[i].color = gradientColorPool.pool[i] || gradientMarkers[i].color;
            updateGradientMarkersCache();
        }
        renderGradientList();
        toast(`Theme "${gradientColorPool.name}" applied to gradient`);
        requestRender();
    };

    dom.resetAllRot.onclick = () => {
        bulkAnimate('zero', 0);
        toast('All tile rotations reset to 0°');
    };

    dom.uploadZone.onclick = () => dom.fileInput.click();
    dom.uploadZone.ondragover = e => {
        e.preventDefault();
        dom.uploadZone.style.borderColor = 'var(--col-accent)';
    };
    dom.uploadZone.ondragleave = () => { dom.uploadZone.style.borderColor = ''; };
    dom.uploadZone.ondrop = e => {
        e.preventDefault();
        dom.uploadZone.style.borderColor = '';
        if (e.dataTransfer.files[0]?.type.startsWith('image/')) loadFile(e.dataTransfer.files[0]);
    };
    dom.fileInput.onchange = () => { if (dom.fileInput.files[0]) loadFile(dom.fileInput.files[0]); };

    function loadFile(file) {
        dom.fileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                pendImg = img;
                openEditor();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function readSliders() {
        return {
            rot: +dom.sRot.value,
            scale: +dom.sScale.value,
            sx: +dom.sSX.value,
            sy: +dom.sSY.value,
            ox: +dom.sOX.value,
            oy: +dom.sOY.value
        };
    }

    function writeSliders(tf) {
        dom.sRot.value = tf.rot;
        dom.sScale.value = tf.scale;
        dom.sSX.value = tf.sx;
        dom.sSY.value = tf.sy;
        dom.sOX.value = tf.ox;
        dom.sOY.value = tf.oy;
        syncSliderLabels();
    }

    function openEditor() {
        dom.editorPanel.classList.add('open');
        writeSliders(texTf);
        drawPreview();
    }

    function closeEditor() {
        dom.editorPanel.classList.remove('open');
        pendImg = null;
    }

    function applyTexture() {
        if (pendImg) texImg = pendImg;
        texTf = readSliders();
        toast('Texture applied — keep adjusting or close the editor');
    }

    dom.cancelEd.onclick = closeEditor;
    dom.applyEd.onclick = applyTexture;
    dom.resetTexBtn.onclick = () => {
        texImg = null;
        texTf = { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
        if (dom.editorPanel.classList.contains('open')) {
            writeSliders(texTf);
            drawPreview();
        }
        pendImg = null;
        closeEditor();
        dom.fileName.textContent = '';
        toast('Texture reset to default');
    };

    [dom.sRot, dom.sScale, dom.sSX, dom.sSY, dom.sOX, dom.sOY].forEach(el => {
        el.addEventListener('input', () => {
            syncSliderLabels();
            drawPreview();
        });
    });

    function syncSliderLabels() {
        dom.vRot.textContent = dom.sRot.value + '°';
        dom.vScale.textContent = (+dom.sScale.value).toFixed(2) + 'x';
        dom.vSX.textContent = (+dom.sSX.value).toFixed(2) + 'x';
        dom.vSY.textContent = (+dom.sSY.value).toFixed(2) + 'x';
        dom.vOX.textContent = dom.sOX.value;
        dom.vOY.textContent = dom.sOY.value;
    }

    function drawPreview() {
        const pc = dom.previewCanvas;
        const pctx = pc.getContext('2d');
        const cX = 110,
            cY = 110,
            rSz = 85;
        pctx.clearRect(0, 0, 220, 220);
        pctx.fillStyle = COLORS.bg;
        pctx.fillRect(0, 0, 220, 220);
        pctx.save();
        traceHexPath(pctx, cX, cY, rSz);
        pctx.clip();
        pctx.translate(cX, cY);
        const img = pendImg || texImg;
        if (img) {
            const tf = readSliders();
            pctx.rotate(tf.rot * DEG2RAD);
            pctx.scale(tf.sx * tf.scale, tf.sy * tf.scale);
            pctx.translate(tf.ox, tf.oy);
            const iSz = rSz * 2.6;
            pctx.drawImage(img, -iSz / 2, -iSz / 2, iSz, iSz);
        } else {
            pctx.fillStyle = COLORS.previewPlaceholder;
            pctx.fillRect(-rSz, -rSz, rSz * 2, rSz * 2);
        }
        pctx.restore();
        traceHexPath(pctx, cX, cY, rSz);
        pctx.strokeStyle = COLORS.previewStroke;
        pctx.lineWidth = 2;
        pctx.stroke();
        for (let i = 0; i < 6; i++) {
            const a = PI_DIV_3 * i;
            pctx.beginPath();
            pctx.arc(cX + rSz * Math.cos(a), cY + rSz * Math.sin(a), 3, 0, Math.PI * 2);
            pctx.fillStyle = COLORS.previewDot;
            pctx.fill();
        }
    }

    function generateFavicon() {
        const favCanvas = document.createElement('canvas');
        favCanvas.width = 64;
        favCanvas.height = 64;
        const fctx = favCanvas.getContext('2d');

        const sz = 32;
        const cx = 32;
        const cy = 32;
        const rSz = sz * 0.95;
        const PI_DIV_3 = CONFIG.PI_DIV_3;
        const TWO_PI_DIV_3 = CONFIG.TWO_PI_DIV_3;
        const FOUR_PI_DIV_3 = CONFIG.FOUR_PI_DIV_3;
        const SQRT3 = CONFIG.SQRT3;
        const a = sz * SQRT3 / 2;

        const randomAngle = Math.floor(Math.random() * 6) * PI_DIV_3;

        fctx.save();
        fctx.translate(cx, cy);
        fctx.rotate(randomAngle);

        fctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = PI_DIV_3 * i;
            const vx = rSz * Math.cos(angle);
            const vy = rSz * Math.sin(angle);
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
        const lineWidth = sz / 3.5;
        fctx.strokeStyle = '#444444';
        fctx.lineWidth = lineWidth;

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

    let toastTimer = null;
    let lastTapTime = 0;

    function toast(msg) {
        dom.toast.textContent = msg;
        dom.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => dom.toast.classList.remove('show'), CONFIG.TOAST_DUR);
    }

    function pickNewMarkerColor() {
        const existing = new Set(gradientMarkers.map(m => m.color.toLowerCase()));
        
        for (let i = 0; i < gradientColorPool.pool.length; i++) {
            if (!existing.has(gradientColorPool.pool[i].toLowerCase())) {
                return gradientColorPool.pool[i];
            }
        }
        
        for (let attempts = 0; attempts < 200; attempts++) {
            const c = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            if (!existing.has(c.toLowerCase())) return c;
        }
        return null;
    }

    function pickNewCurveColor() {
        const existing = new Set(curveColors.map(c => c.toLowerCase()));
        
        for (let i = 0; i < curveColorPool.pool.length; i++) {
            if (!existing.has(curveColorPool.pool[i].toLowerCase())) {
                return curveColorPool.pool[i];
            }
        }
        
        for (let attempts = 0; attempts < 200; attempts++) {
            const c = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            if (!existing.has(c.toLowerCase())) return c;
        }
        return null;
    }

    function getRandomMarkerPosition() {
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const sidebarHidden = isCollapsed || isEmbedMode;
        const W = sidebarHidden ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
        const H = dom.cvs.height;
        const minX = W * 0.1;
        const maxX = W * 0.9;
        const minY = H * 0.1;
        const maxY = H * 0.9;

        let bestX = minX + Math.random() * (maxX - minX);
        let bestY = minY + Math.random() * (maxY - minY);

        if (gradientMarkers.length > 0) {
            let maxMinDist = -1;
            const candidates = 100;
            for (let i = 0; i < candidates; i++) {
                const cx = minX + Math.random() * (maxX - minX);
                const cy = minY + Math.random() * (maxY - minY);
                let minDist = Infinity;
                for (const m of gradientMarkers) {
                    const dx = cx - m.x;
                    const dy = cy - m.y;
                    const dist = dx * dx + dy * dy;
                    if (dist < minDist) minDist = dist;
                }
                if (minDist > maxMinDist) {
                    maxMinDist = minDist;
                    bestX = cx;
                    bestY = cy;
                }
            }
        }
        return { x: bestX, y: bestY };
    }

    dom.addMarkerBtn.onclick = () => {
        if (gradientMarkers.length >= CONFIG.MAX_MARKERS) {
            toast('Maximum of ' + CONFIG.MAX_MARKERS + ' gradient markers reached');
            return;
        }
        const color = pickNewMarkerColor();
        if (!color) {
            toast('All colors are already in use');
            return;
        }
        const pos = getRandomMarkerPosition();
        gradientMarkers.push({ x: pos.x, y: pos.y, color: color });
        updateGradientMarkersCache();
        markersVisible = true;
        dom.markersToggle.checked = true;
        renderGradientList();
    };

    dom.addCurveBtn.onclick = () => {
        if (curveColors.length >= CONFIG.MAX_CURVE_COLORS) {
            toast('Maximum of ' + CONFIG.MAX_CURVE_COLORS + ' curve colors reached');
            return;
        }
        const color = pickNewCurveColor();
        if (!color) {
            toast('All colors are already in use');
            return;
        }
        curveColors.push(color);
        updateCurveColorsCache();
        activeCurveIndex = curveColors.length - 1;
        renderCurveList();
        curveMap.clear();
        curves.clear();
        queue.length = 0;
        initializeCentralTile();
        checkIfSolved();
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  EXPORT & EMBED
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function decodeHexKey(k) {
        const ku = k >>> 0, qu = ku >>> 16, ru = ku & 0xFFFF;
        const r = (ru & 0x8000) ? (ru | 0xFFFF0000) | 0 : ru;
        const qVal = (ru & 0x8000) ? ((qu ^ 0xFFFF) & 0xFFFF) : qu;
        const q = (qVal & 0x8000) ? (qVal | 0xFFFF0000) | 0 : qVal;
        return { q, r };
    }

    function serializeRotOverrides() {
        const out = [];
        for (const [k, rot] of rotOverrides.entries()) {
            const { q, r } = decodeHexKey(k);
            out.push([q, r, rot]);
        }
        return out;
    }

    function getTextureDataUrl() {
        if (!texImg) return null;
        try {
            const c = document.createElement('canvas');
            c.width = texImg.naturalWidth || texImg.width;
            c.height = texImg.naturalHeight || texImg.height;
            c.getContext('2d').drawImage(texImg, 0, 0);
            return c.toDataURL('image/png');
        } catch (e) { return null; }
    }

    // ── Frame state ──
    let efRect = { x: 0, y: 0, w: 0, h: 0 };
    let efDrag = null;
    let aspectLocked = false;
    let targetRatio = 1;
    let sidebarWasCollapsed = false;

    function openExportOverlay() {
        // 1. Finish processing the queue instantly so all curves are generated
        let safety = 10000;
        while (safety-- > 0 && queue.length > 0) {
            processQueue();
        }
        
        // 2. Force all edges to their final target colors instantly (no ripples)
        for (const [id, edgeData] of edgeRgbMap.entries()) {
            let targetCurveID = -1;
            let targetRgb = null;
            
            if (curveColors.length === 1) {
                const c = curveColorsRGB[0];
                if (c) targetRgb = { r: c.tr !== undefined ? c.tr : c.r, g: c.tg !== undefined ? c.tg : c.g, b: c.tb !== undefined ? c.tb : c.b };
                targetCurveID = -2;
            } else if (curveMap.has(id)) {
                targetCurveID = curveMap.get(id);
                const curve = curves.get(targetCurveID);
                if (curve) {
                    let c = curve.color;
                    if (typeof c === 'number') {
                        const cc = curveColorsRGB[c % curveColorsRGB.length];
                        targetRgb = { r: cc.tr !== undefined ? cc.tr : cc.r, g: cc.tg !== undefined ? cc.tg : cc.g, b: cc.tb !== undefined ? cc.tb : cc.b };
                    } else {
                        const rgb = hexToRgb(c); 
                        targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
                    }
                }
            }
            
            if (targetRgb) {
                if (!edgeData) {
                    edgeRgbMap.set(id, { 
                        rgb: [targetRgb.r, targetRgb.g, targetRgb.b], 
                        alpha: 1, 
                        targetCurveID: targetCurveID, 
                        rippleTime: 0, 
                        rippleQ: 0, 
                        rippleR: 0,
                        rippleActive: false,
                        colorStr: '' 
                    });
                } else {
                    edgeData.rgb[0] = targetRgb.r;
                    edgeData.rgb[1] = targetRgb.g;
                    edgeData.rgb[2] = targetRgb.b;
                    edgeData.alpha = 1.0;
                    edgeData.targetCurveID = targetCurveID;
                    edgeData.rippleActive = false;
                    edgeData.colorStr = '';
                }
            } else {
                edgeRgbMap.delete(id);
            }
        }

        const cr = dom.cvs.getBoundingClientRect();
        const fw = cr.width / 2, fh = cr.height / 2;
        targetRatio = fw / fh;
        efRect = { x: cr.left + (cr.width - fw) / 2, y: cr.top + (cr.height - fh) / 2, w: fw, h: fh };
        dom.exportOverlay.classList.add('active');
        
        sidebarWasCollapsed = document.body.classList.contains('sidebar-collapsed');
        if (!sidebarWasCollapsed) {
            document.body.classList.add('sidebar-collapsed');
            document.querySelector('.sidebar').classList.add('collapsed');
            document.getElementById('sidebarToggle').classList.add('collapsed');
        }
        document.body.classList.add('exporting');
        isExporting = true;
        
        // Kill any ongoing inertia immediately
        panVX = 0; 
        panVY = 0;

        dom.exportW.value = Math.round(fw);
        dom.exportH.value = Math.round(fh);
        
        aspectLocked = false;
        dom.aspectLockBtn.classList.remove('active');
        dom.exportFrame.classList.remove('locked-aspect');
        
        dom.exportImageBtn.classList.remove('active');
        dom.exportEmbedBtn.classList.remove('active');
        dom.imageExportWrap.classList.remove('visible');
        dom.embedCodeWrap.classList.remove('visible');

        dom.exportMenu.style.display = 'block';
        updateExportFrameDOM();
    }

    function closeExportOverlay() {
        dom.exportOverlay.classList.remove('active');
        document.body.classList.remove('exporting');
        if (!sidebarWasCollapsed) {
            document.body.classList.remove('sidebar-collapsed');
            document.querySelector('.sidebar').classList.remove('collapsed');
            document.getElementById('sidebarToggle').classList.remove('collapsed');
        }
        isExporting = false;
        dom.embedCodeWrap.classList.remove('visible');
        dom.imageExportWrap.classList.remove('visible');
    }
    
    function updateExportFrameDOM() {
        const f = dom.exportFrame;
        f.style.left = efRect.x + 'px';
        f.style.top = efRect.y + 'px';
        f.style.width = efRect.w + 'px';
        f.style.height = efRect.h + 'px';
        
        // Hide export menu if the drawn frame is smaller than 50x50
        if (efRect.w < 50 || efRect.h < 50) {
            dom.exportMenu.style.display = 'none';
            return;
        }
        
        dom.exportMenu.style.display = 'block';
        const menuW = 280; // Approximate menu width
        const menuH = 320; // Approximate menu height
        let mx = 0, my = 0;
        let placed = false;

        // 1. Try Right side
        if (efRect.x + efRect.w + 16 + menuW <= window.innerWidth - 16) {
            mx = efRect.x + efRect.w + 16;
            my = efRect.y;
            // Clamp vertically to screen bounds
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
            placed = true;
        }

        // 2. Try Left side
        if (!placed && efRect.x - menuW - 16 >= 16) {
            mx = efRect.x - menuW - 16;
            my = efRect.y;
            // Clamp vertically to screen bounds
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
            placed = true;
        }

        // 3. Try Top
        if (!placed && efRect.y - menuH - 16 >= 16) {
            my = efRect.y - menuH - 16;
            // Center horizontally over the frame
            mx = efRect.x + (efRect.w / 2) - (menuW / 2);
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            placed = true;
        }

        // 4. Try Bottom
        if (!placed && efRect.y + efRect.h + 16 + menuH <= window.innerHeight - 16) {
            my = efRect.y + efRect.h + 16;
            // Center horizontally over the frame
            mx = efRect.x + (efRect.w / 2) - (menuW / 2);
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            placed = true;
        }

        // 5. Absolute Last Resort: Inside the frame (top-left corner)
        if (!placed) {
            mx = efRect.x + 16;
            my = efRect.y + 16;
            // Just in case the frame itself is smaller than the menu, clamp to screen
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
        }

        dom.exportMenu.style.left = mx + 'px';
        dom.exportMenu.style.top = my + 'px';
        
        const sideLabel = document.getElementById('exportSideLabel');
        if (sideLabel) {
            sideLabel.textContent = efRect.w >= efRect.h ? 'Exported width (px)' : 'Exported height (px)';
        }
    }

    function clampFrameToCanvas() {
        const cr = dom.cvs.getBoundingClientRect();
        efRect.x = Math.max(cr.left, Math.min(efRect.x, cr.left + cr.width - 80));
        efRect.y = Math.max(cr.top, Math.min(efRect.y, cr.top + cr.height - 80));
        efRect.w = Math.max(50, Math.min(efRect.w, cr.left + cr.width - efRect.x));
        efRect.h = Math.max(50, Math.min(efRect.h, cr.top + cr.height - efRect.y));
    }

    dom.exportBtn.onclick = openExportOverlay;
    dom.closeExportBtn.onclick = closeExportOverlay;

    // ── Aspect Ratio Lock ──
    dom.aspectLockBtn.addEventListener('click', () => {
        aspectLocked = !aspectLocked;
        dom.aspectLockBtn.classList.toggle('active', aspectLocked);
        dom.exportFrame.classList.toggle('locked-aspect', aspectLocked);
        
        if (aspectLocked) {
            let valW = parseInt(dom.exportW.value) || 50;
            let valH = parseInt(dom.exportH.value) || 50;
            targetRatio = valW / valH;
            
            let newW = efRect.w;
            let newH = newW / targetRatio;
            if (newH > efRect.h) { 
                newH = efRect.h; 
                newW = newH * targetRatio; 
            }
            
            efRect.x += (efRect.w - newW) / 2;
            efRect.y += (efRect.h - newH) / 2;
            efRect.w = newW;
            efRect.h = newH;
            
            clampFrameToCanvas();
            updateExportFrameDOM();
            
            dom.exportW.value = Math.round(efRect.w);
            dom.exportH.value = Math.round(efRect.h);
        }
    });

    // ── Output Size Inputs (Enter to apply) ──
    dom.exportW.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let valW = parseInt(dom.exportW.value) || 50;
        if (aspectLocked) {
            let valH = valW / targetRatio;
            if (valH > cr.height) { valH = cr.height; valW = valH * targetRatio; }
            if (valW > cr.width) { valW = cr.width; valH = valW / targetRatio; }
            dom.exportH.value = Math.round(valH);
            dom.exportW.value = Math.round(valW);
            efRect.w = valW;
            efRect.h = valH;
        } else {
            valW = Math.min(valW, cr.width);
            dom.exportW.value = valW;
            efRect.w = valW;
        }
        clampFrameToCanvas();
        updateExportFrameDOM();
    });
    
    dom.exportH.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let valH = parseInt(dom.exportH.value) || 50;
        if (aspectLocked) {
            let valW = valH * targetRatio;
            if (valW > cr.width) { valW = cr.width; valH = valW / targetRatio; }
            if (valH > cr.height) { valH = cr.height; valW = valH * targetRatio; }
            dom.exportW.value = Math.round(valW);
            dom.exportH.value = Math.round(valH);
            efRect.w = valW;
            efRect.h = valH;
        } else {
            valH = Math.min(valH, cr.height);
            dom.exportH.value = valH;
            efRect.h = valH;
        }
        clampFrameToCanvas();
        updateExportFrameDOM();
    });

    // ── Tab Switching ──
    dom.exportImageBtn.onclick = () => {
        dom.exportImageBtn.classList.add('active');
        dom.exportEmbedBtn.classList.remove('active');
        dom.imageExportWrap.classList.add('visible');
        dom.embedCodeWrap.classList.remove('visible');
    };

    dom.fmtPdfBtn.onclick = async () => {
        const cr = dom.cvs.getBoundingClientRect();
        const fx = efRect.x - cr.left;
        const fy = efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(efRect.w, efRect.h);
        const scale = targetLong / currentLong;
        const eW = Math.round(efRect.w * scale);
        const eH = Math.round(efRect.h * scale);
        const eZoom = zoom * scale;
        const ePanX = (panX - fx) * scale;
        const ePanY = (panY - fy) * scale;

        const svgString = buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY);

        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
        const svgElement = svgDoc.documentElement;

        const { jsPDF } = window.jspdf;
        const orientation = eW > eH ? 'landscape' : 'portrait';
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [eW, eH],
            compress: true
        });
        
        await pdf.svg(svgElement, { x: 0, y: 0, width: eW, height: eH });
        
        pdf.save('hex-tiles-export.pdf');
        toast('PDF exported (Vector)');
    };

    // ── Shared SVG generation function ──
    function buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY) {
        const now = exportFreezeTime || Date.now();
        const exportHexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);

        let exportBounds = { minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity };
        for (const h of exportHexes) {
            if (h.q < exportBounds.minQ) exportBounds.minQ = h.q;
            if (h.q > exportBounds.maxQ) exportBounds.maxQ = h.q;
            if (h.r < exportBounds.minR) exportBounds.minR = h.r;
            if (h.r > exportBounds.maxR) exportBounds.maxR = h.r;
        }

        const origSz = HEX_R * zoom;
        let eCurveAlpha = 1.0, eGridAlpha = 1.0;
        const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT;
        const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
        if (origSz <= fadeEndSz + 0.5) { eCurveAlpha = 0; eGridAlpha = 0; }
        else if (origSz < fadeStartSz) {
            let t = (origSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
            eCurveAlpha = t * t * (3 - 2 * t);
            eGridAlpha = eCurveAlpha;
        }

        // SKIP PROCESS QUEUE IF CURVES ARE INVISIBLE!
        if (curveColors.length >= 1 && eCurveAlpha > 0) {
            let safety = 2000;
            while (safety-- > 0) {
                processQueue(exportBounds, true);
                if (queue.length === 0) {
                    if (!findUncoloredTileInHexes(exportHexes)) break;
                }
            }
        }

        let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${eW}" height="${eH}" viewBox="0 0 ${eW} ${eH}">`;
        svg += `<rect width="${eW}" height="${eH}" fill="${COLORS.bg}"/>`;

        if (gradientMarkersRGB.length > 0) {
            updateIDWGradientCanvas(eW, eH, scale, fx, fy, 0.5);
            const gradUrl = gradientCanvas.toDataURL('image/png');
            svg += `<image xlink:href="${gradUrl}" width="${eW}" height="${eH}" preserveAspectRatio="none"/>`;
        }

        if (showBgStars) {
            const expStarPanX5 = (starPanX5 - fx) * scale;
            const expStarPanY5 = (starPanY5 - fy) * scale;
            const expStarPanX2 = (starPanX2 - fx) * scale;
            const expStarPanY2 = (starPanY2 - fy) * scale;
            const expStarPanX3 = (starPanX3 - fx) * scale;
            const expStarPanY3 = (starPanY3 - fy) * scale;
            
            const spacing5 = CONFIG.STAR_SPACING_LARGE * starZoom5 * scale;
            const spacing2 = CONFIG.STAR_SPACING_MED * starZoom2 * scale;
            const spacing3 = CONFIG.STAR_SPACING_SMALL * starZoom3 * scale;

            function addStars(spacing, size, seed, panX, panY, eW, eH, coordScale, now, allowBlazing, alphaMult, zoomOutTime, offsetX, offsetY, blazeFade = 1.0) {
                if (spacing < CONFIG.STAR_MIN_SPACING) return;
                const kMin = Math.floor((0 - panX) / spacing) - 2;
                const kMax = Math.ceil((eW - panX) / spacing) + 2;
                const jMin = Math.floor((0 - panY) / spacing) - 2;
                const jMax = Math.ceil((eH - panY) / spacing) + 2;
                
                for (let k = kMin; k <= kMax; k++) {
                    for (let j = jMin; j <= jMax; j++) {
                        const gx = panX + k * spacing;
                        const gy = panY + j * spacing;
                        
                        const rx = (hash2D(k * seed + 123, j * seed + 456) - 0.5) * spacing;
                        const ry = (hash2D(k * seed + 789, j * seed + 101) - 0.5) * spacing;
                        
                        const x = gx + rx;
                        const y = gy + ry;
                        
                        if (x < -spacing || x > eW + spacing || y < -spacing || y > eH + spacing) continue;
                        
                        const bg = getBackgroundColorAt(x, y, coordScale, offsetX, offsetY);
                        if (!bg) continue;
                        
                        const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
                        
                        let t = (lum - CONFIG.STAR_LUM_MIN) / CONFIG.STAR_LUM_RANGE;
                        t = Math.max(0, Math.min(1, t));
                        t = t * t * (3 - 2 * t);
                        
                        let sR = Math.round(255 * (1 - t));
                        let sA = (0.6 * (1 - t) + 0.5 * t) * alphaMult;
                        let r = Math.max(1.5, (size * coordScale) / 2);
                        
                        if (allowBlazing && zoomOutTime > 0) {
                            const cycleDuration = CONFIG.STAR_BLAZE_MIN_INTERVAL + hash2D(k * seed + 555, j * seed + 999) * CONFIG.STAR_BLAZE_MAX_INTERVAL_ADD;
                            const offset = hash2D(k * seed + 111, j * seed + 222) * cycleDuration;
                            const phase = (now + offset) % cycleDuration;
                            
                            const blazeDuration = 1200 + hash2D(k * seed + 333, j * seed + 444) * 1800;
                            
                            if (phase < blazeDuration) {
                                let blazeT = phase / blazeDuration;
                                let blazeGlow = 0;
                                const origSR = sR;
                                const origSA = sA;
                                const origR = r;
                                
                                if (blazeT < 0.25) {
                                    let t2 = blazeT / 0.25;
                                    r = origR * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * t2 * blazeFade);
                                    sR = Math.round(origSR + (255 - origSR) * t2 * blazeFade);
                                    sA = origSA + (Math.min(1, origSA + 0.5) - origSA) * t2 * blazeFade;
                                    blazeGlow = t2 * blazeFade;
                                } else if (blazeT < 0.55) {
                                    let t2 = (blazeT - 0.25) / 0.30;
                                    r = origR * (1 + CONFIG.STAR_BLAZE_SIZE_MULT * blazeFade);
                                    sR = Math.round(origSR + (255 - origSR) * blazeFade);
                                    sA = (origSA + (Math.min(1, origSA + 0.5) - origSA) * blazeFade) * (1 - t2);
                                    blazeGlow = (1 - t2) * blazeFade;
                                } else if (blazeT < 0.65) {
                                    sA = 0;
                                    blazeGlow = 0;
                                } else {
                                    let t2 = (blazeT - 0.65) / 0.35;
                                    r = origR;
                                    sR = origSR;
                                    sA = origSA * t2;
                                    blazeGlow = 0;
                                }
                                
                                if (blazeGlow > 0) {
                                    const glowRadius = (180 + hash2D(k * seed + 777, j * seed + 888) * 120) * coordScale;
                                    
                                    const steps = 90;
                                    for (let s = steps; s > 0; s--) {
                                        const stepT = s / steps;
                                        const stepR = glowRadius * stepT;
                                        const stepA = (0.05 * blazeGlow) * Math.pow(1 - stepT, 1.5);
                                        svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(150, 200, 255)" fill-opacity="${stepA.toFixed(3)}"/>`;
                                    }
                                    const steps2 = 45;
                                    for (let s = steps2; s > 0; s--) {
                                        const stepT = s / steps2;
                                        const stepR = glowRadius * 0.5 * stepT;
                                        const stepA = (0.1 * blazeGlow) * Math.pow(1 - stepT, 1.5);
                                        svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(255, 255, 240)" fill-opacity="${stepA.toFixed(3)}"/>`;
                                    }
                                }
                            }
                        }
                        
                        // ALWAYS draw the star — moved OUTSIDE the blazing condition
                        // This matches the canvas drawDotLayer behavior where the dot is
                        // always drawn, and blazing only modifies size/color/alpha.
                        const coreFill = `rgb(${sR},${sR},${sR})`;
                        svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${coreFill}" fill-opacity="${sA.toFixed(3)}"/>`;
                    }
                }
            }
            
            addStars(spacing5, CONFIG.STAR_SIZE_LARGE, 1, expStarPanX5, expStarPanY5, eW, eH, scale, now, false, 1, 0, fx, fy);
            addStars(spacing2, CONFIG.STAR_SIZE_MED, 2, expStarPanX2, expStarPanY2, eW, eH, scale, now, false, 1, 0, fx, fy);
            
            let l3Alpha = Math.max(0, Math.min(1, (CONFIG.ZOOM_BLAZE_FADE_START - (eZoom / scale)) / CONFIG.ZOOM_BLAZE_FADE_RANGE));
            if (l3Alpha > 0) {
                let canBlaze = zoomOutStartTime > 0 && (now - zoomOutStartTime) > CONFIG.STAR_BLAZE_DELAY;
                addStars(spacing3, CONFIG.STAR_SIZE_SMALL, 3, expStarPanX3, expStarPanY3, eW, eH, scale, now, canBlaze, l3Alpha, zoomOutStartTime, fx, fy, 1.0);
            }
        }

        const eSz = HEX_R * eZoom;
        const pathsByColor = {};
        const gridPaths = [];

        // LOD match for SVG export
        const ext = eSz > CONFIG.LOD_HIGH_SZ ? CONFIG.LOD_EXT_HIGH : (eSz > CONFIG.LOD_MED_SZ ? CONFIG.LOD_EXT_MED : CONFIG.LOD_EXT_LOW);

        function getSvgEdgeColor(q, r, e) {
            if (curveColors.length === 1) {
                const cc = curveColorsRGB[0];
                return `rgb(${Math.round(cc.tr !== undefined ? cc.tr : cc.r)},${Math.round(cc.tg !== undefined ? cc.tg : cc.g)},${Math.round(cc.tb !== undefined ? cc.tb : cc.b)})`;
            }
            const id = edgeID(q, r, e);
            if (!curveMap.has(id)) return null;
            const curve = curves.get(curveMap.get(id));
            if (!curve) return null;
            const c = curve.color;
            if (typeof c === 'number') {
                const cc = curveColorsRGB[c % curveColorsRGB.length];
                return `rgb(${Math.round(cc.tr !== undefined ? cc.tr : cc.r)},${Math.round(cc.tg !== undefined ? cc.tg : cc.g)},${Math.round(cc.tb !== undefined ? cc.tb : cc.b)})`;
            }
            return c;
        }

        function arcToPath(tx, ty, rot, cx, cy, r, startAngle, endAngle, anticlockwise) {
            const rad = rot * Math.PI / 180.0;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            
            const p1x = cx + r * Math.cos(startAngle);
            const p1y = cy + r * Math.sin(startAngle);
            const p2x = cx + r * Math.cos(endAngle);
            const p2y = cy + r * Math.sin(endAngle);
            
            const tx1 = tx + p1x * cos - p1y * sin;
            const ty1 = ty + p1x * sin + p1y * cos;
            const tx2 = tx + p2x * cos - p2y * sin;
            const ty2 = ty + p2x * sin + p2y * cos;
            
            const sweep = anticlockwise ? 0 : 1;
            const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
            return `M ${tx1.toFixed(2)} ${ty1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweep} ${tx2.toFixed(2)} ${ty2.toFixed(2)}`;
        }
        if (eCurveAlpha > 0) {
            for (const h of exportHexes) {
                const rot = tileRot(h.q, h.r);
                const k = (rot / 60) % 6;
                const alter = isTileAlter(h.q, h.r);
                
                const rad = rot * Math.PI / 180.0;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                if (texImg) {
                    // Skip vector logic for texture tiles
                } else {
                    const a = eSz * SQRT3 / 2;
                    if (alter) {
                        let c = getSvgEdgeColor(h.q, h.r, (0 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, eSz/2, a, eSz/2, Math.PI - ext, 5 * PI_DIV_3 + ext, false)); }
                        c = getSvgEdgeColor(h.q, h.r, (2 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, -eSz, 0, eSz/2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false)); }
                        c = getSvgEdgeColor(h.q, h.r, (4 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, eSz/2, -a, eSz/2, PI_DIV_3 - ext, Math.PI + ext, false)); }
                    } else {
                        let c = getSvgEdgeColor(h.q, h.r, (2 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, -eSz, 0, eSz/2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false)); }
                        c = getSvgEdgeColor(h.q, h.r, (4 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, 1.5 * eSz, -a, 1.5 * eSz, TWO_PI_DIV_3 - ext, Math.PI + ext, false)); }
                        c = getSvgEdgeColor(h.q, h.r, (1 + k) % 6); if (c) { pathsByColor[c] = pathsByColor[c] || []; pathsByColor[c].push(arcToPath(h.x, h.y, rot, 1.5 * eSz, a, 1.5 * eSz, Math.PI - ext, FOUR_PI_DIV_3 + ext, false)); }
                    }

                    if (showGrid) {
                        let hexPath = "M ";
                        for (let i = 0; i < 6; i++) {
                            const ang = PI_DIV_3 * i;
                            const vx = eSz * Math.cos(ang);
                            const vy = eSz * Math.sin(ang);
                            const tx_v = h.x + vx * cos - vy * sin;
                            const ty_v = h.y + vx * sin + vy * cos;
                            hexPath += `${tx_v.toFixed(2)} ${ty_v.toFixed(2)} `;
                            if (i < 5) hexPath += "L ";
                        }
                        hexPath += "Z ";
                        gridPaths.push(hexPath);
                    }
                }
            }
        }

        const lw = (eSz / 3 * curveLineWidth).toFixed(2);
        for (const color in pathsByColor) {
            svg += `<path d="${pathsByColor[color].join(' ')}" stroke="${color}" stroke-width="${lw}" fill="none" stroke-linecap="butt"/>`;
        }

        if (showGrid && eGridAlpha > 0 && gridPaths.length > 0) {
            svg += `<path d="${gridPaths.join(' ')}" stroke="${COLORS.gridLine}" stroke-width="1" fill="none" stroke-opacity="${eGridAlpha.toFixed(3)}"/>`;
        }

        svg += `</svg>`;
        return svg;
    }

    dom.fmtSvgBtn.onclick = () => {
        const cr = dom.cvs.getBoundingClientRect();
        const fx = efRect.x - cr.left;
        const fy = efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(efRect.w, efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(efRect.w * scale);
        const eH = Math.round(efRect.h * scale);
        const eZoom = zoom * scale;
        const ePanX = (panX - fx) * scale;
        const ePanY = (panY - fy) * scale;

        const svg = buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY);

        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hex-tiles-export.svg';
        a.click();
        URL.revokeObjectURL(url);
        toast('SVG exported');
    };

    dom.exportBackdrop.onclick = closeExportOverlay;

    // ── Mobile Touch Support for Export Frame ──
    function simulateMouseEvent(e) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        
        if (e.type === 'touchmove' && e.touches.length > 1) return; 
        const t = e.touches[0] || e.changedTouches[0];
        if (!t) return;
        const type = { touchstart: 'mousedown', touchmove: 'mousemove', touchend: 'mouseup' }[e.type];
        if (!type) return;
        const evt = new MouseEvent(type, { 
            clientX: t.clientX, clientY: t.clientY, 
            bubbles: true, cancelable: true 
        });
        e.target.dispatchEvent(evt);
        e.preventDefault();
    }
    dom.exportOverlay.addEventListener('touchstart', simulateMouseEvent, { passive: false });
    dom.exportOverlay.addEventListener('touchmove', simulateMouseEvent, { passive: false });
    dom.exportOverlay.addEventListener('touchend', simulateMouseEvent, { passive: false });

    // ── Frame dragging & resizing ──
    dom.exportFrame.addEventListener('mousedown', e => {
        const h = e.target.dataset.h;
        if (h) {
            efDrag = { mode: h, mx: e.clientX, my: e.clientY, x: efRect.x, y: efRect.y, w: efRect.w, h: efRect.h, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
        } else {
            efDrag = { mode: 'move', mx: e.clientX, my: e.clientY, x: efRect.x, y: efRect.y, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
        }
        e.preventDefault();
        e.stopPropagation();
    });

    dom.exportBackdrop.addEventListener('mousedown', e => {
        efDrag = { mode: 'draw', mx: e.clientX, my: e.clientY, startX: e.clientX, startY: e.clientY, prevRect: {...efRect}, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
        efRect.x = e.clientX;
        efRect.y = e.clientY;
        efRect.w = 0;
        efRect.h = 0;
        updateExportFrameDOM();
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('mousemove', e => {
        if (!efDrag) return;
        const dx = e.clientX - efDrag.mx, dy = e.clientY - efDrag.my;
        const cr = dom.cvs.getBoundingClientRect();
        
        if (efDrag.mode === 'move') {
            efRect.x = efDrag.x + dx;
            efRect.y = efDrag.y + dy;
            // Resist in all 4 directions (clamp position without shrinking) and slip grab point
            if (efRect.w <= cr.width) {
                const maxX = cr.left + cr.width - efRect.w;
                if (efRect.x < cr.left) { efDrag.x = cr.left - dx; efRect.x = cr.left; }
                else if (efRect.x > maxX) { efDrag.x = maxX - dx; efRect.x = maxX; }
            } else { efDrag.x = cr.left - dx; efRect.x = cr.left; }
            if (efRect.h <= cr.height) {
                const maxY = cr.top + cr.height - efRect.h;
                if (efRect.y < cr.top) { efDrag.y = cr.top - dy; efRect.y = cr.top; }
                else if (efRect.y > maxY) { efDrag.y = maxY - dy; efRect.y = maxY; }
            } else { efDrag.y = cr.top - dy; efRect.y = cr.top; }
        } else if (efDrag.mode === 'draw') {
            let rawW = Math.abs(e.clientX - efDrag.startX);
            let rawH = Math.abs(e.clientY - efDrag.startY);
            let startX = Math.min(efDrag.startX, e.clientX);
            let startY = Math.min(efDrag.startY, e.clientY);
            
            if (aspectLocked) {
                if (rawW / rawH > targetRatio) { rawW = rawH * targetRatio; } 
                else { rawH = rawW / targetRatio; }
            }
            
            efRect.x = (e.clientX < efDrag.startX) ? efDrag.startX - rawW : startX;
            efRect.y = (e.clientY < efDrag.startY) ? efDrag.startY - rawH : startY;
            efRect.w = rawW;
            efRect.h = rawH;
            
            dom.exportW.value = Math.round(efRect.w);
            dom.exportH.value = Math.round(efRect.h);
            
            updateExportFrameDOM();
            return;
        } else {
            let { x, y, w, h } = efDrag;
            let newW = w, newH = h;
            
            if (efDrag.mode.includes('r')) newW = efDrag.w + dx;
            if (efDrag.mode.includes('l')) { newW = efDrag.w - dx; x = efDrag.x + dx; }
            if (efDrag.mode.includes('b')) newH = efDrag.h + dy;
            if (efDrag.mode.includes('t')) { newH = efDrag.h - dy; y = efDrag.y + dy; }
            
            if (aspectLocked) {
                let scale = Math.max(newW / efDrag.w, newH / efDrag.h);
                scale = Math.max(0.1, scale);
                newW = efDrag.w * scale;
                newH = efDrag.h * scale;
                if (efDrag.mode.includes('l')) x = efDrag.x + (efDrag.w - newW);
                if (efDrag.mode.includes('t')) y = efDrag.y + (efDrag.h - newH);
            }
            if (newW < 50) { newW = 50; if (efDrag.mode.includes('l')) x = efDrag.x + efDrag.w - 50; if (aspectLocked) newH = newW / targetRatio; }
            if (newH < 50) { newH = 50; if (efDrag.mode.includes('t')) y = efDrag.y + efDrag.h - 50; if (aspectLocked) newW = newH * targetRatio; }
            
            efRect.x = x; efRect.y = y; efRect.w = newW; efRect.h = newH;
            
            dom.exportW.value = Math.round(efRect.w);
            dom.exportH.value = Math.round(efRect.h);
            clampFrameToCanvas();
        }
        updateExportFrameDOM();
    });

    window.addEventListener('mouseup', () => { 
        // Exit export mode if the drawn frame is released under 50x50
        if (efDrag && efDrag.mode === 'draw' && (efRect.w < 50 || efRect.h < 50)) {
            closeExportOverlay();
        }
        efDrag = null; 
        requestRender(); 
    });

    // ── Output Size Inputs ──
    dom.exportW.addEventListener('input', () => {
        let val = parseInt(dom.exportW.value) || 50;
        if (aspectLocked) {
            dom.exportH.value = Math.round(val / targetRatio);
        }
    });
    
    dom.exportH.addEventListener('input', () => {
        let val = parseInt(dom.exportH.value) || 50;
        if (aspectLocked) {
            dom.exportW.value = Math.round(val * targetRatio);
        }
    });

    dom.exportW.addEventListener('change', () => {
        if (!aspectLocked) {
            const val = parseInt(dom.exportW.value) || 50;
            const prev = parseFloat(dom.exportW.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                efRect.w *= ratio;
                clampFrameToCanvas();
                updateExportFrameDOM();
            }
            dom.exportW.dataset.prev = val;
        }
    });

    dom.exportH.addEventListener('change', () => {
        if (!aspectLocked) {
            const val = parseInt(dom.exportH.value) || 50;
            const prev = parseFloat(dom.exportH.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                efRect.h *= ratio;
                clampFrameToCanvas();
                updateExportFrameDOM();
            }
            dom.exportH.dataset.prev = val;
        }
    });

    // ── Render to offscreen canvas ──
    function renderToOffscreen(offCanvas, eW, eH, fx, fy, fw, fh) {
        offCanvas.width = eW;
        offCanvas.height = eH;
        const offCtx = offCanvas.getContext('2d');
        const scale = eW / fw;
        const eZoom = zoom * scale;
        const ePanX = (panX - fx) * scale;
        const ePanY = (panY - fy) * (eH / fh);

        const origSz = HEX_R * zoom;
        let eCurveAlpha = 1.0, eGridAlpha = 1.0;
        const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT;
        const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
        if (origSz <= fadeEndSz + 0.5) { eCurveAlpha = 0; eGridAlpha = 0; }
        else if (origSz < fadeStartSz) {
            let t = (origSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
            eCurveAlpha = t * t * (3 - 2 * t);
            eGridAlpha = eCurveAlpha;
        }

        const hexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);

        const centerHex = pixToHex(eW / 2, eH / 2, eZoom, ePanX, ePanY);
        hexes.sort((a, b) => {
            return hexDistance(a.q, a.r, centerHex.q, centerHex.r) -
                hexDistance(b.q, b.r, centerHex.q, centerHex.r);
        });

        let exportBounds = { minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity };
        for (const h of hexes) {
            if (h.q < exportBounds.minQ) exportBounds.minQ = h.q;
            if (h.q > exportBounds.maxQ) exportBounds.maxQ = h.q;
            if (h.r < exportBounds.minR) exportBounds.minR = h.r;
            if (h.r > exportBounds.maxR) exportBounds.maxR = h.r;
        }

        // SKIP PROCESS QUEUE IF CURVES ARE INVISIBLE!
        if (curveColors.length >= 1 && eCurveAlpha > 0) {
            let safety = 2000;
            while (safety-- > 0) {
                processQueue(exportBounds, true); 
                if (queue.length === 0) {
                    if (!findUncoloredTileInHexes(hexes)) break;
                }
            }
        }

        const oldCtx = ctx;
        ctx = offCtx;
        const now = exportFreezeTime || Date.now();

        offCtx.fillStyle = COLORS.bg;
        offCtx.fillRect(0, 0, eW, eH);

        drawIDWGradient(eW, eH, scale, fx, fy);

        const expStarPanX5 = (starPanX5 - fx) * scale;
        const expStarPanY5 = (starPanY5 - fy) * scale;
        const expStarPanX2 = (starPanX2 - fx) * scale;
        const expStarPanY2 = (starPanY2 - fy) * scale;
        const expStarPanX3 = (starPanX3 - fx) * scale;
        const expStarPanY3 = (starPanY3 - fy) * scale;
        
        drawBackgroundStars(eW, eH, scale, expStarPanX5, expStarPanY5, expStarPanX2, expStarPanY2, expStarPanX3, expStarPanY3, now, eZoom / scale, zoomOutStartTime, fx, fy);

        const eSz = HEX_R * eZoom;
        // 1. Draw curves only
        for (const h of hexes) {
            const rot = tileRot(h.q, h.r);
            drawTile(h.x, h.y, eSz, rot, false, texImg, texTf, h.q, h.r, now, eCurveAlpha, 0.0);
        }
        
        // 2. Draw grid on top
        if (showGrid && eGridAlpha > 0.01) {
            traceHexPathBatch(ctx, hexes, eSz);
            ctx.globalAlpha = eGridAlpha;
            ctx.strokeStyle = COLORS.gridLine;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        ctx = oldCtx;
        return offCanvas;
    }

    // ── PNG export ──
    function canvasToBlob(canvas, type) {
        return new Promise(resolve => canvas.toBlob(resolve, type));
    }

    dom.fmtPngBtn.onclick = async () => {
        const cr = dom.cvs.getBoundingClientRect();
        const fx = efRect.x - cr.left;
        const fy = efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(efRect.w, efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(efRect.w * scale);
        const eH = Math.round(efRect.h * scale);

        const off = document.createElement('canvas');
        renderToOffscreen(off, eW, eH, fx, fy, efRect.w, efRect.h);

        const blob = await canvasToBlob(off, 'image/png');
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hex-tiles-export.png';
        a.click();
        URL.revokeObjectURL(url);
        toast('PNG exported');
    };

    // ── Embed code generation ──
    dom.exportEmbedBtn.onclick = () => {
        dom.exportImageBtn.classList.remove('active');
        dom.exportEmbedBtn.classList.add('active');
        dom.imageExportWrap.classList.remove('visible');
        dom.embedCodeWrap.classList.add('visible');
        
        const cr = dom.cvs.getBoundingClientRect();
        const fx = efRect.x - cr.left;
        const fy = efRect.y - cr.top;
        
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(efRect.w, efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(efRect.w * scale);
        const eH = Math.round(efRect.h * scale);
        const eZoom = zoom * scale;
        const ePanX = (panX - fx) * scale;
        const ePanY = (panY - fy) * scale;

        const eMarkers = gradientMarkers.map(m => ({
            x: (m.x - fx) * scale,
            y: (m.y - fy) * scale,
            color: m.color
        }));

        const data = {
            w: eW, h: eH, zoom: eZoom, panX: ePanX, panY: ePanY,
            origZoom: zoom,
            showGrid, showUnrenderedDotted, markersVisible: false, showBgStars, flowEnabled, inertiaEnabled,
            rotMode, randomSeed, rotSeed, curveLineWidth, alterTilesRatio,
            texTf: { ...texTf },
            curveColors: [...curveColors],
            markers: eMarkers, 
            rotOverrides: serializeRotOverrides(),
            texture: getTextureDataUrl()
        };

        let encoded;
        try {
            encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
        } catch (e) {
            toast('Too much data to encode');
            return;
        }

        const baseUrl = location.href.split('#')[0];
        const iframe = `<iframe src="${baseUrl}#embed=${encoded}" width="${eW}" height="${eH}" frameborder="0" style="border:none;width:${eW}px;height:${eH}px;"></iframe>`;

        dom.embedCode.value = iframe;
        toast('Embed code generated');
    };

    // ── Copy embed code ──
    dom.copyEmbedBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(dom.embedCode.value);
            toast('Copied to clipboard');
        } catch (err) {
            console.error('Failed to copy: ', err);
            toast('Failed to copy');
        }
    };

    // ── Escape to close export or restore sidebar ──
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (dom.exportOverlay.classList.contains('active')) {
                closeExportOverlay();
            } else if (document.body.classList.contains('sidebar-collapsed')) {
                document.body.classList.remove('sidebar-collapsed');
                document.querySelector('.sidebar').classList.remove('collapsed');
                document.getElementById('sidebarToggle').classList.remove('collapsed');
            }
        }
    });
    

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  RAM MONITOR & AGGRESSIVE GC
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    setInterval(() => {
        // performance.memory is Chrome/Edge only
        if (performance.memory) {
            const usedRAM = performance.memory.usedJSHeapSize;
            const threshold = 200 * 1024 * 1024; // 200 MB
            
            if (usedRAM > threshold) {
                if (window.gc) {
                    try { 
                        window.gc();
                        console.log("GC has been successfully called");
                    } catch(e) {
                        console.log("Couldn't call GC: ", e);
                    }
                } else {
                    console.log("RAM is above 200MB, but window.gc is not exposed in this browser.");
                }
            }
        }
    }, 15000); // Every 15 seconds

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  INITIALIZATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ── Auto-detect GitHub repo link from GH Pages URL ──
    (function setGhLink() {
        try {
            const hostParts = location.hostname.split('.');
            if (hostParts.length === 3 && hostParts[1] === 'github' && hostParts[2] === 'io') {
                const user = hostParts[0];
                const path = location.pathname.split('/')[1];
                if (path) {
                    dom.ghLink.href = `https://github.com/${user}/${path}`;
                } else {
                    dom.ghLink.href = `https://github.com/${user}/${user}.github.io`;
                }
            }
        } catch (e) { console.warn('Could not auto-detect GitHub repo URL'); }
    })();

    // Initialize theme pools on startup
    curveColorPool = generateDistinctThemePool();
    gradientColorPool = generateDistinctThemePool();
    
    if (isEmbedMode && embedData) {
        // ── Embed mode: load state from data ──
        zoom = embedData.zoom;
        targetZoom = zoom;
        panX = embedData.panX;
        panY = embedData.panY;
        showGrid = embedData.showGrid;
        showUnrenderedDotted = embedData.showUnrenderedDotted;
        markersVisible = embedData.markersVisible;
        showBgStars = embedData.showBgStars !== undefined ? embedData.showBgStars : true;
        rotMode = embedData.rotMode || 'hash';
        randomSeed = embedData.randomSeed || 0;
        rotSeed = embedData.rotSeed || 0;
        curveLineWidth = embedData.curveLineWidth || 1;
        alterTilesRatio = embedData.alterTilesRatio || 0;
        flowEnabled = embedData.flowEnabled || false;
        inertiaEnabled = embedData.inertiaEnabled !== undefined ? embedData.inertiaEnabled : true;
        dom.inertiaToggle.checked = inertiaEnabled;
        texTf = embedData.texTf || { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
        curveColors = embedData.curveColors && embedData.curveColors.length > 0
            ? [...embedData.curveColors].slice(0, CONFIG.MAX_CURVE_COLORS) : ['#444444']; 
        gradientMarkers = (embedData.markers || []).slice(0, CONFIG.MAX_MARKERS).map(m => ({ ...m }));
        markersVisible = false; 

        updateCurveColorsCache();
        updateGradientMarkersCache();

        dom.gridToggle.checked = showGrid;
        dom.unrenderedToggle.checked = showUnrenderedDotted;
        dom.bgStarsToggle.checked = showBgStars;
        dom.markersToggle.checked = markersVisible;
        dom.flowToggle.checked = flowEnabled;
        dom.sCurveW.value = curveLineWidth;
        dom.vCurveW.textContent = curveLineWidth.toFixed(2) + 'x';
        dom.sAlterTiles.value = alterTilesRatio;
        dom.vAlterTiles.textContent = alterTilesRatio.toFixed(2);

        if (embedData.rotOverrides) {
            for (const [q, r, rot] of embedData.rotOverrides) {
                rotOverrides.set(hexKey(q, r), rot);
            }
        }

        function startEmbedRender() {
            dom.cvs.width = embedData.w;
            dom.cvs.height = embedData.h;
            isInitialized = true;
            curveMap.clear(); edgeRgbMap.clear();
            curves.clear(); queue.length = 0;
            initializeCentralTile();
            
            // Kickstart blazing stars if the embed is at 20% zoom
            if (embedData.origZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
                zoomOutStartTime = Date.now() - CONFIG.STAR_BLAZE_DELAY - 1000;
            }
            
            render();
        }

        if (embedData.texture) {
            const img = new Image();
            img.onload = () => { texImg = img; startEmbedRender(); };
            img.onerror = () => { startEmbedRender(); };
            img.src = embedData.texture;
        } else {
            startEmbedRender();
        }
    } else {
        // ── Normal mode ──
        showGrid = dom.gridToggle.checked;
        showUnrenderedDotted = dom.unrenderedToggle.checked;
        showBgStars = dom.bgStarsToggle.checked;
        markersVisible = dom.markersToggle.checked;
        flowEnabled = dom.flowToggle.checked;
        inertiaEnabled = dom.inertiaToggle.checked;
        curveLineWidth = +dom.sCurveW.value || 1;
        dom.vCurveW.textContent = curveLineWidth.toFixed(2) + 'x';
        alterTilesRatio = +dom.sAlterTiles.value || 0;
        dom.vAlterTiles.textContent = alterTilesRatio.toFixed(2);

        curveColors = ['#444444']; 
        updateCurveColorsCache();
        updateGradientMarkersCache(); 

        resize();
        render();
    }

    // Generate default tile favicon and replace GH icon in embed mode
    const generatedFaviconUrl = generateFavicon();
    if (isEmbedMode) {
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
})();
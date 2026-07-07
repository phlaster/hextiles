import { CONFIG, COLORS, COLOR_THEMES } from './config.js';
import { hexToRgb, rgbToHex, colorDistance, shuffleArray, generateDistinctThemePool } from './utils.js';
import { state } from './state.js';
import { dom } from './dom.js';
import { toast, renderGradientList, renderCurveList } from './ui.js';
import { hexToPix, pixToHex, hexDistance, hexKey, tileRot, displayRot, traceHexPath, traceHexPathBatch, traceHexGrid, visibleHexes, hash2D, isTileAlter, baseRot, nearestTarget } from './math.js';
import { processQueue, findUncoloredTileInHexes, findNextUncoloredTile, getVisibleBounds, initializeCentralTile, splitCurve, updateLocalCurves, recalculateTile, edgeID, decodeEdgeID, getNeighbor, getCurveColorIndex, getAdjacentColors, getBackgroundColorAt, pickColorForNewCurve, mergeCurves, getOtherEdge } from './curves.js';

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

    // ──── UI Bridge Functions ────
    function updateCurveColorsCache() {
        while (state.curveColorsRGB.length < state.curveColors.length) {
            const rgb = hexToRgb(state.curveColors[state.curveColorsRGB.length]);
            state.curveColorsRGB.push({ r: rgb[0], g: rgb[1], b: rgb[2], tr: rgb[0], tg: rgb[1], tb: rgb[2] });
        }
        if (state.curveColorsRGB.length > state.curveColors.length) {
            state.curveColorsRGB.length = state.curveColors.length;
        }
        for (let i = 0; i < state.curveColors.length; i++) {
            const rgb = hexToRgb(state.curveColors[i]);
            state.curveColorsRGB[i].tr = rgb[0];
            state.curveColorsRGB[i].tg = rgb[1];
            state.curveColorsRGB[i].tb = rgb[2];
        }
    }

    function updateGradientMarkersCache() {
        while (state.gradientMarkersRGB.length < state.gradientMarkers.length) {
            const m = state.gradientMarkers[state.gradientMarkersRGB.length];
            const rgb = hexToRgb(m.color);
            state.gradientMarkersRGB.push({ 
                x: m.x, y: m.y, 
                r: rgb[0], g: rgb[1], b: rgb[2], 
                tr: rgb[0], tg: rgb[1], tb: rgb[2],
                weight: 0 // Start at 0 for fade-in
            });
        }
        if (state.gradientMarkersRGB.length > state.gradientMarkers.length) {
            state.gradientMarkersRGB.length = state.gradientMarkers.length;
        }
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
    }

    state.updateCurveColorsCache = updateCurveColorsCache;
    state.updateGradientMarkersCache = updateGradientMarkersCache;

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

    // ──── IDW Gradient & Stars ────
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
                let fillStyle = state.starColorCache.get(fillKey);
                if (!fillStyle) {
                    fillStyle = `rgba(${sR},${sR},${sR},${sA.toFixed(3)})`;
                    state.starColorCache.set(fillKey, fillStyle);
                }
                ctx.fillStyle = fillStyle;
                
                ctx.beginPath();
                ctx.arc(x, y, drawSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawBackgroundStars(W, H, coordScale, dPanX5, dPanY5, dPanX2, dPanY2, dPanX3, dPanY3, now, currentZoom, zoomOutTime, offsetX = 0, offsetY = 0) {
        if (!state.showBgStars) return;
        
        ctx.save();
        
        // Layer 1: Size 7, medium spacing, fastest parallax
        const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * coordScale;
        drawDotLayer(W, H, spacing5, CONFIG.STAR_SIZE_LARGE, 1, coordScale, dPanX5, dPanY5, now, false, 1, 0, offsetX, offsetY);
        
        // Layer 2: Size 4, densest spacing, medium parallax
        const spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * coordScale;
        drawDotLayer(W, H, spacing2, CONFIG.STAR_SIZE_MED, 2, coordScale, dPanX2, dPanY2, now, false, 1, 0, offsetX, offsetY);
        
        // Layer 3: Size 2, least dense, slowest parallax. Fades in at low state.zoom.
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
            const spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * coordScale;
            drawDotLayer(W, H, spacing3, CONFIG.STAR_SIZE_SMALL, 3, coordScale, dPanX3, dPanY3, now, canBlaze, layer3Alpha, zoomOutTime, offsetX, offsetY, blazeFade);
        }
        
        ctx.restore();
    }

    // ──── IDW Gradient ────
    function updateIDWGradientCanvas(W, H, coordScale = 1, offsetX = 0, offsetY = 0, qualityScale = 0.2) {
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
        
        // 1. Calculate the weighted average color of active markers
        let avgR = 0, avgG = 0, avgB = 0, avgW = 0;
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
            avgR = bgR; avgG = bgG; avgB = bgB;
        }

        // 2. Combine active and fading markers.
        const allMarkers = [];
        for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
            const m = state.gradientMarkersRGB[i];
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
        for (let i = 0; i < state.fadingMarkersRGB.length; i++) {
            const m = state.fadingMarkersRGB[i];
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
        if (state.gradientMarkersRGB.length === 0 && state.fadingMarkersRGB.length === 0) return;
        
        const targetLowW = Math.max(2, Math.ceil(W * 0.2));
        const targetLowH = Math.max(2, Math.ceil(H * 0.2));
        if (state.isGradientDirty || coordScale !== 1 || !state.gradientCanvas || state.gradientCanvas.width !== targetLowW || state.gradientCanvas.height !== targetLowH) {
            updateIDWGradientCanvas(W, H, coordScale, offsetX, offsetY);
            state.isGradientDirty = false;
        }
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(state.gradientCanvas, 0, 0, state.gradientCanvas.width, state.gradientCanvas.height, 0, 0, W, H);
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

    function applyCurveStyle(q, r, e, sz, now) {
        ctx.setLineDash([]);
        const id = edgeID(q, r, e);
        
        let targetRgb = null;
        let targetCurveID = -1;
        if (state.curveColors.length === 1) {
            const c = state.curveColorsRGB[0];
            if (c) {
                targetRgb = { r: c.tr !== undefined ? c.tr : c.r, g: c.tg !== undefined ? c.tg : c.g, b: c.tb !== undefined ? c.tb : c.b };
            } else {
                const rgb = hexToRgb(state.curveColors[0]);
                targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
            }
            targetCurveID = -2; 
        } else if (state.curveMap.has(id)) {
            targetCurveID = state.curveMap.get(id);
            let curve = state.curves.get(targetCurveID);
            if (curve) {
                let c = curve.color;
                if (typeof c === 'number') {
                    const cc = state.curveColorsRGB[c % state.curveColorsRGB.length];
                    targetRgb = { r: cc.tr !== undefined ? cc.tr : cc.r, g: cc.tg !== undefined ? cc.tg : cc.g, b: cc.tb !== undefined ? cc.tb : cc.b };
                } else {
                    const rgb = hexToRgb(c); 
                    targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
                }
            }
        }

        if (targetRgb) {
            let edgeData = state.edgeRgbMap.get(id);
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
            ctx.lineWidth = sz / 3 * state.curveLineWidth;
            return true;
        }

        state.currentUnassignedEdges.add(id);
        if (state.showUnrenderedDotted) {
            ctx.strokeStyle = `rgba(110, 110, 144, 0.55)`;
            ctx.lineWidth = Math.max(1, (sz / 10) * state.curveLineWidth);
            const dash = Math.max(2, sz / 8);
            ctx.setLineDash([dash, dash]);
            return true;
        }
        return false;
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

    function checkIfSolved() {
        if (state.solvedCheckTimeout) return; 
        
        state.solvedCheckTimeout = setTimeout(() => {
            state.solvedCheckTimeout = null;
            performSolvedCheck();
        }, CONFIG.STATS_UPDATE_INTERVAL);
    }
    
    function performSolvedCheck() {
        if (state.curveColors.length <= 1) return;

        if (state.zoom <= CONFIG.ZOOM_FADE_MID) {
            window.dispatchEvent(new CustomEvent('hexCurveSolved', { detail: { solved: false } }));
            try { 
                if (isEmbedMode) window.parent.postMessage({ type: 'HEX_CURVE_SOLVED', solved: false }, '*'); 
            } catch(e) {}
            return;
        }

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const effectiveW = (isCollapsed || isEmbedMode) ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
        const H = dom.cvs.height;
        const hexes = visibleHexes(state.zoom, state.panX, state.panY, dom.cvs.width, H);
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
            if (state.curveMap.has(id)) {
                const curveID = state.curveMap.get(id);
                const curve = state.curves.get(curveID);
                if (curve) {
                    let c = curve.color;
                    if (typeof c === 'number') c = state.curveColors[c % state.curveColors.length];
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

    function requestRender() {
        if (!isRenderScheduled) {
            isRenderScheduled = true;
            requestAnimationFrame(() => {
                isRenderScheduled = false;
                render();
            });
        }
    }
    
    function render() {
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
        
        // Use original editor state.zoom for visual fades in embed mode
        const visZoom = (isEmbedMode && embedData && embedData.origZoom) ? embedData.origZoom : z;

        for (const [k, a] of state.animMap) {
            if (now - a.start >= a.duration) state.animMap.delete(k);
        }

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);
        drawIDWGradient(W, H);
        drawBackgroundStars(W, H, 1, state.starPanX5, state.starPanY5, state.starPanX2, state.starPanY2, state.starPanX3, state.starPanY3, now, visZoom, state.zoomOutStartTime);

        let keepRendering = (state.animMap.size > 0 || state.isDrag || state.isDragMarker);
        if (state.showBgStars && visZoom <= CONFIG.ZOOM_FADE_MID) keepRendering = true;
        
        if (state.isExporting) keepRendering = false;

        state.edgeColorAnimating = false;
        let gradColorAnimating = false;
        let curveColorAnimating = false;
        state.currentUnassignedEdges.clear();

        if (!state.isExporting) {
            // 1. Calculate target average color of ACTIVE markers
            let avgR = 0, avgG = 0, avgB = 0, avgW = 0;
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
                
                // Calculate target color using IDW formula, then LERP towards it at 0.1
                const targetR = state.currentAvgR + (m.tr - state.currentAvgR) * m.weight;
                const targetG = state.currentAvgG + (m.tg - state.currentAvgG) * m.weight;
                const targetB = state.currentAvgB + (m.tb - state.currentAvgB) * m.weight;
                
                const nr = m.r + (targetR - m.r) * 0.1;
                const ng = m.g + (targetG - m.g) * 0.1;
                const nb = m.b + (targetB - m.b) * 0.1;
                
                if (Math.abs(m.r - nr) > 0.5 || Math.abs(m.g - ng) > 0.5 || Math.abs(m.b - nb) > 0.5) diff = true;
                m.r = nr; m.g = ng; m.b = nb;
                
                if (diff) {
                    gradColorAnimating = true;
                    state.isGradientDirty = true;
                }
            }
            
            for (let i = state.fadingMarkersRGB.length - 1; i >= 0; i--) {
                const m = state.fadingMarkersRGB[i];
                m.weight += (0 - m.weight) * 0.05; // Match fade-in speed!
                
                if (m.weight <= 0.00008) {
                    state.fadingMarkersRGB.splice(i, 1);
                    // Force one last update to clear it completely
                    gradColorAnimating = true;
                    state.isGradientDirty = true;
                    continue;
                }
                
                // Calculate target color using IDW formula, then LERP towards it at 0.1
                const targetR = state.currentAvgR + (m.origR - state.currentAvgR) * m.weight;
                const targetG = state.currentAvgG + (m.origG - state.currentAvgG) * m.weight;
                const targetB = state.currentAvgB + (m.origB - state.currentAvgB) * m.weight;
                
                const nr = m.r + (targetR - m.r) * 0.1;
                const ng = m.g + (targetG - m.g) * 0.1;
                const nb = m.b + (targetB - m.b) * 0.1;
                
                m.r = nr; m.g = ng; m.b = nb;
                
                // ALWAYS force rendering until it is completely gone
                gradColorAnimating = true;
                state.isGradientDirty = true;
            }
        }

        // Flow physics: drift and turn
        let driftX = 0, driftY = 0;
        if (state.flowEnabled && !state.isExporting) {
            let speedMult = (visZoom <= CONFIG.ZOOM_FADE_MID) ? CONFIG.FLOW_SPEED_MULT_LOW_ZOOM : 1.0;
            let isHovering = state.hoveredQ !== null && state.hoveredR !== null;
            
            // If hovering started during a long drift, interrupt it so the new angle picks quickly (within 2s)
            if (isHovering && state.flowState === 'drift' && (state.flowStateEndTime - now) > 2000) {
                state.flowStateEndTime = now + 2000;
            }
            
            if (now > state.flowStateEndTime) {
                if (state.flowState === 'drift') {
                    // Transition to turning
                    state.flowState = 'turn';
                    // 1s turn while hovering, normal 3s turn otherwise
                    state.flowStateEndTime = now + (isHovering ? 1000 : CONFIG.FLOW_TURN_DURATION);
                    
                    // Determine base angle: opposite of mouse vector if hovering, else current drift
                    let baseAngle = state.driftAngle;
                    if (isHovering) {
                        const cx = W / 2;
                        const cy = H / 2;
                        const dx = state.mouseScreenX - cx;
                        const dy = state.mouseScreenY - cy;
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
                    state.driftTargetAngle = baseAngle + turnAmount;
                } else {
                    // Transition back to drifting
                    state.flowState = 'drift';
                    state.driftAngle = state.driftTargetAngle; // Snap to target to prevent residual drift
                    // 5s drift while hovering, normal 10-20s drift otherwise
                    state.flowStateEndTime = now + (isHovering ? 5000 : (CONFIG.DRIFT_TIMER_MIN + Math.random() * CONFIG.DRIFT_TIMER_RANGE));
                    
                    // Set new base speed for this drift segment
                    state.driftTargetSpeed = (CONFIG.DRIFT_SPEED_BASE + Math.random() * CONFIG.DRIFT_SPEED_RANGE) * speedMult;
                }
            }
            
            if (state.flowState === 'turn') {
                // Slow rotation of velocity vector
                let angleDiff = state.driftTargetAngle - state.driftAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                state.driftAngle += angleDiff * 0.03; 
            }
            
            // Random fluctuations of absolute speed during drift
            let fluctuation = Math.sin(now / 800) * 0.2 + Math.sin(now / 350) * 0.1;
            let currentTargetSpeed = state.driftTargetSpeed + (state.driftTargetSpeed * fluctuation);
            state.driftSpeed += (currentTargetSpeed - state.driftSpeed) * 0.02;
            
            driftX = Math.cos(state.driftAngle) * state.driftSpeed;
            driftY = Math.sin(state.driftAngle) * state.driftSpeed;
        }

        // Dampen residual velocity if the user holds the mouse/touch still before releasing
        if ((state.isDrag || touchState.mode === 'pan' || touchState.mode === 'pan_wait') && Date.now() - state.lastPanMoveTime > 60) {
            state.panVX *= 0.6;
            state.panVY *= 0.6;
            if (Math.abs(state.panVX) < 0.5) state.panVX = 0;
            if (Math.abs(state.panVY) < 0.5) state.panVY = 0;
        }

        // Apply inertia ONLY in normal mode and when not dragging
        if (!isEmbedMode && state.inertiaEnabled && !state.isDrag && !state.isExporting) {
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
        
        // Apply flow drift in BOTH normal and embed modes (when enabled)
        if (state.flowEnabled && (!state.isDrag || isEmbedMode) && !state.isExporting) {
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

        // Smooth state.zoom interpolation
        if (!state.isExporting && Math.abs(state.targetZoom - state.zoom) > 0.0001) {
            let lerpFactor = 0.15; 
            let step = (state.targetZoom - state.zoom) * lerpFactor;
            if (Math.abs(step) < 0.0005) step = state.targetZoom - state.zoom; // Snap if very close
            setZoom(state.zoom + step, state.zoomCx, state.zoomCy);
            keepRendering = true;
        }

        // Track when user reaches exactly 20% state.zoom for blazing star delay
        if (visZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) { 
            if (state.zoomOutStartTime === 0) state.zoomOutStartTime = now;
        } else {
            state.zoomOutStartTime = 0; 
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

        state.interactionFade += (state.targetInteractionFade - state.interactionFade) * 0.2;
        if (Math.abs(state.targetInteractionFade - state.interactionFade) > 0.001) keepRendering = true;

        curveAlpha *= state.interactionFade;
        gridAlpha *= state.interactionFade;

        let hexes = [];
        if (img || curveAlpha > 0 || gridAlpha > 0) {
            hexes = visibleHexes(z, px, py, W, H); 
            
            const centerHex = pixToHex(W / 2, H / 2, z, px, py);
            hexes.sort((a, b) => {
                return hexDistance(a.q, a.r, centerHex.q, centerHex.r) - 
                        hexDistance(b.q, b.r, centerHex.q, centerHex.r);
            });
        }

        if (state.curveColors.length > 1 && curveAlpha > 0.01 && hexes.length > 0) {
            let startTime = performance.now();
            let didWork = true;
            while (didWork && performance.now() - startTime < 16) {
                if (state.queue.length > 0) {
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
                // Fading state.curves/grid: render to offscreen canvas to avoid per-tile alpha blending
                if (state.curveCanvas.width !== W || state.curveCanvas.height !== H) {
                    state.curveCanvas.width = W;
                    state.curveCanvas.height = H;
                }
                state.curveCtx.clearRect(0, 0, W, H);
                
                const oldCtx = ctx;
                ctx = state.curveCtx;
                
                // 1. Draw state.curves only
                for (const h of hexes) {
                    const rot = displayRot(h.q, h.r, now);
                    drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
                }
                
                // 2. Draw grid on top of state.curves as a single batched path
                if (state.showGrid && gridAlpha > 0.01) {
                    traceHexPathBatch(ctx, hexes, sz);
                    ctx.strokeStyle = COLORS.gridLine;
                    ctx.lineWidth = 1;
                    ctx.globalAlpha = gridAlpha;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
                
                ctx = oldCtx;
                ctx.globalAlpha = Math.max(curveAlpha, gridAlpha);
                ctx.drawImage(state.curveCanvas, 0, 0);
                ctx.globalAlpha = 1.0;
            } else {
                // Fully opaque: draw directly (fastest path)
                // 1. Draw state.curves only
                for (const h of hexes) {
                    const rot = displayRot(h.q, h.r, now);
                    drawTile(h.x, h.y, sz, rot, false, null, tf, h.q, h.r, now, 1.0, 0.0);
                }
                // 2. Draw grid on top
                if (state.showGrid) {
                    traceHexPathBatch(ctx, hexes, sz);
                    ctx.strokeStyle = COLORS.gridLine;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        if (lod >= 1 && visZoom > CONFIG.ZOOM_FADE_MID + 0.001 && !state.isExporting) {
            if (!state.isTouchDevice && state.hoveredQ !== null && state.hoveredR !== null) {
                const p = hexToPix(state.hoveredQ, state.hoveredR, z, px, py);
                const targetHX = p.x;
                const targetHY = p.y;
                
                if (state.visHoverX === null) {
                    state.visHoverX = targetHX;
                    state.visHoverY = targetHY;
                } else {
                    state.visHoverX += (targetHX - state.visHoverX) * CONFIG.HOVER_LERP; 
                    state.visHoverY += (targetHY - state.visHoverY) * CONFIG.HOVER_LERP;
                    
                    if (Math.abs(targetHX - state.visHoverX) > 0.5 || Math.abs(targetHY - state.visHoverY) > 0.5) {
                        keepRendering = true;
                    } else {
                        state.visHoverX = targetHX;
                        state.visHoverY = targetHY;
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

        if (state.markersVisible) {
            for (let i = 0; i < state.gradientMarkers.length; i++) {
                const m = state.gradientMarkers[i];
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
            
            if (curveAlpha === 0) {
                state.edgeRgbMap.clear();
            } else {
                const visibleEdgeIDs = new Set();
                for (const h of hexes) {
                    for (let e = 0; e < 6; e++) {
                        visibleEdgeIDs.add(edgeID(h.q, h.r, e));
                    }
                }
                for (const id of state.edgeRgbMap.keys()) {
                    if (!visibleEdgeIDs.has(id)) {
                        state.edgeRgbMap.delete(id);
                    }
                }
            }
        }

        if (keepRendering || state.edgeColorAnimating || gradColorAnimating || curveColorAnimating) {
            requestRender();
        }
        
        const tempUnassigned = state.previousUnassignedEdges;
        state.previousUnassignedEdges = state.currentUnassignedEdges;
        state.currentUnassignedEdges = tempUnassigned;
    }

    // ──── Resize ────
    function resize() {
        state.isGradientDirty = true;
        
        if (isEmbedMode) {
            if (embedData) {
                dom.cvs.width = embedData.w;
                dom.cvs.height = embedData.h;
            }
            if (!state.isInitialized) {
                state.isInitialized = true;
                if (state.gradientMarkers.length === 0) {
                    const pos = getRandomMarkerPosition();
                    state.gradientMarkers.push({ x: pos.x, y: pos.y, color: '#cccccc' });
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

        if (!state.isInitialized) {
            if (w > 0 && h > 0) {
                const isCollapsed = document.body.classList.contains('sidebar-collapsed');
                const effectiveW = isCollapsed ? w : Math.max(0, w - CONFIG.SIDEBAR_WIDTH);
                state.panX = effectiveW / 2;
                state.panY = h / 2;
                state.starPanX5 = state.panX;
                state.starPanY5 = state.panY;
                state.starZoom5 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_LARGE);
                state.starZoom2 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_MED);
                state.starPanX3 = state.panX;
                state.starPanY3 = state.panY;
                state.starZoom3 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
                state.isInitialized = true;

                if (state.gradientMarkers.length === 0) {
                    const pos = getRandomMarkerPosition();
                    state.gradientMarkers.push({
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
        clearTimeout(state.magnetTimer);
        state.magnetTimer = setTimeout(() => {
            // Postpone the magnet snap if the user is actively interacting
            if (state.isDrag || touchState.mode === 'pinch') {
                scheduleMagnetZoom(); 
                return;
            }
            if (state.targetZoom < 0.27 && state.targetZoom > CONFIG.MIN_ZOOM) {
                if (state.targetZoom < 0.22) {
                    state.targetZoom = 0.20; // Snap to 20%
                } else {
                    state.targetZoom = 0.25; // Snap to 25%
                }
                requestRender();
            }
        }, CONFIG.MAGNET_DELAY);
    }

    function setZoom(nz, cx, cy) {
        const oz = state.zoom;
        const oPanX = state.panX;
        const oPanY = state.panY;
        state.zoom = Math.max(MIN_Z, Math.min(MAX_Z, nz));
        if (cx !== undefined) {
            state.panX = cx - (cx - oPanX) * (state.zoom / oz);
            state.panY = cy - (cy - oPanY) * (state.zoom / oz);
            
            if (state.zoom !== oz) {
                const odz5 = state.starZoom5;
                const odz2 = state.starZoom2;
                const odz3 = state.starZoom3;

                state.starZoom5 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_LARGE);
                state.starZoom2 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_MED);
                state.starZoom3 = Math.pow(state.zoom, CONFIG.STAR_ZOOM_EXP_SMALL);
                
                state.starPanX5 = cx - (cx - state.starPanX5) * (state.starZoom5 / odz5);
                state.starPanY5 = cy - (cy - state.starPanY5) * (state.starZoom5 / odz5);
                state.starPanX2 = cx - (cx - state.starPanX2) * (state.starZoom2 / odz2);
                state.starPanY2 = cy - (cy - state.starPanY2) * (state.starZoom2 / odz2);
                state.starPanX3 = cx - (cx - state.starPanX3) * (state.starZoom3 / odz3);
                state.starPanY3 = cy - (cy - state.starPanY3) * (state.starZoom3 / odz3);
            }
            
            if (state.isDrag) {
                const dx = state.mouseScreenX - state.dragSX;
                const dy = state.mouseScreenY - state.dragSY;
                state.dragPX = state.panX - dx;
                state.dragPY = state.panY - dy;
            }
        }
        dom.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
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
        state.isTouchDevice = true;
        state.hoveredQ = null;
        state.hoveredR = null;
        state.visHoverX = null;
        state.visHoverY = null;

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

            if (!isEmbedMode && state.markersVisible) {
                let clickedMarkerIdx = -1;
                for (let i = 0; i < state.gradientMarkers.length; i++) {
                    const m = state.gradientMarkers[i];
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
                            state.isDragMarker = true;
                            state.draggedMarkerIndex = touchState.markerIdx;
                            state.dragMarkerOffsetX = touchState.startX - state.gradientMarkers[touchState.markerIdx].x;
                            state.dragMarkerOffsetY = touchState.startY - state.gradientMarkers[touchState.markerIdx].y;
                            state.targetInteractionFade = 0.0; // Hide grid/state.curves ONLY when long-press completes
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
            touchState.startPanX = state.panX;
            touchState.startPanY = state.panY;
            touchState.startTime = Date.now();
            
            state.isDrag = false;
            state.dragMoved = false;
            state.dragSX = tx; state.dragSY = ty;
            state.embedDragLastTile = null;
            state.panVX = 0; state.panVY = 0;
            
            touchState.timer = setTimeout(() => {
                if (touchState.mode === 'pan_wait' && !state.dragMoved) {
                    touchState.mode = 'draw';
                    state.isDrag = false; 
                    if (navigator.vibrate) navigator.vibrate(CONFIG.HAPTIC_DUR);
                    const h = pixToHex(touchState.startX, touchState.startY, state.zoom, state.panX, state.panY);
                    const hk = hexKey(h.q, h.r);
                    if (hk !== state.embedDragLastTile) {
                        state.embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                    requestRender();
                }
            }, CONFIG.LONG_PRESS_DUR);
        } else if (e.touches.length === 2) {
            if (touchState.mode === 'marker_wait' || touchState.mode === 'pan_wait') {
                clearTimeout(touchState.timer);
            }
            state.targetInteractionFade = 1.0; // Restore grid/state.curves for pinch
            if (touchState.mode === 'marker_drag') {
                state.isDragMarker = false;
                state.draggedMarkerIndex = -1;
            }
            touchState.mode = 'pinch';
            state.isDrag = false; 
            
            state.panVX = 0; 
            state.panVY = 0;
            
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchState.startDist = Math.hypot(dx, dy);
            touchState.startZoom = state.targetZoom;
            
            const r = dom.cvs.getBoundingClientRect();
            touchState.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            touchState.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
            
            state.zoomCx = touchState.pinchCenterX;
            state.zoomCy = touchState.pinchCenterY;
            state.zoomOutBlockedUntil = 0; 
        }
        e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        if (touchState.mode === 'none') return; 
        const r = dom.cvs.getBoundingClientRect();
        
        if (touchState.mode === 'marker_drag' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left;
            const ty = e.touches[0].clientY - r.top;
            state.gradientMarkers[state.draggedMarkerIndex].x = tx - state.dragMarkerOffsetX;
            state.gradientMarkers[state.draggedMarkerIndex].y = ty - state.dragMarkerOffsetY;
            if (state.gradientMarkersRGB[state.draggedMarkerIndex]) {
                state.gradientMarkersRGB[state.draggedMarkerIndex].x = state.gradientMarkers[state.draggedMarkerIndex].x;
                state.gradientMarkersRGB[state.draggedMarkerIndex].y = state.gradientMarkers[state.draggedMarkerIndex].y;
            }
            state.isGradientDirty = true;
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
            const h = pixToHex(tx, ty, state.zoom, state.panX, state.panY);
            const hk = hexKey(h.q, h.r);
            if (hk !== state.embedDragLastTile) {
                state.embedDragLastTile = hk;
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
                if (!state.dragMoved) state.dragMoved = true;
            }
            
            if (state.dragMoved && touchState.mode === 'pan_wait') {
                clearTimeout(touchState.timer);
                touchState.mode = 'pan';
                state.isDrag = true; 
            }
            
            if (touchState.mode === 'pan') {
                let targetPanX = touchState.startPanX + dx;
                let targetPanY = touchState.startPanY + dy;
                
                const dPanX = targetPanX - state.panX;
                const dPanY = targetPanY - state.panY;
                
                if (state.inertiaEnabled) {
                    state.panVX = dPanX;
                    state.panVY = dPanY;
                    state.lastPanMoveTime = Date.now();
                } else {
                    state.panVX = 0;
                    state.panVY = 0;
                }
                
                state.panX = targetPanX;
                state.panY = targetPanY;
                
                state.starPanX5 += dPanX * CONFIG.STAR_PARALLAX_LARGE;
                state.starPanY5 += dPanY * CONFIG.STAR_PARALLAX_LARGE;
                state.starPanX2 += dPanX * CONFIG.STAR_PARALLAX_MED;
                state.starPanY2 += dPanY * CONFIG.STAR_PARALLAX_MED;
                state.starPanX3 += dPanX * CONFIG.STAR_PARALLAX_SMALL;
                state.starPanY3 += dPanY * CONFIG.STAR_PARALLAX_SMALL;
            }
            requestRender();
        } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const newDist = Math.hypot(dx, dy);
            
            let scale = newDist / Math.max(1, touchState.startDist);
            let newTargetZoom = touchState.startZoom * scale;
            
            if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH && newTargetZoom < state.targetZoom) {
                let delta = newTargetZoom - state.targetZoom;
                newTargetZoom = state.targetZoom + delta * 0.25;
            }
            
            state.targetZoom = Math.max(MIN_Z, Math.min(MAX_Z, newTargetZoom));
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
            if (now - state.lastTapTime < 300) {
                removeMarkerAt(touchState.startX, touchState.startY);
                state.lastTapTime = 0;
            } else {
                state.lastTapTime = now;
            }
        } else if (wasMode === 'marker_drag') {
            state.isDragMarker = false;
            state.draggedMarkerIndex = -1;
            state.targetInteractionFade = 1.0; // Bring back grid/state.curves
        } else if (wasMode === 'pan_wait') {
            clearTimeout(touchState.timer);
            
            // Single tap on empty grid - Rotate tile!
            const h = pixToHex(touchState.startX, touchState.startY, state.zoom, state.panX, state.panY);
            rotateTile(h.q, h.r);
            state.touchOutlines.push({ q: h.q, r: h.r, alpha: 1.0 }); 
        } else if (wasMode === 'pan') {
            if (state.dragMoved) {
                checkIfSolved();
            }
            // Do NOT zero state.panVX/state.panVY here so inertia can continue!
        } else if (wasMode === 'draw') {
            state.panVX = 0; state.panVY = 0; // Draw mode shouldn't have inertia
        }
        
        if (e.touches.length === 0) {
            touchState.mode = 'none';
            state.isDrag = false;
            // Only kill inertia if we weren't panning
            if (wasMode !== 'pan') {
                state.panVX = 0; state.panVY = 0;
            }
        } else if (wasMode === 'pinch' && e.touches.length === 1) {
            touchState.mode = 'none';
            state.isDrag = false;
            state.panVX = 0; state.panVY = 0; // Kill inertia when transitioning from pinch
        }
        
        requestRender();
        e.preventDefault();
    }, { passive: false });

    dom.cvs.addEventListener('wheel', e => {
        if (isEmbedMode) return;
        e.preventDefault();
        const r = dom.cvs.getBoundingClientRect();
        state.zoomCx = e.clientX - r.left;
        state.zoomCy = e.clientY - r.top;

        const now = Date.now();
        let delta = e.deltaY > 0 ? CONFIG.WHEEL_DELTA_OUT : CONFIG.WHEEL_DELTA_IN;

        if (e.deltaY > 0) { 
            if (state.targetZoom >= CONFIG.ZOOM_FADE_HIGH && state.targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
                if (now < state.zoomOutBlockedUntil) return;
                if (state.zoomOutBlockedUntil === 0) {
                    state.zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_WHEEL;
                    return;
                }
            }
            if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) {
                delta = 1 + (delta - 1) * CONFIG.WHEEL_SLOW_MULT;
            }
        } else { 
            if (state.targetZoom * delta >= CONFIG.ZOOM_FADE_HIGH) {
                state.zoomOutBlockedUntil = 0;
            }
        }

        state.targetZoom *= delta;
        state.targetZoom = Math.max(MIN_Z, Math.min(MAX_Z, state.targetZoom));
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    }, { passive: false });

    dom.cvs.addEventListener('mouseleave', () => {
        state.hoveredQ = null;
        state.hoveredR = null;
        state.visHoverX = null;
        state.visHoverY = null;
    });
    
    dom.cvs.addEventListener('mousedown', e => {
        const r = dom.cvs.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        
        if (isEmbedMode) {
            state.isDrag = true; state.dragMoved = false;
            state.dragSX = mx; state.dragSY = my;
            state.embedDragLastTile = null;
            return;
        }

        if (state.markersVisible) {
            let clickedMarkerIdx = -1;
            for (let i = 0; i < state.gradientMarkers.length; i++) {
                const m = state.gradientMarkers[i];
                const dx = mx - m.x;
                const dy = my - m.y;
                const hitR = CONFIG.MARKER_HIT_RADIUS;
                if (dx * dx + dy * dy < hitR * hitR) {
                    clickedMarkerIdx = i;
                    break;
                }
            }
            if (clickedMarkerIdx !== -1) {
                state.isDragMarker = true;
                state.draggedMarkerIndex = clickedMarkerIdx;
                state.dragMarkerOffsetX = mx - state.gradientMarkers[clickedMarkerIdx].x;
                state.dragMarkerOffsetY = my - state.gradientMarkers[clickedMarkerIdx].y;
                requestRender();
                return;
            }
        }

        state.isDrag = true;
        state.dragMoved = false;
        state.dragSX = e.clientX;
        state.dragSY = e.clientY;
        state.dragPX = state.panX;
        state.dragPY = state.panY;
        state.panVX = 0;
        state.panVY = 0;
        requestRender();
    });

    window.addEventListener('mousemove', e => {
        const r = dom.cvs.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;

        if (state.isDragMarker && state.draggedMarkerIndex !== -1) {
            state.gradientMarkers[state.draggedMarkerIndex].x = mx - state.dragMarkerOffsetX;
            state.gradientMarkers[state.draggedMarkerIndex].y = my - state.dragMarkerOffsetY;
            if (state.gradientMarkersRGB[state.draggedMarkerIndex]) {
                state.gradientMarkersRGB[state.draggedMarkerIndex].x = state.gradientMarkers[state.draggedMarkerIndex].x;
                state.gradientMarkersRGB[state.draggedMarkerIndex].y = state.gradientMarkers[state.draggedMarkerIndex].y;
            }
            state.isGradientDirty = true;
            state.targetInteractionFade = 0.0; // Hide grid/state.curves as soon as mouse drag starts
            requestRender();
            return;
        }

        state.mouseScreenX = mx;
        state.mouseScreenY = my;

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const sidebarHidden = isCollapsed || isEmbedMode;
        const effectiveW = sidebarHidden ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);

        const h = pixToHex(state.mouseScreenX, state.mouseScreenY, state.zoom, state.panX, state.panY);

        if (state.isTouchDevice) {
            state.hoveredQ = null;
            state.hoveredR = null;
        } else {
            if (!sidebarHidden && mx > effectiveW) {
                state.hoveredQ = null;
                state.hoveredR = null;
            } else {
                state.hoveredQ = h.q;
                state.hoveredR = h.r;
            }
        }
        if (state.isDrag) {
            const dx = mx - state.dragSX, dy = my - state.dragSY;
            if (Math.abs(dx) + Math.abs(dy) > CLICK_THRESH) { if (!state.dragMoved) state.dragMoved = true; }

            if (isEmbedMode) {
                if (state.dragMoved) {
                    const hk = hexKey(h.q, h.r);
                    if (hk !== state.embedDragLastTile) {
                        state.embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                }
            } else {
                let targetPanX = state.dragPX + dx;
                let targetPanY = state.dragPY + dy;

                const dPanX = targetPanX - state.panX;
                const dPanY = targetPanY - state.panY;

                if (state.inertiaEnabled) {
                    state.panVX = dPanX;
                    state.panVY = dPanY;
                    state.lastPanMoveTime = Date.now();
                } else {
                    state.panVX = 0;
                    state.panVY = 0;
                }

                state.panX = targetPanX;
                state.panY = targetPanY;
                
                state.starPanX5 += dPanX * CONFIG.STAR_PARALLAX_LARGE;
                state.starPanY5 += dPanY * CONFIG.STAR_PARALLAX_LARGE;
                state.starPanX2 += dPanX * CONFIG.STAR_PARALLAX_MED;
                state.starPanY2 += dPanY * CONFIG.STAR_PARALLAX_MED;
                state.starPanX3 += dPanX * CONFIG.STAR_PARALLAX_SMALL;
                state.starPanY3 += dPanY * CONFIG.STAR_PARALLAX_SMALL;
            }
        }
        requestRender();
    });
    window.addEventListener('mouseup', e => {
        if (state.isDragMarker) {
            state.isDragMarker = false;
            state.draggedMarkerIndex = -1;
            state.targetInteractionFade = 1.0; // Bring back grid/state.curves
            requestRender();
            return;
        }
        if (state.isDrag) {
            if (!state.dragMoved) {
                handleClick(e);
            } else {
                checkIfSolved();
            }
            state.isDrag = false;
            state.targetInteractionFade = 1.0; // Bring back grid/state.curves
        }
        requestRender();
    });

    function removeMarkerAt(mx, my) {
        let clickedMarkerIdx = -1;
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            const m = state.gradientMarkers[i];
            const dx = mx - m.x;
            const dy = my - m.y;
            const hitR = CONFIG.MARKER_HIT_RADIUS;
            if (dx * dx + dy * dy < hitR * hitR) {
                clickedMarkerIdx = i;
                break;
            }
        }

        if (clickedMarkerIdx !== -1) {
            if (state.gradientMarkers.length > 1) {
                const removedMarker = state.gradientMarkers[clickedMarkerIdx];
                const cached = state.gradientMarkersRGB[clickedMarkerIdx];
                state.fadingMarkersRGB.push({
                    x: removedMarker.x,
                    y: removedMarker.y,
                    r: cached.r, g: cached.g, b: cached.b,
                    origR: cached.r, origG: cached.g, origB: cached.b,
                    weight: cached.weight || 1
                });
                
                state.gradientMarkers.splice(clickedMarkerIdx, 1);
                state.gradientMarkersRGB.splice(clickedMarkerIdx, 1); 
                
                state.isDragMarker = false;
                state.draggedMarkerIndex = -1;
                
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
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            const m = state.gradientMarkers[i];
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
        
        state.lastRipple = { q, r, time: now };

        const curDisplay = displayRot(q, r, now);
        const curLogical = tileRot(q, r);
        const nextLogical = (curLogical + ROT_STEP) % 360;
        state.rotOverrides.set(k, nextLogical);

        const target = nearestTarget(curDisplay, nextLogical);
        state.animMap.set(k, { start: now, from: curDisplay, to: target, duration: CLICK_DUR });
        
        // Only calculate state.curves if they are actually visible to prevent memory leaks
        const visZoom = (isEmbedMode && embedData && embedData.origZoom) ? embedData.origZoom : state.zoom;
        const visSz = HEX_R * visZoom;
        const fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
        
        if (visSz > fadeEndSz) {
            if (state.curveColors.length > 1) {
                updateLocalCurves(q, r);
            }
        } else {
            state.queue.length = 0;
            state.curveMap.clear();
            state.curves.clear();
            state.edgeRgbMap.clear();
        }

        checkIfSolved();
        requestRender();
    }

    function handleClick(e) {
        const r = dom.cvs.getBoundingClientRect();
        const h = pixToHex(e.clientX - r.left, e.clientY - r.top, state.zoom, state.panX, state.panY);
        rotateTile(h.q, h.r);
    }

    dom.zoomIn.onclick = () => {
        state.zoomCx = dom.cvs.width / 2; 
        state.zoomCy = dom.cvs.height / 2;
        state.targetZoom = Math.min(MAX_Z, state.targetZoom * CONFIG.BTN_DELTA_IN);
        if (state.targetZoom >= CONFIG.ZOOM_FADE_HIGH) state.zoomOutBlockedUntil = 0;
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    };
    
    dom.zoomOut.onclick = () => {
        state.zoomCx = dom.cvs.width / 2; 
        state.zoomCy = dom.cvs.height / 2;
        const now = Date.now();
        let delta = CONFIG.BTN_DELTA_OUT;
        
        if (state.targetZoom >= CONFIG.ZOOM_FADE_HIGH && state.targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
            if (now < state.zoomOutBlockedUntil) return;
            if (state.zoomOutBlockedUntil === 0) {
                state.zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_BTN;
                return;
            }
        }
        if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) {
            delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
        }
        state.targetZoom = Math.max(MIN_Z, state.targetZoom * delta);
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    };

    window.addEventListener('keydown', e => {
        if (isEmbedMode) return;
        state.zoomCx = dom.cvs.width / 2; 
        state.zoomCy = dom.cvs.height / 2;
        const now = Date.now();
        
        if (e.key === '=' || e.key === '+') {
            state.targetZoom = Math.min(MAX_Z, state.targetZoom * CONFIG.KEY_DELTA_IN);
            if (state.targetZoom >= CONFIG.ZOOM_FADE_HIGH) state.zoomOutBlockedUntil = 0;
            checkIfSolved();
            scheduleMagnetZoom();
        }
        if (e.key === '-') {
            let delta = CONFIG.KEY_DELTA_OUT;
            if (state.targetZoom >= CONFIG.ZOOM_FADE_HIGH && state.targetZoom * delta < CONFIG.ZOOM_FADE_HIGH) {
                if (now < state.zoomOutBlockedUntil) return;
                if (state.zoomOutBlockedUntil === 0) {
                    state.zoomOutBlockedUntil = now + CONFIG.ZOOM_BLOCK_DELAY_BTN;
                    return;
                }
            }
            if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) {
                delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
            }
            state.targetZoom = Math.max(MIN_Z, state.targetZoom * delta);
            checkIfSolved();
            scheduleMagnetZoom(); 
        }
        requestRender();
    });

    dom.gridToggle.addEventListener('change', function() { state.showGrid = this.checked; requestRender();});
    dom.unrenderedToggle.addEventListener('change', function() { state.showUnrenderedDotted = this.checked; requestRender();});
    dom.bgStarsToggle.addEventListener('change', function() { state.showBgStars = this.checked; requestRender();});
    dom.markersToggle.addEventListener('change', function() { state.markersVisible = this.checked; requestRender();});
    dom.flowToggle.addEventListener('change', function() { 
        state.flowEnabled = this.checked; 
        requestRender(); 
    });
    dom.inertiaToggle.addEventListener('change', function() { 
        state.inertiaEnabled = this.checked; 
        if (!state.inertiaEnabled) {
            state.panVX = 0; 
            state.panVY = 0;
        }
        requestRender(); 
    });
    dom.sCurveW.addEventListener('input', function() {
        state.curveLineWidth = +dom.sCurveW.value;
        dom.vCurveW.textContent = state.curveLineWidth.toFixed(2) + 'x';
        requestRender();
    });

    let lastAlterRatio = 0;
    dom.sAlterTiles.addEventListener('input', function() {
        state.alterTilesRatio = +dom.sAlterTiles.value;
        dom.vAlterTiles.textContent = state.alterTilesRatio.toFixed(2);
        if (Math.abs(state.alterTilesRatio - lastAlterRatio) > 0.001) {
            lastAlterRatio = state.alterTilesRatio;
            state.curveMap.clear();
            state.edgeRgbMap.clear();
            state.curves.clear();
            state.queue.length = 0;
            initializeCentralTile();
        }
        requestRender();
        checkIfSolved();
    });

    function bulkAnimate(newMode, newSeed) {
        const now = Date.now();
        const hexes = visibleHexes(state.zoom, state.panX, state.panY, dom.cvs.width, dom.cvs.height);
        const snapshots = new Map();
        for (const h of hexes) snapshots.set(hexKey(h.q, h.r), displayRot(h.q, h.r, now));
        state.rotOverrides.clear();
        state.rotMode = newMode;
        state.rotSeed = newSeed; 
        for (const h of hexes) {
            const k = hexKey(h.q, h.r);
            const curDisplay = snapshots.get(k);
            const newBase = baseRot(h.q, h.r);
            const target = nearestTarget(curDisplay, newBase);
            if (Math.abs(target - curDisplay) > 0.5) {
                state.animMap.set(k, { start: now, from: curDisplay, to: target, duration: BULK_DUR });
            } else {
                state.animMap.delete(k);
            }
        }
        state.curveMap.clear();
        state.edgeRgbMap.clear();
        state.curves.clear();
        state.queue.length = 0;
        initializeCentralTile();
        checkIfSolved();
    }

    dom.randAnglesBtn.onclick = () => {
        bulkAnimate('hash', (state.rotSeed + 1) & 0x7FFFFFFF);
        toast('Angles randomized');
    };

    dom.randLineColorsBtn.onclick = () => {
        if (state.curveColors.length === 0) return;
        state.curveColorPool = generateDistinctThemePool();
        for (let i = 0; i < state.curveColors.length; i++) {
            state.curveColors[i] = state.curveColorPool.pool[i] || state.curveColors[i];
        }
        updateCurveColorsCache();
        renderCurveList();
        toast(`Theme "${state.curveColorPool.name}" applied to state.curves`);
        checkIfSolved();
        requestRender();
    };

    dom.randGradColorsBtn.onclick = () => {
        if (state.gradientMarkers.length === 0) return;
        state.gradientColorPool = generateDistinctThemePool();
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            state.gradientMarkers[i].color = state.gradientColorPool.pool[i] || state.gradientMarkers[i].color;
            updateGradientMarkersCache();
        }
        renderGradientList();
        toast(`Theme "${state.gradientColorPool.name}" applied to gradient`);
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
                state.pendImg = img;
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
        writeSliders(state.texTf);
        drawPreview();
    }

    function closeEditor() {
        dom.editorPanel.classList.remove('open');
        state.pendImg = null;
    }

    function applyTexture() {
        if (state.pendImg) state.texImg = state.pendImg;
        state.texTf = readSliders();
        toast('Texture applied — keep adjusting or close the editor');
    }

    dom.cancelEd.onclick = closeEditor;
    dom.applyEd.onclick = applyTexture;
    dom.resetTexBtn.onclick = () => {
        state.texImg = null;
        state.texTf = { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
        if (dom.editorPanel.classList.contains('open')) {
            writeSliders(state.texTf);
            drawPreview();
        }
        state.pendImg = null;
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
        const img = state.pendImg || state.texImg;
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

    function pickNewMarkerColor() {
        const existing = new Set(state.gradientMarkers.map(m => m.color.toLowerCase()));
        
        for (let i = 0; i < state.gradientColorPool.pool.length; i++) {
            if (!existing.has(state.gradientColorPool.pool[i].toLowerCase())) {
                return state.gradientColorPool.pool[i];
            }
        }
        
        for (let attempts = 0; attempts < 200; attempts++) {
            const c = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            if (!existing.has(c.toLowerCase())) return c;
        }
        return null;
    }

    function pickNewCurveColor() {
        const existing = new Set(state.curveColors.map(c => c.toLowerCase()));
        
        for (let i = 0; i < state.curveColorPool.pool.length; i++) {
            if (!existing.has(state.curveColorPool.pool[i].toLowerCase())) {
                return state.curveColorPool.pool[i];
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

        if (state.gradientMarkers.length > 0) {
            let maxMinDist = -1;
            const candidates = 100;
            for (let i = 0; i < candidates; i++) {
                const cx = minX + Math.random() * (maxX - minX);
                const cy = minY + Math.random() * (maxY - minY);
                let minDist = Infinity;
                for (const m of state.gradientMarkers) {
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
        if (state.gradientMarkers.length >= CONFIG.MAX_MARKERS) {
            toast('Maximum of ' + CONFIG.MAX_MARKERS + ' gradient markers reached');
            return;
        }
        const color = pickNewMarkerColor();
        if (!color) {
            toast('All colors are already in use');
            return;
        }
        const pos = getRandomMarkerPosition();
        state.gradientMarkers.push({ x: pos.x, y: pos.y, color: color });
        updateGradientMarkersCache();
        state.markersVisible = true;
        dom.markersToggle.checked = true;
        renderGradientList();
    };

    dom.addCurveBtn.onclick = () => {
        if (state.curveColors.length >= CONFIG.MAX_CURVE_COLORS) {
            toast('Maximum of ' + CONFIG.MAX_CURVE_COLORS + ' curve colors reached');
            return;
        }
        const color = pickNewCurveColor();
        if (!color) {
            toast('All colors are already in use');
            return;
        }
        state.curveColors.push(color);
        updateCurveColorsCache();
        state.activeCurveIndex = state.curveColors.length - 1;
        renderCurveList();
        state.curveMap.clear();
        state.curves.clear();
        state.queue.length = 0;
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
        for (const [k, rot] of state.rotOverrides.entries()) {
            const { q, r } = decodeHexKey(k);
            out.push([q, r, rot]);
        }
        return out;
    }

    function getTextureDataUrl() {
        if (!state.texImg) return null;
        try {
            const c = document.createElement('canvas');
            c.width = state.texImg.naturalWidth || state.texImg.width;
            c.height = state.texImg.naturalHeight || state.texImg.height;
            c.getContext('2d').drawImage(state.texImg, 0, 0);
            return c.toDataURL('image/png');
        } catch (e) { return null; }
    }

    // ── Frame state ──

    function openExportOverlay() {
        // 1. Finish processing the state.queue instantly so all state.curves are generated
        let safety = 10000;
        while (safety-- > 0 && state.queue.length > 0) {
            processQueue();
        }
        
        // 2. Force all edges to their final target colors instantly (no ripples)
        for (const [id, edgeData] of state.edgeRgbMap.entries()) {
            let targetCurveID = -1;
            let targetRgb = null;
            
            if (state.curveColors.length === 1) {
                const c = state.curveColorsRGB[0];
                if (c) targetRgb = { r: c.tr !== undefined ? c.tr : c.r, g: c.tg !== undefined ? c.tg : c.g, b: c.tb !== undefined ? c.tb : c.b };
                targetCurveID = -2;
            } else if (state.curveMap.has(id)) {
                targetCurveID = state.curveMap.get(id);
                const curve = state.curves.get(targetCurveID);
                if (curve) {
                    let c = curve.color;
                    if (typeof c === 'number') {
                        const cc = state.curveColorsRGB[c % state.curveColorsRGB.length];
                        targetRgb = { r: cc.tr !== undefined ? cc.tr : cc.r, g: cc.tg !== undefined ? cc.tg : cc.g, b: cc.tb !== undefined ? cc.tb : cc.b };
                    } else {
                        const rgb = hexToRgb(c); 
                        targetRgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
                    }
                }
            }
            
            if (targetRgb) {
                if (!edgeData) {
                    state.edgeRgbMap.set(id, { 
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
                state.edgeRgbMap.delete(id);
            }
        }

        const cr = dom.cvs.getBoundingClientRect();
        const fw = cr.width / 2, fh = cr.height / 2;
        state.targetRatio = fw / fh;
        state.efRect = { x: cr.left + (cr.width - fw) / 2, y: cr.top + (cr.height - fh) / 2, w: fw, h: fh };
        dom.exportOverlay.classList.add('active');
        
        state.sidebarWasCollapsed = document.body.classList.contains('sidebar-collapsed');
        if (!state.sidebarWasCollapsed) {
            document.body.classList.add('sidebar-collapsed');
            document.querySelector('.sidebar').classList.add('collapsed');
            document.getElementById('sidebarToggle').classList.add('collapsed');
        }
        document.body.classList.add('exporting');
        state.isExporting = true;
        
        // Kill any ongoing inertia immediately
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

    function closeExportOverlay() {
        dom.exportOverlay.classList.remove('active');
        document.body.classList.remove('exporting');
        if (!state.sidebarWasCollapsed) {
            document.body.classList.remove('sidebar-collapsed');
            document.querySelector('.sidebar').classList.remove('collapsed');
            document.getElementById('sidebarToggle').classList.remove('collapsed');
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
        
        // Hide export menu if the drawn frame is smaller than 50x50
        if (state.efRect.w < 50 || state.efRect.h < 50) {
            dom.exportMenu.style.display = 'none';
            return;
        }
        
        dom.exportMenu.style.display = 'block';
        const menuW = 280; // Approximate menu width
        const menuH = 320; // Approximate menu height
        let mx = 0, my = 0;
        let placed = false;

        // 1. Try Right side
        if (state.efRect.x + state.efRect.w + 16 + menuW <= window.innerWidth - 16) {
            mx = state.efRect.x + state.efRect.w + 16;
            my = state.efRect.y;
            // Clamp vertically to screen bounds
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
            placed = true;
        }

        // 2. Try Left side
        if (!placed && state.efRect.x - menuW - 16 >= 16) {
            mx = state.efRect.x - menuW - 16;
            my = state.efRect.y;
            // Clamp vertically to screen bounds
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
            placed = true;
        }

        // 3. Try Top
        if (!placed && state.efRect.y - menuH - 16 >= 16) {
            my = state.efRect.y - menuH - 16;
            // Center horizontally over the frame
            mx = state.efRect.x + (state.efRect.w / 2) - (menuW / 2);
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            placed = true;
        }

        // 4. Try Bottom
        if (!placed && state.efRect.y + state.efRect.h + 16 + menuH <= window.innerHeight - 16) {
            my = state.efRect.y + state.efRect.h + 16;
            // Center horizontally over the frame
            mx = state.efRect.x + (state.efRect.w / 2) - (menuW / 2);
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            placed = true;
        }

        // 5. Absolute Last Resort: Inside the frame (top-left corner)
        if (!placed) {
            mx = state.efRect.x + 16;
            my = state.efRect.y + 16;
            // Just in case the frame itself is smaller than the menu, clamp to screen
            mx = Math.max(16, Math.min(mx, window.innerWidth - menuW - 16));
            my = Math.max(16, Math.min(my, window.innerHeight - menuH - 16));
        }

        dom.exportMenu.style.left = mx + 'px';
        dom.exportMenu.style.top = my + 'px';
        
        const sideLabel = document.getElementById('exportSideLabel');
        if (sideLabel) {
            sideLabel.textContent = state.efRect.w >= state.efRect.h ? 'Exported width (px)' : 'Exported height (px)';
        }
    }

    function clampFrameToCanvas() {
        const cr = dom.cvs.getBoundingClientRect();
        state.efRect.x = Math.max(cr.left, Math.min(state.efRect.x, cr.left + cr.width - 80));
        state.efRect.y = Math.max(cr.top, Math.min(state.efRect.y, cr.top + cr.height - 80));
        state.efRect.w = Math.max(50, Math.min(state.efRect.w, cr.left + cr.width - state.efRect.x));
        state.efRect.h = Math.max(50, Math.min(state.efRect.h, cr.top + cr.height - state.efRect.y));
    }

    dom.exportBtn.onclick = openExportOverlay;
    dom.closeExportBtn.onclick = closeExportOverlay;

    // ── Aspect Ratio Lock ──
    dom.aspectLockBtn.addEventListener('click', () => {
        state.aspectLocked = !state.aspectLocked;
        dom.aspectLockBtn.classList.toggle('active', state.aspectLocked);
        dom.exportFrame.classList.toggle('locked-aspect', state.aspectLocked);
        
        if (state.aspectLocked) {
            let valW = parseInt(dom.exportW.value) || 50;
            let valH = parseInt(dom.exportH.value) || 50;
            state.targetRatio = valW / valH;
            
            let newW = state.efRect.w;
            let newH = newW / state.targetRatio;
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

    // ── Output Size Inputs (Enter to apply) ──
    dom.exportW.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let valW = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) {
            let valH = valW / state.targetRatio;
            if (valH > cr.height) { valH = cr.height; valW = valH * state.targetRatio; }
            if (valW > cr.width) { valW = cr.width; valH = valW / state.targetRatio; }
            dom.exportH.value = Math.round(valH);
            dom.exportW.value = Math.round(valW);
            state.efRect.w = valW;
            state.efRect.h = valH;
        } else {
            valW = Math.min(valW, cr.width);
            dom.exportW.value = valW;
            state.efRect.w = valW;
        }
        clampFrameToCanvas();
        updateExportFrameDOM();
    });
    
    dom.exportH.addEventListener('change', () => {
        const cr = dom.cvs.getBoundingClientRect();
        let valH = parseInt(dom.exportH.value) || 50;
        if (state.aspectLocked) {
            let valW = valH * state.targetRatio;
            if (valW > cr.width) { valW = cr.width; valH = valW / state.targetRatio; }
            if (valH > cr.height) { valH = cr.height; valW = valH * state.targetRatio; }
            dom.exportW.value = Math.round(valW);
            dom.exportH.value = Math.round(valH);
            state.efRect.w = valW;
            state.efRect.h = valH;
        } else {
            valH = Math.min(valH, cr.height);
            dom.exportH.value = valH;
            state.efRect.h = valH;
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
        const fx = state.efRect.x - cr.left;
        const fy = state.efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(state.efRect.w, state.efRect.h);
        const scale = targetLong / currentLong;
        const eW = Math.round(state.efRect.w * scale);
        const eH = Math.round(state.efRect.h * scale);
        const eZoom = state.zoom * scale;
        const ePanX = (state.panX - fx) * scale;
        const ePanY = (state.panY - fy) * scale;

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
        const now = state.exportFreezeTime || Date.now();
        const exportHexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);

        let exportBounds = { minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity };
        for (const h of exportHexes) {
            if (h.q < exportBounds.minQ) exportBounds.minQ = h.q;
            if (h.q > exportBounds.maxQ) exportBounds.maxQ = h.q;
            if (h.r < exportBounds.minR) exportBounds.minR = h.r;
            if (h.r > exportBounds.maxR) exportBounds.maxR = h.r;
        }

        const origSz = HEX_R * state.zoom;
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
        if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
            let safety = 2000;
            while (safety-- > 0) {
                processQueue(exportBounds, false);
                if (state.queue.length === 0) {
                    if (!findUncoloredTileInHexes(exportHexes)) break;
                }
            }
        }

        let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${eW}" height="${eH}" viewBox="0 0 ${eW} ${eH}">`;
        svg += `<rect width="${eW}" height="${eH}" fill="${COLORS.bg}"/>`;

        if (state.gradientMarkersRGB.length > 0) {
            updateIDWGradientCanvas(eW, eH, scale, fx, fy, 0.5);
            const gradUrl = state.gradientCanvas.toDataURL('image/png');
            svg += `<image xlink:href="${gradUrl}" width="${eW}" height="${eH}" preserveAspectRatio="none"/>`;
        }

        if (state.showBgStars) {
            const expStarPanX5 = (state.starPanX5 - fx) * scale;
            const expStarPanY5 = (state.starPanY5 - fy) * scale;
            const expStarPanX2 = (state.starPanX2 - fx) * scale;
            const expStarPanY2 = (state.starPanY2 - fy) * scale;
            const expStarPanX3 = (state.starPanX3 - fx) * scale;
            const expStarPanY3 = (state.starPanY3 - fy) * scale;
            
            const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * scale;
            const spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * scale;
            const spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * scale;

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
                let canBlaze = state.zoomOutStartTime > 0 && (now - state.zoomOutStartTime) > CONFIG.STAR_BLAZE_DELAY;
                addStars(spacing3, CONFIG.STAR_SIZE_SMALL, 3, expStarPanX3, expStarPanY3, eW, eH, scale, now, canBlaze, l3Alpha, state.zoomOutStartTime, fx, fy, 1.0);
            }
        }

        const eSz = HEX_R * eZoom;
        const pathsByColor = {};
        const gridPaths = [];

        // LOD match for SVG export
        const ext = eSz > CONFIG.LOD_HIGH_SZ ? CONFIG.LOD_EXT_HIGH : (eSz > CONFIG.LOD_MED_SZ ? CONFIG.LOD_EXT_MED : CONFIG.LOD_EXT_LOW);

        function getSvgEdgeColor(q, r, e) {
            if (state.curveColors.length === 1) {
                const cc = state.curveColorsRGB[0];
                return `rgb(${Math.round(cc.tr !== undefined ? cc.tr : cc.r)},${Math.round(cc.tg !== undefined ? cc.tg : cc.g)},${Math.round(cc.tb !== undefined ? cc.tb : cc.b)})`;
            }
            const id = edgeID(q, r, e);
            if (!state.curveMap.has(id)) return null;
            const curve = state.curves.get(state.curveMap.get(id));
            if (!curve) return null;
            const c = curve.color;
            if (typeof c === 'number') {
                const cc = state.curveColorsRGB[c % state.curveColorsRGB.length];
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

                if (state.texImg) {
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

                    if (state.showGrid) {
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

        const lw = (eSz / 3 * state.curveLineWidth).toFixed(2);
        for (const color in pathsByColor) {
            svg += `<path d="${pathsByColor[color].join(' ')}" stroke="${color}" stroke-width="${lw}" fill="none" stroke-linecap="butt"/>`;
        }

        if (state.showGrid && eGridAlpha > 0 && gridPaths.length > 0) {
            svg += `<path d="${gridPaths.join(' ')}" stroke="${COLORS.gridLine}" stroke-width="1" fill="none" stroke-opacity="${eGridAlpha.toFixed(3)}"/>`;
        }

        svg += `</svg>`;
        return svg;
    }

    dom.fmtSvgBtn.onclick = () => {
        const cr = dom.cvs.getBoundingClientRect();
        const fx = state.efRect.x - cr.left;
        const fy = state.efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(state.efRect.w, state.efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(state.efRect.w * scale);
        const eH = Math.round(state.efRect.h * scale);
        const eZoom = state.zoom * scale;
        const ePanX = (state.panX - fx) * scale;
        const ePanY = (state.panY - fy) * scale;

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
            state.efDrag = { mode: h, mx: e.clientX, my: e.clientY, x: state.efRect.x, y: state.efRect.y, w: state.efRect.w, h: state.efRect.h, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
        } else {
            state.efDrag = { mode: 'move', mx: e.clientX, my: e.clientY, x: state.efRect.x, y: state.efRect.y, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
        }
        e.preventDefault();
        e.stopPropagation();
    });

    dom.exportBackdrop.addEventListener('mousedown', e => {
        state.efDrag = { mode: 'draw', mx: e.clientX, my: e.clientY, startX: e.clientX, startY: e.clientY, prevRect: {...state.efRect}, exportW: parseInt(dom.exportW.value), exportH: parseInt(dom.exportH.value) };
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
        const dx = e.clientX - state.efDrag.mx, dy = e.clientY - state.efDrag.my;
        const cr = dom.cvs.getBoundingClientRect();
        
        if (state.efDrag.mode === 'move') {
            state.efRect.x = state.efDrag.x + dx;
            state.efRect.y = state.efDrag.y + dy;
            // Resist in all 4 directions (clamp position without shrinking) and slip grab point
            if (state.efRect.w <= cr.width) {
                const maxX = cr.left + cr.width - state.efRect.w;
                if (state.efRect.x < cr.left) { state.efDrag.x = cr.left - dx; state.efRect.x = cr.left; }
                else if (state.efRect.x > maxX) { state.efDrag.x = maxX - dx; state.efRect.x = maxX; }
            } else { state.efDrag.x = cr.left - dx; state.efRect.x = cr.left; }
            if (state.efRect.h <= cr.height) {
                const maxY = cr.top + cr.height - state.efRect.h;
                if (state.efRect.y < cr.top) { state.efDrag.y = cr.top - dy; state.efRect.y = cr.top; }
                else if (state.efRect.y > maxY) { state.efDrag.y = maxY - dy; state.efRect.y = maxY; }
            } else { state.efDrag.y = cr.top - dy; state.efRect.y = cr.top; }
        } else if (state.efDrag.mode === 'draw') {
            let rawW = Math.abs(e.clientX - state.efDrag.startX);
            let rawH = Math.abs(e.clientY - state.efDrag.startY);
            let startX = Math.min(state.efDrag.startX, e.clientX);
            let startY = Math.min(state.efDrag.startY, e.clientY);
            
            if (state.aspectLocked) {
                if (rawW / rawH > state.targetRatio) { rawW = rawH * state.targetRatio; } 
                else { rawH = rawW / state.targetRatio; }
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
            let { x, y, w, h } = state.efDrag;
            let newW = w, newH = h;
            
            if (state.efDrag.mode.includes('r')) newW = state.efDrag.w + dx;
            if (state.efDrag.mode.includes('l')) { newW = state.efDrag.w - dx; x = state.efDrag.x + dx; }
            if (state.efDrag.mode.includes('b')) newH = state.efDrag.h + dy;
            if (state.efDrag.mode.includes('t')) { newH = state.efDrag.h - dy; y = state.efDrag.y + dy; }
            
            if (state.aspectLocked) {
                let scale = Math.max(newW / state.efDrag.w, newH / state.efDrag.h);
                scale = Math.max(0.1, scale);
                newW = state.efDrag.w * scale;
                newH = state.efDrag.h * scale;
                if (state.efDrag.mode.includes('l')) x = state.efDrag.x + (state.efDrag.w - newW);
                if (state.efDrag.mode.includes('t')) y = state.efDrag.y + (state.efDrag.h - newH);
            }
            if (newW < 50) { newW = 50; if (state.efDrag.mode.includes('l')) x = state.efDrag.x + state.efDrag.w - 50; if (state.aspectLocked) newH = newW / state.targetRatio; }
            if (newH < 50) { newH = 50; if (state.efDrag.mode.includes('t')) y = state.efDrag.y + state.efDrag.h - 50; if (state.aspectLocked) newW = newH * state.targetRatio; }
            
            state.efRect.x = x; state.efRect.y = y; state.efRect.w = newW; state.efRect.h = newH;
            
            dom.exportW.value = Math.round(state.efRect.w);
            dom.exportH.value = Math.round(state.efRect.h);
            clampFrameToCanvas();
        }
        updateExportFrameDOM();
    });

    window.addEventListener('mouseup', () => { 
        // Exit export mode if the drawn frame is released under 50x50
        if (state.efDrag && state.efDrag.mode === 'draw' && (state.efRect.w < 50 || state.efRect.h < 50)) {
            closeExportOverlay();
        }
        state.efDrag = null; 
        requestRender(); 
    });

    // ── Output Size Inputs ──
    dom.exportW.addEventListener('input', () => {
        let val = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) {
            dom.exportH.value = Math.round(val / state.targetRatio);
        }
    });
    
    dom.exportH.addEventListener('input', () => {
        let val = parseInt(dom.exportH.value) || 50;
        if (state.aspectLocked) {
            dom.exportW.value = Math.round(val * state.targetRatio);
        }
    });

    dom.exportW.addEventListener('change', () => {
        if (!state.aspectLocked) {
            const val = parseInt(dom.exportW.value) || 50;
            const prev = parseFloat(dom.exportW.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                state.efRect.w *= ratio;
                clampFrameToCanvas();
                updateExportFrameDOM();
            }
            dom.exportW.dataset.prev = val;
        }
    });

    dom.exportH.addEventListener('change', () => {
        if (!state.aspectLocked) {
            const val = parseInt(dom.exportH.value) || 50;
            const prev = parseFloat(dom.exportH.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                state.efRect.h *= ratio;
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
        const eZoom = state.zoom * scale;
        const ePanX = (state.panX - fx) * scale;
        const ePanY = (state.panY - fy) * (eH / fh);

        const origSz = HEX_R * state.zoom;
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
        if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
            let safety = 2000;
            while (safety-- > 0) {
                processQueue(exportBounds, false); 
                if (state.queue.length === 0) {
                    if (!findUncoloredTileInHexes(hexes)) break;
                }
            }
        }

        const oldCtx = ctx;
        ctx = offCtx;
        const now = state.exportFreezeTime || Date.now();

        offCtx.fillStyle = COLORS.bg;
        offCtx.fillRect(0, 0, eW, eH);

        drawIDWGradient(eW, eH, scale, fx, fy);

        const expStarPanX5 = (state.starPanX5 - fx) * scale;
        const expStarPanY5 = (state.starPanY5 - fy) * scale;
        const expStarPanX2 = (state.starPanX2 - fx) * scale;
        const expStarPanY2 = (state.starPanY2 - fy) * scale;
        const expStarPanX3 = (state.starPanX3 - fx) * scale;
        const expStarPanY3 = (state.starPanY3 - fy) * scale;
        
        drawBackgroundStars(eW, eH, scale, expStarPanX5, expStarPanY5, expStarPanX2, expStarPanY2, expStarPanX3, expStarPanY3, now, eZoom / scale, state.zoomOutStartTime, fx, fy);

        const eSz = HEX_R * eZoom;
        // 1. Draw state.curves only
        for (const h of hexes) {
            const rot = tileRot(h.q, h.r);
            drawTile(h.x, h.y, eSz, rot, false, state.texImg, state.texTf, h.q, h.r, now, eCurveAlpha, 0.0);
        }
        
        // 2. Draw grid on top
        if (state.showGrid && eGridAlpha > 0.01) {
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
        const fx = state.efRect.x - cr.left;
        const fy = state.efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(state.efRect.w, state.efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(state.efRect.w * scale);
        const eH = Math.round(state.efRect.h * scale);

        const off = document.createElement('canvas');
        renderToOffscreen(off, eW, eH, fx, fy, state.efRect.w, state.efRect.h);

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
        const fx = state.efRect.x - cr.left;
        const fy = state.efRect.y - cr.top;
        
        const targetLong = parseInt(dom.exportSide.value) || 1920;
        const currentLong = Math.max(state.efRect.w, state.efRect.h);
        const scale = targetLong / currentLong;
        
        const eW = Math.round(state.efRect.w * scale);
        const eH = Math.round(state.efRect.h * scale);
        const eZoom = state.zoom * scale;
        const ePanX = (state.panX - fx) * scale;
        const ePanY = (state.panY - fy) * scale;

        const eMarkers = state.gradientMarkers.map(m => ({
            x: (m.x - fx) * scale,
            y: (m.y - fy) * scale,
            color: m.color
        }));

        const data = {
            w: eW, h: eH, zoom: eZoom, panX: ePanX, panY: ePanY,
            origZoom: state.zoom,
            showGrid: state.showGrid, 
            showUnrenderedDotted: state.showUnrenderedDotted, 
            markersVisible: false, 
            showBgStars: state.showBgStars, 
            flowEnabled: state.flowEnabled, 
            inertiaEnabled: state.inertiaEnabled,
            rotMode: state.rotMode, 
            randomSeed: state.randomSeed, 
            rotSeed: state.rotSeed, 
            curveLineWidth: state.curveLineWidth, 
            alterTilesRatio: state.alterTilesRatio,
            texTf: { ...state.texTf },
            curveColors: [...state.curveColors],
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
    state.curveColorPool = generateDistinctThemePool();
    state.gradientColorPool = generateDistinctThemePool();
    
    if (isEmbedMode && embedData) {
        // ── Embed mode: load state from data ──
        state.zoom = embedData.zoom;
        state.targetZoom = state.zoom;
        state.panX = embedData.panX;
        state.panY = embedData.panY;
        state.showGrid = embedData.showGrid;
        state.showUnrenderedDotted = embedData.showUnrenderedDotted;
        state.markersVisible = embedData.markersVisible;
        state.showBgStars = embedData.showBgStars !== undefined ? embedData.showBgStars : true;
        state.rotMode = embedData.rotMode || 'hash';
        state.randomSeed = embedData.randomSeed || 0;
        state.rotSeed = embedData.rotSeed || 0;
        state.curveLineWidth = embedData.curveLineWidth || 1;
        state.alterTilesRatio = embedData.alterTilesRatio || 0;
        state.flowEnabled = embedData.flowEnabled || false;
        state.inertiaEnabled = embedData.inertiaEnabled !== undefined ? embedData.inertiaEnabled : true;
        dom.inertiaToggle.checked = state.inertiaEnabled;
        state.texTf = embedData.texTf || { rot: 0, scale: 1, sx: 1, sy: 1, ox: 0, oy: 0 };
        state.curveColors.length = 0;
        state.curveColors.push(...(embedData.curveColors && embedData.curveColors.length > 0
            ? [...embedData.curveColors].slice(0, CONFIG.MAX_CURVE_COLORS) : ['#444444']));
        state.gradientMarkers.length = 0;
        state.gradientMarkers.push(...(embedData.markers || []).slice(0, CONFIG.MAX_MARKERS).map(m => ({ ...m })));
        state.markersVisible = false; 

        updateCurveColorsCache();
        updateGradientMarkersCache();

        dom.gridToggle.checked = state.showGrid;
        dom.unrenderedToggle.checked = state.showUnrenderedDotted;
        dom.bgStarsToggle.checked = state.showBgStars;
        dom.markersToggle.checked = state.markersVisible;
        dom.flowToggle.checked = state.flowEnabled;
        dom.sCurveW.value = state.curveLineWidth;
        dom.vCurveW.textContent = state.curveLineWidth.toFixed(2) + 'x';
        dom.sAlterTiles.value = state.alterTilesRatio;
        dom.vAlterTiles.textContent = state.alterTilesRatio.toFixed(2);

        if (embedData.rotOverrides) {
            for (const [q, r, rot] of embedData.rotOverrides) {
                state.rotOverrides.set(hexKey(q, r), rot);
            }
        }

        function startEmbedRender() {
            dom.cvs.width = embedData.w;
            dom.cvs.height = embedData.h;
            state.isInitialized = true;
            state.curveMap.clear(); state.edgeRgbMap.clear();
            state.curves.clear(); state.queue.length = 0;
            initializeCentralTile();
            
            // Kickstart blazing stars if the embed is at 20% state.zoom
            if (embedData.origZoom <= CONFIG.ZOOM_FADE_LOW + 0.001) {
                state.zoomOutStartTime = Date.now() - CONFIG.STAR_BLAZE_DELAY - 1000;
            }
            
            render();
        }

        if (embedData.texture) {
            const img = new Image();
            img.onload = () => { state.texImg = img; startEmbedRender(); };
            img.onerror = () => { startEmbedRender(); };
            img.src = embedData.texture;
        } else {
            startEmbedRender();
        }
    } else {
        // ── Normal mode ──
        state.showGrid = dom.gridToggle.checked;
        state.showUnrenderedDotted = dom.unrenderedToggle.checked;
        state.showBgStars = dom.bgStarsToggle.checked;
        state.markersVisible = dom.markersToggle.checked;
        state.flowEnabled = dom.flowToggle.checked;
        state.inertiaEnabled = dom.inertiaToggle.checked;
        state.curveLineWidth = +dom.sCurveW.value || 1;
        dom.vCurveW.textContent = state.curveLineWidth.toFixed(2) + 'x';
        state.alterTilesRatio = +dom.sAlterTiles.value || 0;
        dom.vAlterTiles.textContent = state.alterTilesRatio.toFixed(2);

        state.curveColors.length = 0; 
        state.curveColors.push('#444444');
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
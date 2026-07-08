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
    hash2D,
    isTileAlter,
    traceHexPath,
    traceHexPathBatch
} from './math.js';
import {
    processQueue,
    findUncoloredTileInHexes,
    edgeID,
    getBackgroundColorAt
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

export function setupExport() {
    dom.exportBtn.onclick = openExportOverlay;
    dom.closeExportBtn.onclick = closeExportOverlay;
    dom.exportBackdrop.onclick = closeExportOverlay;

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
        let valW = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) {
            let valH = valW / state.targetRatio;
            if (valH > cr.height) {
                valH = cr.height;
                valW = valH * state.targetRatio;
            }
            if (valW > cr.width) {
                valW = cr.width;
                valH = valW / state.targetRatio;
            }
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
            if (valW > cr.width) {
                valW = cr.width;
                valH = valW / state.targetRatio;
            }
            if (valH > cr.height) {
                valH = cr.height;
                valW = valH * state.targetRatio;
            }
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
    dom.exportImageBtn.onclick = () => {
        dom.exportImageBtn.classList.add('active');
        dom.exportEmbedBtn.classList.remove('active');
        dom.imageExportWrap.classList.add('visible');
        dom.embedCodeWrap.classList.remove('visible');
    };

    dom.fmtPdfBtn.onclick = async () => {
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
        const svgString = buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY);
        const parser = new DOMParser(),
            svgDoc = parser.parseFromString(svgString, "image/svg+xml"),
            svgElement = svgDoc.documentElement;
        const {
            jsPDF
        } = window.jspdf, orientation = eW > eH ? 'landscape' : 'portrait';
        const pdf = new jsPDF({
            orientation,
            unit: 'px',
            format: [eW, eH],
            compress: true
        });
        await pdf.svg(svgElement, {
            x: 0,
            y: 0,
            width: eW,
            height: eH
        });
        pdf.save('hex-tiles-export.pdf');
        toast('PDF exported (Vector)');
    };
    dom.fmtSvgBtn.onclick = () => {
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
        const svg = buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY);
        const blob = new Blob([svg], {
                type: 'image/svg+xml'
            }),
            url = URL.createObjectURL(blob),
            a = document.createElement('a');
        a.href = url;
        a.download = 'hex-tiles-export.svg';
        a.click();
        URL.revokeObjectURL(url);
        toast('SVG exported');
    };
    dom.fmtPngBtn.onclick = async () => {
        const cr = dom.cvs.getBoundingClientRect(),
            fx = state.efRect.x - cr.left,
            fy = state.efRect.y - cr.top;
        const targetLong = parseInt(dom.exportSide.value) || 1920,
            currentLong = Math.max(state.efRect.w, state.efRect.h),
            scale = targetLong / currentLong;
        const eW = Math.round(state.efRect.w * scale),
            eH = Math.round(state.efRect.h * scale);
        const off = document.createElement('canvas');
        renderToOffscreen(off, eW, eH, fx, fy, state.efRect.w, state.efRect.h);
        const blob = await canvasToBlob(off, 'image/png'),
            url = URL.createObjectURL(blob),
            a = document.createElement('a');
        a.href = url;
        a.download = 'hex-tiles-export.png';
        a.click();
        URL.revokeObjectURL(url);
        toast('PNG exported');
    };
    dom.exportEmbedBtn.onclick = () => {
        dom.exportImageBtn.classList.remove('active');
        dom.exportEmbedBtn.classList.add('active');
        dom.imageExportWrap.classList.remove('visible');
        dom.embedCodeWrap.classList.add('visible');
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
        const eMarkers = state.gradientMarkers.map(m => ({
            x: (m.x - fx) * scale,
            y: (m.y - fy) * scale,
            color: m.color
        }));
        const data = {
            w: eW,
            h: eH,
            zoom: eZoom,
            panX: ePanX,
            panY: ePanY,
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
            texTf: {
                ...state.texTf
            },
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
        dom.embedCode.value = `<iframe src="${baseUrl}#embed=${encoded}" width="${eW}" height="${eH}" frameborder="0" style="border:none;width:${eW}px;height:${eH}px;"></iframe>`;
        toast('Embed code generated');
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

    dom.exportW.addEventListener('input', () => {
        let val = parseInt(dom.exportW.value) || 50;
        if (state.aspectLocked) dom.exportH.value = Math.round(val / state.targetRatio);
    });
    dom.exportH.addEventListener('input', () => {
        let val = parseInt(dom.exportH.value) || 50;
        if (state.aspectLocked) dom.exportW.value = Math.round(val * state.targetRatio);
    });
    dom.exportW.addEventListener('change', () => {
        if (!state.aspectLocked) {
            const val = parseInt(dom.exportW.value) || 50,
                prev = parseFloat(dom.exportW.dataset.prev || val);
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
            const val = parseInt(dom.exportH.value) || 50,
                prev = parseFloat(dom.exportH.dataset.prev || val);
            if (prev > 0) {
                const ratio = val / prev;
                state.efRect.h *= ratio;
                clampFrameToCanvas();
                updateExportFrameDOM();
            }
            dom.exportH.dataset.prev = val;
        }
    });
}

function decodeHexKey(k) {
    const ku = k >>> 0,
        qu = ku >>> 16,
        ru = ku & 0xFFFF;
    const r = (ru & 0x8000) ? (ru | 0xFFFF0000) | 0 : ru;
    const qVal = (ru & 0x8000) ? ((qu ^ 0xFFFF) & 0xFFFF) : qu;
    const q = (qVal & 0x8000) ? (qVal | 0xFFFF0000) | 0 : qVal;
    return {
        q,
        r
    };
}

function serializeRotOverrides() {
    const out = [];
    for (const [k, rot] of state.rotOverrides.entries()) {
        const {
            q,
            r
        } = decodeHexKey(k);
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
    } catch (e) {
        return null;
    }
}

function openExportOverlay() {
    let safety = 10000;
    while (safety-- > 0 && state.queue.length > 0) processQueue();

    for (const [id, edgeData] of state.edgeRgbMap.entries()) {
        let targetCurveID = -1,
            targetRgb = null;
        if (state.curveColors.length === 1) {
            const c = state.curveColorsRGB[0];
            if (c) targetRgb = {
                r: c.tr !== undefined ? c.tr : c.r,
                g: c.tg !== undefined ? c.tg : c.g,
                b: c.tb !== undefined ? c.tb : c.b
            };
            targetCurveID = -2;
        } else if (state.curveMap.has(id)) {
            targetCurveID = state.curveMap.get(id);
            const curve = state.curves.get(targetCurveID);
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
        document.body.classList.add('sidebar-collapsed');
        document.querySelector('.sidebar').classList.add('collapsed');
        document.getElementById('sidebarToggle').classList.add('collapsed');
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

function buildExportSVG(fx, fy, scale, eW, eH, eZoom, ePanX, ePanY) {
    const now = state.exportFreezeTime || Date.now();
    const exportHexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);
    let exportBounds = {
        minQ: Infinity,
        maxQ: -Infinity,
        minR: Infinity,
        maxR: -Infinity
    };
    for (const h of exportHexes) {
        if (h.q < exportBounds.minQ) exportBounds.minQ = h.q;
        if (h.q > exportBounds.maxQ) exportBounds.maxQ = h.q;
        if (h.r < exportBounds.minR) exportBounds.minR = h.r;
        if (h.r > exportBounds.maxR) exportBounds.maxR = h.r;
    }

    const origSz = HEX_R * state.zoom;
    let eCurveAlpha = 1.0,
        eGridAlpha = 1.0;
    const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT,
        fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
    if (origSz <= fadeEndSz + 0.5) {
        eCurveAlpha = 0;
        eGridAlpha = 0;
    } else if (origSz < fadeStartSz) {
        let t = (origSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
        eCurveAlpha = t * t * (3 - 2 * t);
        eGridAlpha = eCurveAlpha;
    }

    if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
        let safety = 2000;
        while (safety-- > 0) {
            processQueue(exportBounds, false);
            if (state.queue.length === 0) {
                if (!findUncoloredTileInHexes(exportHexes)) break;
            }
        }
    }

    let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${eW}" height="${eH}" viewBox="0 0 ${eW} ${eH}"><rect width="${eW}" height="${eH}" fill="${COLORS.bg}"/>`;

    if (state.gradientMarkersRGB.length > 0) {
        updateIDWGradientCanvas(eW, eH, scale, fx, fy, 0.5);
        const gradUrl = state.gradientCanvas.toDataURL('image/png');
        svg += `<image xlink:href="${gradUrl}" width="${eW}" height="${eH}" preserveAspectRatio="none"/>`;
    }

    if (state.showBgStars) {
        const expStarPanX5 = (state.starPanX5 - fx) * scale,
            expStarPanY5 = (state.starPanY5 - fy) * scale;
        const expStarPanX2 = (state.starPanX2 - fx) * scale,
            expStarPanY2 = (state.starPanY2 - fy) * scale;
        const expStarPanX3 = (state.starPanX3 - fx) * scale,
            expStarPanY3 = (state.starPanY3 - fy) * scale;
        const spacing5 = CONFIG.STAR_SPACING_LARGE * state.starZoom5 * scale,
            spacing2 = CONFIG.STAR_SPACING_MED * state.starZoom2 * scale,
            spacing3 = CONFIG.STAR_SPACING_SMALL * state.starZoom3 * scale;

        function addStars(spacing, size, seed, panX, panY, eW, eH, coordScale, now, allowBlazing, alphaMult, zoomOutTime, offsetX, offsetY, blazeFade = 1.0) {
            if (spacing < CONFIG.STAR_MIN_SPACING) return;
            const kMin = Math.floor((0 - panX) / spacing) - 2,
                kMax = Math.ceil((eW - panX) / spacing) + 2;
            const jMin = Math.floor((0 - panY) / spacing) - 2,
                jMax = Math.ceil((eH - panY) / spacing) + 2;
            for (let k = kMin; k <= kMax; k++) {
                for (let j = jMin; j <= jMax; j++) {
                    const gx = panX + k * spacing,
                        gy = panY + j * spacing;
                    const rx = (hash2D(k * seed + 123, j * seed + 456) - 0.5) * spacing,
                        ry = (hash2D(k * seed + 789, j * seed + 101) - 0.5) * spacing;
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
                        const cycleDuration = CONFIG.STAR_BLAZE_MIN_INTERVAL + hash2D(k * seed + 555, j * seed + 999) * CONFIG.STAR_BLAZE_MAX_INTERVAL_ADD;
                        const offset = hash2D(k * seed + 111, j * seed + 222) * cycleDuration,
                            phase = (now + offset) % cycleDuration;
                        const blazeDuration = 1200 + hash2D(k * seed + 333, j * seed + 444) * 1800;
                        if (phase < blazeDuration) {
                            let blazeT = phase / blazeDuration,
                                blazeGlow = 0,
                                origSR = sR,
                                origSA = sA,
                                origR = r;
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
                                    const stepT = s / steps,
                                        stepR = glowRadius * stepT,
                                        stepA = (0.05 * blazeGlow) * Math.pow(1 - stepT, 1.5);
                                    svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(150, 200, 255)" fill-opacity="${stepA.toFixed(3)}"/>`;
                                }
                                const steps2 = 45;
                                for (let s = steps2; s > 0; s--) {
                                    const stepT = s / steps2,
                                        stepR = glowRadius * 0.5 * stepT,
                                        stepA = (0.1 * blazeGlow) * Math.pow(1 - stepT, 1.5);
                                    svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${stepR.toFixed(2)}" fill="rgb(255, 255, 240)" fill-opacity="${stepA.toFixed(3)}"/>`;
                                }
                            }
                        }
                    }
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
    if (eCurveAlpha > 0) {
        for (const h of exportHexes) {
            const rot = tileRot(h.q, h.r),
                k = (rot / 60) % 6,
                alter = isTileAlter(h.q, h.r);
            const rad = rot * Math.PI / 180.0,
                cos = Math.cos(rad),
                sin = Math.sin(rad);
            if (state.texImg) continue;
            const a = eSz * SQRT3 / 2;
            if (alter) {
                let c = getSvgEdgeColor(h.q, h.r, (0 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, eSz / 2, a, eSz / 2, Math.PI - ext, 5 * PI_DIV_3 + ext, false));
                }
                c = getSvgEdgeColor(h.q, h.r, (2 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, -eSz, 0, eSz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false));
                }
                c = getSvgEdgeColor(h.q, h.r, (4 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, eSz / 2, -a, eSz / 2, PI_DIV_3 - ext, Math.PI + ext, false));
                }
            } else {
                let c = getSvgEdgeColor(h.q, h.r, (2 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, -eSz, 0, eSz / 2, -PI_DIV_3 - ext, PI_DIV_3 + ext, false));
                }
                c = getSvgEdgeColor(h.q, h.r, (4 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, 1.5 * eSz, -a, 1.5 * eSz, TWO_PI_DIV_3 - ext, Math.PI + ext, false));
                }
                c = getSvgEdgeColor(h.q, h.r, (1 + k) % 6);
                if (c) {
                    pathsByColor[c] = pathsByColor[c] || [];
                    pathsByColor[c].push(arcToPath(h.x, h.y, rot, 1.5 * eSz, a, 1.5 * eSz, Math.PI - ext, FOUR_PI_DIV_3 + ext, false));
                }
            }
            if (state.showGrid) {
                let hexPath = "M ";
                for (let i = 0; i < 6; i++) {
                    const ang = PI_DIV_3 * i,
                        vx = eSz * Math.cos(ang),
                        vy = eSz * Math.sin(ang),
                        tx_v = h.x + vx * cos - vy * sin,
                        ty_v = h.y + vx * sin + vy * cos;
                    hexPath += `${tx_v.toFixed(2)} ${ty_v.toFixed(2)} `;
                    if (i < 5) hexPath += "L ";
                }
                hexPath += "Z ";
                gridPaths.push(hexPath);
            }
        }
    }
    const lw = (eSz / 3 * state.curveLineWidth).toFixed(2);
    for (const color in pathsByColor) svg += `<path d="${pathsByColor[color].join(' ')}" stroke="${color}" stroke-width="${lw}" fill="none" stroke-linecap="butt"/>`;
    if (state.showGrid && eGridAlpha > 0 && gridPaths.length > 0) svg += `<path d="${gridPaths.join(' ')}" stroke="${COLORS.gridLine}" stroke-width="1" fill="none" stroke-opacity="${eGridAlpha.toFixed(3)}"/>`;
    svg += `</svg>`;
    return svg;
}

function renderToOffscreen(offCanvas, eW, eH, fx, fy, fw, fh) {
    offCanvas.width = eW;
    offCanvas.height = eH;
    const offCtx = offCanvas.getContext('2d');
    const scale = eW / fw,
        eZoom = state.zoom * scale,
        ePanX = (state.panX - fx) * scale,
        ePanY = (state.panY - fy) * scale;
    const origSz = HEX_R * state.zoom;
    let eCurveAlpha = 1.0,
        eGridAlpha = 1.0;
    const fadeStartSz = HEX_R * CONFIG.ZOOM_FADE_START_MULT,
        fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
    if (origSz <= fadeEndSz + 0.5) {
        eCurveAlpha = 0;
        eGridAlpha = 0;
    } else if (origSz < fadeStartSz) {
        let t = (origSz - fadeEndSz) / (fadeStartSz - fadeEndSz);
        eCurveAlpha = t * t * (3 - 2 * t);
        eGridAlpha = eCurveAlpha;
    }

    const hexes = visibleHexes(eZoom, ePanX, ePanY, eW, eH);
    const centerHex = pixToHex(eW / 2, eH / 2, eZoom, ePanX, ePanY);
    hexes.sort((a, b) => hexDistance(a.q, a.r, centerHex.q, centerHex.r) - hexDistance(b.q, b.r, centerHex.q, centerHex.r));
    let exportBounds = {
        minQ: Infinity,
        maxQ: -Infinity,
        minR: Infinity,
        maxR: -Infinity
    };
    for (const h of hexes) {
        if (h.q < exportBounds.minQ) exportBounds.minQ = h.q;
        if (h.q > exportBounds.maxQ) exportBounds.maxQ = h.q;
        if (h.r < exportBounds.minR) exportBounds.minR = h.r;
        if (h.r > exportBounds.maxR) exportBounds.maxR = h.r;
    }

    if (state.curveColors.length >= 1 && eCurveAlpha > 0) {
        let safety = 2000;
        while (safety-- > 0) {
            processQueue(exportBounds, false);
            if (state.queue.length === 0) {
                if (!findUncoloredTileInHexes(hexes)) break;
            }
        }
    }

    const oldCtx = state.ctx;
    state.ctx = offCtx;
    const now = state.exportFreezeTime || Date.now();
    offCtx.fillStyle = COLORS.bg;
    offCtx.fillRect(0, 0, eW, eH);
    drawIDWGradient(eW, eH, scale, fx, fy); // Need to import drawIDWGradient
    const expStarPanX5 = (state.starPanX5 - fx) * scale,
        expStarPanY5 = (state.starPanY5 - fy) * scale;
    const expStarPanX2 = (state.starPanX2 - fx) * scale,
        expStarPanY2 = (state.starPanY2 - fy) * scale;
    const expStarPanX3 = (state.starPanX3 - fx) * scale,
        expStarPanY3 = (state.starPanY3 - fy) * scale;
    drawBackgroundStars(eW, eH, scale, expStarPanX5, expStarPanY5, expStarPanX2, expStarPanY2, expStarPanX3, expStarPanY3, now, eZoom / scale, state.zoomOutStartTime, fx, fy); // Need to import

    const eSz = HEX_R * eZoom;
    for (const h of hexes) {
        const rot = tileRot(h.q, h.r);
        drawTile(h.x, h.y, eSz, rot, false, state.texImg, state.texTf, h.q, h.r, now, eCurveAlpha, 0.0);
    } // Need to import drawTile
    if (state.showGrid && eGridAlpha > 0.01) {
        traceHexPathBatch(state.ctx, hexes, eSz);
        state.ctx.globalAlpha = eGridAlpha;
        state.ctx.strokeStyle = COLORS.gridLine;
        state.ctx.lineWidth = 1;
        state.ctx.stroke();
        state.ctx.globalAlpha = 1.0;
    }
    state.ctx = oldCtx;
    return offCanvas;
}

function canvasToBlob(canvas, type) {
    return new Promise(resolve => canvas.toBlob(resolve, type));
}
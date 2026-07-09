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
    toast,
    renderGradientList,
    renderCurveList
} from './ui.js';
import {
    hexToPix,
    pixToHex,
    hexDistance,
    hexKey,
    tileRot,
    displayRot,
    traceHexPath,
    visibleHexes,
    baseRot,
    nearestTarget,
    isTileAlter
} from './math.js';
import {
    initializeCentralTile,
    updateLocalCurves,
    edgeID,
    getVisibleBounds
} from './curves.js';
import {
    generateDistinctThemePool
} from './utils.js';
import {
    requestRender,
    checkIfSolved,
    resize
} from './render.js';
import {
    closeExportOverlay
} from './export.js';

const HEX_R = CONFIG.HEX_R;
const MIN_Z = CONFIG.MIN_ZOOM;
const MAX_Z = CONFIG.MAX_ZOOM;
const CLICK_THRESH = CONFIG.CLICK_THRESH;
const CLICK_DUR = CONFIG.CLICK_DUR;
const BULK_DUR = CONFIG.BULK_DUR;
const ROT_STEP = CONFIG.ROT_STEP;
const DEG2RAD = CONFIG.DEG2RAD;
const PI_DIV_3 = CONFIG.PI_DIV_3;

export function getRandomMarkerPosition() {
    const isCollapsed = document.body.classList.contains('sidebar-collapsed');
    const sidebarHidden = isCollapsed || state.isEmbedMode;
    const W = sidebarHidden ? dom.cvs.width : Math.max(0, dom.cvs.width - CONFIG.SIDEBAR_WIDTH);
    const H = dom.cvs.height;
    const minX = W * 0.1,
        maxX = W * 0.9,
        minY = H * 0.1,
        maxY = H * 0.9;
    let bestX = minX + Math.random() * (maxX - minX),
        bestY = minY + Math.random() * (maxY - minY);
    if (state.gradientMarkers.length > 0) {
        let maxMinDist = -1;
        for (let i = 0; i < 100; i++) {
            const cx = minX + Math.random() * (maxX - minX),
                cy = minY + Math.random() * (maxY - minY);
            let minDist = Infinity;
            for (const m of state.gradientMarkers) {
                const dx = cx - m.x,
                    dy = cy - m.y,
                    dist = dx * dx + dy * dy;
                if (dist < minDist) minDist = dist;
            }
            if (minDist > maxMinDist) {
                maxMinDist = minDist;
                bestX = cx;
                bestY = cy;
            }
        }
    }
    return {
        x: bestX,
        y: bestY
    };
}

export function setZoom(nz, cx, cy) {
    const oz = state.zoom,
        oPanX = state.panX,
        oPanY = state.panY;
    state.zoom = Math.max(MIN_Z, Math.min(MAX_Z, nz));
    if (cx !== undefined) {
        state.panX = cx - (cx - oPanX) * (state.zoom / oz);
        state.panY = cy - (cy - oPanY) * (state.zoom / oz);
        if (state.zoom !== oz) {
            const odz5 = state.starZoom5,
                odz2 = state.starZoom2,
                odz3 = state.starZoom3;
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
            const dx = state.mouseScreenX - state.dragSX,
                dy = state.mouseScreenY - state.dragSY;
            state.dragPX = state.panX - dx;
            state.dragPY = state.panY - dy;
        }
    }
    dom.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
}

export function scheduleMagnetZoom() {
    clearTimeout(state.magnetTimer);
    state.magnetTimer = setTimeout(() => {
        if (state.isDrag || state.touchState.mode === 'pinch') {
            scheduleMagnetZoom();
            return;
        }
        if (state.targetZoom < 0.27 && state.targetZoom > CONFIG.MIN_ZOOM) {
            if (state.targetZoom < 0.22) state.targetZoom = 0.20;
            else state.targetZoom = 0.25;
            requestRender();
        }
    }, CONFIG.MAGNET_DELAY);
}

export function rotateTile(q, r) {
    const k = hexKey(q, r),
        now = Date.now();
    state.lastRipple = {
        q,
        r,
        time: now
    };
    const curDisplay = displayRot(q, r, now),
        curLogical = tileRot(q, r),
        nextLogical = (curLogical + ROT_STEP) % 360;
    state.rotOverrides.set(k, nextLogical);
    state.animMap.set(k, {
        start: now,
        from: curDisplay,
        to: nearestTarget(curDisplay, nextLogical),
        duration: CLICK_DUR
    });

    const visZoom = (state.isEmbedMode && state.embedData && state.embedData.origZoom) ? state.embedData.origZoom : state.zoom;
    const visSz = HEX_R * visZoom,
        fadeEndSz = HEX_R * CONFIG.ZOOM_FADE_END_MULT;
    if (visSz > fadeEndSz) {
        if (state.curveColors.length > 1) updateLocalCurves(q, r);
    } else {
        state.queue.length = 0;
        state.curveMap.clear();
        state.curves.clear();
        state.edgeRgbMap.clear();
    }
    checkIfSolved();
    requestRender();
}

export function setupEvents() {
    dom.fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => toast('Fullscreen mode not allowed'));
        else if (document.exitFullscreen) document.exitFullscreen();
    });

    let wasSidebarOpenBeforeFullscreen = false;
    document.addEventListener('fullscreenchange', () => {
        const icon = dom.fullscreenBtn.querySelector('i');
        if (document.fullscreenElement) {
            icon.classList.remove('fa-expand');
            icon.classList.add('fa-compress');
            wasSidebarOpenBeforeFullscreen = !dom.sidebar.classList.contains('collapsed');
            if (wasSidebarOpenBeforeFullscreen) {
                dom.sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                dom.sidebarToggle.classList.add('collapsed');
            }
            setTimeout(resetIdleTimer, 400);
        } else {
            icon.classList.remove('fa-compress');
            icon.classList.add('fa-expand');
            if (wasSidebarOpenBeforeFullscreen) {
                dom.sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                dom.sidebarToggle.classList.remove('collapsed');
            }
            clearTimeout(state.idleTimer);
            exitIdleState();
            document.body.classList.remove('fullscreen-idle');
        }
        resize();
        requestRender();
    });

    // Fullscreen Idle Listeners
    ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (document.fullscreenElement) resetIdleTimer();
        }, {
            passive: true
        });
    });

    dom.sidebarToggle.addEventListener('click', () => {
        dom.sidebar.classList.toggle('collapsed');
        dom.sidebarToggle.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed');
    });

    if (typeof ResizeObserver !== 'undefined' && !state.isEmbedMode) {
        const ro = new ResizeObserver(() => {
            resize();
            requestRender();
        });
        ro.observe(dom.wrap);
    } else if (!state.isEmbedMode) window.addEventListener('resize', resize);

    let sbTouchStartX = null,
        sbTouchStartY = null,
        sbDragging = false;
    dom.sidebar.addEventListener('touchstart', e => {
        if (dom.sidebar.classList.contains('collapsed')) return;
        const targetTag = e.target.tagName;
        if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'BUTTON' || targetTag === 'SELECT') {
            sbTouchStartX = null;
            return;
        }
        sbTouchStartX = e.touches[0].clientX;
        sbTouchStartY = e.touches[0].clientY;
        sbDragging = false;
        dom.sidebar.style.transition = 'none';
    }, {
        passive: true
    });
    dom.sidebar.addEventListener('touchmove', e => {
        if (sbTouchStartX === null) return;
        const dx = e.touches[0].clientX - sbTouchStartX,
            dy = e.touches[0].clientY - sbTouchStartY;
        if (!sbDragging) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) sbDragging = true;
            else if (Math.abs(dy) > 10) {
                sbTouchStartX = null;
                return;
            }
        }
        if (sbDragging) {
            e.preventDefault();
            dom.sidebar.style.transform = dx > 0 ? `translateX(${dx}px)` : `translateX(0px)`;
        }
    }, {
        passive: false
    });
    dom.sidebar.addEventListener('touchend', e => {
        if (sbTouchStartX === null) return;
        const dx = e.changedTouches[0].clientX - sbTouchStartX;
        dom.sidebar.style.transition = '';
        if (sbDragging && dx > 80) {
            dom.sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            dom.sidebarToggle.classList.add('collapsed');
            dom.sidebar.style.transform = 'translateX(calc(100% + 10px))';
            setTimeout(() => {
                dom.sidebar.style.transform = '';
            }, 300);
        } else dom.sidebar.style.transform = '';
        sbTouchStartX = null;
        sbDragging = false;
    });

    let sbToggleDragging = false,
        sbToggleStartX = 0,
        sbToggleCurrentX = 0;
    dom.sidebarToggle.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        sbToggleDragging = true;
        sbToggleStartX = e.touches[0].clientX;
        sbToggleCurrentX = e.touches[0].clientX;
        dom.sidebar.style.transition = 'none';
        dom.sidebarToggle.style.transition = 'none';
        e.preventDefault();
    }, {
        passive: false
    });
    dom.sidebarToggle.addEventListener('touchmove', e => {
        if (!sbToggleDragging) return;
        sbToggleCurrentX = e.touches[0].clientX;
        let dx = sbToggleCurrentX - sbToggleStartX;
        let isCollapsed = dom.sidebar.classList.contains('collapsed');
        if (isCollapsed) {
            if (dx < 0) {
                let moveX = Math.max(dx, -CONFIG.SIDEBAR_WIDTH);
                dom.sidebar.style.transform = `translateX(calc(100% + 10px + ${moveX}px))`;
                dom.sidebarToggle.style.transform = `translateX(${moveX}px)`;
            }
        } else {
            if (dx > 0) {
                let moveX = Math.min(dx, CONFIG.SIDEBAR_WIDTH);
                dom.sidebar.style.transform = `translateX(${moveX}px)`;
                dom.sidebarToggle.style.transform = `translateX(calc(50% + ${moveX}px))`;
            }
        }
        e.preventDefault();
    }, {
        passive: false
    });
    dom.sidebarToggle.addEventListener('touchend', e => {
        if (!sbToggleDragging) return;
        sbToggleDragging = false;
        let dx = sbToggleCurrentX - sbToggleStartX;
        let isCollapsed = dom.sidebar.classList.contains('collapsed');
        dom.sidebar.style.transition = '';
        dom.sidebarToggle.style.transition = '';
        if (Math.abs(dx) < 10) {
            if (isCollapsed) {
                dom.sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                dom.sidebarToggle.classList.remove('collapsed');
            } else {
                dom.sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                dom.sidebarToggle.classList.add('collapsed');
            }
            dom.sidebar.style.transform = '';
            dom.sidebarToggle.style.transform = '';
        } else if (isCollapsed) {
            if (dx < -80) {
                dom.sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
                dom.sidebarToggle.classList.remove('collapsed');
                dom.sidebar.style.transform = '';
                dom.sidebarToggle.style.transform = '';
            } else {
                dom.sidebar.style.transform = 'translateX(calc(100% + 10px))';
                dom.sidebarToggle.style.transform = 'translateX(0)';
                setTimeout(() => {
                    dom.sidebar.style.transform = '';
                    dom.sidebarToggle.style.transform = '';
                }, 300);
            }
        } else {
            if (dx > 80) {
                dom.sidebar.classList.add('collapsed');
                document.body.classList.add('sidebar-collapsed');
                dom.sidebarToggle.classList.add('collapsed');
                dom.sidebar.style.transform = 'translateX(calc(100% + 10px))';
                dom.sidebarToggle.style.transform = 'translateX(0)';
                setTimeout(() => {
                    dom.sidebar.style.transform = '';
                    dom.sidebarToggle.style.transform = '';
                }, 300);
            } else {
                dom.sidebar.style.transform = '';
                dom.sidebarToggle.style.transform = '';
            }
        }
        e.preventDefault();
    });

    dom.cvs.addEventListener('touchstart', e => {
        state.isTouchDevice = true;
        state.hoveredQ = null;
        state.hoveredR = null;
        state.visHoverX = null;
        state.visHoverY = null;
        if (!state.isEmbedMode && !dom.sidebar.classList.contains('collapsed')) {
            dom.sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            dom.sidebarToggle.classList.add('collapsed');
        }
        if (e.touches.length === 1) {
            const r = dom.cvs.getBoundingClientRect(),
                tx = e.touches[0].clientX - r.left,
                ty = e.touches[0].clientY - r.top;
            if (!state.isEmbedMode && state.markersVisible) {
                let clickedMarkerIdx = -1;
                for (let i = 0; i < state.gradientMarkers.length; i++) {
                    const m = state.gradientMarkers[i],
                        dx = tx - m.x,
                        dy = ty - m.y;
                    if (dx * dx + dy * dy < CONFIG.MARKER_HIT_RADIUS * CONFIG.MARKER_HIT_RADIUS) {
                        clickedMarkerIdx = i;
                        break;
                    }
                }
                if (clickedMarkerIdx !== -1) {
                    state.touchState.mode = 'marker_wait';
                    state.touchState.markerIdx = clickedMarkerIdx;
                    state.touchState.startX = tx;
                    state.touchState.startY = ty;
                    state.touchState.startTime = Date.now();
                    state.touchState.timer = setTimeout(() => {
                        if (state.touchState.mode === 'marker_wait') {
                            state.touchState.mode = 'marker_drag';
                            state.isDragMarker = true;
                            state.draggedMarkerIndex = state.touchState.markerIdx;
                            state.dragMarkerOffsetX = state.touchState.startX - state.gradientMarkers[state.touchState.markerIdx].x;
                            state.dragMarkerOffsetY = state.touchState.startY - state.gradientMarkers[state.touchState.markerIdx].y;
                            state.targetInteractionFade = 0.0;
                            if (navigator.vibrate) navigator.vibrate(CONFIG.HAPTIC_DUR);
                            requestRender();
                        }
                    }, CONFIG.LONG_PRESS_DUR);
                    e.preventDefault();
                    requestRender();
                    return;
                }
            }
            state.touchState.mode = 'pan_wait';
            state.touchState.startX = tx;
            state.touchState.startY = ty;
            state.touchState.startPanX = state.panX;
            state.touchState.startPanY = state.panY;
            state.touchState.startTime = Date.now();
            state.isDrag = false;
            state.dragMoved = false;
            state.dragSX = tx;
            state.dragSY = ty;
            state.embedDragLastTile = null;
            state.panVX = 0;
            state.panVY = 0;
            state.touchState.timer = setTimeout(() => {
                if (state.touchState.mode === 'pan_wait' && !state.dragMoved) {
                    state.touchState.mode = 'draw';
                    state.isDrag = false;
                    if (navigator.vibrate) navigator.vibrate(CONFIG.HAPTIC_DUR);
                    const h = pixToHex(state.touchState.startX, state.touchState.startY, state.zoom, state.panX, state.panY),
                        hk = hexKey(h.q, h.r);
                    if (hk !== state.embedDragLastTile) {
                        state.embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                    requestRender();
                }
            }, CONFIG.LONG_PRESS_DUR);
        } else if (e.touches.length === 2) {
            if (state.touchState.mode === 'marker_wait' || state.touchState.mode === 'pan_wait') clearTimeout(state.touchState.timer);
            state.targetInteractionFade = 1.0;
            if (state.touchState.mode === 'marker_drag') {
                state.isDragMarker = false;
                state.draggedMarkerIndex = -1;
            }
            state.touchState.mode = 'pinch';
            state.isDrag = false;
            state.panVX = 0;
            state.panVY = 0;
            const dx = e.touches[0].clientX - e.touches[1].clientX,
                dy = e.touches[0].clientY - e.touches[1].clientY;
            state.touchState.startDist = Math.hypot(dx, dy);
            state.touchState.startZoom = state.targetZoom;
            const r = dom.cvs.getBoundingClientRect();
            state.touchState.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            state.touchState.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
            state.zoomCx = state.touchState.pinchCenterX;
            state.zoomCy = state.touchState.pinchCenterY;
            state.zoomOutBlockedUntil = 0;
        }
        e.preventDefault();
    }, {
        passive: false
    });

    window.addEventListener('touchmove', e => {
        if (state.touchState.mode === 'none') return;
        const r = dom.cvs.getBoundingClientRect();
        if (state.touchState.mode === 'marker_drag' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left,
                ty = e.touches[0].clientY - r.top;
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
        } else if (state.touchState.mode === 'marker_wait' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left,
                ty = e.touches[0].clientY - r.top,
                dx = tx - state.touchState.startX,
                dy = ty - state.touchState.startY;
            if (Math.abs(dx) > CLICK_THRESH || Math.abs(dy) > CLICK_THRESH) {
                clearTimeout(state.touchState.timer);
                state.touchState.mode = 'cancelled';
            }
            e.preventDefault();
            return;
        } else if (state.touchState.mode === 'draw' && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left,
                ty = e.touches[0].clientY - r.top,
                h = pixToHex(tx, ty, state.zoom, state.panX, state.panY),
                hk = hexKey(h.q, h.r);
            if (hk !== state.embedDragLastTile) {
                state.embedDragLastTile = hk;
                rotateTile(h.q, h.r);
            }
            requestRender();
            e.preventDefault();
            return;
        } else if ((state.touchState.mode === 'pan' || state.touchState.mode === 'pan_wait') && e.touches.length === 1) {
            const tx = e.touches[0].clientX - r.left,
                ty = e.touches[0].clientY - r.top,
                dx = tx - state.touchState.startX,
                dy = ty - state.touchState.startY;
            if (Math.abs(dx) + Math.abs(dy) > CLICK_THRESH) {
                if (!state.dragMoved) state.dragMoved = true;
            }
            if (state.dragMoved && state.touchState.mode === 'pan_wait') {
                clearTimeout(state.touchState.timer);
                state.touchState.mode = 'pan';
                state.isDrag = true;
            }
            if (state.touchState.mode === 'pan') {
                let targetPanX = state.touchState.startPanX + dx,
                    targetPanY = state.touchState.startPanY + dy;
                const dPanX = targetPanX - state.panX,
                    dPanY = targetPanY - state.panY;
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
        } else if (state.touchState.mode === 'pinch' && e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX,
                dy = e.touches[0].clientY - e.touches[1].clientY,
                newDist = Math.hypot(dx, dy);
            let scale = newDist / Math.max(1, state.touchState.startDist),
                newTargetZoom = state.touchState.startZoom * scale;
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
    }, {
        passive: false
    });

    window.addEventListener('touchend', e => {
        if (state.touchState.mode === 'none') return;
        let wasMode = state.touchState.mode;
        if (wasMode === 'marker_wait') {
            clearTimeout(state.touchState.timer);
            const now = Date.now();
            if (now - state.lastTapTime < 300) {
                removeMarkerAt(state.touchState.startX, state.touchState.startY);
                state.lastTapTime = 0;
            } else state.lastTapTime = now;
        } else if (wasMode === 'marker_drag') {
            state.isDragMarker = false;
            state.draggedMarkerIndex = -1;
            state.targetInteractionFade = 1.0;
        } else if (wasMode === 'pan_wait') {
            clearTimeout(state.touchState.timer);
            const h = pixToHex(state.touchState.startX, state.touchState.startY, state.zoom, state.panX, state.panY);
            rotateTile(h.q, h.r);
            state.touchOutlines.push({
                q: h.q,
                r: h.r,
                alpha: 1.0
            });
        } else if (wasMode === 'pan') {
            if (state.dragMoved) checkIfSolved();
        } else if (wasMode === 'draw') {
            state.panVX = 0;
            state.panVY = 0;
        }
        if (e.touches.length === 0) {
            state.touchState.mode = 'none';
            state.isDrag = false;
            if (wasMode !== 'pan') {
                state.panVX = 0;
                state.panVY = 0;
            }
        } else if (wasMode === 'pinch' && e.touches.length === 1) {
            state.touchState.mode = 'none';
            state.isDrag = false;
            state.panVX = 0;
            state.panVY = 0;
        }
        requestRender();
        e.preventDefault();
    }, {
        passive: false
    });

    dom.cvs.addEventListener('wheel', e => {
        if (state.isEmbedMode) return;
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
            if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) delta = 1 + (delta - 1) * CONFIG.WHEEL_SLOW_MULT;
        } else {
            if (state.targetZoom * delta >= CONFIG.ZOOM_FADE_HIGH) state.zoomOutBlockedUntil = 0;
        }
        state.targetZoom *= delta;
        state.targetZoom = Math.max(MIN_Z, Math.min(MAX_Z, state.targetZoom));
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    }, {
        passive: false
    });

    dom.cvs.addEventListener('mouseleave', () => {
        state.hoveredQ = null;
        state.hoveredR = null;
        state.visHoverX = null;
        state.visHoverY = null;
    });

    dom.cvs.addEventListener('mousedown', e => {
        const r = dom.cvs.getBoundingClientRect(),
            mx = e.clientX - r.left,
            my = e.clientY - r.top;
        if (state.isEmbedMode) {
            state.isDrag = true;
            state.dragMoved = false;
            state.dragSX = mx;
            state.dragSY = my;
            state.embedDragLastTile = null;
            return;
        }
        if (state.markersVisible) {
            let clickedMarkerIdx = -1;
            for (let i = 0; i < state.gradientMarkers.length; i++) {
                const m = state.gradientMarkers[i],
                    dx = mx - m.x,
                    dy = my - m.y;
                if (dx * dx + dy * dy < CONFIG.MARKER_HIT_RADIUS * CONFIG.MARKER_HIT_RADIUS) {
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
        const r = dom.cvs.getBoundingClientRect(),
            mx = e.clientX - r.left,
            my = e.clientY - r.top;
        if (state.isDragMarker && state.draggedMarkerIndex !== -1) {
            state.gradientMarkers[state.draggedMarkerIndex].x = mx - state.dragMarkerOffsetX;
            state.gradientMarkers[state.draggedMarkerIndex].y = my - state.dragMarkerOffsetY;
            if (state.gradientMarkersRGB[state.draggedMarkerIndex]) {
                state.gradientMarkersRGB[state.draggedMarkerIndex].x = state.gradientMarkers[state.draggedMarkerIndex].x;
                state.gradientMarkersRGB[state.draggedMarkerIndex].y = state.gradientMarkers[state.draggedMarkerIndex].y;
            }
            state.isGradientDirty = true;
            state.targetInteractionFade = 0.0;
            requestRender();
            return;
        }
        state.mouseScreenX = mx;
        state.mouseScreenY = my;
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const sidebarHidden = isCollapsed || state.isEmbedMode;
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
            const dx = mx - state.dragSX,
                dy = my - state.dragSY;
            if (Math.abs(dx) + Math.abs(dy) > CLICK_THRESH) {
                if (!state.dragMoved) state.dragMoved = true;
            }
            if (state.isEmbedMode) {
                if (state.dragMoved) {
                    const hk = hexKey(h.q, h.r);
                    if (hk !== state.embedDragLastTile) {
                        state.embedDragLastTile = hk;
                        rotateTile(h.q, h.r);
                    }
                }
            } else {
                let targetPanX = state.dragPX + dx,
                    targetPanY = state.dragPY + dy;
                const dPanX = targetPanX - state.panX,
                    dPanY = targetPanY - state.panY;
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
            state.targetInteractionFade = 1.0;
            requestRender();
            return;
        }
        if (state.isDrag) {
            if (!state.dragMoved) handleClick(e);
            else checkIfSolved();
            state.isDrag = false;
            state.targetInteractionFade = 1.0;
        }
        requestRender();
    });

    dom.cvs.addEventListener('dblclick', e => {
        if (state.isEmbedMode) return;
        const r = dom.cvs.getBoundingClientRect(),
            mx = e.clientX - r.left,
            my = e.clientY - r.top;
        let clickedMarkerIdx = -1;
        for (let i = 0; i < state.gradientMarkers.length; i++) {
            const m = state.gradientMarkers[i],
                dx = mx - m.x,
                dy = my - m.y;
            if (dx * dx + dy * dy < CONFIG.MARKER_HIT_RADIUS * CONFIG.MARKER_HIT_RADIUS) {
                clickedMarkerIdx = i;
                break;
            }
        }
        if (clickedMarkerIdx !== -1) removeMarkerAt(mx, my);
    });

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
        if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
        state.targetZoom = Math.max(MIN_Z, state.targetZoom * delta);
        checkIfSolved();
        scheduleMagnetZoom();
        requestRender();
    };

    window.addEventListener('keydown', e => {
        if (state.isEmbedMode) return;
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
            if (state.targetZoom < CONFIG.ZOOM_FADE_HIGH) delta = 1 + (delta - 1) * CONFIG.BTN_SLOW_MULT;
            state.targetZoom = Math.max(MIN_Z, state.targetZoom * delta);
            checkIfSolved();
            scheduleMagnetZoom();
        }
        requestRender();
    });

    dom.gridToggle.addEventListener('change', function() {
        state.showGrid = this.checked;
        requestRender();
    });
    dom.bgStarsToggle.addEventListener('change', function() {
        state.showBgStars = this.checked;
        requestRender();
    });
    dom.markersToggle.addEventListener('change', function() {
        state.markersVisible = this.checked;
        requestRender();
    });
    dom.flowToggle.addEventListener('change', function() {
        state.flowEnabled = this.checked;
        
        if (!state.isEmbedMode) {
            if (!state.flowEnabled && state.inertiaEnabled) {
                state.panVX += state.currentFlowVX;
                state.panVY += state.currentFlowVY;
            } else if (state.flowEnabled) {
                state.panVX = 0;
                state.panVY = 0;
            }
        }
        
        requestRender();
    });
    dom.liveTwistsToggle.addEventListener('change', function() {
        state.liveTwistsEnabled = this.checked;
        if (state.liveTwistsEnabled) scheduleLiveTwist();
        else clearTimeout(state.liveTwistsTimer);
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

    dom.randAnglesBtn.onclick = () => {
        bulkAnimate('hash', (state.rotSeed + 1) & 0x7FFFFFFF);
        toast('Angles randomized');
    };
    dom.randLineColorsBtn.onclick = () => {
        if (state.curveColors.length === 0) return;
        state.curveColorPool = generateDistinctThemePool();
        for (let i = 0; i < state.curveColors.length; i++) state.curveColors[i] = state.curveColorPool.pool[i] || state.curveColors[i];
        state.updateCurveColorsCache();
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
            state.updateGradientMarkersCache();
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
    dom.uploadZone.ondragleave = () => {
        dom.uploadZone.style.borderColor = '';
    };
    dom.uploadZone.ondrop = e => {
        e.preventDefault();
        dom.uploadZone.style.borderColor = '';
        if (e.dataTransfer.files[0]?.type.startsWith('image/')) loadFile(e.dataTransfer.files[0]);
    };
    dom.fileInput.onchange = () => {
        if (dom.fileInput.files[0]) loadFile(dom.fileInput.files[0]);
    };

    dom.cancelEd.onclick = closeEditor;
    dom.applyEd.onclick = applyTexture;
    dom.resetTexBtn.onclick = () => {
        state.texImg = null;
        state.texTf = {
            rot: 0,
            scale: 1,
            sx: 1,
            sy: 1,
            ox: 0,
            oy: 0
        };
        if (dom.editorPanel.classList.contains('open')) {
            writeSliders(state.texTf);
            drawPreview();
        }
        state.pendImg = null;
        closeEditor();
        dom.fileName.textContent = '';
        toast('Texture reset to default');
    };
    [dom.sRot, dom.sScale, dom.sSX, dom.sSY, dom.sOX, dom.sOY].forEach(el => el.addEventListener('input', () => {
        syncSliderLabels();
        drawPreview();
    }));

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
        state.gradientMarkers.push({
            x: pos.x,
            y: pos.y,
            color: color
        });
        state.updateGradientMarkersCache();
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
        state.updateCurveColorsCache();
        state.activeCurveIndex = state.curveColors.length - 1;
        renderCurveList();
        state.curveMap.clear();
        state.curves.clear();
        state.queue.length = 0;
        initializeCentralTile();
        checkIfSolved();
    };

    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (dom.exportOverlay.classList.contains('active')) {
                closeExportOverlay();
            } else if (document.body.classList.contains('sidebar-collapsed')) {
                document.body.classList.remove('sidebar-collapsed');
                dom.sidebar.classList.remove('collapsed');
                dom.sidebarToggle.classList.remove('collapsed');
            }
        }
    });
}

export function scheduleLiveTwist() {
    clearTimeout(state.liveTwistsTimer);
    if (!state.liveTwistsEnabled) return;
    const delay = 5000 + Math.random() * 5000; // 5-10 seconds
    state.liveTwistsTimer = setTimeout(() => {
        if (state.liveTwistsEnabled) {
            performLiveTwist();
            scheduleLiveTwist();
        }
    }, delay);
}

function performLiveTwist() {
    // Don't interrupt user interaction or exports
    if (state.isDrag || state.touchState.mode !== 'none' || state.isExporting) return;

    const W = dom.cvs.width,
        H = dom.cvs.height;
    const visZoom = (state.isEmbedMode && state.embedData && state.embedData.origZoom) ? state.embedData.origZoom : state.zoom;
    const visSz = HEX_R * visZoom;

    // Only twist if curves are visible enough
    if (visSz <= HEX_R * CONFIG.ZOOM_FADE_END_MULT) return;

    const hexes = visibleHexes(state.zoom, state.panX, state.panY, W, H);
    const candidates = [];

    // Filter to central 80% area
    for (const h of hexes) {
        if (h.x > W * 0.1 && h.x < W * 0.9 && h.y > H * 0.1 && h.y < H * 0.9) {
            candidates.push(h);
        }
    }

    if (candidates.length === 0) return;

    let bestImpact = -1;
    let bestHexes = [];

    // Evaluate impact for each candidate
    for (const h of candidates) {
        const impact = predictTwistImpact(h.q, h.r);
        if (impact > bestImpact) {
            bestImpact = impact;
            bestHexes = [h];
        } else if (impact === bestImpact) {
            bestHexes.push(h);
        }
    }

    if (bestHexes.length > 0 && bestImpact > 0) {
        const chosen = bestHexes[Math.floor(Math.random() * bestHexes.length)];
        rotateTile(chosen.q, chosen.r);
    }
}

function predictTwistImpact(q, r) {
    const k = (tileRot(q, r) / 60) % 6;
    const alter = isTileAlter(q, r);
    const newK = (k + 1) % 6;

    // Determine the new pairs if rotated by 60 degrees
    const newPairs = alter ? [
        [(0 + newK) % 6, (1 + newK) % 6],
        [(2 + newK) % 6, (3 + newK) % 6],
        [(4 + newK) % 6, (5 + newK) % 6]
    ] : [
        [(2 + newK) % 6, (3 + newK) % 6],
        [(4 + newK) % 6, (0 + newK) % 6],
        [(1 + newK) % 6, (5 + newK) % 6]
    ];

    let impact = 0;

    // Check how many edges will change color due to new pairings
    for (const pair of newPairs) {
        const e1 = pair[0],
            e2 = pair[1];
        const id1 = edgeID(q, r, e1);
        const id2 = edgeID(q, r, e2);
        const c1 = state.curveMap.has(id1) ? state.curveMap.get(id1) : -1;
        const c2 = state.curveMap.has(id2) ? state.curveMap.get(id2) : -1;

        if (c1 !== c2) {
            if (c1 !== -1 && c2 !== -1) impact += 2; // Two colors merging
            else if (c1 !== -1 || c2 !== -1) impact += 1; // One color expanding into blank
        }
    }
    return impact;
}

function pickNewMarkerColor() {
    const existing = new Set(state.gradientMarkers.map(m => m.color.toLowerCase()));
    for (let i = 0; i < state.gradientColorPool.pool.length; i++)
        if (!existing.has(state.gradientColorPool.pool[i].toLowerCase())) return state.gradientColorPool.pool[i];
    for (let attempts = 0; attempts < 200; attempts++) {
        const c = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
        if (!existing.has(c.toLowerCase())) return c;
    }
    return null;
}

function pickNewCurveColor() {
    const existing = new Set(state.curveColors.map(c => c.toLowerCase()));
    for (let i = 0; i < state.curveColorPool.pool.length; i++)
        if (!existing.has(state.curveColorPool.pool[i].toLowerCase())) return state.curveColorPool.pool[i];
    for (let attempts = 0; attempts < 200; attempts++) {
        const c = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
        if (!existing.has(c.toLowerCase())) return c;
    }
    return null;
}

function handleClick(e) {
    const r = dom.cvs.getBoundingClientRect();
    const h = pixToHex(e.clientX - r.left, e.clientY - r.top, state.zoom, state.panX, state.panY);
    rotateTile(h.q, h.r);
}

function removeMarkerAt(mx, my) {
    let clickedMarkerIdx = -1;
    for (let i = 0; i < state.gradientMarkers.length; i++) {
        const m = state.gradientMarkers[i],
            dx = mx - m.x,
            dy = my - m.y;
        if (dx * dx + dy * dy < CONFIG.MARKER_HIT_RADIUS * CONFIG.MARKER_HIT_RADIUS) {
            clickedMarkerIdx = i;
            break;
        }
    }
    if (clickedMarkerIdx !== -1) {
        if (state.gradientMarkers.length > 1) {
            const removedMarker = state.gradientMarkers[clickedMarkerIdx],
                cached = state.gradientMarkersRGB[clickedMarkerIdx];
            state.fadingMarkersRGB.push({
                x: removedMarker.x,
                y: removedMarker.y,
                r: cached.r,
                g: cached.g,
                b: cached.b,
                origR: cached.r,
                origG: cached.g,
                origB: cached.b,
                weight: cached.weight || 1
            });
            state.gradientMarkers.splice(clickedMarkerIdx, 1);
            state.gradientMarkersRGB.splice(clickedMarkerIdx, 1);
            state.isDragMarker = false;
            state.draggedMarkerIndex = -1;
            renderGradientList();
            state.updateGradientMarkersCache();
            requestRender();
            toast('Marker and color removed');
        } else toast('At least one marker is required');
    }
}

function bulkAnimate(newMode, newSeed) {
    const now = Date.now();
    const hexes = visibleHexes(state.zoom, state.panX, state.panY, dom.cvs.width, dom.cvs.height);
    const snapshots = new Map();
    for (const h of hexes) snapshots.set(hexKey(h.q, h.r), displayRot(h.q, h.r, now));
    state.rotOverrides.clear();
    state.rotMode = newMode;
    state.rotSeed = newSeed;
    for (const h of hexes) {
        const k = hexKey(h.q, h.r),
            curDisplay = snapshots.get(k),
            newBase = baseRot(h.q, h.r),
            target = nearestTarget(curDisplay, newBase);
        if (Math.abs(target - curDisplay) > 0.5) state.animMap.set(k, {
            start: now,
            from: curDisplay,
            to: target,
            duration: BULK_DUR
        });
        else state.animMap.delete(k);
    }
    state.curveMap.clear();
    state.edgeRgbMap.clear();
    state.curves.clear();
    state.queue.length = 0;
    initializeCentralTile();
    checkIfSolved();
}

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

function syncSliderLabels() {
    dom.vRot.textContent = dom.sRot.value + '°';
    dom.vScale.textContent = (+dom.sScale.value).toFixed(2) + 'x';
    dom.vSX.textContent = (+dom.sSX.value).toFixed(2) + 'x';
    dom.vSY.textContent = (+dom.sSY.value).toFixed(2) + 'x';
    dom.vOX.textContent = dom.sOX.value;
    dom.vOY.textContent = dom.sOY.value;
}

function drawPreview() {
    const pc = dom.previewCanvas,
        pctx = pc.getContext('2d'),
        cX = 110,
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

export function resetIdleTimer() {
    if (!document.fullscreenElement) return;
    clearTimeout(state.idleTimer);
    if (state.isIdle) exitIdleState();
    state.idleTimer = setTimeout(enterIdleState, 5000);
}

function enterIdleState() {
    if (!document.fullscreenElement) return;
    state.isIdle = true;

    state.hoveredQ = null;
    state.hoveredR = null;
    state.visHoverX = null;
    state.visHoverY = null;

    document.body.classList.add('fullscreen-idle');
    document.body.style.cursor = 'none';
    dom.cvs.style.cursor = 'none';

    state.sidebarWasOpenBeforeIdle = !dom.sidebar.classList.contains('collapsed');
    if (state.sidebarWasOpenBeforeIdle) {
        dom.sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        dom.sidebarToggle.classList.add('collapsed');
    }

    state.gridWasVisibleBeforeIdle = state.showGrid;
    if (state.gridWasVisibleBeforeIdle) state.showGrid = false;

    state.markersWereVisibleBeforeIdle = state.markersVisible;
    if (state.markersWereVisibleBeforeIdle) state.markersVisible = false;

    requestRender();
}

function exitIdleState() {
    if (!state.isIdle) return;
    state.isIdle = false;
    document.body.classList.remove('fullscreen-idle');
    document.body.style.cursor = '';
    dom.cvs.style.cursor = '';

    if (state.sidebarWasOpenBeforeIdle) {
        dom.sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
        dom.sidebarToggle.classList.remove('collapsed');
    }

    if (state.gridWasVisibleBeforeIdle) state.showGrid = true;
    if (state.markersWereVisibleBeforeIdle) state.markersVisible = true;

    requestRender();
}

state.setZoom = setZoom;
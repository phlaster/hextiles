import {
    CONFIG,
    COLORS,
    COLOR_THEMES
} from './config.js';

export const state = {
    CONFIG,
    COLORS,
    COLOR_THEMES,

    // App context
    isEmbedMode: false,
    embedData: null,
    ctx: null,

    // View & Pan
    zoom: 1,
    targetZoom: 1,
    panX: 0,
    panY: 0,
    zoomCx: 0,
    zoomCy: 0,
    zoomOutBlockedUntil: 0,

    // Interaction
    touchState: {
        mode: 'none',
        startX: 0,
        startY: 0,
        startPanX: 0,
        startPanY: 0,
        startDist: 0,
        startZoom: 0,
        pinchCenterX: 0,
        pinchCenterY: 0,
        markerIdx: -1,
        startTime: 0,
        timer: null
    },
    isTouchDevice: false,
    isDrag: false,
    isDragMarker: false,
    dragSX: 0,
    dragSY: 0,
    dragPX: 0,
    dragPY: 0,
    dragMoved: false,
    draggedMarkerIndex: -1,
    dragMarkerOffsetX: 0,
    dragMarkerOffsetY: 0,
    mouseScreenX: -9999,
    mouseScreenY: -9999,
    hoveredQ: null,
    hoveredR: null,
    visHoverX: null,
    visHoverY: null,
    touchOutlines: [],
    embedDragLastTile: null,
    lastTapTime: 0,
    mouseDrawTimer: null,
    isMouseDrawMode: false,
    lastDraggedTile: null,

    // Render flags
    showGrid: true,
    showBgStars: true,
    markersVisible: true,
    flowEnabled: false,
    liveTwistsEnabled: false,
    liveTwistsTimer: null,
    inertiaEnabled: true,
    interactionFade: 1.0,
    targetInteractionFade: 1.0,
    isExporting: false,
    exportFreezeTime: 0,

    // Physics
    panVX: 0,
    panVY: 0,
    lastPanMoveTime: 0,
    flowIntensity: 0,
    flowTime: 0,
    flowLastTime: 0,
    flowLastCycle: -1,
    flowStartAngle: 0,
    flowTargetAngle: 0,
    flowCurrentAngle: 0,
    flowMaxSpeed: 0.5,
    flowCycleStarted: false,
    currentFlowVX: 0,
    currentFlowVY: 0,

    // Grid & Rotation
    rotMode: 'hash',
    randomSeed: 0,
    rotSeed: 0,
    rotOverrides: new Map(),
    animMap: new Map(),
    alterTilesRatio: 0,
    curveLineWidth: 1,

    // Textures
    texImg: null,
    pendImg: null,
    texTf: {
        rot: 0,
        scale: 1,
        sx: 1,
        sy: 1,
        ox: 0,
        oy: 0
    },

    // Markers & Colors
    gradientMarkers: [],
    gradientMarkersRGB: [],
    fadingMarkersRGB: [],
    currentAvgR: 0,
    currentAvgG: 0,
    currentAvgB: 0,
    curveColors: ['#444444'],
    curveColorsRGB: [],
    activeCurveIndex: 0,

    // Curve Engine State
    curveMap: new Map(),
    curves: new Map(),
    queue: [],
    edgeRgbMap: new Map(),
    edgeColorAnimating: false,
    lastRipple: {
        q: 0,
        r: 0,
        time: 0
    },
    nextCurveID: 0,
    curveColorPool: {
        name: '',
        pool: []
    },
    gradientColorPool: {
        name: '',
        pool: []
    },

    // Star Parallax
    starPanX5: 0,
    starPanY5: 0,
    starZoom5: 1,
    starPanX2: 0,
    starPanY2: 0,
    starZoom2: 1,
    starPanX3: 0,
    starPanY3: 0,
    starZoom3: 1,
    zoomOutStartTime: 0,

    // Misc
    isInitialized: false,
    gradientCanvas: null,
    curveCanvas: document.createElement('canvas'),
    curveCtx: null,
    starColorCache: new Map(),
    solvedCheckTimeout: null,
    isGradientDirty: true,
    visibleHexesArray: [],
    currentUnassignedEdges: new Set(),
    previousUnassignedEdges: new Set(),
    magnetTimer: null,
    isRenderScheduled: false,
    lastStatsUpdate: 0,

    // Fullscreen Idle Mode
    isIdle: false,
    idleTimer: null,
    sidebarWasOpenBeforeIdle: false,
    gridWasVisibleBeforeIdle: false,
    markersWereVisibleBeforeIdle: false,

    // Export State
    efRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0
    },
    efDrag: null,
    aspectLocked: false,
    targetRatio: 1,
    sidebarWasCollapsed: false,

    // Functions (bridged)
    updateGradientMarkersCache: () => {},
    updateCurveColorsCache: () => {},
    requestRender: () => {},
    toast: () => {},
};

state.curveCtx = state.curveCanvas.getContext('2d');

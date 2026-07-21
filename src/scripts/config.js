// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GLOBAL CONFIGURATION CONSTANTS
//  All tuning parameters for zoom, stars, parallax, and interactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CONFIG = {

    // Core Hex Grid & Math
    HEX_R: 62,
    MIN_ZOOM: 0.20,
    MAX_ZOOM: 6,
    CLICK_THRESH: 5,
    CLICK_DUR: 280,
    BULK_DUR: 420,
    ROT_STEP: 60,
    SQRT3: Math.sqrt(3),
    DEG2RAD: Math.PI / 180,
    PI_DIV_3: Math.PI / 3,
    TWO_PI_DIV_3: 2 * Math.PI / 3,
    FOUR_PI_DIV_3: 4 * Math.PI / 3,

    // Tracing & Bounds
    TRACE_QUEUE_MARGIN: 20,
    TRACE_MAX_PER_FRAME: 100000,
    TRACE_SEARCH_MARGIN: 10,
    VISIBLE_BOUND_MULT: 4,

    // Zoom & Magnetism
    MAGNET_DELAY: 300,
    MAGNET_SNAP_POINTS: [0.25, 0.20],
    ZOOM_BLOCK_DELAY_WHEEL: 100,
    ZOOM_BLOCK_DELAY_BTN: 1000,
    ZOOM_FADE_HIGH: 0.30,
    ZOOM_FADE_MID: 0.20,
    ZOOM_FADE_LOW: 0.20,
    ZOOM_FADE_START_MULT: 0.25,
    ZOOM_FADE_END_MULT: 0.20,
    ZOOM_BLAZE_FADE_START: 0.205,
    ZOOM_BLAZE_FADE_RANGE: 0.005,

    // Zoom Controls
    WHEEL_DELTA_IN: 1.05,
    WHEEL_DELTA_OUT: 0.95,
    WHEEL_SLOW_MULT: 0.333,
    BTN_DELTA_IN: 1.1,
    BTN_DELTA_OUT: 0.9,
    BTN_SLOW_MULT: 0.333,
    KEY_DELTA_IN: 1.1,
    KEY_DELTA_OUT: 0.9,

    // Background Stars & Parallax
    STAR_PARALLAX_LARGE: 0.08,
    STAR_PARALLAX_MED: 0.04,
    STAR_PARALLAX_SMALL: 0.015,
    STAR_ZOOM_EXP_LARGE: 0.4 / 1.7,
    STAR_ZOOM_EXP_MED: 0.15 / 1.7,
    STAR_ZOOM_EXP_SMALL: 0.05 / 1.7,
    STAR_SPACING_LARGE: 150,
    STAR_SPACING_MED: 100,
    STAR_SPACING_SMALL: 200,
    STAR_SIZE_LARGE: 6,
    STAR_SIZE_MED: 3,
    STAR_SIZE_SMALL: 2,
    STAR_MIN_SPACING: 5,
    STAR_BLAZE_DELAY: 10000,
    STAR_BLAZE_MIN_INTERVAL: 30000,
    STAR_BLAZE_MAX_INTERVAL_ADD: 20000,
    STAR_BLAZE_DURATION: 1000,
    STAR_BLAZE_SIZE_MULT: 3,
    STAR_LUM_MIN: 100,
    STAR_LUM_RANGE: 80,
    EXPORT_STAR_SPACING_LARGE: 80,
    EXPORT_STAR_SPACING_MED: 50,
    EXPORT_STAR_SPACING_SMALL: 250,
    EXPORT_BLAZE_TIME_OFFSET: 11000,

    // Interaction & Physics
    INERTIA_DAMPING_LOW: 0.99,
    INERTIA_DAMPING_NORMAL: 0.95,
    INERTIA_THRESHOLD: 0.01,
    DRIFT_TIMER_MIN: 10000,
    DRIFT_TIMER_RANGE: 10000,
    DRIFT_SPEED_BASE: 2,
    DRIFT_SPEED_RANGE: 0.4,
    FLOW_SPEED_MULT_LOW_ZOOM: 5,
    FLOW_ANGLE_LERP_LOW_ZOOM: 0.015,
    FLOW_ANGLE_LERP_NORMAL: 0.03,
    TOUCH_OUTLINE_FADE: 0.035,
    HOVER_LERP: 0.40,
    LONG_PRESS_DUR: 500,
    HAPTIC_DUR: 50,
    MARKER_HIT_RADIUS: 30,

    // Live twist every 0.5 to 3s:
    LIVE_TWIST_MIN_DELAY: 500, // ms
    LIVE_TWIST_DELAY_DELTA: 2500, // ms

    // UI & Limits
    TOAST_DUR: 1500,
    SIDEBAR_WIDTH: 310,
    MAX_MARKERS: 10,
    MAX_CURVE_COLORS: 10,
    STATS_UPDATE_INTERVAL: 500,

    // Size Thresholds (visSz boundaries)
    LOD_HIGH_SZ: 120, // Threshold between LOD 3 and LOD 2
    LOD_MED_HIGH_SZ: 60, // Threshold between LOD 2 and LOD 1
    LOD_MED_LOW_SZ: 30, // Threshold between LOD 1 and LOD 0

    // Curve Extensions (Overlap values per LOD)
    LOD_EXT_HIGH: 0.007, // Used for LOD 3
    LOD_EXT_MED_HIGH: 0.014, // Used for LOD 2
    LOD_EXT_MED_LOW: 0.028, // Used for LOD 1
    LOD_EXT_LOW: 0.050, // Used for LOD 0
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ALL COLORS IN ONE PLACE — edit these to change the entire look
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const COLORS = {
    bg: '#13132a',
    fg: '#aeaeca',
    muted: '#6e6e90',
    black: '#000000',
    white: '#ffffff',
};

// Aliases and alpha concatenations
COLORS.accent = COLORS.fg;
COLORS.border = COLORS.muted;
COLORS.hoverStroke = COLORS.black;

COLORS.accentDim = COLORS.accent + '26';
COLORS.unrenderedDotted = COLORS.muted + '8c';
COLORS.previewStroke = COLORS.accent + '99';
COLORS.hoverBorder = COLORS.accent + '33';

COLORS.card = COLORS.bg;
COLORS.card2 = COLORS.bg;
COLORS.gridLine = COLORS.muted;
COLORS.shadowColor = COLORS.accentDim;
COLORS.previewPlaceholder = COLORS.fg;
COLORS.previewDot = COLORS.accent;
COLORS.starPattern = COLORS.muted;

export const COLOR_THEMES = [{
        name: 'Acton',
        colors: [
            '#BA6891', '#EBD6EA', '#5D5884', '#74628D',
            '#F0EAFA', '#97658F', '#DA98BA', '#4A406E',
            '#3B2A5A', '#E3B7D3', '#260D40', '#D17CA1'
        ]
    },
    {
        name: 'Bamako',
        colors: [
            '#FFE5AD', '#003B47', '#255231', '#16483A',
            '#6B8005', '#E4CA73', '#8B8900', '#395F24',
            '#C7AF3B', '#0A4142', '#516F15', '#A59510'
        ]
    },
    {
        name: 'Batlow',
        colors: [
            '#144D62', '#FBC7EC', '#91862D', '#FDBCCD',
            '#677B3E', '#0E365E', '#FDAB9A', '#477150',
            '#C49138', '#28645F', '#F19D6B', '#011959'
        ]
    },
    {
        name: 'Bilbao',
        colors: [
            '#D7D7D4', '#B2A16B', '#4C0001', '#8A3A41',
            '#C6C3B3', '#722328', '#A77B5D', '#A16758',
            '#F8F8F8', '#BDB590', '#AC8C60', '#9A5152'
        ]
    },
    {
        name: 'Buda',
        colors: [
            '#D49E78', '#C36588', '#CE897D', '#FFFF66',
            '#DDC36F', '#BD548E', '#D8AF74', '#B63D96',
            '#E5DF68', '#C97683', '#B301B3', '#B326A0'
        ]
    },
    {
        name: 'Davos',
        colors: [
            '#628797', '#3A679B', '#112B70', '#EFF0CB',
            '#22488A', '#76958E', '#B2C08F', '#92A887',
            '#D6DCA9', '#FDFDF4', '#4D789D', '#00054A'
        ]
    },
    {
        name: 'Devon',
        colors: [
            '#283E71', '#F8F8FE', '#BEB9F2', '#D4D0F6',
            '#6181D0', '#274275', '#ABA6ED', '#8D95E3',
            '#3A6CB2', '#2A295B', '#2B2759', '#E8E5FA'
        ]
    },
    {
        name: 'Glasgow',
        colors: [
            '#5F9585', '#4A1827', '#80AEBB', '#744F01',
            '#361338', '#6C7434', '#DBD3FF', '#735905',
            '#668153', '#A6BED8', '#629C96', '#702D06'
        ]
    },
    {
        name: 'GrayC',
        colors: [
            '#565656', '#686868', '#DBDBDB', '#C1C1C1',
            '#F9F9F9', '#1E1E1E', '#070707', '#A9A9A9',
            '#939393', '#808080', '#333333', '#454545'
        ]
    },
    {
        name: 'Hawaii',
        colors: [
            '#9C911C', '#8F1867', '#995E33', '#97503C',
            '#74CE79', '#67E9D5', '#953E49', '#B3F2FD',
            '#5FE0B7', '#922A59', '#9B6C2A', '#87BE4E'
        ]
    },
    {
        name: 'Imola',
        colors: [
            '#CDED66', '#1A33B3', '#2344AA', '#598B7D',
            '#FFFF66', '#3B6C92', '#84B772', '#32629B',
            '#467888', '#2A52A3', '#71A477', '#9ED06C'
        ]
    },
    {
        name: 'Lipari',
        colors: [
            '#5A5D7A', '#FDF5DA', '#9A6169', '#BE6561',
            '#E89E77', '#031326', '#ECD2AB', '#E27760',
            '#7C6071', '#0B2D4B', '#E6AB80', '#25486D'
        ]
    },
    {
        name: 'Navia',
        colors: [
            '#3B8584', '#BCDB89', '#0C487B', '#5FA66F',
            '#FCF4D9', '#031327', '#236C91', '#062C52',
            '#83C068', '#49927B', '#307A8B', '#E5EAB8'
        ]
    },
    {
        name: 'Oslo',
        colors: [
            '#225183', '#D7D9DD', '#97A9C9', '#567FC0',
            '#112A43', '#B8BFCD', '#183E64', '#3A6AA9',
            '#7997CA', '#030609', '#0D1925', '#F9F9F9'
        ]
    },
    {
        name: 'Tab20',
        colors: [
            '#1F77B4', '#AEC7E8', '#FF7F0E', '#FFBB78', '#2CA02C', '#98DF8A',
            '#D62728', '#FF9896', '#9467BD', '#C5B0D5', '#8C564B', '#C49C94',
            '#E377C2', '#F7B6D2', '#7F7F7F', '#C7C7C7', '#BCBD22', '#DBDB8D',
            '#17BECF', '#9EDAE5'
        ]
    },
    {
        name: 'Spectral',
        colors: [
            '#9E0142',
            '#D53E4F', '#F46D43', '#FDAE61', '#FEE08B', '#FFFFBF',
            '#E6F598',
            '#ABDDA4', '#66C2A5', '#3288BD', '#5E4FA2'
        ]
    },
];
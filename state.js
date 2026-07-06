import { CONFIG } from './config.js';

export const state = {
    CONFIG,
    gradientMarkers: [],
    gradientMarkersRGB: [],
    fadingMarkersRGB: [],
    curveColors: ['#444444'],
    curveColorsRGB: [],
    activeCurveIndex: 0,
    
    // These will be wired up to the real functions in main.js later
    updateGradientMarkersCache: () => {},
    updateCurveColorsCache: () => {},
};
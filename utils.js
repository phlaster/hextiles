import { COLOR_THEMES } from './config.js';


export function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
}

export function rgbToHex(rgb) {
    return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Low-cost approximation of human color perception (Redmean weighted Euclidean)
export function colorDistance(c1, c2) {
    const rmean = (c1[0] + c2[0]) / 2;
    const dr = c1[0] - c2[0];
    const dg = c1[1] - c2[1];
    const db = c1[2] - c2[2];
    return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function generateDistinctThemePool() {
    const theme = COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)];
    let pool = theme.colors.map(hexToRgb);
    
    let ordered = [];
    // 1. Start with a random color from the pool
    let startIdx = Math.floor(Math.random() * pool.length);
    ordered.push(pool[startIdx]);
    pool.splice(startIdx, 1);
    
    // 2. Iteratively add the color that maximizes the minimum distance to the ordered set
    while (pool.length > 0) {
        let bestCandidateIdx = -1;
        let bestMinDist = -1;
        
        for (let i = 0; i < pool.length; i++) {
            let minDist = Infinity;
            for (let j = 0; j < ordered.length; j++) {
                let d = colorDistance(pool[i], ordered[j]);
                if (d < minDist) minDist = d;
            }
            if (minDist > bestMinDist) {
                bestMinDist = minDist;
                bestCandidateIdx = i;
            }
        }
        
        ordered.push(pool[bestCandidateIdx]);
        pool.splice(bestCandidateIdx, 1);
    }
    
    return { name: theme.name, pool: ordered.map(rgbToHex) };
}
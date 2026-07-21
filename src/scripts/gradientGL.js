import {
    COLORS
} from './config.js';
import {
    state
} from './state.js';

let gl, program, canvas, vao;
let u_resolution, u_markers, u_colors, u_weights, u_count, u_bgColor;
const MAX_MARKERS = 10;

export function initGradientGL() {
    canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', {
        antialias: false,
        premultipliedAlpha: false
    });
    if (!gl) return false;

    const vsSource = `#version 300 es
        in vec2 a_pos;
        void main() {
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }`;

    const fsSource = `#version 300 es
        precision highp float;
        uniform vec2 u_resolution;
        uniform vec2 u_markers[${MAX_MARKERS}];
        uniform vec3 u_colors[${MAX_MARKERS}];
        uniform float u_weights[${MAX_MARKERS}];
        uniform int u_count;
        uniform vec3 u_bgColor;
        out vec4 fragColor;

        void main() {
            vec2 pos = gl_FragCoord.xy;
            float totalWeight = 0.0;
            vec3 totalColor = vec3(0.0);
            
            for (int i = 0; i < ${MAX_MARKERS}; i++) {
                if (i >= u_count) break;
                vec2 d = pos - u_markers[i];
                float distSq = dot(d, d) + 0.5;
                float w = (1.0 / (distSq * distSq)) * u_weights[i];
                totalWeight += w;
                totalColor += u_colors[i] * w;
            }
            
            if (totalWeight > 0.0) {
                fragColor = vec4(totalColor / totalWeight, 1.0);
            } else {
                fragColor = vec4(u_bgColor, 1.0);
            }
        }`;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const a_pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    u_resolution = gl.getUniformLocation(program, 'u_resolution');
    u_markers = gl.getUniformLocation(program, 'u_markers');
    u_colors = gl.getUniformLocation(program, 'u_colors');
    u_weights = gl.getUniformLocation(program, 'u_weights');
    u_count = gl.getUniformLocation(program, 'u_count');
    u_bgColor = gl.getUniformLocation(program, 'u_bgColor');

    return true;
}

export function renderGradientGL(targetCtx, W, H, coordScale, offsetX, offsetY) {
    if (!gl || !program) return false;

    // Render at half resolution for performance, GPU will still be instant
    const lowW = Math.max(2, Math.ceil(W * 0.5));
    const lowH = Math.max(2, Math.ceil(H * 0.5));
    if (canvas.width !== lowW || canvas.height !== lowH) {
        canvas.width = lowW;
        canvas.height = lowH;
    }

    gl.viewport(0, 0, lowW, lowH);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform2f(u_resolution, lowW, lowH);

    const bgR = parseInt(COLORS.bg.slice(1, 3), 16) / 255;
    const bgG = parseInt(COLORS.bg.slice(3, 5), 16) / 255;
    const bgB = parseInt(COLORS.bg.slice(5, 7), 16) / 255;
    gl.uniform3f(u_bgColor, bgR, bgG, bgB);

    const markersData = new Float32Array(MAX_MARKERS * 2);
    const colorsData = new Float32Array(MAX_MARKERS * 3);
    const weightsData = new Float32Array(MAX_MARKERS);

    const allMarkers = [];
    for (let i = 0; i < state.gradientMarkersRGB.length; i++) {
        const m = state.gradientMarkersRGB[i];
        allMarkers.push({
            x: m.x,
            y: m.y,
            r: m.r / 255,
            g: m.g / 255,
            b: m.b / 255,
            weight: m.weight || 0
        });
    }
    for (let i = 0; i < state.fadingMarkersRGB.length; i++) {
        const m = state.fadingMarkersRGB[i];
        allMarkers.push({
            x: m.x,
            y: m.y,
            r: m.r / 255,
            g: m.g / 255,
            b: m.b / 255,
            weight: m.weight || 0
        });
    }

    let count = 0;
    for (const m of allMarkers) {
        if (count >= MAX_MARKERS) break;
        markersData[count * 2] = ((m.x - offsetX) * coordScale) * 0.5; // 0.5 for lowW scaling
        // WebGL Y is bottom-up, so we must invert the Y coordinate here
        markersData[count * 2 + 1] = lowH - (((m.y - offsetY) * coordScale) * 0.5);
        colorsData[count * 3] = m.r;
        colorsData[count * 3 + 1] = m.g;
        colorsData[count * 3 + 2] = m.b;
        weightsData[count] = Math.max(0, Math.min(1, m.weight));
        count++;
    }

    gl.uniform1i(u_count, count);
    gl.uniform2fv(u_markers, markersData);
    gl.uniform3fv(u_colors, colorsData);
    gl.uniform1fv(u_weights, weightsData);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Draw the WebGL canvas onto the main Canvas2D context
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.drawImage(canvas, 0, 0, lowW, lowH, 0, 0, W, H);
    return true;
}
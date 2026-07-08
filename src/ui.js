// ui.js
import { dom } from './dom.js';
import { state } from './state.js';
import { hexToRgb } from './utils.js';

let toastTimer = null;

export function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), state.CONFIG.TOAST_DUR);
}

export function renderGradientList() {
    const list = dom.gradientList;
    list.innerHTML = '';
    const canRemove = state.gradientMarkers.length > 1;

    state.gradientMarkers.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'grad-item';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = m.color;
        let originalColor = m.color;
        colorInput.addEventListener('input', (e) => {
            state.gradientMarkers[i].color = e.target.value;
            state.updateGradientMarkersCache();
            hexInput.value = e.target.value.toUpperCase();
        });
        colorInput.addEventListener('change', (e) => {
            const newColor = e.target.value.toLowerCase();
            state.gradientMarkers[i].color = newColor;
            originalColor = newColor;
            state.updateGradientMarkersCache();
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
                state.gradientMarkers[i].color = newColor;
                originalColor = newColor;
                state.updateGradientMarkersCache();
                colorInput.value = newColor;
                e.target.value = newColor.toUpperCase();
            } else {
                toast('Invalid hex color (e.g. #FF0000)');
                e.target.value = state.gradientMarkers[i].color.toUpperCase();
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
                
                const removedMarker = state.gradientMarkers[i];
                const cached = state.gradientMarkersRGB[i];
                if (cached) {
                    state.fadingMarkersRGB.push({
                        x: removedMarker.x,
                        y: removedMarker.y,
                        r: cached.r, g: cached.g, b: cached.b,
                        origR: cached.r, origG: cached.g, origB: cached.b,
                        weight: cached.weight || 1
                    });
                }
                
                state.gradientMarkers.splice(i, 1);
                state.gradientMarkersRGB.splice(i, 1); 
                renderGradientList();
                state.updateGradientMarkersCache();
            });
            item.appendChild(removeBtn);
        }

        list.appendChild(item);
    });
}

export function renderCurveList() {
    const list = dom.curveList;
    list.innerHTML = '';
    const canRemove = state.curveColors.length > 1;

    state.curveColors.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'grad-item';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = m;
        let originalColor = m;
        colorInput.addEventListener('input', (e) => {
            state.curveColors[i] = e.target.value;
            state.updateCurveColorsCache();
            hexInput.value = e.target.value.toUpperCase();
        });
        colorInput.addEventListener('change', (e) => {
            const newColor = e.target.value.toLowerCase();
            const isDuplicate = state.curveColors.some((mm, idx) =>
                idx !== i && mm.toLowerCase() === newColor);
            if (isDuplicate) {
                state.curveColors[i] = originalColor;
                e.target.value = originalColor;
                hexInput.value = originalColor.toUpperCase();
                toast('Color already exists in curve palette');
                state.updateCurveColorsCache(); 
            } else {
                state.curveColors[i] = newColor; 
                originalColor = newColor;
                state.updateCurveColorsCache();
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
                const isDuplicate = state.curveColors.some((mm, idx) =>
                    idx !== i && mm.toLowerCase() === newColor);
                if (isDuplicate) {
                    toast('Color already exists in curve palette');
                    e.target.value = state.curveColors[i].toUpperCase();
                } else {
                    state.curveColors[i] = newColor;
                    originalColor = newColor;
                    state.updateCurveColorsCache();
                    colorInput.value = newColor;
                    e.target.value = newColor.toUpperCase();
                }
            } else {
                toast('Invalid hex color (e.g. #FF0000)');
                e.target.value = state.curveColors[i].toUpperCase();
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
                state.curveColors.splice(i, 1);
                if (state.activeCurveIndex === i) {
                    state.activeCurveIndex = Math.min(i, state.curveColors.length - 1);
                } else if (state.activeCurveIndex > i) {
                    state.activeCurveIndex--;
                }
                state.updateCurveColorsCache();
                renderCurveList();
            });
            item.appendChild(removeBtn);
        }

        item.addEventListener('click', () => {
            state.activeCurveIndex = i;
            renderCurveList();
        });

        list.appendChild(item);
    });
}
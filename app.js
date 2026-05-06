/**
 * DMR Tone Generator v1.2
 * Zetron & Motorola QC2 templates + sweep + polyphony + fade-in/out
 */

class DMRGenerator {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.visualizerData = null;
        this.isPlaying = false;
        this.activeNodes = [];
        this.sequenceTimeout = null;

        this.burstContainer = document.getElementById('burst-container');
        this.burstTemplate  = document.getElementById('burst-template');
        this.canvas    = document.getElementById('waveform-canvas');
        this.canvasCtx = this.canvas.getContext('2d');

        this.bursts  = [];
        this.library = JSON.parse(localStorage.getItem('dmr_library') || '[]');

        this.TEMPLATES = this._buildTemplates();
        this.init();
    }

    // ─── Templates ────────────────────────────────────────────────────────
    _b(freqs, dur, fadeIn = 10, fadeOut = 10) {
        return { freqs, dur, type: 'sine', fadeIn, fadeOut };
    }

    _buildTemplates() {
        const hilo = () => {
            const cycle = [ this._b('1500', 500), this._b('800', 500) ];
            return Array(4).fill(null).flatMap(() => cycle.map(b => ({...b})));
        };

        const fiveBeeps = () => {
            const seq = [];
            for (let i = 0; i < 5; i++) {
                seq.push(this._b('1006.9', 200, 8, 8));
                if (i < 4) seq.push(this._b('0', 100, 1, 1));
            }
            return seq;
        };

        const slowSiren = () => {
            const cycle = [ this._b('800->1500', 1500), this._b('1500->800', 1500) ];
            return Array(2).fill(null).flatMap(() => cycle.map(b => ({...b})));
        };

        const fastSiren = () => {
            const cycle = [ this._b('800->1500', 400), this._b('1500->800', 400) ];
            return Array(4).fill(null).flatMap(() => cycle.map(b => ({...b})));
        };

        return {
            'zetron-hilo':       { label: 'Hi-Lo Alert',     std: 'zetron', gen: hilo },
            'zetron-5beep':      { label: 'Five Beeps',       std: 'zetron', gen: fiveBeeps },
            'zetron-slow-siren': { label: 'Slow Siren',       std: 'zetron', gen: slowSiren },
            'zetron-fast-siren': { label: 'Fast Siren',       std: 'zetron', gen: fastSiren },
            'qc2-2tone':         { label: '2-Tone QC2',       std: 'qc2',    qc2fields: ['Tono A (Hz)', 'Tono B (Hz)'] },
            'qc2-3tone':         { label: '3-Tone QC2',       std: 'qc2',    qc2fields: ['Tono A (Hz)', 'Tono B (Hz)', 'Tono C (Hz)'] },
            'qc2-2tone-5beep':   { label: '2-Tone + 5 Beep', std: 'qc2',    qc2fields: ['Tono A (Hz)', 'Tono B (Hz)'] },
            'base-alert1':       { label: 'Motorola Alert 1', std: 'base',   gen: () => [
                this._b('800', 1000), this._b('0', 200, 1, 1), this._b('800', 1000),
            ]},
            'base-alert2':       { label: 'Motorola Alert 2', std: 'base',   gen: () => [
                { ...this._b('1200', 200), type: 'square' }, { ...this._b('800', 200), type: 'square' },
                { ...this._b('1200', 200), type: 'square' }, { ...this._b('800', 200), type: 'square' },
            ]},
            'base-alert3':       { label: 'Motorola Alert 3', std: 'base',   gen: () => [
                this._b('1500', 100), this._b('1200', 100), this._b('900', 100),
            ]},
            'base-prio':         { label: 'Priority Alert',   std: 'base',   gen: () => [
                this._b('1400, 1600', 400), this._b('900, 1100', 400), this._b('1400, 1600', 400),
            ]},
        };
    }

    _buildQC2Sequence(key, freqValues) {
        const f = freqValues.map(v => parseFloat(v) || 1000);
        if (key === 'qc2-2tone') {
            return [ this._b(String(f[0]), 1000), this._b(String(f[1]), 3000) ];
        }
        if (key === 'qc2-3tone') {
            return [ this._b(String(f[0]), 1000), this._b(String(f[1]), 1000), this._b(String(f[2]), 3000) ];
        }
        if (key === 'qc2-2tone-5beep') {
            const seq = [ this._b(String(f[0]), 1000), this._b(String(f[1]), 3000) ];
            for (let i = 0; i < 5; i++) {
                seq.push(this._b('1006.9', 200, 8, 8));
                if (i < 4) seq.push(this._b('0', 100, 1, 1));
            }
            return seq;
        }
        return [];
    }

    // ─── Init ─────────────────────────────────────────────────────────────
    init() {
        this.setupEventListeners();
        this.addBurst();
        this.resizeCanvas();
        this.renderLibrary();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.drawVisualizer();
    }

    setupEventListeners() {
        document.getElementById('btn-add-burst').onclick    = () => this.addBurst();
        document.getElementById('btn-play').onclick         = () => this.playSequence();
        document.getElementById('btn-stop').onclick         = () => this.stopSequence();
        document.getElementById('btn-clear').onclick        = () => this.clearAll();
        document.getElementById('btn-export').onclick       = () => this.exportWAV();
        document.getElementById('btn-export-json').onclick  = () => this.exportProject();
        document.getElementById('btn-import-json').onclick  = () => document.getElementById('input-import').click();
        document.getElementById('input-import').onchange    = (e) => this.importProject(e);
        document.getElementById('btn-save-library').onclick = () => this.saveToLibrary();
        document.getElementById('template-select').onchange = (e) => this.onTemplateChange(e.target.value);
        document.getElementById('btn-load-preset').onclick  = () => this.loadSelectedPreset();
        document.getElementById('btn-load-template').onclick = () => this.loadQC2Template();

        // Help modal
        document.getElementById('btn-help').onclick  = () => this.openModal();
        document.getElementById('modal-close').onclick = () => this.closeModal();
        document.getElementById('help-modal').onclick  = (e) => { if (e.target.id === 'help-modal') this.closeModal(); };
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeModal(); });
    }

    openModal()  { document.getElementById('help-modal').classList.remove('hidden'); }
    closeModal() { document.getElementById('help-modal').classList.add('hidden'); }

    // ─── Template UI ──────────────────────────────────────────────────────
    DESCRIPTIONS = {
        'zetron-hilo':       '4 ciclos Hi-Lo • 1500Hz↔800Hz • 500ms c/u • ~4000ms',
        'zetron-5beep':      '5 beeps • 1006.9 Hz • 200ms ON / 100ms OFF • ~1500ms',
        'zetron-slow-siren': 'Barrido 800→1500→800 Hz • 2 ciclos • ~6000ms',
        'zetron-fast-siren': 'Barrido 800→1500→800 Hz • 4 ciclos rápidos • ~3200ms',
        'qc2-2tone':         'Tono A (1000ms) → Tono B (3000ms) • frecuencias variables',
        'qc2-3tone':         'Tono A (1000ms) → B (1000ms) → C (3000ms) • frecuencias variables',
        'qc2-2tone-5beep':   '2-Tone QC2 + 5 beeps 1006.9 Hz al final • ~6500ms',
        'base-alert1':       'Alerta base Motorola • 800 Hz doble pulso con pausa',
        'base-alert2':       'Alerta rápida • 1200/800 Hz alternados (Square)',
        'base-alert3':       'Alerta descendente • 1500/1200/900 Hz',
        'base-prio':         'Alerta de prioridad • tonos duales simultáneos',
    };

    STD_LABELS = { zetron: 'ESTÁNDAR ZETRON', qc2: 'ESTÁNDAR QC2', base: 'PLANTILLA BASE' };

    onTemplateChange(key) {
        const info    = document.getElementById('template-info');
        const badge   = document.getElementById('template-std-badge');
        const desc    = document.getElementById('template-desc');
        const qc2Pan  = document.getElementById('qc2-inputs');
        const loadBtn = document.getElementById('btn-load-preset');

        if (!key) {
            info.classList.add('hidden');
            qc2Pan.classList.add('hidden');
            loadBtn.classList.add('hidden');
            return;
        }

        const tpl = this.TEMPLATES[key];
        if (!tpl) return;

        info.classList.remove('hidden');
        badge.textContent = this.STD_LABELS[tpl.std] || '';
        badge.className   = `std-badge ${tpl.std}`;
        desc.textContent  = this.DESCRIPTIONS[key] || '';

        if (tpl.qc2fields) {
            qc2Pan.classList.remove('hidden');
            loadBtn.classList.add('hidden');
            this._renderQC2Fields(tpl.qc2fields);
        } else {
            qc2Pan.classList.add('hidden');
            loadBtn.classList.remove('hidden');
        }
    }

    _renderQC2Fields(fields) {
        const container = document.getElementById('qc2-fields');
        container.innerHTML = '';
        fields.forEach((label, i) => {
            container.insertAdjacentHTML('beforeend', `
                <div class="qc2-field">
                    <label>${label}</label>
                    <input type="number" class="qc2-freq-input" data-index="${i}"
                           placeholder="553–1600 Hz" min="553" max="1600" value="1000">
                </div>`);
        });
    }

    loadSelectedPreset() {
        const key = document.getElementById('template-select').value;
        if (!key) return;
        const tpl = this.TEMPLATES[key];
        if (!tpl || !tpl.gen) return;
        this.clearAll();
        tpl.gen().forEach(b => this.addBurst({ ...b, type: 'sine' }));
    }

    loadQC2Template() {
        const key    = document.getElementById('template-select').value;
        const inputs = document.querySelectorAll('.qc2-freq-input');
        const freqs  = Array.from(inputs).map(i => i.value);
        this.clearAll();
        this._buildQC2Sequence(key, freqs).forEach(b => this.addBurst({ ...b, type: 'sine' }));
    }

    // ─── Burst Management ────────────────────────────────────────────────
    addBurst(data = { freqs: '1000', dur: 500, type: 'sine', fadeIn: 10, fadeOut: 10 }) {
        const clone = this.burstTemplate.content.cloneNode(true);
        const item  = clone.querySelector('.burst-item');

        const freqInput = item.querySelector('.input-freq');
        freqInput.value = data.freqs;
        item.querySelector('.input-dur').value     = data.dur;
        item.querySelector('.input-type').value    = data.type ?? 'sine';
        item.querySelector('.input-fadein').value  = data.fadeIn  ?? data.fade ?? 10;
        item.querySelector('.input-fadeout').value = data.fadeOut ?? data.fade ?? 10;

        // Sweep helper button
        item.querySelector('.sweep-btn').onclick = () => {
            const val = freqInput.value.trim();
            if (val.includes('->')) return;
            const num = parseFloat(val) || 1000;
            const end = Math.min(1600, num + 300);
            freqInput.value = `${num}->${end}`;
            freqInput.focus();
        };

        // Poly helper button
        item.querySelector('.poly-btn').onclick = () => {
            const val = freqInput.value.trim();
            freqInput.value = val ? `${val}, 1000` : '1000, 1000';
            freqInput.focus();
            // Select the appended "1000" so user can type over it
            const pos = freqInput.value.lastIndexOf('1000');
            freqInput.setSelectionRange(pos, pos + 4);
        };

        item.querySelector('.btn-remove').onclick = () => {
            item.remove();
            this.updateBurstList();
            this._updateBurstNumbers();
        };

        this.burstContainer.appendChild(item);
        this.updateBurstList();
        this._updateBurstNumbers();
    }

    _updateBurstNumbers() {
        this.burstContainer.querySelectorAll('.burst-item').forEach((el, i) => {
            el.querySelector('.burst-number').textContent = i + 1;
        });
    }

    updateBurstList() {
        const items = this.burstContainer.querySelectorAll('.burst-item');
        this.bursts = Array.from(items).map(item => ({
            freqs:   item.querySelector('.input-freq').value,
            dur:     parseInt(item.querySelector('.input-dur').value),
            type:    item.querySelector('.input-type').value,
            fadeIn:  parseFloat(item.querySelector('.input-fadein').value)  / 1000 || 0.01,
            fadeOut: parseFloat(item.querySelector('.input-fadeout').value) / 1000 || 0.01,
        }));
    }

    // ─── Audio Engine ─────────────────────────────────────────────────────
    initAudio() {
        if (!this.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            try   { this.audioCtx = new AC({ sampleRate: 44100 }); }
            catch  { this.audioCtx = new AC(); }
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.visualizerData = new Uint8Array(this.analyser.frequencyBinCount);
            document.getElementById('audio-status').innerText = 'AUDIO ENGINE: ACTIVE';
            document.getElementById('samplerate').innerText   = 'SR: 44.1kHz';
        }
    }

    _parseFreq(str) {
        const s = String(str).trim();
        if (s.includes('->')) {
            const [a, b] = s.split('->').map(v => parseFloat(v.trim()));
            return { isSweep: true, freqA: this._clamp(a), freqB: this._clamp(b) };
        }
        return { isSweep: false, freqA: this._clamp(parseFloat(s) || 0) };
    }

    _clamp(f) { return Math.max(553, Math.min(1600, f)); }

    _scheduleOsc(ctx, dest, freqStr, type, startTime, endTime, fadeIn, fadeOut, volume = 1) {
        const { isSweep, freqA, freqB } = this._parseFreq(freqStr);
        if (freqA <= 0) return; // silence

        const dur      = endTime - startTime;
        // iOS is strict about click noise — enforce 12ms minimum fade
        const fadeInD  = Math.min(Math.max(fadeIn,  0.012), dur / 3);
        const fadeOutD = Math.min(Math.max(fadeOut, 0.012), dur / 3);

        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freqA, startTime);
        if (isSweep) osc.frequency.linearRampToValueAtTime(freqB, endTime);

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(volume, startTime + fadeInD);
        gain.gain.setValueAtTime(volume, endTime - fadeOutD);
        gain.gain.linearRampToValueAtTime(0, endTime);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(startTime);
        osc.stop(endTime);

        this.activeNodes.push(osc, gain);
    }

    async playSequence() {
        // ── Step 1: create context inside gesture (sync) ─────────────────
        this.initAudio();

        // ── Step 2: silent buffer — unlocks iOS audio permission (sync) ──
        // Must happen BEFORE any await so we're still in the gesture context.
        const silBuf = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate);
        const silSrc = this.audioCtx.createBufferSource();
        silSrc.buffer = silBuf;
        silSrc.connect(this.audioCtx.destination);
        silSrc.start(0);

        // ── Step 3: await resume — now context is truly running ───────────
        // iOS: currentTime is frozen while suspended. We must wait for
        // resume() to resolve before reading currentTime for scheduling.
        await this.audioCtx.resume();

        // ── Step 4: schedule tones using fresh currentTime ────────────────
        this.stopSequence();
        this.updateBurstList();
        if (this.bursts.length === 0) return;

        this.isPlaying = true;
        document.getElementById('audio-status').innerText = 'AUDIO ENGINE: PLAYING';
        let startTime = this.audioCtx.currentTime + 0.08;

        this.bursts.forEach(burst => {
            const end   = startTime + burst.dur / 1000;
            const parts = burst.freqs.includes('->') ? [burst.freqs] : burst.freqs.split(',').map(f => f.trim());
            const vol   = 1 / parts.length;
            parts.forEach(part => {
                this._scheduleOsc(this.audioCtx, this.analyser, part, burst.type, startTime, end, burst.fadeIn, burst.fadeOut, vol);
            });
            startTime = end;
        });

        this.analyser.connect(this.audioCtx.destination);
        const totalMs = (startTime - this.audioCtx.currentTime) * 1000;
        this.sequenceTimeout = setTimeout(() => {
            this.isPlaying = false;
            document.getElementById('audio-status').innerText = 'AUDIO ENGINE: READY';
        }, totalMs);
    }

    stopSequence() {
        clearTimeout(this.sequenceTimeout);
        if (this.audioCtx) {
            this.activeNodes.forEach(node => { try { node.disconnect(); } catch(e) {} });
        }
        this.activeNodes = [];
        this.isPlaying   = false;
        document.getElementById('audio-status').innerText = 'AUDIO ENGINE: READY';
    }

    clearAll() { this.burstContainer.innerHTML = ''; this.updateBurstList(); }

    // ─── Library ──────────────────────────────────────────────────────────
    saveToLibrary() {
        const nameInput = document.getElementById('input-save-name');
        const name = nameInput.value.trim();
        if (!name) { alert('Ingresa un nombre para el tono'); return; }
        this.updateBurstList();
        if (this.bursts.length === 0) return;
        this.library.push({ id: Date.now(), name, bursts: JSON.parse(JSON.stringify(this.bursts)) });
        localStorage.setItem('dmr_library', JSON.stringify(this.library));
        this.renderLibrary();
        nameInput.value = '';
    }

    _burstFromSaved(b) {
        const freqStr = Array.isArray(b.freqs) ? b.freqs.join(', ') : b.freqs;
        // Handle old format (single fade in seconds)
        const fadeIn  = b.fadeIn  != null ? b.fadeIn  * 1000 : (b.fade != null ? b.fade * 1000 : 10);
        const fadeOut = b.fadeOut != null ? b.fadeOut * 1000 : (b.fade != null ? b.fade * 1000 : 10);
        return { freqs: freqStr, dur: b.dur, type: b.type, fadeIn, fadeOut };
    }

    loadFromLibrary(id) {
        const tone = this.library.find(t => t.id === id);
        if (!tone) return;
        this.clearAll();
        tone.bursts.forEach(b => this.addBurst(this._burstFromSaved(b)));
    }

    deleteFromLibrary(id) {
        if (!confirm('¿Eliminar este tono?')) return;
        this.library = this.library.filter(t => t.id !== id);
        localStorage.setItem('dmr_library', JSON.stringify(this.library));
        this.renderLibrary();
    }

    renderLibrary() {
        const container = document.getElementById('library-container');
        container.innerHTML = '';
        if (this.library.length === 0) {
            container.innerHTML = '<p style="color:var(--text-dim);font-size:0.75rem;">Sin tonos guardados.</p>';
            return;
        }
        this.library.forEach(tone => {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.innerHTML = `
                <span class="item-name" title="Click para cargar">${tone.name}</span>
                <div class="item-actions"><button class="btn-icon delete" title="Eliminar">🗑</button></div>`;
            item.querySelector('.item-name').onclick = () => this.loadFromLibrary(tone.id);
            item.querySelector('.delete').onclick    = (e) => { e.stopPropagation(); this.deleteFromLibrary(tone.id); };
            container.appendChild(item);
        });
    }

    // ─── Project JSON ─────────────────────────────────────────────────────
    exportProject() {
        this.updateBurstList();
        if (this.bursts.length === 0) return;
        const blob = new Blob([JSON.stringify({ version: '1.2', bursts: this.bursts }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dmr_config_${Date.now()}.json`;
        a.click();
    }

    importProject(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.bursts) throw new Error('Formato inválido');
                this.clearAll();
                data.bursts.forEach(b => this.addBurst(this._burstFromSaved(b)));
                event.target.value = '';
            } catch (err) { alert('Error: ' + err.message); }
        };
        reader.readAsText(file);
    }

    // ─── WAV Export ───────────────────────────────────────────────────────
    exportWAV() {
        this.updateBurstList();
        if (this.bursts.length === 0) return;

        const sampleRate   = 44100;
        const totalSamples = Math.floor(this.bursts.reduce((a, b) => a + b.dur, 0) / 1000 * sampleRate);
        const offCtx = new OfflineAudioContext(1, totalSamples, sampleRate);

        let startTime = 0;
        this.bursts.forEach(burst => {
            const end   = startTime + burst.dur / 1000;
            const parts = burst.freqs.includes('->') ? [burst.freqs] : burst.freqs.split(',').map(f => f.trim());
            const vol   = 1 / parts.length;
            parts.forEach(part => {
                this._scheduleOsc(offCtx, offCtx.destination, part, burst.type, startTime, end, burst.fadeIn, burst.fadeOut, vol);
            });
            startTime = end;
        });

        offCtx.startRendering().then(buf => {
            const blob    = this._bufferToWav(buf);
            const blobUrl = URL.createObjectURL(blob);
            const isIOS   = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

            if (isIOS) {
                // iOS Safari/Chrome block blob downloads — open in new tab instead.
                // User must long-press the audio and choose "Save to Files".
                window.open(blobUrl, '_blank');
                alert('iOS: mantén presionado el audio en la nueva pestaña y selecciona "Guardar en Archivos".');
            } else {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `dmr_tone_${Date.now()}.wav`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        });
    }

    _bufferToWav(buffer) {
        const len  = buffer.length * 2 + 44;
        const ab   = new ArrayBuffer(len);
        const view = new DataView(ab);
        let pos = 0;
        const u16 = d => { view.setUint16(pos, d, true); pos += 2; };
        const u32 = d => { view.setUint32(pos, d, true); pos += 4; };
        u32(0x46464952); u32(len - 8); u32(0x45564157);
        u32(0x20746d66); u32(16); u16(1); u16(1);
        u32(buffer.sampleRate); u32(buffer.sampleRate * 2); u16(2); u16(16);
        u32(0x61746164); u32(len - pos - 4);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            pos += 2;
        }
        return new Blob([ab], { type: 'audio/wav' });
    }

    // ─── Visualizer ───────────────────────────────────────────────────────
    resizeCanvas() {
        this.canvas.width  = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    drawVisualizer() {
        requestAnimationFrame(() => this.drawVisualizer());
        const ctx = this.canvasCtx;
        const W = this.canvas.width, H = this.canvas.height;

        if (!this.analyser) {
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = 'rgba(255,176,0,0.15)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
            return;
        }

        this.analyser.getByteTimeDomainData(this.visualizerData);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffb000'; ctx.beginPath();
        const sw = W / this.visualizerData.length;
        let x = 0;
        for (let i = 0; i < this.visualizerData.length; i++) {
            const y = (this.visualizerData[i] / 128.0) * H / 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            x += sw;
        }
        ctx.lineTo(W, H / 2); ctx.stroke();
    }
}

window.addEventListener('DOMContentLoaded', () => { new DMRGenerator(); });

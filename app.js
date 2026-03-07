/**
 * ╔══════════════════════════════════════════════════╗
 * ║  STELARIS PRO 2.0 — Application Core             ║
 * ║  Phase 1: El Núcleo de Cristal                    ║
 * ║  Modules: CommandBus · Toast · Theme · Timeline   ║
 * ║           Player · Vault                          ║
 * ╚══════════════════════════════════════════════════╝
 */

/* ═══════════════════════════════════════════
   §1  COMMAND BUS  (Event Backbone)
   ═══════════════════════════════════════════ */
class CommandBus {
    constructor() {
        this._channels = {};
        this._log = [];
    }

    /** Subscribe to an event */
    on(event, handler) {
        if (!this._channels[event]) this._channels[event] = [];
        this._channels[event].push(handler);
        return () => this.off(event, handler);          // return unsubscribe fn
    }

    /** Unsubscribe */
    off(event, handler) {
        if (!this._channels[event]) return;
        this._channels[event] = this._channels[event].filter(h => h !== handler);
    }

    /** Emit an event */
    emit(event, data) {
        this._log.push({ event, data, ts: Date.now() });
        if (this._channels[event]) {
            this._channels[event].forEach(h => {
                try { h(data); } catch (err) { console.error(`[Bus] Error in "${event}":`, err); }
            });
        }
    }

    /** One-time listener */
    once(event, handler) {
        const unsub = this.on(event, (data) => { unsub(); handler(data); });
    }
}

/* ═══════════════════════════════════════════
   §2  TOAST MANAGER
   ═══════════════════════════════════════════ */
class ToastManager {
    constructor(bus, container, config) {
        this.bus = bus;
        this.el = container;
        this.cfg = config;
        this._count = 0;

        // Listen for bus events
        bus.on('toast', ({ message, type }) => this.show(message, type));
        bus.on('toast:success', (msg) => this.show(msg, 'success'));
        bus.on('toast:warning', (msg) => this.show(msg, 'warning'));
        bus.on('toast:error', (msg) => this.show(msg, 'error'));
        bus.on('toast:info', (msg) => this.show(msg, 'info'));
    }

    _icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };

    show(message, type = 'info') {
        // Limit visible toasts
        while (this.el.childElementCount >= this.cfg.maxVisible) {
            const oldest = this.el.firstElementChild;
            if (oldest) oldest.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.setProperty('--toast-duration', `${this.cfg.durationMs}ms`);
        toast.innerHTML = `
      <span class="toast-icon">${this._icons[type] || 'ℹ'}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" aria-label="Cerrar">✕</button>
      <div class="toast-progress"></div>
    `;

        // Close on click
        toast.querySelector('.toast-close').addEventListener('click', () => this._dismiss(toast));

        this.el.appendChild(toast);
        this._count++;

        // Auto-dismiss
        const timer = setTimeout(() => this._dismiss(toast), this.cfg.durationMs);
        toast._timer = timer;

        return toast;
    }

    _dismiss(toast) {
        if (toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._timer);
        toast.classList.add('leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }
}

/* ═══════════════════════════════════════════
   §3  THEME MANAGER
   ═══════════════════════════════════════════ */
class ThemeManager {
    constructor(bus, config) {
        this.bus = bus;
        this.cfg = config;
        this.current = localStorage.getItem(config.storageKey) || config.default;
    }

    /** Returns true if user has already chosen a theme */
    hasTheme() { return !!this.current; }

    /** Apply a theme */
    set(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.cfg.storageKey, theme);
        this.current = theme;
        // Update meta theme-color
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'gamer' ? '#07070f' : '#f3ede7';
        this.bus.emit('theme:changed', theme);
    }

    /** Toggle between themes */
    toggle() {
        const next = this.current === 'gamer' ? 'canva' : 'gamer';
        this.set(next);
        this.bus.emit('toast:info', `Tema cambiado a ${next === 'gamer' ? 'Gamer 🎮' : 'Canva 🎨'}`);
    }
}

/* ═══════════════════════════════════════════
   §4  PLAYER MODULE
   ═══════════════════════════════════════════ */
class PlayerModule {
    constructor(bus, config) {
        this.bus = bus;
        this.cfg = config;

        // DOM references
        this.video = document.getElementById('video-player');
        this.btnPlay = document.getElementById('btn-play');
        this.iconPlay = document.getElementById('icon-play');
        this.iconPause = document.getElementById('icon-pause');
        this.btnSkipBack = document.getElementById('btn-skip-back');
        this.btnSkipFwd = document.getElementById('btn-skip-forward');
        this.tCurrent = document.getElementById('timecode-current');
        this.tDuration = document.getElementById('timecode-duration');
        this.speedSlider = document.getElementById('speed-slider');
        this.speedValue = document.getElementById('speed-value');
        this.previewEmpty = document.getElementById('preview-empty');

        this._playing = false;
        this._animFrame = null;
        this._filters = {}; // Initialize filters state

        this._bind();
    }

    _bind() {
        this.btnPlay.addEventListener('click', () => this.togglePlay());
        this.btnSkipBack.addEventListener('click', () => this.skip(-this.cfg.skipSeconds));
        this.btnSkipFwd.addEventListener('click', () => this.skip(this.cfg.skipSeconds));

        // Speed slider
        this.speedSlider.min = this.cfg.minSpeed;
        this.speedSlider.max = this.cfg.maxSpeed;
        this.speedSlider.step = this.cfg.speedStep;
        this.speedSlider.value = this.cfg.defaultSpeed;
        this.speedSlider.addEventListener('input', () => this._onSpeedChange());

        // Video events
        this.video.addEventListener('loadedmetadata', () => this._onLoaded());
        this.video.addEventListener('ended', () => this._onEnded());
        this.video.addEventListener('timeupdate', () => this._onTimeUpdate());
        this.video.addEventListener('play', () => this._syncPlayState(true));
        this.video.addEventListener('pause', () => this._syncPlayState(false));

        // Bus commands
        this.bus.on('player:load', (file) => this.loadFile(file));
        this.bus.on('player:seek', (time) => this.seek(time));
        this.bus.on('player:toggle', () => this.togglePlay());
        this.bus.on('effect:update', (payload) => this._onEffectUpdate(payload));
    }

    loadFile(file) {
        const url = URL.createObjectURL(file);
        this.video.src = url;
        this.video.load();
        this.previewEmpty.classList.add('hidden');
        this.video.style.display = 'block';
        this.bus.emit('toast:success', `Video cargado: ${file.name}`);
    }

    togglePlay() {
        if (!this.video.src || this.video.readyState < 2) return;
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
    }

    skip(seconds) {
        if (!this.video.duration) return;
        this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    }

    seek(time) {
        if (!this.video.duration) return;
        this.video.currentTime = Math.max(0, Math.min(this.video.duration, time));
    }

    _onSpeedChange() {
        const speed = parseFloat(this.speedSlider.value);
        this.video.playbackRate = speed;
        this.video.preservesPitch = true;            // avoid voice distortion
        this.video.mozPreservesPitch = true;          // Firefox
        this.video.webkitPreservesPitch = true;       // Safari
        this.speedValue.textContent = `${speed.toFixed(speed % 1 ? 1 : 1)}x`;
        this.bus.emit('player:speed', speed);
    }

    _onLoaded() {
        this.tDuration.textContent = this._fmt(this.video.duration);
        this.bus.emit('player:loaded', {
            duration: this.video.duration,
            width: this.video.videoWidth,
            height: this.video.videoHeight,
        });
    }

    _onEnded() {
        this._syncPlayState(false);
        this.bus.emit('player:ended');
    }

    _onTimeUpdate() {
        this.tCurrent.textContent = this._fmt(this.video.currentTime);
        this.bus.emit('player:timeupdate', this.video.currentTime);
    }

    _syncPlayState(playing) {
        this._playing = playing;
        this.iconPlay.classList.toggle('hidden', playing);
        this.iconPause.classList.toggle('hidden', !playing);
        this.btnPlay.classList.toggle('playing', playing);
        this.bus.emit('player:playstate', playing);

        if (playing) {
            this._tickLoop();
        } else {
            cancelAnimationFrame(this._animFrame);
        }
    }

    _onEffectUpdate({ prop, value }) {
        if (!this._filters) this._filters = {};
        this._filters[prop] = value;
        this._applyVisualPipeline();
    }

    _applyVisualPipeline() {
        const f = this._filters || {};
        const b = f.brightness || 1;
        const c = f.contrast || 1;
        const s = f.saturation || 1;
        const e = f.exposure || 0; // Simulated with brightness
        const exp = Math.pow(2, e);

        // CSS Filter string
        const filterStr = `
            brightness(${b * exp}) 
            contrast(${c}) 
            saturate(${s})
            opacity(${f.opacity || 1})
        `;

        this.video.style.filter = filterStr;

        // Transform pipeline
        const scale = f.scale || 1;
        const rotate = f.rotation || 0;
        this.video.style.transform = `scale(${scale}) rotate(${rotate}deg)`;

        // Blend mode
        if (f.blendMode) this.video.style.mixBlendMode = f.blendMode;
    }

    /** High-frequency sync loop during playback */
    _tickLoop() {
        this._animFrame = requestAnimationFrame(() => {
            this.bus.emit('player:tick', this.video.currentTime);
            this.tCurrent.textContent = this._fmt(this.video.currentTime);
            if (this._playing) this._tickLoop();
        });
    }

    /** Format seconds → HH:MM:SS.ff */
    _fmt(sec) {
        if (!isFinite(sec)) return '00:00:00.00';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const f = Math.floor((sec % 1) * 100);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
    }
}

/* ═══════════════════════════════════════════
   §5  TIMELINE MODULE
   ═══════════════════════════════════════════ */
class TimelineModule {
    constructor(bus, config) {
        this.bus = bus;
        this.cfg = config;
        this._inPoint = null;
        this._outPoint = null;

        // DOM
        this.body = document.getElementById('timeline-body');
        this.rulerCanvas = document.getElementById('ruler-canvas');
        this.thumbCanvas = document.getElementById('thumbnail-canvas');
        this.waveCanvas = document.getElementById('waveform-canvas');
        this.playhead = document.getElementById('playhead');
        this.zoomSlider = document.getElementById('timeline-zoom');
        this.btnZoomIn = document.getElementById('btn-zoom-in');
        this.btnZoomOut = document.getElementById('btn-zoom-out');
        this.btnSnap = document.getElementById('btn-snap');
        this.videoTrackEmpty = document.getElementById('video-track-empty');
        this.audioTrackEmpty = document.getElementById('audio-track-empty');
        this.trackVideoContent = document.getElementById('track-video-content');
        this.trackAudioContent = document.getElementById('track-audio-content');

        this._duration = 0;
        this._zoom = parseFloat(this.zoomSlider.value);
        this._snap = false;
        this._audioCtx = null;
        this._audioBuffer = null;

        this._inPoint = null;
        this._outPoint = null;
        this.rangeOverlay = document.createElement('div');
        this.rangeOverlay.className = 'timeline-range-overlay hidden';
        this.body.querySelector('.timeline-tracks').appendChild(this.rangeOverlay);

        this._bind();
        this._resizeObserver();
    }

    _bind() {
        // Zoom controls
        this.zoomSlider.addEventListener('input', () => {
            this._zoom = parseFloat(this.zoomSlider.value);
            this._drawRuler();
            this._drawThumbnails();
            this._drawWaveform();
            this._updateRangeVisuals();
        });
        this.btnZoomIn.addEventListener('click', () => {
            this._zoom = Math.min(this.cfg.maxZoom, this._zoom + 0.5);
            this.zoomSlider.value = this._zoom;
            this._drawRuler();
            this._drawThumbnails();
            this._drawWaveform();
            this._updateRangeVisuals();
        });
        this.btnZoomOut.addEventListener('click', () => {
            this._zoom = Math.max(this.cfg.minZoom, this._zoom - 0.5);
            this.zoomSlider.value = this._zoom;
            this._drawRuler();
            this._drawThumbnails();
            this._drawWaveform();
            this._updateRangeVisuals();
        });
        this.btnSnap.addEventListener('click', () => {
            this._snap = !this._snap;
            this.btnSnap.classList.toggle('active', this._snap);
            this.bus.emit('toast:info', `Snap magnético: ${this._snap ? 'ON' : 'OFF'}`);
        });

        // Click on timeline body → seek
        this.trackVideoContent.addEventListener('click', (e) => this._onTrackClick(e));
        this.trackAudioContent.addEventListener('click', (e) => this._onTrackClick(e));

        // Bus events
        this.bus.on('player:loaded', (info) => this._onVideoLoaded(info));
        this.bus.on('player:tick', (time) => this._movePlayhead(time));
        this.bus.on('player:timeupdate', (time) => this._movePlayhead(time));
        this.bus.on('timeline:set-in', () => this.setInPoint());
        this.bus.on('timeline:set-out', () => this.setOutPoint());
        this.bus.on('timeline:clear-range', () => this.clearRange());
    }

    // In/Out Range Selection
    setInPoint() {
        const video = document.getElementById('video-player');
        if (!video.duration) return;
        this._inPoint = video.currentTime;
        if (this._outPoint !== null && this._inPoint >= this._outPoint) this._outPoint = null;
        this._updateRangeVisuals();
        this.bus.emit('toast:info', `In Point: ${this._fmtRuler(this._inPoint)}`);
    }

    setOutPoint() {
        const video = document.getElementById('video-player');
        if (!video.duration) return;
        this._outPoint = video.currentTime;
        if (this._inPoint !== null && this._outPoint <= this._inPoint) this._inPoint = null;
        this._updateRangeVisuals();
        this.bus.emit('toast:info', `Out Point: ${this._fmtRuler(this._outPoint)}`);
    }

    clearRange() {
        this._inPoint = null;
        this._outPoint = null;
        this._updateRangeVisuals();
        this.bus.emit('toast:info', 'Rango limpiado');
    }

    _updateRangeVisuals() {
        if (!this._duration || (this._inPoint === null && this._outPoint === null)) {
            this.rangeOverlay.classList.add('hidden');
            return;
        }

        const pxPerSec = this._totalWidth() / this._duration;
        const startX = (this._inPoint || 0) * pxPerSec;
        const endX = (this._outPoint !== null ? this._outPoint : this._duration) * pxPerSec;

        this.rangeOverlay.style.left = `${startX}px`;
        this.rangeOverlay.style.width = `${Math.max(1, endX - startX)}px`;
        this.rangeOverlay.classList.remove('hidden');
    }

    _resizeObserver() {
        const ro = new ResizeObserver(() => {
            this._sizeCanvases();
            this._drawRuler();
            this._drawThumbnails();
            this._drawWaveform();
            this._updateRangeVisuals();
        });
        ro.observe(this.body);
    }

    _sizeCanvases() {
        const w = this._totalWidth();
        const dpr = window.devicePixelRatio || 1;

        // Ruler
        this.rulerCanvas.width = w * dpr;
        this.rulerCanvas.height = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ruler-h')) * dpr || 26 * dpr;
        this.rulerCanvas.style.width = w + 'px';

        // Thumbnail
        const trackH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-h')) || 84;
        this.thumbCanvas.width = w * dpr;
        this.thumbCanvas.height = trackH * dpr;
        this.thumbCanvas.style.width = w + 'px';
        this.thumbCanvas.style.height = trackH + 'px';

        // Waveform
        this.waveCanvas.width = w * dpr;
        this.waveCanvas.height = trackH * dpr;
        this.waveCanvas.style.width = w + 'px';
        this.waveCanvas.style.height = trackH + 'px';
    }

    _totalWidth() {
        const containerW = this.body.clientWidth - 54;   // minus track-label width
        if (!this._duration) return containerW;
        return Math.max(containerW, this._duration * this._zoom * 30);   // 30px per second at zoom=1
    }

    /* ── Ruler Drawing ── */
    _drawRuler() {
        const canvas = this.rulerCanvas;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (!this._duration) return;

        const pxPerSec = (this._totalWidth() / this._duration);
        const step = this._rulerStep(pxPerSec);

        const style = getComputedStyle(document.documentElement);
        const textCol = style.getPropertyValue('--color-text-muted').trim() || '#666';
        const lineCol = style.getPropertyValue('--border-color').trim() || '#333';

        ctx.font = '10px Inter, sans-serif';
        ctx.fillStyle = textCol;
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = 1;

        for (let t = 0; t <= this._duration; t += step) {
            const x = t * pxPerSec;
            // Major tick
            ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, h - 10); ctx.stroke();
            // Label
            ctx.fillText(this._fmtRuler(t), x + 3, 11);
            // Minor ticks
            const minor = step / 4;
            for (let m = 1; m < 4 && (t + m * minor) <= this._duration; m++) {
                const mx = (t + m * minor) * pxPerSec;
                ctx.beginPath(); ctx.moveTo(mx, h); ctx.lineTo(mx, h - 5); ctx.stroke();
            }
        }
    }

    _rulerStep(pxPerSec) {
        const targets = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        for (const s of targets) {
            if (s * pxPerSec >= 60) return s;        // at least 60px between labels
        }
        return 600;
    }

    _fmtRuler(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /* ── Playhead ── */
    _movePlayhead(time) {
        if (!this._duration) return;
        const pxPerSec = this._totalWidth() / this._duration;
        const x = time * pxPerSec;
        this.playhead.style.transform = `translateX(${x}px)`;

        // Auto-scroll if playhead near edge
        const bodyScroll = this.body.scrollLeft;
        const bodyW = this.body.clientWidth;
        if (x > bodyScroll + bodyW - 80) {
            this.body.scrollLeft = x - bodyW + 120;
        } else if (x < bodyScroll + 40) {
            this.body.scrollLeft = Math.max(0, x - 120);
        }
    }

    _onTrackClick(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left + this.body.scrollLeft;
        if (!this._duration) return;
        const pxPerSec = this._totalWidth() / this._duration;
        const time = x / pxPerSec;
        this.bus.emit('player:seek', time);
    }

    /* ── Video Loaded ── */
    _onVideoLoaded(info) {
        this._duration = info.duration;
        this.videoTrackEmpty.classList.add('hidden');
        this.audioTrackEmpty.classList.add('hidden');
        this._inPoint = null;
        this._outPoint = null;
        this._sizeCanvases();
        this._drawRuler();
        this._generateThumbnails();
        this._generateWaveform();
        this._updateRangeVisuals();
    }

    /* ── Thumbnail Generation (Filmstrip) ── */
    async _generateThumbnails() {
        const video = document.getElementById('video-player');
        if (!video.src || !this._duration) return;

        const canvas = this.thumbCanvas;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const totalW = this._totalWidth();
        const h = canvas.height / dpr;

        // Calculate dynamic thumb width based on video aspect ratio
        const aspect = video.videoWidth / video.videoHeight || 16 / 9;
        const thumbW = h * aspect;
        const numThumbs = Math.ceil(totalW / thumbW);

        // Pre-fill with black
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width / dpr, h);

        const tempVideo = document.createElement('video');
        tempVideo.src = video.src;
        tempVideo.muted = true;
        tempVideo.preload = 'auto';

        this._thumbnails = [];
        await new Promise(r => { tempVideo.onloadeddata = r; tempVideo.load(); });

        for (let i = 0; i < numThumbs; i++) {
            const time = (i * thumbW / totalW) * this._duration;
            tempVideo.currentTime = time;
            await new Promise(r => { tempVideo.onseeked = r; });

            const x = i * thumbW;
            ctx.drawImage(tempVideo, x, 0, thumbW, h);

            // Filmstrip border
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, 0, thumbW, h);

            this._thumbnails.push({ time, x, w: thumbW });
        }

        tempVideo.remove();
        this.bus.emit('timeline:thumbnails:ready');
    }

    _drawThumbnails() {
        if (this._duration && document.getElementById('video-player').src) {
            this._generateThumbnails();
        }
    }

    /* ── Waveform Generation (Precise Full Duration) ── */
    async _generateWaveform() {
        const video = document.getElementById('video-player');
        if (!video.src) return;

        try {
            const response = await fetch(video.src);
            const arrayBuffer = await response.arrayBuffer();
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this._audioBuffer = await this._audioCtx.decodeAudioData(arrayBuffer);
            this._drawWaveform();
            this.bus.emit('timeline:waveform:ready');
        } catch (err) {
            console.warn('[Timeline] Could not decode audio:', err);
        }
    }

    _drawWaveform() {
        const canvas = this.waveCanvas;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.clearRect(0, 0, w, h);

        if (!this._audioBuffer) return;

        // Force waveform to span exactly total width by calculating pixels per second
        const totalW = this._totalWidth();
        const pxPerSec = totalW / this._duration;

        const channelData = this._audioBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        const sampleRate = this._audioBuffer.sampleRate;
        const audioDuration = totalSamples / sampleRate;

        // Ensure we draw up to the duration (match video mapping)
        const samplesPerPixel = sampleRate / pxPerSec;
        const midY = h / 2;

        const style = getComputedStyle(document.documentElement);
        const primaryRGB = style.getPropertyValue('--color-primary-rgb').trim() || '0,224,255';

        ctx.fillStyle = `rgba(${primaryRGB}, 0.7)`;

        // Draw pixel by pixel to ensure exact length match
        for (let x = 0; x < totalW; x++) {
            const startIndex = Math.floor(x * samplesPerPixel);
            const endIndex = Math.floor((x + 1) * samplesPerPixel);
            if (startIndex >= totalSamples) break;

            let min = 1, max = -1;
            for (let j = startIndex; j < endIndex && j < totalSamples; j++) {
                const s = channelData[j];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            const barH = Math.max(1, (max - min) * midY * 0.9);
            ctx.fillRect(x, midY - barH, 0.8, barH * 2);
        }

        ctx.strokeStyle = `rgba(${primaryRGB}, 0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
    }

}

/* ═══════════════════════════════════════════
   §6  VAULT MODULE
   ═══════════════════════════════════════════ */
class VaultModule {
    constructor(bus, config) {
        this.bus = bus;
        this.cfg = config;

        // DOM
        this.overlay = document.getElementById('vault-overlay');
        this.container = document.getElementById('vault-container');
        this.pinDisplay = document.getElementById('vault-pin-display');
        this.keypad = document.getElementById('vault-keypad');
        this.subtitle = document.getElementById('vault-subtitle');
        this.setupMsg = document.getElementById('vault-setup');
        this.btnClose = document.getElementById('vault-close');

        this._pin = '';
        this._isSetup = !localStorage.getItem(config.pinHashKey);
        this._attempts = 0;
        this._locked = false;

        this._bind();
    }

    _bind() {
        this.keypad.addEventListener('click', (e) => {
            const btn = e.target.closest('.vault-key');
            if (!btn || this._locked) return;
            const key = btn.dataset.key;
            if (key === 'backspace') this._pin = this._pin.slice(0, -1);
            else if (key === 'enter') this._submit();
            else if (this._pin.length < 15) this._pin += key;
            this._renderDots();
        });

        document.addEventListener('keydown', (e) => {
            if (this.overlay.classList.contains('hidden')) return;
            if (e.key >= '0' && e.key <= '9') {
                if (this._pin.length < 15) this._pin += e.key;
                this._renderDots();
            } else if (e.key === 'Backspace') {
                this._pin = this._pin.slice(0, -1);
                this._renderDots();
            } else if (e.key === 'Enter') this._submit();
        });

        this.btnClose.addEventListener('click', () => this.close());
        this.bus.on('vault:open', () => this.open());
        document.getElementById('btn-vault-change-pin').addEventListener('click', () => {
            this._isSetup = true;
            this._updateUI();
            this.bus.emit('toast:info', 'Configura tu nuevo PIN');
        });
    }

    open() {
        this.overlay.classList.remove('unlocked'); // Reset visual state
        this._pin = '';
        this._isSetup = !localStorage.getItem(this.cfg.pinHashKey);
        this._updateUI();
        this._renderDots();
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('visible');
    }

    close() {
        this.overlay.classList.add('hidden');
        this.overlay.classList.remove('visible', 'success', 'unlocked');
        this._pin = '';
        this.bus.emit('vault:closed');
    }

    _updateUI() {
        if (this._isSetup) {
            this.subtitle.textContent = 'Configura tu nuevo PIN';
            this.setupMsg.classList.remove('hidden');
        } else {
            this.subtitle.textContent = 'Ingresa tu PIN para acceder';
            this.setupMsg.classList.add('hidden');
        }
    }

    _renderDots() {
        const dots = this.pinDisplay;
        if (!dots) return;
        const currentLength = this._pin.length;
        dots.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const dot = document.createElement('div');
            dot.className = `pin-dot ${i < currentLength ? 'filled' : ''}`;
            dots.appendChild(dot);
        }
    }

    async _submit() {
        if (this._pin.length < 4) {
            this.bus.emit('toast:warning', 'El PIN debe tener al menos 4 dígitos');
            return;
        }

        const hash = await this._hash(this._pin);

        if (this._isSetup) {
            localStorage.setItem(this.cfg.pinHashKey, hash);
            this._isSetup = false;
            this.bus.emit('toast:success', 'PIN actualizado con éxito 🔐');
            this._showSuccess();
        } else {
            const stored = localStorage.getItem(this.cfg.pinHashKey);
            if (hash === stored) {
                this._attempts = 0;
                this.overlay.classList.add('unlocked');
                this.subtitle.textContent = 'Acceso concedido ✓';
                this.bus.emit('toast:success', 'Bóveda desbloqueada');
                this.bus.emit('vault:unlocked');

                // Close after a short delay
                setTimeout(() => this.close(), 1000);
            } else {
                this._attempts++;
                this._showError();
            }
        }
    }

    _showSuccess() {
        this.pinDisplay.classList.add('success');
        setTimeout(() => {
            this.close();
            this.pinDisplay.classList.remove('success');
        }, 800);
    }

    _showError() {
        this.pinDisplay.classList.add('shake');
        this.bus.emit('toast:error', `PIN incorrecto. Intentos: ${this._attempts}`);
        setTimeout(() => {
            this.pinDisplay.classList.remove('shake');
            this._pin = '';
            this._renderDots();
        }, 600);
    }

    async _hash(pin) {
        const encoder = new TextEncoder();
        const data = encoder.encode(pin + '_stelaris_salt_v2');
        const buffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /* ── DASHBOARD ASSET MANAGEMENT ── */
    addFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const assets = JSON.parse(localStorage.getItem('stelaris_vault_assets') || '[]');
            assets.push({
                id: Date.now(),
                name: file.name,
                type: file.type,
                data: e.target.result,
                date: Date.now()
            });
            localStorage.setItem('stelaris_vault_assets', JSON.stringify(assets));
            this.bus.emit('vault:asset-added');
        };
        reader.readAsDataURL(file);
    }

    getFiles() {
        return JSON.parse(localStorage.getItem('stelaris_vault_assets') || '[]');
    }

    deleteFile(id) {
        let assets = this.getFiles();
        assets = assets.filter(a => a.id !== id);
        localStorage.setItem('stelaris_vault_assets', JSON.stringify(assets));
        this.bus.emit('vault:asset-removed');
    }
}

/* ═══════════════════════════════════════════
   §7  FILE IMPORT HANDLER
   ═══════════════════════════════════════════ */
class FileImporter {
    constructor(bus, config) {
        this.bus = bus;
        this.cfg = config;

        this.fileInput = document.getElementById('file-input');
        this.btnImport = document.getElementById('btn-import');
        this.btnImportCta = document.getElementById('btn-import-cta');

        this._bind();
    }

    _bind() {
        const trigger = () => this.fileInput.click();

        this.btnImport.addEventListener('click', trigger);
        this.btnImportCta.addEventListener('click', trigger);

        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate size
            if (file.size > this.cfg.maxSizeMb * 1024 * 1024) {
                this.bus.emit('toast:error', `El archivo excede el límite de ${this.cfg.maxSizeMb} MB`);
                return;
            }

            this.bus.emit('player:load', file);
            this.bus.emit('file:loaded', file);

            // Reset input so same file can be re-selected
            this.fileInput.value = '';
        });
    }
}

/* ═══════════════════════════════════════════
   §8  PROPERTIES PANEL
   ═══════════════════════════════════════════ */
class PropertiesPanel {
    constructor(bus) {
        this.bus = bus;

        this.propEmpty = document.getElementById('prop-empty');
        this.propDetails = document.getElementById('prop-details');
        this.propName = document.getElementById('prop-name');
        this.propDuration = document.getElementById('prop-duration');
        this.propRes = document.getElementById('prop-resolution');
        this.propFps = document.getElementById('prop-fps');
        this.propSize = document.getElementById('prop-size');

        this._file = null;

        bus.on('file:loaded', (file) => { this._file = file; });
        bus.on('player:loaded', (info) => this._show(info));
    }

    _show(info) {
        this.propEmpty.classList.add('hidden');
        this.propDetails.classList.remove('hidden');

        this.propName.textContent = this._file?.name || 'Video';
        this.propDuration.textContent = this._fmtDur(info.duration);
        this.propRes.textContent = `${info.width} × ${info.height}`;
        this.propFps.textContent = '—';   // Will detect in future phases
        this.propSize.textContent = this._fmtSize(this._file?.size || 0);
    }

    _fmtDur(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m ${s}s`;
    }

    _fmtSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
}

/* ═══════════════════════════════════════════
   §9  TOOL SELECTOR
   ═══════════════════════════════════════════ */
class ToolSelector {
    constructor(bus) {
        this.bus = bus;
        this.tools = document.querySelectorAll('.tool-btn[data-tool]');
        this.current = 'select';

        this.tools.forEach(btn => {
            btn.addEventListener('click', () => {
                this.tools.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.current = btn.dataset.tool;
                this.bus.emit('tool:changed', this.current);
            });
        });
    }
}

/* ═══════════════════════════════════════════
   §10  SIDEBAR TABS
   ═══════════════════════════════════════════ */
class SidebarTabs {
    constructor(bus) {
        this.bus = bus;
        this.tabs = document.querySelectorAll('.stab[data-tab]');
        this.panels = document.querySelectorAll('.stab-panel');

        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => this.activate(tab.dataset.tab));
        });

        // Tool shortcuts
        bus.on('tool:changed', (tool) => {
            if (tool === 'snapshot') this.activate('stickers');
            if (tool === 'teamchat') this.activate('team-chat');
        });
    }

    activate(tabId) {
        this.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        this.panels.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
    }
}

/* ═══════════════════════════════════════════
   §11  COMMAND API  (Global interface for AI)
   ═══════════════════════════════════════════ */
class CommandAPI {
    constructor(bus, app) {
        this.bus = bus;
        this._app = app;
        this._registry = {};

        // Register all commands
        this._register('play', () => { bus.emit('player:toggle'); });
        this._register('pause', () => { const v = document.getElementById('video-player'); if (!v.paused) bus.emit('player:toggle'); });
        this._register('seek', (t) => bus.emit('player:seek', t));
        this._register('setSpeed', (s) => { const sl = document.getElementById('speed-slider'); sl.value = s; sl.dispatchEvent(new Event('input')); });
        this._register('cut', () => bus.emit('edit:cut'));
        this._register('split', () => bus.emit('edit:split'));
        this._register('setTheme', (t) => app.theme.set(t));
        this._register('toggleTheme', () => app.theme.toggle());
        this._register('openVault', () => bus.emit('vault:open'));
        this._register('snapshot', () => bus.emit('sticker:snapshot'));
        this._register('createRoom', () => bus.emit('mp:open-modal'));
        this._register('joinRoom', (code) => bus.emit('mp:join-room', code));
        this._register('toast', (msg, type) => bus.emit('toast', { message: msg, type: type || 'info' }));

        // Expose globally
        window.App = {};
        Object.keys(this._registry).forEach(name => {
            window.App[name] = this._registry[name];
        });
        window.App.help = () => {
            console.table(Object.keys(this._registry).map(k => ({ command: `App.${k}()` })));
            return 'Comandos disponibles. Usa App.<comando>() para ejecutar.';
        };
    }

    _register(name, fn) {
        this._registry[name] = (...args) => {
            this.bus.emit('command:exec', { name, args });
            return fn(...args);
        };
    }
}

/* ═══════════════════════════════════════════
   §12  STELAR AI  (UI Layer + Brain Bridge)
   ──────────────────────────────────────────
   Thin UI wrapper. All intelligence lives in
   stelar-core.js → StelarBrain (100% local)
   ═══════════════════════════════════════════ */

class StelarAI {
    constructor(bus) {
        this.bus = bus;
        this.brain = new StelarBrain(bus);
        this.isOpen = false;
        this._typing = false;

        // DOM
        this.bubble = document.getElementById('assistant-bubble');
        this.panel = document.getElementById('assistant-panel');
        this.input = document.getElementById('assistant-input');
        this.msgBox = document.getElementById('assistant-messages');
        this.btnSend = document.getElementById('assistant-send');
        this.btnClose = document.getElementById('assistant-close');

        this._bind();
        this._registerMultimodalIntents();

        // Log GPU capabilities
        this.brain.vision.isAvailable
            ? console.log('[StelarAI] TensorFlow.js detectado ✅')
            : console.log('[StelarAI] TensorFlow.js no cargado (visión deshabilitada)');

        // Init audio analysis when video loads
        bus.on('file:loaded', () => this.brain.initAudio());
    }

    _bind() {
        this.bubble.addEventListener('click', () => this.toggle());
        this.btnClose.addEventListener('click', () => this.toggle());
        this.btnSend.addEventListener('click', () => this.processInput());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.processInput(); }
        });
        this.bus.on('stelar:command', (text) => this.processText(text));
    }

    _registerMultimodalIntents() {
        // Register additional multimodal intents in the brain
        const intents = this.brain._intents || {};

        // Generate image/sticker
        intents['generate_asset'] = {
            patterns: ['genera', 'crea una imagen', 'generar sticker', 'crear sticker', 'genera un', 'dibuja', 'imagen de', 'sticker de'],
            handler: async (text) => {
                const desc = text.replace(/^(genera|crea|dibuja|generar|crear)\s*(una?\s*)?(imagen|sticker|dibujo)?\s*(de|con|que)?\s*/i, '').trim() || 'abstract gradient';
                return await this._generateAsset(desc);
            }
        };

        // Search resources
        intents['search_resources'] = {
            patterns: ['busca', 'encuentra', 'descarga', 'buscar', 'search'],
            handler: async (text) => {
                const query = text.replace(/^(busca|encuentra|descarga|buscar|search)\s*/i, '').trim();
                return await this._searchResources(query);
            }
        };

        // Place sticker at time
        intents['place_sticker'] = {
            patterns: ['colocar sticker', 'pon sticker', 'put sticker', 'agregar sticker en', 'añadir sticker en', 'poner sticker'],
            handler: async (text) => {
                return this._executeEditCommand('place_sticker', text);
            }
        };

        // Apply effect
        intents['apply_effect'] = {
            patterns: ['aplica efecto', 'add effect', 'pon efecto', 'aplicar', 'efecto de', 'efecto'],
            handler: async (text) => {
                return this._executeEditCommand('apply_effect', text);
            }
        };

        this.brain._intents = intents;
    }

    toggle() {
        const e = { cancel: false };
        this.bus.emit('ai:init', e);
        if (e.cancel) return;

        this.isOpen = !this.isOpen;
        this.panel.classList.toggle('hidden', !this.isOpen);
        if (this.isOpen) this.input.focus();
    }

    processInput() {
        const text = this.input.value.trim();
        if (!text || this._typing) return;
        this.input.value = '';
        this.processText(text);
    }

    async processText(text) {
        this._addMsg(text, 'user');
        this._typing = true;
        this._showTyping();

        let result;

        // Check multimodal intents first
        const multiResult = await this._checkMultimodalIntent(text);
        if (multiResult) {
            result = multiResult;
        } else {
            // Delegate to brain
            result = await this.brain.process(text);
        }

        // Small delay for natural feel
        await new Promise(r => setTimeout(r, 250 + Math.random() * 300));

        this._hideTyping();
        this._typing = false;

        if (result.preview) {
            this._addPreview(result.preview);
        }

        this._addMsg(result.response, 'bot');

        if (result.confidence > 0) {
            console.log(`[StelarAI] Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`);
        }
    }

    async _checkMultimodalIntent(text) {
        const lower = text.toLowerCase();
        const intents = this.brain._intents || {};

        for (const [name, intent] of Object.entries(intents)) {
            if (intent.patterns && intent.handler) {
                for (const pattern of intent.patterns) {
                    if (lower.includes(pattern)) {
                        const response = await intent.handler(text);
                        return { response, intent: name, confidence: 0.9 };
                    }
                }
            }
        }
        return null;
    }

    async _generateAsset(description) {
        this.bus.emit('toast:info', '🎨 Generando asset con IA...');

        // Generate a procedural image on canvas
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Create a visually interesting procedural generation
        const hue1 = Math.random() * 360;
        const hue2 = (hue1 + 60 + Math.random() * 120) % 360;
        const gradient = ctx.createRadialGradient(256, 256, 50, 256, 256, 300);
        gradient.addColorStop(0, `hsl(${hue1}, 80%, 60%)`);
        gradient.addColorStop(0.5, `hsl(${(hue1 + hue2) / 2}, 70%, 40%)`);
        gradient.addColorStop(1, `hsl(${hue2}, 60%, 20%)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        // Add geometric shapes
        for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const r = 20 + Math.random() * 80;
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue1 + Math.random() * 60}, 70%, 60%, ${0.15 + Math.random() * 0.3})`;
            ctx.fill();
        }

        // Add text label
        ctx.font = 'bold 28px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.fillText(description.slice(0, 30), 256, 480);

        // Convert to blob and save
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(blob);

        // Add to sticker lab
        if (window.stelaris?.stickers) {
            window.stelaris.stickers.stickers.push({ id: Date.now(), url, blob });
            window.stelaris.stickers._renderGrid();
        }

        // Save to vault
        if (window.stelaris?.vault) {
            const file = new File([blob], `AI_Asset_${Date.now()}.png`, { type: 'image/png' });
            window.stelaris.vault.addFile(file);
        }

        this.bus.emit('toast:success', '✨ Asset generado por IA');
        return {
            response: `🎨 **Asset generado:** "${description}"\n\nEl recurso ha sido creado y guardado en tu Bóveda. También está disponible en la Galería de Stickers para añadirlo al timeline.`,
            preview: { type: 'image', url }
        };
    }

    async _searchResources(query) {
        this.bus.emit('toast:info', '🔍 Buscando recursos...');
        await new Promise(r => setTimeout(r, 800));

        // Simulated search results (in production, this would use APIs)
        const results = [
            { title: `${query} - Pack Premium`, icon: '🎬', desc: 'Recurso libre de regalías' },
            { title: `${query} Overlay`, icon: '✨', desc: 'Efecto de superposición HD' },
            { title: `${query} Sound FX`, icon: '🔊', desc: 'Efecto de sonido profesional' },
        ];

        let html = `🔍 **Resultados para "${query}":**\n\n`;
        results.forEach((r, i) => {
            html += `${i + 1}. ${r.icon} **${r.title}** — _${r.desc}_\n`;
        });
        html += '\n_Selecciona un recurso o pide que lo descargue._';

        return { response: html, preview: { type: 'search', results } };
    }

    _executeEditCommand(type, text) {
        const lower = text.toLowerCase();

        if (type === 'place_sticker') {
            // Parse time from text
            const timeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:s|seg|segundo)/);
            const time = timeMatch ? parseFloat(timeMatch[1]) : 0;

            if (window.stelaris?.stickers?.stickers?.length > 0) {
                const lastSticker = window.stelaris.stickers.stickers[window.stelaris.stickers.stickers.length - 1];
                const video = document.getElementById('video-player');
                if (video) video.currentTime = time;
                window.stelaris.stickers.addToTimeline(lastSticker);
                return { response: `✅ **Sticker colocado** en el timeline a los ${time}s.\n\nPuedes ajustar su posición y duración arrastrando los handles en el timeline.` };
            }
            return { response: '⚠️ No hay stickers disponibles. Crea uno primero en el **Sticker Studio** o captura un frame.' };
        }

        if (type === 'apply_effect') {
            const effects = {
                'brillo': { prop: 'brightness', value: '1.3' },
                'brightness': { prop: 'brightness', value: '1.3' },
                'contraste': { prop: 'contrast', value: '1.4' },
                'contrast': { prop: 'contrast', value: '1.4' },
                'saturación': { prop: 'saturation', value: '1.5' },
                'saturation': { prop: 'saturation', value: '1.5' },
                'blur': { prop: 'blur', value: '2' },
                'desenfoque': { prop: 'blur', value: '2' },
                'sepia': { prop: 'sepia', value: '0.8' },
            };

            for (const [keyword, effect] of Object.entries(effects)) {
                if (lower.includes(keyword)) {
                    this.bus.emit('effect:update', effect);
                    return { response: `✨ **Efecto "${keyword}"** aplicado al video.\n\nPuedes ajustar la intensidad en el panel de propiedades.` };
                }
            }
            return { response: '🎨 Efectos disponibles: brillo, contraste, saturación, blur, sepia. ¿Cuál quieres aplicar?' };
        }

        return { response: 'Comando no reconocido. Intenta con más detalle.' };
    }

    _addMsg(text, who) {
        const div = document.createElement('div');
        div.className = `assistant-msg assistant-msg-${who}`;
        let content = text;
        if (typeof text === 'object' && text.response) content = text.response;
        const html = String(content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="font-size:.72rem;background:var(--bg-surface-hover);padding:.1em .3em;border-radius:3px">$1</code>')
            .replace(/\n/g, '<br>');
        div.innerHTML = `<span class="msg-text">${html}</span>`;
        this.msgBox.appendChild(div);
        this.msgBox.scrollTop = this.msgBox.scrollHeight;
    }

    _addPreview(preview) {
        if (!preview) return;
        const div = document.createElement('div');
        div.className = 'ai-gen-preview';

        if (preview.type === 'image' && preview.url) {
            div.innerHTML = `<img src="${preview.url}" alt="AI Generated">
                <div class="ai-gen-actions">
                    <button class="btn btn-primary btn-sm" data-action="add-tl">+ Timeline</button>
                    <button class="btn btn-ghost btn-sm" data-action="save-vault">💾 Bóveda</button>
                </div>`;

            div.querySelector('[data-action="add-tl"]').addEventListener('click', () => {
                if (window.stelaris?.stickers?.stickers?.length > 0) {
                    const lastSticker = window.stelaris.stickers.stickers[window.stelaris.stickers.stickers.length - 1];
                    window.stelaris.stickers.addToTimeline(lastSticker);
                }
            });
        } else if (preview.type === 'search' && preview.results) {
            div.className = 'ai-search-results';
            div.innerHTML = preview.results.map(r =>
                `<div class="ai-search-item">
                    <div class="search-icon">${r.icon}</div>
                    <div class="search-info"><span class="search-title">${r.title}</span><span class="search-desc">${r.desc}</span></div>
                </div>`
            ).join('');
        }

        this.msgBox.appendChild(div);
        this.msgBox.scrollTop = this.msgBox.scrollHeight;
    }

    _showTyping() {
        this._typingEl = document.createElement('div');
        this._typingEl.className = 'assistant-msg assistant-msg-bot';
        this._typingEl.innerHTML = '<span class="msg-text typing-dots"><span>•</span><span>•</span><span>•</span></span>';
        this.msgBox.appendChild(this._typingEl);
        this.msgBox.scrollTop = this.msgBox.scrollHeight;
    }

    _hideTyping() {
        if (this._typingEl) { this._typingEl.remove(); this._typingEl = null; }
    }
}
class MultiplayerClient {
    constructor(bus) {
        this.bus = bus;
        this.ws = null;
        this.userId = null;
        this.color = '#888';
        this.roomCode = null;
        this.users = [];

        // DOM
        this.modal = document.getElementById('mp-modal');
        this.modalClose = document.getElementById('mp-modal-close');
        this.nameInput = document.getElementById('mp-name');
        this.btnCreate = document.getElementById('mp-create');
        this.joinCode = document.getElementById('mp-join-code');
        this.btnJoin = document.getElementById('mp-join');
        this.formEl = document.querySelector('.modal-form');
        this.connectedEl = document.getElementById('mp-connected');
        this.displayCode = document.getElementById('mp-display-code');
        this.copyBtn = document.getElementById('mp-copy-code');
        this.userListEl = document.getElementById('mp-user-list');
        this.disconnBtn = document.getElementById('mp-disconnect');

        // Topbar
        this.mpStatus = document.getElementById('mp-status');
        this.mpBadge = document.getElementById('mp-badge');
        this.mpRoomCode = document.getElementById('mp-room-code');
        this.mpAvatars = document.getElementById('mp-avatars');

        // Ghost cursors
        this.ghostLayer = document.getElementById('ghost-cursors-layer');
        this._ghosts = {};

        // Team chat
        this.chatMsgsEl = document.getElementById('team-chat-messages');
        this.chatInput = document.getElementById('team-chat-input');
        this.chatSendBtn = document.getElementById('team-chat-send');
        this.chatEmptyEl = document.getElementById('chat-empty');

        this._bind();
    }

    _bind() {
        // Open modal
        document.getElementById('btn-multiplayer').addEventListener('click', () => this._openModal());
        this.bus.on('mp:open-modal', () => this._openModal());
        this.modalClose.addEventListener('click', () => this._closeModal());

        // Create / Join
        this.btnCreate.addEventListener('click', () => this._create());
        this.btnJoin.addEventListener('click', () => this._join());
        this.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._join(); });

        // Copy code
        this.copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.roomCode);
            this.bus.emit('toast:success', 'Código copiado al portapapeles');
        });

        // Disconnect
        this.disconnBtn.addEventListener('click', () => this._disconnect());

        // Send cursor position on workspace (global cursor tracking)
        document.getElementById('workspace')?.addEventListener('mousemove', (e) => this._sendCursor(e));

        // Team chat send
        this.chatSendBtn.addEventListener('click', () => this._sendChat());
        this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._sendChat(); });

        // Bus: listen for seek to broadcast
        this.bus.on('player:tick', (time) => this._broadcastState(time));

        // Listen for effect changes to broadcast
        this.bus.on('effect:update', (data) => this._broadcastEffect(data));

        // Listen for notes changes to broadcast
        const notesEl = document.getElementById('production-notes');
        if (notesEl) {
            notesEl.addEventListener('input', () => this._broadcastNotes(notesEl.value));
        }
    }

    _openModal() {
        const e = { cancel: false };
        this.bus.emit('multiplayer:init', e);
        if (e.cancel) return;

        this.modal.classList.remove('hidden');
        if (this.roomCode) {
            this.formEl.classList.add('hidden');
            this.connectedEl.classList.remove('hidden');
        } else {
            this.formEl.classList.remove('hidden');
            this.connectedEl.classList.add('hidden');
        }
    }

    _closeModal() { this.modal.classList.add('hidden'); }

    _connect(callback) {
        try {
            this.ws = new WebSocket('ws://localhost:4200');
            this.ws.onopen = () => callback();
            this.ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
            this.ws.onclose = () => this._onDisconnected();
            this.ws.onerror = () => {
                this.bus.emit('toast:error', 'No se pudo conectar al servidor multiplayer. Ejecuta: node server.js');
            };
        } catch {
            this.bus.emit('toast:error', 'WebSocket no disponible');
        }
    }

    _create() {
        const name = this.nameInput.value.trim() || 'Editor';
        this._connect(() => {
            this.ws.send(JSON.stringify({ type: 'create-room', name }));
        });
    }

    _join() {
        const name = this.nameInput.value.trim() || 'Editor';
        const code = this.joinCode.value.trim();
        if (!code) { this.bus.emit('toast:warning', 'Ingresa el código de sala'); return; }
        this._connect(() => {
            this.ws.send(JSON.stringify({ type: 'join-room', name, code }));
        });
    }

    _disconnect() {
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.roomCode = null;
        this.users = [];
        this._updateUI();
        this.mpStatus.classList.add('hidden');
        this.formEl.classList.remove('hidden');
        this.connectedEl.classList.add('hidden');
        // Clear ghosts
        Object.keys(this._ghosts).forEach(id => this._removeGhost(id));
        this.bus.emit('toast:info', 'Desconectado de la sala');
    }

    _sendCursor(e) {
        if (!this.ws || this.ws.readyState !== 1 || !this.roomCode) return;
        // Throttle to ~20fps
        if (this._lastCursorSend && Date.now() - this._lastCursorSend < 50) return;
        this._lastCursorSend = Date.now();
        this.ws.send(JSON.stringify({ type: 'cursor', x: e.clientX, y: e.clientY }));
    }

    /* ── BROADCAST SYSTEM ── */
    _setupBroadcaster() {
        this.bus.on('multiplayer:broadcast', (data) => {
            if (this.ws && this.ws.readyState === 1 && this.roomCode) {
                this.ws.send(JSON.stringify(data));
            }
        });
    }

    _onMessage(msg) {
        switch (msg.type) {
            case 'room-created':
            case 'room-joined':
                this.userId = msg.userId;
                this.color = msg.color;
                this.roomCode = msg.code;
                this.users = msg.users || [msg.user];
                this._updateUI();
                this._setupBroadcaster();
                this._showSyncIndicator('Conectado a sala ' + msg.code);
                break;
            case 'user-joined':
                this.users = msg.users;
                this._updateUI();
                this.bus.emit('toast:info', `${msg.name} se unió a la sala`);
                this._showSyncIndicator(`${msg.name} conectado`);
                break;
            case 'user-left':
                this.users = msg.users;
                this._updateUI();
                this._removeGhost(msg.userId);
                this.bus.emit('toast:info', `${msg.name} salió de la sala`);
                break;
            case 'cursor':
                this._updateGhost(msg.userId, msg.name, msg.color, msg.x, msg.y);
                break;
            case 'sticker:add':
                this.bus.emit('mp:sync-sticker', msg);
                this._showSyncIndicator('Sticker sincronizado');
                break;
            case 'chat':
                this._addChatMsg(msg.name, msg.color, msg.text);
                break;
            case 'state-sync':
                // Sync playback state from peer
                if (msg.state?.time !== undefined) {
                    this.bus.emit('player:seek', msg.state.time);
                }
                this._showSyncIndicator('Estado sincronizado');
                break;
            case 'note-sync':
                // Sync production notes
                const notesEl = document.getElementById('production-notes');
                if (notesEl && msg.userId !== this.userId) {
                    notesEl.value = msg.text;
                }
                break;
            case 'effect-sync':
                // Sync effect changes
                if (msg.userId !== this.userId) {
                    this.bus.emit('effect:update', msg.effect);
                }
                break;
            case 'error':
                this.bus.emit('toast:error', msg.message);
                break;
        }
    }

    _onDisconnected() {
        if (this.roomCode) {
            this.bus.emit('toast:warning', 'Conexión perdida con la sala');
            this._disconnect();
        }
    }

    _updateUI() {
        if (this.roomCode) {
            this.formEl.classList.add('hidden');
            this.connectedEl.classList.remove('hidden');
            this.displayCode.textContent = this.roomCode;
            this.userListEl.innerHTML = this.users.map(u =>
                `<div class="mp-user-item"><span class="mp-user-dot" style="background:${u.color}"></span>${u.name}${u.id === this.userId ? ' (tú)' : ''}</div>`
            ).join('');

            this.mpStatus.classList.remove('hidden');
            this.mpRoomCode.textContent = this.roomCode;
            this.mpAvatars.innerHTML = this.users.map(u =>
                `<div class="mp-avatar" style="background:${u.color}" title="${u.name}">${u.name[0].toUpperCase()}</div>`
            ).join('');
        }
    }

    _updateGhost(userId, name, color, x, y) {
        let ghost = this._ghosts[userId];
        if (!ghost) {
            ghost = document.createElement('div');
            ghost.className = 'ghost-cursor-global';
            ghost.innerHTML = `<div class="gc-icon" style="color:${color}">▲</div>
                               <div class="gc-label" style="background:${color}">${name.slice(0, 8)}</div>`;
            document.body.appendChild(ghost);
            this._ghosts[userId] = ghost;
        }
        // Position at absolute viewport coordinates
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
    }

    _removeGhost(userId) {
        if (this._ghosts[userId]) {
            this._ghosts[userId].remove();
            delete this._ghosts[userId];
        }
    }

    _showSyncIndicator(text) {
        let ind = document.querySelector('.sync-indicator');
        if (ind) ind.remove();
        ind = document.createElement('div');
        ind.className = 'sync-indicator';
        ind.innerHTML = `<div class="sync-dot"></div><span>${text}</span>`;
        document.body.appendChild(ind);
        setTimeout(() => ind.remove(), 3000);
    }

    /* ── Team Chat ── */
    _sendChat() {
        const text = this.chatInput.value.trim();
        if (!text || !this.ws || this.ws.readyState !== 1) return;
        this.ws.send(JSON.stringify({ type: 'chat', text }));
        this._addChatMsg(this.nameInput.value.trim() || 'Tú', this.color, text);
        this.chatInput.value = '';
    }

    _addChatMsg(name, color, text) {
        this.chatEmptyEl?.remove();
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<span class="chat-msg-name" style="color:${color}">${name}</span><span class="chat-msg-text">${text}</span>`;
        this.chatMsgsEl.appendChild(div);
        this.chatMsgsEl.scrollTop = this.chatMsgsEl.scrollHeight;
    }

    _broadcastState(time) {
        if (!this.ws || this.ws.readyState !== 1) return;
        if (this._lastBroadcast && Date.now() - this._lastBroadcast < 200) return;
        this._lastBroadcast = Date.now();
        this.ws.send(JSON.stringify({ type: 'state-sync', state: { time } }));
    }

    _broadcastEffect(effect) {
        if (!this.ws || this.ws.readyState !== 1 || !this.roomCode) return;
        this.ws.send(JSON.stringify({ type: 'effect-sync', effect }));
    }

    _broadcastNotes(text) {
        if (!this.ws || this.ws.readyState !== 1 || !this.roomCode) return;
        if (this._lastNoteBroadcast && Date.now() - this._lastNoteBroadcast < 500) return;
        this._lastNoteBroadcast = Date.now();
        this.ws.send(JSON.stringify({ type: 'note-sync', text }));
    }
}

/* ═══════════════════════════════════════════
   §14  STICKER STUDIO (DASHBOARD MODULE)
   ═══════════════════════════════════════════ */
class StickerStudioModule {
    constructor(bus) {
        this.bus = bus;
        this.el = document.getElementById('sticker-studio-workspace');
        this.canvas = document.getElementById('sticker-studio-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.colorInp = document.getElementById('ss-color');
        this.sizeInp = document.getElementById('ss-size');
        this.opacityInp = document.getElementById('ss-opacity');
        this.tools = document.querySelectorAll('.ss-tool');
        this.textPanel = document.getElementById('ss-text-panel');
        this.emptyMsg = document.getElementById('ss-empty-msg');

        this.currentTool = 'brush';
        this.isDrawing = false;
        this._hasContent = false;
        this._undoStack = [];
        this._maxUndo = 20;

        this._initCanvas();
        this._bind();
    }

    _initCanvas() {
        this.canvas.width = 800;
        this.canvas.height = 800;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    _pushUndo() {
        this._undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    }

    undo() {
        if (this._undoStack.length === 0) return;
        this.ctx.putImageData(this._undoStack.pop(), 0, 0);
    }

    _bind() {
        // Canvas drawing
        this.canvas.addEventListener('mousedown', (e) => this._startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this._draw(e));
        this.canvas.addEventListener('mouseup', () => this._stopDrawing());
        this.canvas.addEventListener('mouseleave', () => this._stopDrawing());

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDrawing(e.touches[0]); }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); this._draw(e.touches[0]); }, { passive: false });
        this.canvas.addEventListener('touchend', () => this._stopDrawing());

        // Tool selection
        this.tools.forEach(btn => {
            btn.addEventListener('click', () => {
                this.tools.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;
                // Show/hide text panel
                if (this.textPanel) {
                    this.textPanel.classList.toggle('hidden', this.currentTool !== 'text');
                }
            });
        });

        // Text tool add button
        const textAddBtn = document.getElementById('ss-text-add');
        if (textAddBtn) {
            textAddBtn.addEventListener('click', () => this._addText());
        }
        const textInput = document.getElementById('ss-text-input');
        if (textInput) {
            textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._addText(); });
        }

        // Action buttons
        document.getElementById('btn-sticker-ai-remove').addEventListener('click', () => this.removeBackground());
        document.getElementById('btn-sticker-save-vault').addEventListener('click', () => this.saveToVault());
        document.getElementById('btn-sticker-import').addEventListener('click', () => this.importBase());

        // Drag and drop
        this.canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this._loadImageFile(file);
            }
        });

        // Undo shortcut
        this.el.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
        });
    }

    _addText() {
        const textInput = document.getElementById('ss-text-input');
        const fontSelect = document.getElementById('ss-font-select');
        const sizeInput = document.getElementById('ss-text-size');
        const text = textInput?.value?.trim();
        if (!text) return;

        this._pushUndo();
        const fontSize = parseInt(sizeInput?.value || 36);
        const font = fontSelect?.value || 'Inter';
        const color = this.colorInp.value;
        const opacity = parseFloat(this.opacityInp?.value || 1);

        this.ctx.save();
        this.ctx.globalAlpha = opacity;
        this.ctx.font = `bold ${fontSize}px "${font}", sans-serif`;
        this.ctx.fillStyle = color;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        // Add text shadow for readability
        this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
        this.ctx.shadowBlur = 4;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;
        this.ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.restore();

        if (textInput) textInput.value = '';
        this._markContent();
        this.bus.emit('toast:success', 'Texto añadido al sticker');
    }

    _startDrawing(e) {
        if (this.currentTool === 'text' || this.currentTool === 'select') return;
        this._pushUndo();
        this.isDrawing = true;
        this.ctx.beginPath();
        const { x, y } = this._getPos(e);
        this.ctx.moveTo(x, y);
    }

    _draw(e) {
        if (!this.isDrawing) return;
        const { x, y } = this._getPos(e);
        const opacity = parseFloat(this.opacityInp?.value || 1);

        if (this.currentTool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.globalAlpha = 1;
        } else if (this.currentTool === 'shapes') {
            // Shapes mode draws circles at cursor
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.globalAlpha = opacity;
            this.ctx.fillStyle = this.colorInp.value;
            const size = parseInt(this.sizeInp.value);
            this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.globalAlpha = opacity;
            this.ctx.strokeStyle = this.colorInp.value;
        }

        this.ctx.lineWidth = this.sizeInp.value;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
    }

    _stopDrawing() {
        if (this.isDrawing) this._markContent();
        this.isDrawing = false;
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    _markContent() {
        this._hasContent = true;
        if (this.emptyMsg) this.emptyMsg.style.display = 'none';
    }

    _getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
        };
    }

    _loadImageFile(file) {
        if (!file) return;
        this.importBlob(file);
    }

    importBlob(blob) {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            this._pushUndo();
            const ratio = Math.min(this.canvas.width / img.width, this.canvas.height / img.height, 1);
            const w = img.width * ratio;
            const h = img.height * ratio;
            const x = (this.canvas.width - w) / 2;
            const y = (this.canvas.height - h) / 2;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, x, y, w, h);
            this._markContent();
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    async removeBackground() {
        this.bus.emit('toast:info', '🧠 Iniciando IA de recorte con GPU...');
        try {
            if (!window.stelaris?.ai?.brain?.vision?.isAvailable) {
                return this.bus.emit('toast:warning', 'TensorFlow.js/BodyPix no está cargado');
            }

            this.bus.emit('toast:info', '⏳ Cargando modelo de segmentación GPU...');
            await window.stelaris.ai.brain.vision.loadSegmentationModel();

            this._pushUndo();
            await window.stelaris.ai.brain.vision.removeBackground(this.canvas);

            // The canvas is modified in place, we just need to alert success
            this.bus.emit('toast:success', '✨ Fondo removido con IA local (GPU)');
        } catch (e) {
            console.error('[StickerStudio] Remove BG failed:', e);
            this.bus.emit('toast:error', '❌ Error al recortar fondo');
        }
    }

    saveToVault() {
        if (!this._hasContent) {
            this.bus.emit('toast:warning', 'El lienzo está vacío');
            return;
        }
        this.canvas.toBlob((blob) => {
            if (blob) {
                const file = new File([blob], `Sticker_${Date.now()}.png`, { type: 'image/png' });
                if (window.stelaris?.vault) {
                    window.stelaris.vault.addFile(file);
                }
                this.bus.emit('vault:save-asset', file);
                this.bus.emit('toast:success', '🔒 Sticker guardado en la Bóveda');
            }
        }, 'image/png');
    }

    importBase() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) this._loadImageFile(file);
        };
        input.click();
    }
}

/* ═══════════════════════════════════════════
   §14.1  STICKER LAB (EDITOR INTEGRATION)
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   §14.1  STICKER LAB (EDITOR INTEGRATION)
   ═══════════════════════════════════════════ */
class StickerLab {
    constructor(bus) {
        this.bus = bus;
        this.stickers = [];
        this.timelineStickers = [];
        this._selectedClipId = null;

        this.grid = document.getElementById('sticker-grid');
        this.btnSnapshot = document.getElementById('btn-snapshot');
        this.preview = document.getElementById('sticker-preview');
        this.canvas = document.getElementById('sticker-canvas');
        this.btnSave = document.getElementById('sticker-save');
        this.btnDiscard = document.getElementById('sticker-discard');

        this._currentBlob = null;
        this._dragState = null;
        this._bind();
    }

    _bind() {
        this.btnSnapshot.addEventListener('click', () => this.capture());
        this.btnSave.addEventListener('click', () => this._save());
        this.btnDiscard.addEventListener('click', () => this._discard());

        this.bus.on('sticker:snapshot', () => this.capture());
        this.bus.on('vault:asset-added', () => this._loadFromVault());
        this.bus.on('mp:sync-sticker', (data) => this._syncTimelineSticker(data));

        // "Add Sticker" button in timeline toolbar
        const btnAddSticker = document.getElementById('btn-add-sticker-tl');
        if (btnAddSticker) {
            btnAddSticker.addEventListener('click', () => this._openStickerGallery());
        }

        // Global mouse events for drag/resize
        document.addEventListener('mousemove', (e) => this._onDragMove(e));
        document.addEventListener('mouseup', () => this._onDragEnd());
    }

    async capture() {
        const video = document.getElementById('video-player');
        if (!video.src || !video.videoWidth) {
            this.bus.emit('toast:warning', 'Carga un video primero');
            return;
        }

        const c = this.canvas;
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(video, 0, 0, c.width, c.height);

        this.preview.classList.remove('hidden');
        this._currentTime = video.currentTime;

        // Create blob
        const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
        this._currentBlob = blob;

        // Send to Sticker Studio instantly
        if (window.stelaris?.dashboard) {
            window.stelaris.dashboard.switchView('stickers-studio');
            setTimeout(() => {
                if (window.stelaris.dashboard.stickerStudio) {
                    window.stelaris.dashboard.stickerStudio.importBlob(blob);
                }
            }, 150);
        }

        this.bus.emit('toast:success', '📸 Frame enviado al Sticker Studio');
    }

    _save() {
        if (!this._currentBlob) return;
        const url = URL.createObjectURL(this._currentBlob);
        const name = `Sticker_${Date.now()}`;

        const sticker = { id: Date.now(), url, blob: this._currentBlob };
        this.stickers.push(sticker);
        this._renderGrid();

        if (window.stelaris?.vault) {
            const file = new File([this._currentBlob], `${name}.png`, { type: 'image/png' });
            window.stelaris.vault.addFile(file);
        }
        this._discard();
    }

    _discard() {
        this.preview.classList.add('hidden');
        this._currentBlob = null;
    }

    _renderGrid() {
        if (!this.grid) return;
        if (this.stickers.length === 0) {
            this.grid.innerHTML = '<p class="sticker-empty">Captura frames para crear stickers</p>';
            return;
        }
        this.grid.innerHTML = this.stickers.map(s => `
            <div class="sticker-thumb" data-id="${s.id}">
                <img src="${s.url}" alt="Sticker">
                <button class="btn-add-to-tl" title="Añadir al Timeline">+</button>
            </div>
        `).join('');

        this.grid.querySelectorAll('.sticker-thumb').forEach(thumb => {
            thumb.querySelector('.btn-add-to-tl').addEventListener('click', () => {
                const s = this.stickers.find(x => x.id == thumb.dataset.id);
                if (s) this.addToTimeline(s);
            });
        });
    }

    addToTimeline(sticker) {
        const video = document.getElementById('video-player');
        const start = video?.currentTime || 0;
        const duration = 3;

        const clip = {
            id: 'st_cl_' + Date.now(),
            stickerId: sticker.id,
            url: sticker.url,
            startTime: start,
            endTime: start + duration,
            x: 50, y: 50, scale: 1, rotation: 0,
            animIn: 'none', animOut: 'none', animSpeed: 0.5
        };
        this.timelineStickers.push(clip);
        this._renderTimelineClips();
        this.bus.emit('multiplayer:broadcast', { type: 'sticker:add', data: clip });
        this.bus.emit('toast:success', '✨ Sticker añadido al timeline');
    }

    _renderTimelineClips() {
        const container = document.getElementById('stickers-layer-container');
        if (!container) return;

        const totalDuration = window.stelaris?.timeline?._duration || 0;
        if (totalDuration === 0) return;

        container.innerHTML = '';
        this.timelineStickers.forEach(clip => {
            const el = document.createElement('div');
            el.className = 'sticker-clip' + (clip.id === this._selectedClipId ? ' selected' : '');
            el.dataset.clipId = clip.id;
            const left = (clip.startTime / totalDuration) * 100;
            const width = ((clip.endTime - clip.startTime) / totalDuration) * 100;

            el.style.left = `${left}%`;
            el.style.width = `${Math.max(width, 1)}%`;
            el.innerHTML = `<img src="${clip.url}"><span>${this._fmtTime(clip.startTime)} → ${this._fmtTime(clip.endTime)}</span>
                            <div class="clip-handle clip-handle-l"></div>
                            <div class="clip-handle clip-handle-r"></div>`;

            // Drag to reposition
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('clip-handle')) return;
                this._selectClip(clip.id);
                this._dragState = { type: 'move', clipId: clip.id, startX: e.clientX, origStart: clip.startTime, origEnd: clip.endTime };
                el.classList.add('dragging');
                e.preventDefault();
            });

            // Click to select
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this._selectClip(clip.id);
            });

            // Resize handles
            el.querySelector('.clip-handle-l').addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this._dragState = { type: 'resize-l', clipId: clip.id, startX: e.clientX, origStart: clip.startTime };
                e.preventDefault();
            });
            el.querySelector('.clip-handle-r').addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this._dragState = { type: 'resize-r', clipId: clip.id, startX: e.clientX, origEnd: clip.endTime };
                e.preventDefault();
            });

            container.appendChild(el);
        });

        // Show animation panel for selected clip
        this._renderAnimPanel();

        document.getElementById('stickers-track-empty')?.classList.toggle('hidden', this.timelineStickers.length > 0);
    }

    _selectClip(id) {
        this._selectedClipId = id;
        document.querySelectorAll('.sticker-clip').forEach(el => {
            el.classList.toggle('selected', el.dataset.clipId === id);
        });
        this._renderAnimPanel();
    }

    _renderAnimPanel() {
        // Remove existing panels
        document.querySelectorAll('.sticker-anim-panel').forEach(p => p.remove());

        const clip = this.timelineStickers.find(c => c.id === this._selectedClipId);
        if (!clip) return;

        const el = document.querySelector(`.sticker-clip[data-clip-id="${clip.id}"]`);
        if (!el) return;

        const animations = ['none', 'fade', 'pop', 'slide', 'spin'];
        const panel = document.createElement('div');
        panel.className = 'sticker-anim-panel';
        panel.innerHTML = `
            <span class="anim-label">IN:</span>
            ${animations.map(a => `<button class="anim-btn ${clip.animIn === a ? 'active' : ''}" data-dir="in" data-anim="${a}">${a === 'none' ? '—' : a.charAt(0).toUpperCase() + a.slice(1)}</button>`).join('')}
            <span class="anim-label" style="margin-left:8px">OUT:</span>
            ${animations.map(a => `<button class="anim-btn ${clip.animOut === a ? 'active' : ''}" data-dir="out" data-anim="${a}">${a === 'none' ? '—' : a.charAt(0).toUpperCase() + a.slice(1)}</button>`).join('')}
            <span class="anim-label" style="margin-left:8px">⚡</span>
            <input type="range" class="anim-speed" min="0.1" max="2" step="0.1" value="${clip.animSpeed || 0.5}">
        `;

        panel.querySelectorAll('.anim-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const dir = btn.dataset.dir;
                const anim = btn.dataset.anim;
                if (dir === 'in') clip.animIn = anim;
                else clip.animOut = anim;
                this._renderTimelineClips();
                this.bus.emit('toast:info', `Animación ${dir === 'in' ? 'entrada' : 'salida'}: ${anim}`);
            });
        });

        panel.querySelector('.anim-speed').addEventListener('input', (e) => {
            clip.animSpeed = parseFloat(e.target.value);
        });

        el.style.position = 'absolute';  // Ensure positioning context
        el.appendChild(panel);
    }

    _onDragMove(e) {
        if (!this._dragState) return;
        const container = document.getElementById('stickers-layer-container');
        if (!container) return;

        const totalDuration = window.stelaris?.timeline?._duration || 0;
        if (totalDuration === 0) return;

        const rect = container.getBoundingClientRect();
        const pxPerSec = rect.width / totalDuration;
        const dx = e.clientX - this._dragState.startX;
        const dtSec = dx / pxPerSec;

        const clip = this.timelineStickers.find(c => c.id === this._dragState.clipId);
        if (!clip) return;

        if (this._dragState.type === 'move') {
            const dur = this._dragState.origEnd - this._dragState.origStart;
            clip.startTime = Math.max(0, this._dragState.origStart + dtSec);
            clip.endTime = clip.startTime + dur;
            if (clip.endTime > totalDuration) {
                clip.endTime = totalDuration;
                clip.startTime = clip.endTime - dur;
            }
        } else if (this._dragState.type === 'resize-l') {
            clip.startTime = Math.max(0, Math.min(this._dragState.origStart + dtSec, clip.endTime - 0.2));
        } else if (this._dragState.type === 'resize-r') {
            clip.endTime = Math.min(totalDuration, Math.max(this._dragState.origEnd + dtSec, clip.startTime + 0.2));
        }

        this._renderTimelineClips();
    }

    _onDragEnd() {
        if (this._dragState) {
            document.querySelectorAll('.sticker-clip.dragging').forEach(el => el.classList.remove('dragging'));
            this._dragState = null;
        }
    }

    _fmtTime(sec) {
        const s = Math.floor(sec);
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    _openStickerGallery() {
        // Toggle gallery panel near the button
        let panel = document.querySelector('.sticker-gallery-panel');
        if (panel) { panel.remove(); return; }

        const allStickers = [...this.stickers];
        panel = document.createElement('div');
        panel.className = 'sticker-gallery-panel';
        panel.innerHTML = `
            <div class="sg-header"><h3>✨ Galería de Stickers</h3><button class="btn btn-ghost btn-xs sg-close">✕</button></div>
            <div class="sg-body">
                ${allStickers.length === 0
                ? '<p style="grid-column:1/-1;text-align:center;color:var(--text-secondary);font-size:0.8rem">Sin stickers. Captura frames o crea en Sticker Studio.</p>'
                : allStickers.map(s => `<div class="sg-item" data-id="${s.id}"><img src="${s.url}" alt=""></div>`).join('')}
            </div>`;

        panel.querySelector('.sg-close').addEventListener('click', () => panel.remove());
        panel.querySelectorAll('.sg-item').forEach(item => {
            item.addEventListener('click', () => {
                const s = allStickers.find(x => x.id == item.dataset.id);
                if (s) { this.addToTimeline(s); panel.remove(); }
            });
        });

        const btn = document.getElementById('btn-add-sticker-tl');
        if (btn) btn.parentElement.style.position = 'relative';
        btn?.parentElement.appendChild(panel);
    }

    _syncTimelineSticker(data) {
        if (data.type === 'sticker:add') {
            this.timelineStickers.push(data.data);
        }
        this._renderTimelineClips();
    }

    _loadFromVault() {
        this._renderGrid();
    }
}

/* ═══════════════════════════════════════════
   §14.5 LICENSE MANAGER (Muro de Pago Inteligente)
   ═══════════════════════════════════════════ */
class LicenseManager {
    constructor(bus) {
        this.bus = bus;
        this.hasPro = this._checkLicense();

        // Modal DOM (to be appended or expected in HTML)
        this._bind();
    }

    _checkLicense() {
        return localStorage.getItem('STELARIS_LICENSE') === 'PRO_ACTIVE';
    }

    activatePro(key) {
        if (key === 'STELAR-2026-PRO') {
            localStorage.setItem('STELARIS_LICENSE', 'PRO_ACTIVE');
            this.hasPro = true;
            this.bus.emit('toast:success', '✨ Licencia Extendida Activada. ¡Bienvenido a PRO!');
            return true;
        }
        this.bus.emit('toast:error', '❌ Clave de licencia inválida');
        return false;
    }

    requirePro(featureName) {
        if (this.hasPro) return true;

        // Show Paywall
        this._showPaywall(featureName);
        return false;
    }

    _bind() {
        // Intercept features
        this.bus.on('multiplayer:init', (e) => {
            if (!this.requirePro('Multiplayer & Sincronización')) e.cancel = true;
        });
        this.bus.on('ai:init', (e) => {
            if (!this.requirePro('Stelar AI & Comandos Profesionales')) e.cancel = true;
        });
    }

    _showPaywall(feature) {
        let modal = document.getElementById('paywall-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'paywall-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-card paywall-card" style="border: 1px solid var(--color-primary); box-shadow: 0 0 30px rgba(0, 224, 255, 0.2);">
                    <button class="modal-close" onclick="document.getElementById('paywall-modal').classList.add('hidden')">✕</button>
                    <h2>🚀 Desbloquea <span style="color:var(--color-primary)">STELARIS PRO</span></h2>
                    <p class="modal-desc" id="paywall-desc">Esta función requiere una Licencia Extendida</p>
                    <div class="paywall-features" style="text-align:left; margin: 1.5rem 0; font-size: 0.9rem; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px;">
                        <div style="margin-bottom:0.5rem">✨ <strong>Stelar AI Brain:</strong> Comandos por lenguaje natural</div>
                        <div style="margin-bottom:0.5rem">👥 <strong>Multiplayer:</strong> Edición en tiempo real (5 personas)</div>
                        <div style="margin-bottom:0.5rem">✂️ <strong>Sticker Lab:</strong> Recorte mágico con GPU</div>
                    </div>
                    <div class="modal-form">
                        <input type="text" id="license-key" class="modal-input" placeholder="Ingresa tu Clave de Licencia" autocomplete="off">
                        <div class="modal-actions">
                            <button class="btn btn-primary" id="btn-activate-license" style="width:100%">Activar Licencia</button>
                            <button class="btn btn-ghost" onclick="window.open('https://example.com/buy','_blank')" style="width:100%; margin-top:0.5rem">Obtener Licencia</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('btn-activate-license').addEventListener('click', () => {
                const key = document.getElementById('license-key').value.trim();
                if (this.activatePro(key)) {
                    modal.classList.add('hidden');
                }
            });
        }

        document.getElementById('paywall-desc').textContent = `${feature} requiere una Licencia Extendida.`;
        modal.classList.remove('hidden');
    }
}

/* ═══════════════════════════════════════════
   §14.8 IMAGE EDITOR MODULE (Pestaña "Stelar Image")
   ═══════════════════════════════════════════ */
class ImageEditorModule {
    constructor(bus) {
        this.bus = bus;
        this.mainVideoSection = document.getElementById('editor-main');
        this.mainImageSection = document.getElementById('editor-image-main');

        this.btnModeVideo = document.getElementById('mode-video');
        this.btnModeImage = document.getElementById('mode-image');

        this.canvas = document.getElementById('main-image-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.emptyMsg = document.getElementById('image-empty');
        this.btnUpload = document.getElementById('img-btn-upload');
        this.btnGenerate = document.getElementById('img-btn-generate');
        this.btnEnhance = document.getElementById('img-btn-enhance');
        this.btnRemoveBg = document.getElementById('img-btn-removebg');
        this.btnExport = document.getElementById('img-btn-export');

        this.currentImage = null;
        this._bind();
    }

    _bind() {
        // Mode switching
        this.btnModeVideo.addEventListener('click', () => this.switchMode('video'));
        this.btnModeImage.addEventListener('click', () => this.switchMode('image'));

        // Actions
        this.btnUpload.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => this.loadImage(e.target.files[0]);
            input.click();
        });

        const btnMiniatura = document.getElementById('img-btn-miniatura');
        if (btnMiniatura) {
            btnMiniatura.addEventListener('click', async () => {
                if (window.stelaris && window.stelaris.stickers) {
                    this.bus.emit('toast:info', 'Procesando miniatura desde el video...');
                    await window.stelaris.stickers.capture();
                    if (window.stelaris.stickers._currentBlob) {
                        const file = new File([window.stelaris.stickers._currentBlob], 'miniatura.png', { type: 'image/png' });
                        this.loadImage(file);
                        this.bus.emit('toast:success', '🖼️ Miniatura lista para edición');
                    }
                }
            });
        }

        this.btnRemoveBg.addEventListener('click', async () => {
            if (!this.currentImage) return this.bus.emit('toast:warning', 'Carga una imagen primero');
            if (!window.stelaris || !window.stelaris.ai?.brain?.vision?.isAvailable) {
                return this.bus.emit('toast:warning', 'TensorFlow.js no está cargado');
            }
            this.bus.emit('toast:info', 'Recortando fondo con GPU...');
            await window.stelaris.ai.brain.vision.loadSegmentationModel();
            await window.stelaris.ai.brain.vision.removeBackground(this.canvas);

            // Re-store the edited image internally from canvas
            const img = new Image();
            img.src = this.canvas.toDataURL('image/png');
            img.onload = () => { this.currentImage = img; }
        });

        this.btnEnhance.addEventListener('click', () => {
            if (!this.currentImage) return this.bus.emit('toast:warning', 'Carga una imagen primero');
            // Auto enhance: Simple brightness/contrast filter via CSS / Canvas for MVP
            this.ctx.filter = 'brightness(1.1) contrast(1.15) saturate(1.1)';
            this.ctx.drawImage(this.currentImage, 0, 0, this.canvas.width, this.canvas.height);
            this.ctx.filter = 'none'; // reset
            this.bus.emit('toast:success', 'Mejora automática aplicada');

            // Re-store internally (simulate state change)
            const img = new Image();
            img.src = this.canvas.toDataURL('image/png');
            img.onload = () => { this.currentImage = img; }
        });

        this.btnGenerate.addEventListener('click', () => {
            this.bus.emit('toast:info', 'Generación de Imagen IA: Integración Diffusion GPU pendiente en próximas versiones.');
        });

        this.btnExport.addEventListener('click', () => {
            if (!this.currentImage) return this.bus.emit('toast:warning', 'No hay imagen para exportar');
            this.canvas.toBlob((blob) => {
                if (window.stelaris && window.stelaris.vault) {
                    const f = new File([blob], `StelarImage_${Date.now()}.png`, { type: 'image/png' });
                    window.stelaris.vault.addFile(f);
                    this.bus.emit('toast:success', 'Imagen exportada a la Bóveda Segura');
                } else {
                    this.bus.emit('toast:error', 'Bóveda no disponible');
                }
            }, 'image/png');
        });
    }

    switchMode(mode) {
        if (mode === 'video') {
            this.btnModeVideo.classList.add('active');
            this.btnModeImage.classList.remove('active');
            this.mainVideoSection.classList.remove('hidden');
            this.mainImageSection.classList.add('hidden');
        } else {
            this.btnModeImage.classList.add('active');
            this.btnModeVideo.classList.remove('active');
            this.mainImageSection.classList.remove('hidden');
            this.mainVideoSection.classList.add('hidden');
        }
    }

    loadImage(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.currentImage = img;
                this.emptyMsg.style.display = 'none';

                // Set canvas size to match image for editing
                const maxW = this.canvas.parentElement.clientWidth - 40;
                const maxH = this.canvas.parentElement.clientHeight - 40;
                const ratio = Math.min(maxW / img.width, maxH / img.height, 1);

                this.canvas.width = img.width;
                this.canvas.height = img.height;
                this.canvas.style.width = `${img.width * ratio}px`;
                this.canvas.style.height = `${img.height * ratio}px`;

                this.ctx.drawImage(img, 0, 0);
                this.bus.emit('toast:success', 'Imagen cargada en el Canvas');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

/* ═══════════════════════════════════════════
   §15  PROPERTY PANEL (El Arsenal Maestro)
   ═══════════════════════════════════════════ */
class PropertyPanel {
    constructor(bus) {
        this.bus = bus;
        this.empty = document.getElementById('prop-empty');
        this.details = document.getElementById('prop-details');

        // Form inputs
        this.nameEl = document.getElementById('prop-name');
        this.durationEl = document.getElementById('prop-duration');

        this._bind();
    }

    _bind() {
        // Listen for track selections
        this.bus.on('player:video:loaded', (info) => this.showMediaInfo(info));

        // Listen for all range inputs in properties
        document.querySelectorAll('.prop-section input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                const value = e.target.value;
                this.applyChange(prop, value);
            });
        });

        document.getElementById('btn-reset-props').addEventListener('click', () => this.reset());
        document.getElementById('btn-add-keyframe').addEventListener('click', () => {
            this.bus.emit('toast:success', '💎 Keyframe añadido en la posición actual');
        });
    }

    showMediaInfo(info) {
        if (!this.empty || !this.details) return;
        this.empty.classList.add('hidden');
        this.details.classList.remove('hidden');
        this.nameEl.textContent = info.name || 'Video Principal';
        this.durationEl.textContent = `${info.duration.toFixed(2)}s`;

        const res = document.getElementById('prop-resolution');
        if (res) res.textContent = `${info.width}x${info.height}`;
    }

    applyChange(prop, value) {
        console.log(`[Properties] ${prop} -> ${value}`);
        this.bus.emit('effect:update', { prop, value });

        if (prop === 'gain') {
            const out = document.getElementById('gain-out');
            if (out) out.textContent = `${value}dB`;
        }
    }

    reset() {
        document.querySelectorAll('.prop-section input').forEach(input => {
            if (input.type === 'range') input.value = input.defaultValue;
            if (input.type === 'number') input.value = input.defaultValue;
        });
        this.bus.emit('toast:info', 'Parámetros reseteados');
    }
}

/* ═══════════════════════════════════════════
   §16  DASHBOARD MODULE
   ═══════════════════════════════════════════ */
class DashboardModule {
    constructor(bus) {
        this.bus = bus;
        this.el = document.getElementById('dashboard');
        this.appEl = document.getElementById('app');
        this.grid = document.getElementById('project-grid');
        this.btnNew = document.getElementById('btn-new-project');
        this.viewTitle = document.getElementById('ds-view-title');

        this.projects = JSON.parse(localStorage.getItem('stelaris_projects') || '[]');
        this.currentView = 'projects';
        this.currentProjectId = null;

        this._bind();
        this._render();
    }

    _bind() {
        if (this.btnNew) this.btnNew.addEventListener('click', () => this.createNew());

        const btnClose = document.getElementById('btn-close-project');
        if (btnClose) btnClose.addEventListener('click', () => this.closeProject());

        // Nav buttons
        document.querySelectorAll('.ds-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                if (view === 'vault' && this.currentView !== 'vault') {
                    this.bus.emit('vault:open');
                    return;
                }
                this.switchView(view);
            });
        });

        this.bus.on('vault:unlocked', () => {
            this.switchView('vault');
        });

        this.bus.on('project:lock-toggle', (isPrivate) => {
            const p = this.projects.find(x => x.id === this.currentProjectId);
            if (p) {
                p.isPrivate = isPrivate;
                p.updated = Date.now();
                this._save();
                this.bus.emit('toast:info', isPrivate ? 'Video movido a la Bóveda' : 'Video movido al Inicio');
            }
        });
    }

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.ds-nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });

        const projectActions = document.getElementById('ds-project-actions');
        const stickerActions = document.getElementById('ds-sticker-actions');
        const stickerWorkspace = document.getElementById('sticker-studio-workspace');
        const projectGrid = document.getElementById('project-grid');

        // Hide all specialty views first
        stickerActions?.classList.add('hidden');
        stickerWorkspace?.classList.add('hidden');

        if (view === 'stickers-studio') {
            projectActions?.classList.add('hidden');
            stickerActions?.classList.remove('hidden');
            projectGrid?.classList.add('hidden');
            stickerWorkspace?.classList.remove('hidden');
            if (this.viewTitle) this.viewTitle.textContent = '✨ Sticker Studio';
            if (!this.stickerStudio) {
                this.stickerStudio = new StickerStudioModule(this.bus);
            }
        } else if (view === 'templates') {
            projectActions?.classList.add('hidden');
            projectGrid?.classList.remove('hidden');
            if (this.viewTitle) this.viewTitle.textContent = '🏛 Plantillas';
            this._renderTemplates();
        } else if (view === 'settings') {
            projectActions?.classList.add('hidden');
            projectGrid?.classList.remove('hidden');
            if (this.viewTitle) this.viewTitle.textContent = '⚙️ Ajustes';
            this._renderSettings();
        } else if (view === 'vault') {
            projectActions?.classList.remove('hidden');
            projectGrid?.classList.remove('hidden');
            if (this.viewTitle) this.viewTitle.textContent = 'Bóveda Blindada 🔐';
            this._render();
        } else {
            // Default: projects
            projectActions?.classList.remove('hidden');
            projectGrid?.classList.remove('hidden');
            if (this.viewTitle) this.viewTitle.textContent = 'Tus Proyectos';
            this._render();
        }
    }

    _renderTemplates() {
        const grid = document.getElementById('project-grid');
        if (!grid) return;
        grid.innerHTML = `
            <div class="project-card" data-tpl="vlog" style="cursor:pointer">
                <div class="pc-thumb" style="background:linear-gradient(135deg,#0a0a1e,#1a0a2e);display:flex;align-items:center;justify-content:center">
                    <span style="font-size:2.5rem">🎬</span>
                </div>
                <div class="pc-body"><span class="pc-title">Vlog Personal</span><span class="pc-meta">16:9 · 1080p · 30fps</span></div>
            </div>
            <div class="project-card" data-tpl="short" style="cursor:pointer">
                <div class="pc-thumb" style="background:linear-gradient(135deg,#1a0a0a,#2e0a1a);display:flex;align-items:center;justify-content:center">
                    <span style="font-size:2.5rem">📱</span>
                </div>
                <div class="pc-body"><span class="pc-title">Short / Reel</span><span class="pc-meta">9:16 · 1080p · 60fps</span></div>
            </div>
            <div class="project-card" data-tpl="cinematic" style="cursor:pointer">
                <div class="pc-thumb" style="background:linear-gradient(135deg,#0a0e1a,#0a2e2e);display:flex;align-items:center;justify-content:center">
                    <span style="font-size:2.5rem">🎞️</span>
                </div>
                <div class="pc-body"><span class="pc-title">Cinemático</span><span class="pc-meta">21:9 · 4K · 24fps</span></div>
            </div>
            <div class="project-card" data-tpl="presentation" style="cursor:pointer">
                <div class="pc-thumb" style="background:linear-gradient(135deg,#0e0a1a,#1a1a2e);display:flex;align-items:center;justify-content:center">
                    <span style="font-size:2.5rem">📊</span>
                </div>
                <div class="pc-body"><span class="pc-title">Presentación</span><span class="pc-meta">16:9 · 1080p · Slideshow</span></div>
            </div>
        `;
        grid.querySelectorAll('.project-card[data-tpl]').forEach(card => {
            card.addEventListener('click', () => {
                const tplName = card.dataset.tpl;
                const title = card.querySelector('.pc-title')?.textContent || 'Nuevo Proyecto';
                this._createProjectFromTemplate(tplName, title);
            });
        });
    }

    _createProjectFromTemplate(tpl, title) {
        const id = 'proj_' + Date.now();
        this.projects.push({ id, title: `${title} - ${new Date().toLocaleDateString()}`, updated: Date.now(), duration: '00:00', isPrivate: false, thumb: '', notes: '' });
        this._save();
        this.bus.emit('toast:success', `📋 Proyecto creado desde plantilla "${title}"`);
        this.openProject(id);
    }

    _renderSettings() {
        const grid = document.getElementById('project-grid');
        if (!grid) return;
        const currentTheme = document.documentElement.dataset.theme || 'gamer';
        const hasPro = localStorage.getItem('STELARIS_LICENSE') === 'PRO_ACTIVE';

        grid.innerHTML = `
            <div class="ds-settings-section" style="grid-column:1/-1; padding:0">
                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem">
                    <h3 style="font-size:1rem;margin-bottom:1rem">🎨 Tema Visual</h3>
                    <div style="display:flex;gap:1rem">
                        <button class="btn ${currentTheme === 'gamer' ? 'btn-primary' : 'btn-ghost'}" id="set-theme-gamer" style="flex:1">🎮 Gamer</button>
                        <button class="btn ${currentTheme === 'canva' ? 'btn-primary' : 'btn-ghost'}" id="set-theme-canva" style="flex:1">🎨 Canva</button>
                    </div>
                </div>

                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem">
                    <h3 style="font-size:1rem;margin-bottom:1rem">🔑 Licencia</h3>
                    <p style="color:#ccc;font-size:0.85rem;margin-bottom:1rem">
                        Estado: <strong style="color:${hasPro ? 'var(--color-success)' : 'var(--color-warning)'}">${hasPro ? '✅ PRO Activado' : '⚠️ Versión Gratuita'}</strong>
                    </p>
                    ${!hasPro ? `
                        <div style="display:flex;gap:0.5rem">
                            <input type="text" id="settings-license-key" class="modal-input" placeholder="STELAR-2026-PRO" style="flex:1;text-align:left;font-family:var(--font-mono);letter-spacing:0.1em">
                            <button class="btn btn-primary" id="settings-activate-btn">Activar</button>
                        </div>
                    ` : '<p style="color:#ccc;font-size:0.8rem">Todas las funciones están desbloqueadas.</p>'}
                </div>

                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem">
                    <h3 style="font-size:1rem;margin-bottom:1rem">💾 Datos</h3>
                    <p style="color:#ccc;font-size:0.85rem;margin-bottom:1rem">Proyectos guardados: <strong style="color:var(--color-text)">${this.projects.length}</strong></p>
                    <div style="display:flex;gap:1rem">
                        <button class="btn btn-ghost" id="settings-export-btn" style="flex:1">📦 Exportar datos</button>
                        <button class="btn btn-ghost" id="settings-clear-btn" style="flex:1;color:var(--color-error)">🗑 Limpiar todo</button>
                    </div>
                </div>

                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:14px;padding:1.5rem">
                    <h3 style="font-size:1rem;margin-bottom:0.5rem">ℹ️ Acerca de</h3>
                    <p style="color:#ccc;font-size:0.85rem;line-height:1.6">
                        <strong style="color:var(--color-text)">STELARIS PRO</strong> v2.0.0<br>
                        Editor de Video Profesional con IA Local<br>
                        © 2026 Eliecer Git
                    </p>
                </div>
            </div>
        `;

        // Bind settings actions
        document.getElementById('set-theme-gamer')?.addEventListener('click', () => {
            this.bus.emit('theme:set', 'gamer');
            this.bus.emit('toast:success', '🎮 Tema Gamer activado');
            setTimeout(() => this._renderSettings(), 300);
        });
        document.getElementById('set-theme-canva')?.addEventListener('click', () => {
            this.bus.emit('theme:set', 'canva');
            this.bus.emit('toast:success', '🎨 Tema Canva activado');
            setTimeout(() => this._renderSettings(), 300);
        });
        document.getElementById('settings-activate-btn')?.addEventListener('click', () => {
            const key = document.getElementById('settings-license-key')?.value?.trim();
            if (key && window.stelaris?.license?.activatePro(key)) {
                this._renderSettings();
            }
        });
        document.getElementById('settings-export-btn')?.addEventListener('click', () => {
            const data = JSON.stringify({ projects: this.projects, license: localStorage.getItem('STELARIS_LICENSE') }, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `stelaris_backup_${Date.now()}.json`;
            a.click();
            this.bus.emit('toast:success', '📦 Datos exportados');
        });
        document.getElementById('settings-clear-btn')?.addEventListener('click', () => {
            if (confirm('¿Estás seguro? Esto eliminará todos los proyectos guardados.')) {
                this.projects = [];
                this._save();
                this.bus.emit('toast:info', '🗑 Datos limpiados');
                this._renderSettings();
            }
        });
    }

    _render() {
        if (!this.grid) return;

        let filtered = [];
        if (this.currentView === 'projects') {
            filtered = this.projects.filter(p => !p.isPrivate);
        } else if (this.currentView === 'vault') {
            filtered = this.projects.filter(p => p.isPrivate);
        } else {
            filtered = this.projects;
        }

        if (filtered.length === 0) {
            this.grid.innerHTML = `
                <div class="project-card-empty">
                    <div class="pce-icon">${this.currentView === 'vault' ? '🔒' : '📁'}</div>
                    <p>${this.currentView === 'vault' ? 'La bóveda está vacía.' : 'No hay proyectos aún.'}</p>
                </div>`;
            return;
        }

        this.grid.innerHTML = filtered.map(p => `
            <div class="project-card ${p.isPrivate ? 'card-private' : ''}" data-id="${p.id}">
                <div class="pc-thumb">
                    <img src="${p.thumb || ''}" alt="">
                    ${p.isPrivate ? '<span class="pc-lock-badge">🔒</span>' : ''}
                    <span class="pc-duration">${p.duration || '00:00'}</span>
                </div>
                <div class="pc-body">
                    <span class="pc-title">${p.title}</span>
                    <span class="pc-meta">Editado: ${new Date(p.updated).toLocaleDateString()}</span>
                </div>
            </div>
        `).join('');

        this.grid.querySelectorAll('.project-card').forEach(card => {
            card.addEventListener('click', () => this.openProject(card.dataset.id));
        });
    }

    createNew() {
        const title = prompt('Nombre del nuevo proyecto:', 'Mi Gran Edición');
        if (!title) return;

        const id = 'pr_' + Date.now();
        const newProject = {
            id,
            title,
            updated: Date.now(),
            duration: '00:00',
            isPrivate: this.currentView === 'vault',
            thumb: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=400&h=240&auto=format&fit=crop',
            notes: ''
        };

        this.projects.unshift(newProject);
        this._save();
        this._render();
        this.openProject(id);
    }

    openProject(id) {
        this.currentProjectId = id;
        const p = this.projects.find(x => x.id === id);
        if (!p) return;

        const pTitle = document.getElementById('topbar-project');
        if (pTitle) pTitle.textContent = p.title;

        // Load notes
        const notesEl = document.getElementById('production-notes');
        if (notesEl) notesEl.value = p.notes || '';

        // Update lock button UI
        const lockBtn = document.getElementById('btn-lock-project');
        if (lockBtn) {
            lockBtn.classList.toggle('locked', !!p.isPrivate);
            lockBtn.querySelector('.icon-lock').classList.toggle('hidden', !p.isPrivate);
            lockBtn.querySelector('.icon-unlock').classList.toggle('hidden', !!p.isPrivate);
        }

        this.bus.emit('toast:info', `Abriendo ${p.title}...`);
        this.el.classList.add('hidden');
        this.appEl.classList.remove('hidden');
        this.appEl.classList.add('visible');
    }

    closeProject() {
        const p = this.projects.find(x => x.id === this.currentProjectId);

        // Save notes before closing
        const notesEl = document.getElementById('production-notes');
        if (p && notesEl) {
            p.notes = notesEl.value;
            p.updated = Date.now();
            this._save();
        }

        this.appEl.classList.add('hidden');
        this.el.classList.remove('hidden');

        // Decide where to go back
        if (p && p.isPrivate) {
            this.switchView('vault');
        } else {
            this.switchView('projects');
        }

        this.bus.emit('toast:info', 'Proyecto guardado y cerrado');
    }

    _save() {
        localStorage.setItem('stelaris_projects', JSON.stringify(this.projects));
    }
}

/* ═══════════════════════════════════════════
   §17  MAIN APPLICATION
   ═══════════════════════════════════════════ */
class StelarisApp {
    constructor() {
        this.config = STELARIS_CONFIG;
        this.bus = new CommandBus();


        // Modules
        this.theme = new ThemeManager(this.bus, this.config.themes);
        this.toast = new ToastManager(this.bus, document.getElementById('toast-container'), this.config.toast);
        this.timeline = new TimelineModule(this.bus, this.config.timeline);
        this.player = new PlayerModule(this.bus, this.config.timeline);
        this.vault = new VaultModule(this.bus, this.config.vault);
        this.multiplayer = new MultiplayerClient(this.bus);
        this.stickers = new StickerLab(this.bus);
        this.ai = new StelarAI(this.bus);
        this.license = new LicenseManager(this.bus);
        this.imageEditor = new ImageEditorModule(this.bus);

        // Elite Modules
        this.dashboard = new DashboardModule(this.bus);
        this.properties = new PropertyPanel(this.bus);

        // DOM
        this.moodSelector = document.getElementById('mood-selector');
        this.appShell = document.getElementById('app');

        this._init();
    }

    _init() {
        // Apply branding
        const titleEl = document.getElementById('mood-title');
        if (titleEl) titleEl.textContent = this.config.app.name;
        document.getElementById('topbar-logo').textContent = this.config.app.logo;
        document.getElementById('topbar-title').textContent = this.config.app.name;

        // Theme check
        if (this.theme.hasTheme()) {
            this._skipMoodSelector();
        } else {
            this._showMoodSelector();
        }

        this.tabs = new SidebarTabs(this.bus);

        // GUI Bindings
        document.getElementById('btn-theme-toggle').addEventListener('click', () => this.theme.toggle());
        document.getElementById('btn-vault').addEventListener('click', () => this.bus.emit('vault:open'));

        const lockBtn = document.getElementById('btn-lock-project');
        lockBtn.addEventListener('click', () => {
            const isLocked = lockBtn.classList.toggle('locked');
            lockBtn.querySelector('.icon-lock').classList.toggle('hidden', !isLocked);
            lockBtn.querySelector('.icon-unlock').classList.toggle('hidden', isLocked);
            this.bus.emit('project:lock-toggle', isLocked);
        });

        // Shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.target.closest('.vault-overlay')) return;

            if (e.code === 'Space') { e.preventDefault(); this.bus.emit('player:toggle'); }
            if (e.key === 's' && e.ctrlKey) { e.preventDefault(); this.bus.emit('toast:info', 'Auto-guardado activo'); }
        });

        console.log(`%c${this.config.app.name} v${this.config.app.version}%c — Sistema Nervioso Profundo inicializado`,
            'color:#00e0ff;font-weight:bold;font-size:14px', 'color:#888');
    }

    _showMoodSelector() {
        this.moodSelector.classList.remove('hidden');
        const cards = this.moodSelector.querySelectorAll('.mood-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const choice = card.dataset.themeChoice;
                this.theme.set(choice);
                this.bus.emit('toast:success', `Bienvenido al modo ${choice === 'gamer' ? 'Gamer 🎮' : 'Canva 🎨'}`);
                this.moodSelector.classList.add('leaving');
                this.moodSelector.addEventListener('animationend', () => {
                    this.moodSelector.classList.add('hidden');
                    this.moodSelector.classList.remove('leaving');
                    this._revealDashboard();
                }, { once: true });
            });
        });
    }

    _skipMoodSelector() {
        this.moodSelector.classList.add('hidden');
        this.theme.set(this.theme.current);
        this._revealDashboard();
    }

    _revealDashboard() {
        const db = document.getElementById('dashboard');
        db.classList.remove('hidden');
    }

    _revealApp() {
        // Solo se llama desde el Dashboard ahora
        this.appShell.classList.remove('hidden');
        this.appShell.classList.add('visible');
    }
}

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    window.stelaris = new StelarisApp();
});

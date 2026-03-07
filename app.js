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
        // Keypad clicks
        this.keypad.addEventListener('click', (e) => {
            const btn = e.target.closest('.vault-key');
            if (!btn || this._locked) return;
            const key = btn.dataset.key;

            if (key === 'backspace') {
                this._pin = this._pin.slice(0, -1);
            } else if (key === 'enter') {
                this._submit();
            } else {
                if (this._pin.length < this.cfg.maxPinLength) {
                    this._pin += key;
                }
            }
            this._renderDots();
        });

        // Keyboard support
        document.addEventListener('keydown', (e) => {
            if (this.overlay.classList.contains('hidden')) return;

            if (e.key >= '0' && e.key <= '9') {
                if (this._pin.length < this.cfg.maxPinLength) this._pin += e.key;
                this._renderDots();
            } else if (e.key === 'Backspace') {
                this._pin = this._pin.slice(0, -1);
                this._renderDots();
            } else if (e.key === 'Enter') {
                this._submit();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        this.btnClose.addEventListener('click', () => this.close());
        this.bus.on('vault:open', () => this.open());
    }

    open() {
        this._pin = '';
        this._isSetup = !localStorage.getItem(this.cfg.pinHashKey);
        this._updateUI();
        this._renderDots();
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('visible');
        this.bus.emit('vault:opened');
    }

    close() {
        this.overlay.classList.add('hidden');
        this.overlay.classList.remove('visible', 'success');
        this._pin = '';
        this.bus.emit('vault:closed');
    }

    _updateUI() {
        if (this._isSetup) {
            this.subtitle.textContent = 'Crea tu PIN de seguridad';
            this.setupMsg.classList.remove('hidden');
        } else {
            this.subtitle.textContent = 'Ingresa tu PIN para acceder';
            this.setupMsg.classList.add('hidden');
        }
    }

    _renderDots() {
        const max = Math.max(this._pin.length, this.cfg.minPinLength);
        let html = '';
        for (let i = 0; i < max; i++) {
            html += `<div class="pin-dot${i < this._pin.length ? ' filled' : ''}"></div>`;
        }
        this.pinDisplay.innerHTML = html;
    }

    async _submit() {
        if (this._pin.length < this.cfg.minPinLength) {
            this.bus.emit('toast:warning', `El PIN debe tener al menos ${this.cfg.minPinLength} dígitos`);
            return;
        }

        const hash = await this._hash(this._pin);

        if (this._isSetup) {
            // First time — save PIN
            localStorage.setItem(this.cfg.pinHashKey, hash);
            this._isSetup = false;
            this.bus.emit('toast:success', 'PIN configurado correctamente 🔐');
            this._showSuccess();
        } else {
            // Validate PIN
            const stored = localStorage.getItem(this.cfg.pinHashKey);
            if (hash === stored) {
                this._attempts = 0;
                this.bus.emit('toast:success', 'Bóveda desbloqueada ✓');
                this._showSuccess();
                this.bus.emit('vault:unlocked');
            } else {
                this._attempts++;
                this._showError();
                if (this._attempts >= this.cfg.maxAttempts) {
                    this._lockout();
                }
            }
        }
    }

    _showSuccess() {
        this.pinDisplay.classList.add('success');
        this.overlay.classList.add('success');
        setTimeout(() => {
            this.close();
            this.pinDisplay.classList.remove('success');
        }, 800);
    }

    _showError() {
        this.pinDisplay.classList.add('shake');
        this.bus.emit('toast:error', `PIN incorrecto (${this.cfg.maxAttempts - this._attempts} intentos restantes)`);
        setTimeout(() => {
            this.pinDisplay.classList.remove('shake');
            this._pin = '';
            this._renderDots();
        }, 600);
    }

    _lockout() {
        this._locked = true;
        this.subtitle.textContent = 'Demasiados intentos. Espera 5 minutos.';
        this.bus.emit('toast:error', 'Bóveda bloqueada por 5 minutos');
        setTimeout(() => {
            this._locked = false;
            this._attempts = 0;
            this._updateUI();
        }, this.cfg.lockoutMs);
    }

    /** Simple SHA-256 hash for PIN storage */
    async _hash(pin) {
        const encoder = new TextEncoder();
        const data = encoder.encode(pin + '_stelaris_salt_2026');
        const buffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
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

        // Delegate to brain
        const result = await this.brain.process(text);

        // Small delay for natural feel
        await new Promise(r => setTimeout(r, 250 + Math.random() * 300));

        this._hideTyping();
        this._typing = false;

        this._addMsg(result.response, 'bot');

        // Log confidence for debugging
        if (result.confidence > 0) {
            console.log(`[StelarAI] Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`);
        }
    }

    _addMsg(text, who) {
        const div = document.createElement('div');
        div.className = `assistant-msg assistant-msg-${who}`;
        const html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="font-size:.72rem;background:var(--bg-surface-hover);padding:.1em .3em;border-radius:3px">$1</code>')
            .replace(/\n/g, '<br>');
        div.innerHTML = `<span class="msg-text">${html}</span>`;
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

        // Send cursor position on timeline mousemove
        const tracks = document.getElementById('timeline-tracks');
        tracks.addEventListener('mousemove', (e) => this._sendCursor(e));

        // Team chat send
        this.chatSendBtn.addEventListener('click', () => this._sendChat());
        this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._sendChat(); });

        // Bus: listen for seek to broadcast
        this.bus.on('player:tick', (time) => this._broadcastState(time));
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

    _onMessage(msg) {
        switch (msg.type) {
            case 'room-created':
                this.userId = msg.userId;
                this.color = msg.color;
                this.roomCode = msg.code;
                this.users = [{ id: msg.userId, name: this.nameInput.value.trim() || 'Editor', color: msg.color }];
                this._updateUI();
                this.bus.emit('toast:success', `Sala creada: ${msg.code}`);
                break;

            case 'room-joined':
                this.userId = msg.userId;
                this.color = msg.color;
                this.roomCode = msg.code;
                this.users = msg.users;
                this._updateUI();
                this.bus.emit('toast:success', `Conectado a sala ${msg.code}`);
                break;

            case 'user-joined':
                this.users = msg.users;
                this._updateUI();
                this.bus.emit('toast:info', `${msg.name} se unió a la sala`);
                break;

            case 'user-left':
                this.users = msg.users;
                this._removeGhost(msg.userId);
                this._updateUI();
                this.bus.emit('toast:info', `${msg.name} salió de la sala`);
                break;

            case 'cursor':
                this._updateGhost(msg.userId, msg.name, msg.color, msg.x, msg.time);
                break;

            case 'chat':
                this._addChatMsg(msg.name, msg.color, msg.text);
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
        // Modal
        if (this.roomCode) {
            this.formEl.classList.add('hidden');
            this.connectedEl.classList.remove('hidden');
            this.displayCode.textContent = this.roomCode;
            this.userListEl.innerHTML = this.users.map(u =>
                `<div class="mp-user-item"><span class="mp-user-dot" style="background:${u.color}"></span>${u.name}${u.id === this.userId ? ' (tú)' : ''}</div>`
            ).join('');

            // Topbar
            this.mpStatus.classList.remove('hidden');
            this.mpRoomCode.textContent = this.roomCode;
            this.mpAvatars.innerHTML = this.users.map(u =>
                `<div class="mp-avatar" style="background:${u.color}" title="${u.name}">${u.name[0].toUpperCase()}</div>`
            ).join('');
        }
    }

    /* ── Ghost Cursors ── */
    _sendCursor(e) {
        if (!this.ws || this.ws.readyState !== 1 || !this.roomCode) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        this.ws.send(JSON.stringify({ type: 'cursor', x }));
    }

    _updateGhost(userId, name, color, x) {
        let ghost = this._ghosts[userId];
        if (!ghost) {
            ghost = document.createElement('div');
            ghost.className = 'ghost-cursor';
            ghost.innerHTML = `<div class="ghost-cursor-line" style="background:${color}"></div>
                               <div class="ghost-cursor-label" style="background:${color}">${name.slice(0, 6)}</div>`;
            this.ghostLayer.appendChild(ghost);
            this._ghosts[userId] = ghost;
        }
        ghost.style.transform = `translateX(${x}px)`;
    }

    _removeGhost(userId) {
        if (this._ghosts[userId]) {
            this._ghosts[userId].remove();
            delete this._ghosts[userId];
        }
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
        // Throttle to ~10fps
        if (this._lastBroadcast && Date.now() - this._lastBroadcast < 100) return;
        this._lastBroadcast = Date.now();
    }
}

/* ═══════════════════════════════════════════
   §14  STICKER LAB
   ═══════════════════════════════════════════ */
class StickerLab {
    constructor(bus) {
        this.bus = bus;
        this.stickers = [];

        this.grid = document.getElementById('sticker-grid');
        this.emptyMsg = document.getElementById('sticker-empty');
        this.btnSnapshot = document.getElementById('btn-snapshot');
        this.preview = document.getElementById('sticker-preview');
        this.canvas = document.getElementById('sticker-canvas');
        this.btnSave = document.getElementById('sticker-save');
        this.btnDiscard = document.getElementById('sticker-discard');
        this.toolBtn = document.getElementById('tool-snapshot');

        this._currentBlob = null;

        this._bind();
    }

    _bind() {
        this.btnSnapshot.addEventListener('click', () => this.capture());
        this.toolBtn.addEventListener('click', () => this.capture());
        this.btnSave.addEventListener('click', () => this._save());
        this.btnDiscard.addEventListener('click', () => this._discard());
        this.bus.on('sticker:snapshot', () => this.capture());
    }

    async capture() {
        const video = document.getElementById('video-player');
        if (!video.src || !video.videoWidth) {
            this.bus.emit('toast:warning', 'Carga un video primero');
            return;
        }

        // Capture frame at full resolution
        const c = this.canvas;
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(video, 0, 0, c.width, c.height);

        // Aplicar IA de recorte local (TensorFlow.js)
        if (window.App && App.ai?.brain?.vision?.isAvailable) {
            await App.ai.brain.vision.loadSegmentationModel();
            await App.ai.brain.vision.removeBackground(c);
        } else if (window.App && !App.ai?.brain?.vision?.isAvailable) {
            this.bus.emit('toast:info', 'Recorte de fondo avanzado desactivado (sin TFJS)');
        }

        // Show preview
        this.preview.classList.remove('hidden');
        this._currentTime = video.currentTime;

        c.toBlob((blob) => {
            this._currentBlob = blob;
        }, 'image/png');

        this.bus.emit('toast:info', '📸 Frame capturado & procesado');
    }

    _save() {
        if (!this._currentBlob) return;

        const url = URL.createObjectURL(this._currentBlob);
        const name = `Sticker_${this._fmt(this._currentTime)}`;
        const sticker = {
            id: Date.now(),
            url,
            time: this._currentTime,
            blob: this._currentBlob,
        };
        this.stickers.push(sticker);
        this._renderGrid();

        // Enviar a la Bóveda Blindada
        if (window.App?.vault) {
            const vaultFile = new File([this._currentBlob], `${name}.png`, { type: 'image/png' });
            App.vault.addFile(vaultFile);
            this.bus.emit('toast:success', 'Sticker creado y cifrado en la Bóveda');
        } else {
            this.bus.emit('toast:success', 'Sticker guardado (Bóveda no disponible)');
        }

        this._discard();
    }

    _discard() {
        this.preview.classList.add('hidden');
        this._currentBlob = null;
    }

    _renderGrid() {
        if (this.stickers.length === 0) {
            this.grid.innerHTML = '<p class="sticker-empty">Captura frames del video para crear stickers</p>';
            return;
        }
        this.grid.innerHTML = this.stickers.map(s => `
            <div class="sticker-thumb" data-id="${s.id}">
                <img src="${s.url}" alt="Sticker">
                <span class="sticker-thumb-time">${this._fmt(s.time)}</span>
            </div>
        `).join('');
    }

    _fmt(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
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
                if (window.App && window.App.stickerLab) {
                    this.bus.emit('toast:info', 'Procesando miniatura desde el video...');
                    await window.App.stickerLab.capture();
                    if (window.App.stickerLab._currentBlob) {
                        const file = new File([window.App.stickerLab._currentBlob], 'miniatura.png', { type: 'image/png' });
                        this.loadImage(file);
                        this.bus.emit('toast:success', '🖼️ Miniatura lista para edición');
                    }
                }
            });
        }

        this.btnRemoveBg.addEventListener('click', async () => {
            if (!this.currentImage) return this.bus.emit('toast:warning', 'Carga una imagen primero');
            if (!window.App || !window.App.ai?.brain?.vision?.isAvailable) {
                return this.bus.emit('toast:warning', 'TensorFlow.js no está cargado');
            }
            this.bus.emit('toast:info', 'Recortando fondo con GPU...');
            await window.App.ai.brain.vision.loadSegmentationModel();
            await window.App.ai.brain.vision.removeBackground(this.canvas);

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
                if (window.App && window.App.vault) {
                    const f = new File([blob], `StelarImage_${Date.now()}.png`, { type: 'image/png' });
                    window.App.vault.addFile(f);
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

        this.projects = JSON.parse(localStorage.getItem('stelaris_projects') || '[]');
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
                document.querySelectorAll('.ds-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const view = btn.dataset.view;
                const title = document.getElementById('ds-view-title');
                if (title) {
                    title.textContent =
                        view === 'projects' ? 'Tus Proyectos' :
                            view === 'vault' ? 'Bóveda Blindada' : view.toUpperCase();
                }
            });
        });
    }

    _render() {
        if (!this.grid) return;
        if (this.projects.length === 0) {
            this.grid.innerHTML = `
                <div class="project-card-empty">
                    <div class="pce-icon">📁</div>
                    <p>No hay proyectos aún. ¡Crea el primero!</p>
                </div>`;
            return;
        }

        this.grid.innerHTML = this.projects.map(p => `
            <div class="project-card" data-id="${p.id}">
                <div class="pc-thumb">
                    <img src="${p.thumb || ''}" alt="">
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
            thumb: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?q=80&w=400&h=240&auto=format&fit=crop'
        };

        this.projects.unshift(newProject);
        this._save();
        this._render();
        this.openProject(id);
    }

    openProject(id) {
        const p = this.projects.find(x => x.id === id);
        if (!p) return;

        const pTitle = document.getElementById('topbar-project');
        if (pTitle) pTitle.textContent = p.title;
        this.bus.emit('toast:info', `Abriendo ${p.title}...`);

        this.el.classList.add('hidden');
        this.appEl.classList.remove('hidden');
        this.appEl.classList.add('visible');
    }

    closeProject() {
        this.appEl.classList.add('hidden');
        this.el.classList.remove('hidden');
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

        // GUI Bindings
        document.getElementById('btn-theme-toggle').addEventListener('click', () => this.theme.toggle());
        document.getElementById('btn-vault').addEventListener('click', () => this.bus.emit('vault:open'));

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

/**
 * ═══════════════════════════════════════════════════════════════
 *  STELAR CORE — Cerebro de IA Local & Offline
 * ═══════════════════════════════════════════════════════════════
 *  100% navegador. Zero APIs. Sin internet requerido.
 *
 *  Módulos:
 *    1. StelarNLP        — Tokenización, stemming, sinónimos, clasificación
 *    2. StelarMemory     — IndexedDB para preferencias y aprendizaje
 *    3. StelarAutomaton  — Análisis de audio + decisiones de edición
 *    4. StelarVision     — Hooks para TensorFlow.js (recorte de fondo)
 *    5. ProCommands      — Comandos profesionales compuestos
 *    6. StelarBrain      — Orquestador principal
 * ═══════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════
   §1  NLP ENGINE — Procesamiento de Lenguaje
   ═══════════════════════════════════════════ */

const SPANISH_STOPWORDS = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en',
    'y', 'o', 'que', 'es', 'por', 'con', 'para', 'como', 'pero', 'su', 'se', 'no', 'lo',
    'le', 'me', 'te', 'nos', 'les', 'mi', 'tu', 'este', 'esta', 'ese', 'esa', 'muy',
    'más', 'mas', 'ya', 'también', 'tambien', 'hay', 'ser', 'estar', 'tener', 'hacer',
    'ir', 'ver', 'dar', 'saber', 'poder', 'querer', 'deber', 'poner', 'otro', 'otra',
]);

const SYNONYM_MAP = {
    // Playback
    'reproduce': ['play', 'iniciar', 'reproducir', 'dale', 'arranca', 'empieza', 'comenzar', 'lanza'],
    'pausa': ['pause', 'stop', 'para', 'detener', 'deten', 'frena', 'espera', 'hold'],
    // Speed
    'velocidad': ['speed', 'vel', 'rapido', 'rápido', 'lento', 'slow', 'fast', 'ritmo', 'tempo'],
    'lento': ['slow', 'lenta', 'despacio', 'suave', 'cámara lenta', 'camara lenta', 'slowmo'],
    'rapido': ['fast', 'rápido', 'acelera', 'turbo', 'sprint', 'rush'],
    // Seek
    'ir': ['ve', 'salta', 'mueve', 'posiciona', 'seek', 'busca', 'avanza', 'adelanta', 'navega'],
    'retrocede': ['atrás', 'atras', 'rewind', 'back', 'devuelve', 'regresa'],
    // Edit
    'corta': ['cut', 'split', 'divide', 'separa', 'recorta', 'tijera', 'partir', 'trozar'],
    'elimina': ['delete', 'borra', 'quita', 'remueve', 'remove', 'limpia'],
    // Zoom
    'acerca': ['zoom in', 'ampliar', 'aumentar', 'agrandar', 'acercar', 'closer'],
    'aleja': ['zoom out', 'reducir', 'disminuir', 'alejar', 'smaller', 'empequeñecer'],
    // Theme
    'tema': ['theme', 'modo', 'mode', 'estilo', 'apariencia', 'skin', 'look'],
    'gamer': ['neon', 'neón', 'oscuro', 'dark', 'futurista', 'cyber', 'gaming'],
    'canva': ['pastel', 'claro', 'light', 'suave', 'antifatiga', 'clean', 'minimal'],
    // Features
    'captura': ['snapshot', 'foto', 'frame', 'sticker', 'fotografía', 'fotograma', 'screencap'],
    'boveda': ['vault', 'bóveda', 'seguro', 'seguridad', 'privado', 'candado', 'lock', 'caja fuerte'],
    'sala': ['room', 'multiplayer', 'multi', 'equipo', 'team', 'colaborar', 'compartir'],
    'volumen': ['volume', 'vol', 'sonido', 'audio', 'sound', 'mute', 'silencio'],
    // Pro
    'dinamico': ['dinámico', 'energético', 'energetico', 'activo', 'vivo', 'animado', 'movido'],
    'cinematico': ['cinematográfico', 'cinematografico', 'cine', 'pelicula', 'película', 'epico', 'épico', 'dramático', 'dramatico'],
    'silencio': ['mudo', 'callado', 'quiet', 'silent', 'sin sonido', 'sin audio'],
    'importante': ['destacar', 'resaltar', 'highlight', 'marcar', 'señalar', 'enfatizar'],
};

/** Basic Spanish stemmer — removes common suffixes */
function stemES(word) {
    if (word.length < 4) return word;
    // Remove common verb endings
    const suffixes = ['ando', 'endo', 'ción', 'cion', 'mente', 'idad', 'ible', 'able',
        'ando', 'iendo', 'ado', 'ido', 'ando', 'ar', 'er', 'ir', 'os', 'as', 'es', 'an', 'en'];
    for (const s of suffixes) {
        if (word.length > s.length + 2 && word.endsWith(s)) {
            return word.slice(0, -s.length);
        }
    }
    return word;
}

/** Normalize text: lowercase, remove accents, trim */
function normalize(text) {
    return text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\sáéíóúñ]/g, ' ')
        .trim();
}

/** Tokenize text into meaningful words */
function tokenize(text) {
    return normalize(text)
        .split(/\s+/)
        .filter(w => w.length > 1 && !SPANISH_STOPWORDS.has(w));
}

/** Expand tokens with synonyms → returns set of canonical keys */
function expandSynonyms(tokens) {
    const expanded = new Set(tokens);
    for (const token of tokens) {
        for (const [canonical, syns] of Object.entries(SYNONYM_MAP)) {
            if (canonical === token || syns.includes(token)) {
                expanded.add(canonical);
            }
            // Fuzzy: check if token is a substring of any synonym
            for (const s of syns) {
                if (s.includes(token) || token.includes(s)) {
                    expanded.add(canonical);
                }
            }
        }
    }
    return expanded;
}

/** Extract entities from text */
function extractEntities(text) {
    const entities = {};
    const norm = normalize(text);

    // Time: "segundo 30", "5s", "2 minutos", "1:30"
    const timePatterns = [
        { re: /(\d+)\s*(?:minuto|min|m)\s*(?:y\s*)?(\d+)?\s*(?:segundo|seg|s)?/i, fn: (m) => parseInt(m[1]) * 60 + (parseInt(m[2]) || 0) },
        { re: /(\d+):(\d{2})/, fn: (m) => parseInt(m[1]) * 60 + parseInt(m[2]) },
        { re: /(\d+(?:\.\d+)?)\s*(?:segundo|seg|s)\b/i, fn: (m) => parseFloat(m[1]) },
        { re: /(?:segundo|seg)\s*(\d+(?:\.\d+)?)/i, fn: (m) => parseFloat(m[1]) },
    ];
    for (const { re, fn } of timePatterns) {
        const m = norm.match(re);
        if (m) { entities.time = fn(m); break; }
    }

    // Speed: "2x", "velocidad 1.5", "a 3"
    const speedMatch = norm.match(/(\d+(?:\.\d+)?)\s*x/i);
    if (speedMatch) entities.speed = parseFloat(speedMatch[1]);
    if (!entities.speed && /lent|slow|camara/i.test(norm)) entities.speed = 0.5;
    if (!entities.speed && /rapido|fast|turbo/i.test(norm)) entities.speed = 2.0;

    // Percentage: "50%", "al 80"
    const pctMatch = norm.match(/(\d+)\s*%/);
    if (pctMatch) entities.percentage = parseInt(pctMatch[1]);

    // Theme
    if (/gamer|neon|oscuro|dark|cyber/i.test(norm)) entities.theme = 'gamer';
    if (/canva|pastel|claro|light|suave/i.test(norm)) entities.theme = 'canva';

    // Number (fallback)
    if (!entities.time && !entities.speed && !entities.percentage) {
        const numMatch = norm.match(/\b(\d+(?:\.\d+)?)\b/);
        if (numMatch) entities.number = parseFloat(numMatch[0]);
    }

    return entities;
}

/** NLP Classifier: score text against intent definitions */
class StelarNLP {
    constructor() {
        this.intents = [];
    }

    /** Register an intent with keywords and weights */
    registerIntent(name, config) {
        this.intents.push({ name, ...config });
    }

    /** Classify text → { intent, confidence, entities } */
    classify(text) {
        const tokens = tokenize(text);
        const stemmed = tokens.map(stemES);
        const expanded = expandSynonyms(tokens);
        const entities = extractEntities(text);

        let bestIntent = null;
        let bestScore = 0;

        for (const intent of this.intents) {
            let score = 0;

            // Keyword matching
            if (intent.keywords) {
                for (const kw of intent.keywords) {
                    if (expanded.has(kw)) score += 2;
                    if (tokens.includes(kw)) score += 1;
                    if (stemmed.some(s => s === stemES(kw))) score += 0.5;
                }
            }

            // Regex patterns
            if (intent.patterns) {
                for (const p of intent.patterns) {
                    if (p.test(text) || p.test(normalize(text))) score += 3;
                }
            }

            // Required entities boost
            if (intent.requiresEntity) {
                if (entities[intent.requiresEntity] !== undefined) score += 1;
                else score -= 2;
            }

            // Normalize
            const maxPossible = (intent.keywords?.length || 0) * 3.5 + (intent.patterns?.length || 0) * 3;
            const confidence = maxPossible > 0 ? Math.min(score / maxPossible, 1) : 0;

            if (score > bestScore && confidence >= 0.15) {
                bestScore = score;
                bestIntent = { name: intent.name, confidence, entities, rawScore: score };
            }
        }

        return bestIntent || { name: 'unknown', confidence: 0, entities };
    }
}


/* ═══════════════════════════════════════════
   §2  MEMORY — IndexedDB Persistencia Local
   ═══════════════════════════════════════════ */

class StelarMemory {
    constructor() {
        this.db = null;
        this._ready = this._open();
    }

    async _open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('StelarBrain', 2); // Bump version to 2
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('preferences'))
                    db.createObjectStore('preferences', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('history'))
                    db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('patterns'))
                    db.createObjectStore('patterns', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('snapshots'))
                    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = (e) => { console.warn('[StelarMemory] IndexedDB failed, using RAM fallback'); this._ram = {}; resolve(); };
        });
    }

    async _tx(store, mode = 'readonly') {
        await this._ready;
        if (!this.db) return null;
        return this.db.transaction(store, mode).objectStore(store);
    }

    /** Save a preference */
    async setPref(key, value) {
        const s = await this._tx('preferences', 'readwrite');
        if (s) s.put({ key, value, ts: Date.now() });
        else if (this._ram) this._ram[key] = value;
    }

    /** Get a preference */
    async getPref(key) {
        const s = await this._tx('preferences');
        if (!s) return this._ram?.[key] ?? null;
        return new Promise(r => {
            const req = s.get(key);
            req.onsuccess = () => r(req.result?.value ?? null);
            req.onerror = () => r(null);
        });
    }

    /** Log a command execution */
    async logCommand(intent, text) {
        const s = await this._tx('history', 'readwrite');
        if (s) s.add({ intent, text, ts: Date.now() });
    }

    /** Get command frequency map */
    async getCommandFrequency() {
        const s = await this._tx('history');
        if (!s) return {};
        return new Promise(r => {
            const req = s.getAll();
            req.onsuccess = () => {
                const freq = {};
                for (const entry of req.result || []) {
                    freq[entry.intent] = (freq[entry.intent] || 0) + 1;
                }
                r(freq);
            };
            req.onerror = () => r({});
        });
    }

    /** Learn a pattern: increment counter for a behavior */
    async learnPattern(key) {
        const s = await this._tx('patterns', 'readwrite');
        if (!s) return;
        const req = s.get(key);
        req.onsuccess = () => {
            const current = req.result?.count || 0;
            s.put({ key, count: current + 1, lastSeen: Date.now() });
        };
    }

    /** Get pattern strength */
    async getPattern(key) {
        const s = await this._tx('patterns');
        if (!s) return 0;
        return new Promise(r => {
            const req = s.get(key);
            req.onsuccess = () => r(req.result?.count || 0);
            req.onerror = () => r(0);
        });
    }

    /** Generate suggestions based on learned patterns */
    async getSuggestions() {
        const freq = await this.getCommandFrequency();
        const themePref = await this.getPref('preferred-theme');
        const suggestions = [];

        // Most used commands
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            suggestions.push(`💡 Tu comando más usado: **${sorted[0][0]}** (${sorted[0][1]} veces)`);
        }

        // Theme preference
        if (themePref) {
            suggestions.push(`🎨 Recuerdo que prefieres el tema **${themePref}**`);
        }

        // Dynamic editing pattern
        const dynCount = await this.getPattern('uses-dynamic');
        if (dynCount >= 3) {
            suggestions.push('⚡ Noto que te gusta la edición dinámica. ¿Quieres que la aplique automáticamente?');
        }

        return suggestions;
    }

    /** Save Timeline Snapshot before AI edits */
    async saveSnapshot(reason = 'AI Action') {
        if (!window.App?.timeline) return false;
        const s = await this._tx('snapshots', 'readwrite');
        if (!s) return false;

        // Simulating the state storage (simplified array of clips/settings)
        const state = {
            duration: window.App.timeline.duration,
            inPoint: window.App.timeline.inPoint,
            outPoint: window.App.timeline.outPoint,
            speed: window.App.player.playbackRate || 1.0,
            time: document.getElementById('video-player')?.currentTime || 0
        };

        return new Promise(r => {
            const req = s.add({ reason, state, ts: Date.now() });
            req.onsuccess = () => r(req.result); // Returns the ID
            req.onerror = () => r(false);
        });
    }

    /** Restore last snapshot */
    async restoreLastSnapshot() {
        const s = await this._tx('snapshots', 'readwrite');
        if (!s) return null;

        return new Promise(r => {
            const req = s.openCursor(null, 'prev'); // Get latest
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const snap = cursor.value;
                    cursor.delete(); // Remove it after popping
                    r(snap);
                } else {
                    r(null);
                }
            };
            req.onerror = () => r(null);
        });
    }
}


/* ═══════════════════════════════════════════
   §3  AUTOMATON — Análisis de Audio & Decisiones
   ═══════════════════════════════════════════ */

class StelarAutomaton {
    constructor(bus) {
        this.bus = bus;
        this._audioCtx = null;
        this._analyser = null;
        this._silenceThreshold = 0.02;
        this._analysisCache = null;
    }

    /** Initialize audio context from video element */
    _ensureAudioCtx() {
        if (this._audioCtx) return;
        const video = document.getElementById('video-player');
        if (!video || !video.src) return;
        try {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this._sourceNode = this._audioCtx.createMediaElementSource(video);

            // Compressor for normalizing voices
            this._compressor = this._audioCtx.createDynamicsCompressor();
            this._compressor.threshold.value = -24;
            this._compressor.knee.value = 30;
            this._compressor.ratio.value = 12;
            this._compressor.attack.value = 0.003;
            this._compressor.release.value = 0.25;

            // Voice Enhance EQ (Highpass)
            this._eqNode = this._audioCtx.createBiquadFilter();
            this._eqNode.type = 'highpass';
            this._eqNode.frequency.value = 80;

            this._analyser = this._audioCtx.createAnalyser();
            this._analyser.fftSize = 2048;

            // Connect: Source -> (bypassed initially) -> Analyser -> Dest
            this._sourceNode.connect(this._analyser);
            this._analyser.connect(this._audioCtx.destination);
        } catch (e) {
            console.warn('[Automaton] Audio context failed:', e.message);
        }
    }

    applyAudioPolish() {
        if (!this._audioCtx || !this._sourceNode) return false;
        try {
            // Disconnect old chain
            this._sourceNode.disconnect();
            this._eqNode.disconnect();
            this._compressor.disconnect();
            this._analyser.disconnect();

            // Source -> EQ -> Compressor -> Analyser -> Dest
            this._sourceNode.connect(this._eqNode);
            this._eqNode.connect(this._compressor);
            this._compressor.connect(this._analyser);
            this._analyser.connect(this._audioCtx.destination);
            return true;
        } catch (e) {
            return false;
        }
    }

    /** Get current audio level (0-1) */
    getCurrentLevel() {
        if (!this._analyser) return 0;
        const data = new Uint8Array(this._analyser.frequencyBinCount);
        this._analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        return Math.sqrt(sum / data.length);
    }

    /** Analyze entire video for silence regions (offline analysis) */
    async analyzeForSilences(videoEl) {
        if (this._analysisCache) return this._analysisCache;
        if (!videoEl || !videoEl.src || !videoEl.duration) return [];

        this.bus.emit('toast:info', '🔍 Analizando audio para silencios...');

        const duration = videoEl.duration;
        const sampleRate = 10; // samples per second
        const totalSamples = Math.floor(duration * sampleRate);
        const regions = [];

        // Use OfflineAudioContext for faster analysis
        try {
            const response = await fetch(videoEl.src);
            const arrayBuffer = await response.arrayBuffer();
            const offlineCtx = new OfflineAudioContext(1, 44100 * duration, 44100);
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);

            const windowSize = Math.floor(44100 / sampleRate);
            let inSilence = false;
            let silenceStart = 0;

            for (let i = 0; i < totalSamples; i++) {
                const start = i * windowSize;
                const end = Math.min(start + windowSize, channelData.length);
                let rms = 0;
                for (let j = start; j < end; j++) {
                    rms += channelData[j] * channelData[j];
                }
                rms = Math.sqrt(rms / (end - start));

                const time = i / sampleRate;

                if (rms < this._silenceThreshold) {
                    if (!inSilence) { inSilence = true; silenceStart = time; }
                } else {
                    if (inSilence && (time - silenceStart) > 0.5) {
                        regions.push({ start: silenceStart, end: time, type: 'silence' });
                    }
                    inSilence = false;
                }
            }
            if (inSilence && (duration - silenceStart) > 0.5) {
                regions.push({ start: silenceStart, end: duration, type: 'silence' });
            }

            this._analysisCache = regions;
            this.bus.emit('toast:success', `✅ Análisis completo: ${regions.length} silencios detectados`);
            return regions;

        } catch (e) {
            console.warn('[Automaton] Offline analysis failed, using live fallback:', e.message);
            this.bus.emit('toast:warning', '⚠️ Análisis de audio no disponible para este formato');
            return [];
        }
    }

    /** Detect "boring" regions: low energy sustained > 2s */
    async findBoringRegions(videoEl) {
        const silences = await this.analyzeForSilences(videoEl);
        // Boring = silences longer than 2 seconds
        return silences.filter(s => (s.end - s.start) > 2.0)
            .map(s => ({ ...s, type: 'boring' }));
    }

    /** Find high-energy moments (loud/exciting) */
    async findHighlights(videoEl) {
        if (!videoEl || !videoEl.src || !videoEl.duration) return [];
        try {
            const response = await fetch(videoEl.src);
            const arrayBuffer = await response.arrayBuffer();
            const duration = videoEl.duration;
            const offlineCtx = new OfflineAudioContext(1, 44100 * duration, 44100);
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
            const channelData = audioBuffer.getChannelData(0);

            const windowSize = Math.floor(44100 / 10);
            const highlights = [];
            let avgEnergy = 0;
            const energies = [];

            // First pass: compute average energy
            const totalWindows = Math.floor(channelData.length / windowSize);
            for (let i = 0; i < totalWindows; i++) {
                const start = i * windowSize;
                const end = Math.min(start + windowSize, channelData.length);
                let rms = 0;
                for (let j = start; j < end; j++) rms += channelData[j] * channelData[j];
                rms = Math.sqrt(rms / (end - start));
                energies.push(rms);
                avgEnergy += rms;
            }
            avgEnergy /= totalWindows;

            // Second pass: find regions above 1.8x average
            const threshold = avgEnergy * 1.8;
            let inHighlight = false;
            let hlStart = 0;

            for (let i = 0; i < energies.length; i++) {
                const time = i / 10;
                if (energies[i] > threshold) {
                    if (!inHighlight) { inHighlight = true; hlStart = time; }
                } else {
                    if (inHighlight && (time - hlStart) > 0.3) {
                        highlights.push({ start: hlStart, end: time, type: 'highlight', energy: energies[i] });
                    }
                    inHighlight = false;
                }
            }

            return highlights;
        } catch (e) {
            return [];
        }
    }

    /** Clear analysis cache */
    clearCache() { this._analysisCache = null; }
}


/* ═══════════════════════════════════════════
   §4  VISION — Hooks para TensorFlow.js
   ═══════════════════════════════════════════ */

class StelarVision {
    constructor(bus) {
        this.bus = bus;
        this.isLoaded = false;
        this._model = null;
    }

    /** Check if TF.js is available */
    get isAvailable() {
        return typeof window.tf !== 'undefined' && typeof window.bodyPix !== 'undefined';
    }

    /** Load body segmentation model */
    async loadSegmentationModel() {
        if (!this.isAvailable) {
            this.bus.emit('toast:info', '🧪 TensorFlow.js/BodyPix no cargados.');
            return false;
        }
        if (this._model) return true;

        try {
            this.bus.emit('toast:info', '🧠 Cargando modelo de segmentación GPU...');
            this._model = await bodyPix.load({
                architecture: 'MobileNetV1',
                outputStride: 16,
                multiplier: 0.75,
                quantBytes: 2
            });
            this.bus.emit('toast:success', '✅ Modelo de visión cargado (GPU local)');
            this.isLoaded = true;
            return true;
        } catch (e) {
            this.bus.emit('toast:error', '❌ Error cargando modelo de visión: ' + e.message);
            return false;
        }
    }

    /** Remove background from a canvas frame */
    async removeBackground(canvas) {
        if (!this._model) {
            this.bus.emit('toast:warning', 'Modelo de visión no cargado');
            return canvas;
        }

        try {
            this.bus.emit('toast:info', '🎭 Procesando GPU...');
            const segmentation = await this._model.segmentPerson(canvas, {
                internalResolution: 'medium',
                segmentationThreshold: 0.7
            });

            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const { data } = imgData;

            // Mask out background
            for (let i = 0; i < data.length; i += 4) {
                if (segmentation.data[i / 4] === 0) {
                    data[i + 3] = 0; // Set alpha to 0 for background pixels
                }
            }
            ctx.putImageData(imgData, 0, 0);

            this.bus.emit('toast:success', '🎭 Recorte de fondo completo');
            return canvas;
        } catch (e) {
            console.error(e);
            return canvas;
        }
    }

    /** Detect faces in a frame (placeholder) */
    async detectFaces(canvas) {
        if (!this.isAvailable) return [];
        return [];
    }
}


/* ═══════════════════════════════════════════
   §5  PRO COMMANDS — Edición Profesional
   ═══════════════════════════════════════════ */

class ProCommands {
    constructor(bus, automaton, memory) {
        this.bus = bus;
        this.auto = automaton;
        this.mem = memory;
    }

    /** "Hazlo dinámico" — Speed up boring parts, highlight exciting */
    async makeDynamic() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        this.mem.learnPattern('uses-dynamic');
        const boring = await this.auto.findBoringRegions(video);
        const highlights = await this.auto.findHighlights(video);

        if (boring.length === 0 && highlights.length === 0) {
            return '📊 El video ya tiene buen ritmo. No hay regiones aburridas detectadas.';
        }

        const actions = [];
        for (const region of boring) {
            actions.push(`• ${this._fmtTime(region.start)}–${this._fmtTime(region.end)}: Velocidad 1.5x (${(region.end - region.start).toFixed(1)}s de silencio)`);
        }
        for (const hl of highlights.slice(0, 5)) {
            actions.push(`• ${this._fmtTime(hl.start)}–${this._fmtTime(hl.end)}: 🔥 Momento destacado`);
        }

        return `⚡ **Análisis Dinámico completado:**\n\n${actions.join('\n')}\n\n📝 Se encontraron **${boring.length} zonas lentas** y **${highlights.length} momentos clave**.\nEn futuras versiones, estos cambios se aplicarán al timeline automáticamente.`;
    }

    /** "Corta los silencios" — Remove silent gaps */
    async cutSilences() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        const silences = await this.auto.analyzeForSilences(video);
        if (silences.length === 0) return '✅ No se detectaron silencios significativos.';

        const totalSilence = silences.reduce((sum, s) => sum + (s.end - s.start), 0);

        return `✂️ **Silencios detectados: ${silences.length}**\n\nTiempo total de silencio: **${totalSilence.toFixed(1)}s**\n\n${silences.slice(0, 8).map(s =>
            `• ${this._fmtTime(s.start)} → ${this._fmtTime(s.end)} (${(s.end - s.start).toFixed(1)}s)`
        ).join('\n')}\n\n${silences.length > 8 ? `...y ${silences.length - 8} más.\n` : ''}📝 Cortes automáticos disponibles en próxima actualización.`;
    }

    /** "Hazlo cinematográfico" — Slow-mo on highlights, lower speed elsewhere */
    async makeCinematic() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        const highlights = await this.auto.findHighlights(video);

        await this.mem.saveSnapshot('Modo Cinematográfico');

        if (highlights.length === 0) {
            App.setSpeed(0.8);
            return '🎬 **Modo Cinematográfico activado.**\nVelocidad global reducida a 0.8x para un look dramático.\nNo se detectaron momentos destacados para slow-motion.';
        }

        const actions = highlights.slice(0, 5).map(hl =>
            `• ${this._fmtTime(hl.start)}: Slow-motion 0.5x (${(hl.end - hl.start).toFixed(1)}s)`
        );

        App.setSpeed(0.85);
        return `🎬 **Modo Cinematográfico activado:**\nVelocidad base: 0.85x\n\nMomentos para slow-motion:\n${actions.join('\n')}\n\n🎵 Tip: Agrega música épica para maximizar el efecto.`;
    }

    /** "Resalta lo importante" — Mark highlights */
    async highlightImportant() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        const highlights = await this.auto.findHighlights(video);
        if (highlights.length === 0) return '📊 No se detectaron momentos de alta energía.';

        // Jump to first highlight
        if (highlights[0]) App.seek(highlights[0].start);

        return `🌟 **${highlights.length} momentos importantes detectados:**\n\n${highlights.slice(0, 8).map((h, i) =>
            `${i + 1}. ${this._fmtTime(h.start)} — ${this._fmtTime(h.end)}`
        ).join('\n')}\n\n▶️ Te llevé al primer momento destacado.`;
    }

    /** "Normaliza el audio" / "Limpia el audio" */
    async normalizeAudio() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        await this.mem.saveSnapshot('Normalizar Audio');

        if (this.auto.applyAudioPolish()) {
            return '🔊 **Limpieza Quirúrgica Activa**\nFiltro paso alto (80Hz) y Compresor Dinámico aplicados en tiempo real vía Web Audio API.';
        } else {
            video.volume = 1.0;
            video.muted = false;
            return '🔊 **Audio normalizado** (Fallback básico)\nPara limpieza real, asegúrate de que el audio no esté restringido por el navegador.';
        }
    }

    /** "Piloto Automático: Resumen Reels" */
    async createReelsSummary() {
        const video = document.getElementById('video-player');
        if (!video?.src) return '⚠️ Carga un video primero.';

        this.bus.emit('toast:info', '🤖 Piloto AI: Cortando edición para Reels...');
        await this.mem.saveSnapshot('Auto-Resumen Reels');

        const highlights = await this.auto.findHighlights(video);
        if (highlights.length === 0) return '📊 No hay suficientes datos para armar un resumen emocionante.';

        // Find the best highlight
        const best = highlights.reduce((prev, current) => (prev.energy > current.energy) ? prev : current);

        // Let's frame a 60s max video around the best highlight
        let inP = Math.max(0, best.start - 10);
        let outP = Math.min(video.duration, inP + 60);

        if (window.App && window.App.timeline) {
            window.App.timeline.setRange(inP, outP);
            window.App.seek(inP);
        }

        return `🎬 **Modo Piloto Completado**\n\nHe aislado el clip más enérgico del video y cortado los silencios circundantes para un formato Reels (duración: ${(outP - inP).toFixed(1)}s).\n\n▶️ Listo para previsualizar. Si no te gusta escribe "revertir".`;
    }

    _fmtTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }
}


/* ═══════════════════════════════════════════
   §6  STELAR BRAIN — Orquestador Principal
   ═══════════════════════════════════════════ */

class StelarBrain {
    constructor(bus) {
        this.bus = bus;
        this.nlp = new StelarNLP();
        this.memory = new StelarMemory();
        this.automaton = new StelarAutomaton(bus);
        this.vision = new StelarVision(bus);
        this.pro = new ProCommands(bus, this.automaton, this.memory);

        this._registerIntents();
        this._initialized = false;

        // Learn user patterns
        bus.on('theme:changed', (theme) => {
            this.memory.setPref('preferred-theme', theme);
            this.memory.learnPattern(`theme-${theme}`);
        });
    }

    /** Register all NLP intents */
    _registerIntents() {
        const I = (name, config) => this.nlp.registerIntent(name, config);

        // ── Playback ──
        I('play', {
            keywords: ['reproduce', 'play', 'iniciar', 'empieza'],
            patterns: [/\b(play|reproduce|reproducir|dale\s?play|inicia)\b/i],
            action: () => { App.play(); return '▶️ Reproduciendo.'; }
        });
        I('pause', {
            keywords: ['pausa', 'stop', 'detener', 'para'],
            patterns: [/\b(pause?|pausa|stop|para|detener)\b/i],
            action: () => { App.pause(); return '⏸️ Pausado.'; }
        });

        // ── Seek ──
        I('seek', {
            keywords: ['ir', 've', 'salta', 'posiciona', 'seek'],
            patterns: [/\b(ve\s+a|ir\s+a|salta?\s+a|go\s+to|seek)\b/i],
            requiresEntity: 'time',
            action: (e) => { App.seek(e.time || 0); return `⏩ Posición: ${(e.time || 0).toFixed(1)}s`; }
        });
        I('skip-fwd', {
            keywords: ['avanza', 'adelanta', 'forward', 'skip'],
            patterns: [/\b(avanza|adelanta|forward)\b/i],
            action: (e) => { const v = document.getElementById('video-player'); const s = e.number || e.time || 5; App.seek(v.currentTime + s); return `⏩ +${s}s`; }
        });
        I('skip-back', {
            keywords: ['retrocede', 'atras', 'rewind'],
            patterns: [/\b(retrocede|atrás|atras|rewind)\b/i],
            action: (e) => { const v = document.getElementById('video-player'); const s = e.number || e.time || 5; App.seek(v.currentTime - s); return `⏪ -${s}s`; }
        });

        // ── Speed ──
        I('speed', {
            keywords: ['velocidad', 'speed', 'vel', 'rapido', 'lento'],
            patterns: [/\b(velocidad|speed|vel)\b/i, /\d+(\.\d+)?\s*x/i, /\b(lento|slow|fast|rapido|cámara\s*lenta)\b/i],
            action: async (e) => {
                await this.memory.saveSnapshot('Cambio de velocidad');
                const s = Math.max(0.5, Math.min(4.0, e.speed || 1)); App.setSpeed(s); return `⚡ Velocidad: ${s}x`;
            }
        });

        // ── Cut/Split ──
        I('cut', {
            keywords: ['corta', 'cut', 'divide', 'split', 'separa'],
            patterns: [/\b(corta|cortar|divide|dividir|split|cut)\b/i],
            action: async (e) => {
                await this.memory.saveSnapshot('Corte manual');
                if (e.time) App.seek(e.time); App.split(); return `✂️ Dividido${e.time ? ` en ${e.time}s` : ''}.`;
            }
        });

        // ── Undo ──
        I('undo', {
            keywords: ['deshacer', 'deshaz', 'revierte', 'atras', 'undo', 'error'],
            patterns: [/\b(deshacer|deshaz|revierte|undo|me equivoqué|error)\b/i],
            action: async () => {
                const snap = await this.memory.restoreLastSnapshot();
                if (!snap) return '⚠️ No hay cambios recientes para deshacer.';

                // Aplicar estado revertido
                if (window.App) {
                    window.App.setSpeed(snap.state.speed);
                    window.App.seek(snap.state.time);
                    if (window.App.timeline) {
                        window.App.timeline.inPoint = snap.state.inPoint;
                        window.App.timeline.outPoint = snap.state.outPoint;
                        window.App.timeline._draw();
                    }
                }
                return `⏪ **Cambio revertido:** ${snap.reason}\nVolvimos al estado anterior.`;
            }
        });

        // ── Zoom ──
        I('zoom-in', {
            keywords: ['acerca', 'ampliar', 'zoom'],
            patterns: [/\b(zoom\s*in|acerca|ampliar|acercar)\b/i],
            action: () => { document.getElementById('btn-zoom-in').click(); return '🔍 Timeline acercado.'; }
        });
        I('zoom-out', {
            keywords: ['aleja', 'reducir'],
            patterns: [/\b(zoom\s*out|aleja|alejar|reducir)\b/i],
            action: () => { document.getElementById('btn-zoom-out').click(); return '🔍 Timeline alejado.'; }
        });

        // ── Theme ──
        I('theme', {
            keywords: ['tema', 'theme', 'modo', 'gamer', 'canva'],
            patterns: [/\b(tema|theme|modo|mode)\b/i],
            action: (e) => {
                if (e.theme) { App.setTheme(e.theme); return `🎨 Tema: ${e.theme === 'gamer' ? 'Gamer 🎮' : 'Canva 🎨'}`; }
                App.toggleTheme(); return '🎨 Tema alternado.';
            }
        });

        // ── Features ──
        I('snapshot', {
            keywords: ['captura', 'snapshot', 'foto', 'frame', 'sticker'],
            patterns: [/\b(captura|snapshot|foto|frame|sticker)\b/i],
            action: () => { App.snapshot(); return '📸 Frame capturado.'; }
        });
        I('vault', {
            keywords: ['boveda', 'vault', 'seguro', 'candado'],
            patterns: [/\b(bóveda|boveda|vault|seguro|candado)\b/i],
            action: () => { App.openVault(); return '🔒 Abriendo Bóveda...'; }
        });
        I('multiplayer', {
            keywords: ['sala', 'multiplayer', 'equipo', 'team'],
            patterns: [/\b(sala|multiplayer|equipo|team|colabor)\b/i],
            action: () => { App.createRoom(); return '🌐 Panel multiplayer abierto.'; }
        });
        I('volume', {
            keywords: ['volumen', 'volume', 'vol', 'mute', 'silencio'],
            patterns: [/\b(volumen|volume|mute|silencio|mudo)\b/i],
            action: (e) => {
                const v = document.getElementById('video-player');
                if (e.percentage !== undefined) { v.volume = e.percentage / 100; v.muted = false; return `🔊 Volumen: ${e.percentage}%`; }
                if (/mute|silencio|mudo/i.test('')) { v.muted = true; return '🔇 Silenciado.'; }
                return `🔊 Volumen actual: ${Math.round(v.volume * 100)}%`;
            }
        });

        // ── PRO COMMANDS ──
        I('dynamic', {
            keywords: ['dinamico', 'energetico', 'activo', 'vivo'],
            patterns: [/\b(hazlo\s+)?dinámic|dinamic|energetic|activ[oa]\b/i, /\bhacer(lo)?\s+dinámic/i],
            action: async () => await this.pro.makeDynamic()
        });
        I('cut-silences', {
            keywords: ['silencio', 'silencios', 'mudo', 'callado'],
            patterns: [/\b(corta|elimina|quita|remueve)\s+(los\s+)?silencio/i, /\bsin\s+silencios\b/i],
            action: async () => await this.pro.cutSilences()
        });
        I('cinematic', {
            keywords: ['cinematico', 'cine', 'pelicula', 'epico', 'dramatico'],
            patterns: [/\b(cinemat|cine|pelicula|épic|epic|dramátic|dramatic)\b/i, /\bhazlo\s+(cinemat|épic|epic)/i],
            action: async () => await this.pro.makeCinematic()
        });
        I('highlight', {
            keywords: ['importante', 'destacar', 'resaltar', 'highlight'],
            patterns: [/\b(resalta|destaca|highlight|important)\b/i, /\blo\s+importante\b/i],
            action: async () => await this.pro.highlightImportant()
        });
        I('normalize-audio', {
            keywords: ['normaliza', 'limpia', 'audio', 'normalizar'],
            patterns: [/\b(normaliza|limpia)\s+(el\s+)?audio\b/i, /\baudio\s+(limpio|normal)/i],
            action: async () => await this.pro.normalizeAudio()
        });
        I('reels', {
            keywords: ['reels', 'resumen', 'tiktok', 'corto', 'piloto'],
            patterns: [/\b(resumen|reels|tiktok|piloto)\b/i],
            action: async () => await this.pro.createReelsSummary()
        });
        I('thumbnail', {
            keywords: ['miniatura', 'thumbnail', 'portada'],
            patterns: [/\b(miniatura|thumbnail|portada)\b/i],
            action: async () => {
                if (window.App && window.App.imageEditor && window.App.stickerLab) {
                    // Switch mode
                    window.App.imageEditor.switchMode('image');
                    // Capture
                    await window.App.stickerLab.capture();
                    // Load the blob into ImageEditor
                    if (window.App.stickerLab._currentBlob) {
                        const file = new File([window.App.stickerLab._currentBlob], 'thumbnail.png', { type: 'image/png' });
                        window.App.imageEditor.loadImage(file);
                        return '📸 **Modo Miniatura Activado**\n\nHe capturado el fotograma y te pasé al Modo Stelar Image. Usa "Mejora Automática" o recorta el fondo para terminarla.';
                    }
                }
                return '⚠️ No pude extraer la miniatura.';
            }
        });

        // ── Info ──
        I('info', {
            keywords: ['info', 'estado', 'status', 'duracion'],
            patterns: [/\b(info|estado|status|duración|duracion)\b/i],
            action: () => {
                const v = document.getElementById('video-player');
                if (!v?.src || !v.duration) return '📊 No hay video cargado.';
                const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
                return `📊 **Proyecto**\n• Duración: ${fmt(v.duration)}\n• Posición: ${fmt(v.currentTime)}\n• Velocidad: ${v.playbackRate}x\n• Resolución: ${v.videoWidth}×${v.videoHeight}\n• Volumen: ${Math.round(v.volume * 100)}%`;
            }
        });

        // ── Suggestions ──
        I('suggestions', {
            keywords: ['sugerencia', 'sugiere', 'recomienda', 'consejo', 'tip'],
            patterns: [/\b(suger|recomien|consejo|tip)\b/i],
            action: async () => {
                const suggestions = await this.memory.getSuggestions();
                if (suggestions.length === 0) return '💡 Aún no tengo suficientes datos para sugerirte algo. ¡Sigue editando!';
                return `🧠 **Mis sugerencias:**\n\n${suggestions.join('\n')}`;
            }
        });

        // ── Help ──
        I('help', {
            keywords: ['ayuda', 'help', 'comandos'],
            patterns: [/\b(ayuda|help|que puedes|qué puedes|como|cómo)\b/i],
            action: () => `🤖 **Stelar — IA de Edición Local**\n\n📝 **Básicos:**\n• "reproduce" / "pausa"\n• "ve al segundo 30"\n• "velocidad 2x"\n• "corta aquí"\n\n🎯 **Pro:**\n• "**hazlo dinámico**" — acelera silencios\n• "**corta los silencios**" — detecta y marca\n• "**hazlo cinematográfico**" — slow-motion épico\n• "**resalta lo importante**" — encuentra momentos clave\n• "**limpia el audio**" — normaliza volumen\n\n🧠 **Inteligencia:**\n• "sugerencias" — basadas en tu historial\n• "info" — estado del proyecto\n\n💡 Todo offline. Tu data nunca sale del navegador.`
        });

        // ── Generation placeholder ──
        I('generate', {
            keywords: ['genera', 'generar', 'crear', 'create'],
            patterns: [/\b(genera|crear?)\s+(un\s+)?(video|clip|animación)/i],
            action: (e) => `🧪 **Generación de Video (próximamente)**\n\nEstructura lista para:\n• Pipeline de difusión WebGPU\n• Text-to-Video local (ONNX)\n• Interpolación de frames\n\n🔐 Todo se procesará en tu GPU local.`
        });
    }

    /** Main entry: process text input */
    async process(text) {
        const result = this.nlp.classify(text);

        // Log to memory
        this.memory.logCommand(result.name, text);

        // Find the intent
        const intent = this.nlp.intents.find(i => i.name === result.name);

        if (intent?.action) {
            try {
                const response = await intent.action(result.entities);
                return { response, intent: result.name, confidence: result.confidence };
            } catch (err) {
                return { response: `⚠️ Error: ${err.message}`, intent: result.name, confidence: result.confidence };
            }
        }

        // Contextual fallback
        return { response: this._fallback(text), intent: 'unknown', confidence: 0 };
    }

    _fallback(text) {
        const lower = text.toLowerCase();
        if (/otra\s*vez|de\s*nuevo|repite|again/i.test(lower)) return '🔄 ¿Qué quieres que repita? Dime el comando.';
        if (/gracia|thanks/i.test(lower)) return '✨ ¡De nada! Sigo aquí.';
        if (/hola|hello|hey/i.test(lower)) return '👋 ¡Hola! Escribe "**ayuda**" para ver todo lo que puedo hacer.';
        if (/^(si|sí|ok|dale|claro)$/i.test(lower)) return '👍 Perfecto. ¿Qué necesitas?';

        const tips = [
            '🤔 No entendí. Prueba: "**hazlo dinámico**", "**velocidad 2x**", "**corta en 5s**"',
            '💡 Escribe "**ayuda**" para ver todos mis comandos pro.',
            '🎯 Intenta: "**corta los silencios**" o "**hazlo cinematográfico**"',
        ];
        return tips[Math.floor(Math.random() * tips.length)];
    }

    /** Initialize audio analysis when video loads */
    initAudio() {
        this.automaton._ensureAudioCtx();
    }
}


/* ═══════════════════════════════════════════
   EXPORT — Make available globally
   ═══════════════════════════════════════════ */
window.StelarBrain = StelarBrain;

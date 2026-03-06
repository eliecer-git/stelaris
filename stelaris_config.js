/**
 * ╔══════════════════════════════════════════════╗
 * ║  STELARIS PRO 2.0 — White Label Config       ║
 * ║  Modify this file to rebrand the application ║
 * ╚══════════════════════════════════════════════╝
 */
const STELARIS_CONFIG = Object.freeze({

    /* ── Branding ── */
    app: {
        name: 'STELARIS PRO',
        version: '2.0.0',
        tagline: 'Editor de Video Profesional',
        logo: '✦',
        copyright: '© 2026 STELARIS',
    },

    /* ── Vault Settings ── */
    vault: {
        minPinLength: 4,
        maxPinLength: 15,
        maxAttempts: 5,
        lockoutMs: 300000,           // 5 min lockout after max attempts
        storageKey: 'stelaris_vault',
        pinHashKey: 'stelaris_vault_pin',
    },

    /* ── Timeline Defaults ── */
    timeline: {
        minSpeed: 0.5,
        maxSpeed: 4.0,
        defaultSpeed: 1.0,
        speedStep: 0.25,
        thumbnailInterval: 2,       // seconds between thumbnail captures
        waveformBars: 512,          // number of bars in waveform
        defaultZoom: 3,
        minZoom: 1,
        maxZoom: 10,
        skipSeconds: 5,
    },

    /* ── Toast Notifications ── */
    toast: {
        durationMs: 3500,
        maxVisible: 4,
        position: 'bottom-right',   // bottom-right | bottom-left | top-right
    },

    /* ── Theming ── */
    themes: {
        storageKey: 'stelaris_theme',
        default: null,               // null → show mood selector
        available: ['gamer', 'canva'],
    },

    /* ── File Constraints ── */
    files: {
        acceptVideo: 'video/mp4,video/webm,video/ogg,video/quicktime',
        maxSizeMb: 2048,
    },
});

# STELARIS PRO 2.0

**Editor de Video Profesional** — Software de edición de alto nivel con interfaz inmersiva y arquitectura modular.

---

## 📁 Estructura del Proyecto

```
STELARIS PRO/
├── index.html            # Layout HTML5 semántico
├── style.css             # Sistema de diseño + temas (Gamer / Canva)
├── app.js                # Lógica principal (módulos independientes)
├── stelaris_config.js    # ⚙️ Configuración White-Label (rebranding)
├── service-worker.js     # PWA / offline support
├── manifest.json         # Manifiesto PWA
├── favicon.ico           # Ícono del navegador
├── icon-192x192.png      # Ícono PWA (192px)
├── icon-512x512.png      # Ícono PWA (512px)
└── README.md             # Este archivo
```

## 🎨 Temas Disponibles

| Tema | Descripción | Uso recomendado |
|------|-------------|-----------------|
| **Gamer** 🎮 | Neón, alto contraste, fondos oscuros | Sesiones nocturnas, estética futurista |
| **Canva** 🎨 | Pasteles suaves, antifatiga | Sesiones largas, entorno profesional |

Los temas se configuran vía variables CSS en `style.css` → secciones `[data-theme="gamer"]` y `[data-theme="canva"]`.

## 🏗️ Arquitectura Modular (app.js)

| Módulo | Descripción |
|--------|-------------|
| `CommandBus` | Bus de eventos centralizado para comunicación entre módulos |
| `ToastManager` | Notificaciones tipo toast (success, warning, error, info) |
| `ThemeManager` | Gestión de temas con persistencia en localStorage |
| `PlayerModule` | Reproductor de video con controles y velocidad (0.5x–4.0x) |
| `TimelineModule` | Timeline híbrido: regla + thumbnails + waveform + playhead |
| `VaultModule` | Bóveda segura con PIN (SHA-256) y lockout |
| `FileImporter` | Importación de archivos de video |
| `PropertiesPanel` | Panel de propiedades del clip |
| `ToolSelector` | Selector de herramientas de edición |

## ⚙️ Personalización White-Label

Edite `stelaris_config.js` para cambiar:

- **Nombre y logo** de la aplicación
- **Límites del PIN** de la bóveda
- **Velocidades** del reproductor
- **Duración** de notificaciones toast
- **Tema por defecto**

```javascript
// Ejemplo: cambiar nombre y logo
const STELARIS_CONFIG = Object.freeze({
  app: {
    name: 'MI EDITOR PRO',
    logo: '🎬',
    // ...
  },
});
```

## ⌨️ Atajos de Teclado

| Tecla | Acción |
|-------|--------|
| `Espacio` | Reproducir / Pausar |
| `J` | Retroceder 5 segundos |
| `L` | Avanzar 5 segundos |
| `Esc` | Cerrar Bóveda |

## 🚀 Cómo Ejecutar

1. Sirva la carpeta con cualquier servidor HTTP estático:
   ```bash
   npx serve .
   # o
   python3 -m http.server 8080
   ```
2. Abra `http://localhost:3000` (o el puerto indicado) en su navegador.

## 📜 Licencia

© 2026 STELARIS — Todos los derechos reservados.

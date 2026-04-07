## **Project Identity**
* **Name:** Flatspace Commander
* **Concept:** A 2D vertical-scrolling PWA space trader/shooter inspired by the C64 classic *Elite*.
* **Tech Stack:** Strict **Pure Vanilla JavaScript (ES6+)**, HTML5 Canvas API, and CSS3. No frameworks or external engines.

### **Visual & Style Guide**
* **Aesthetic:** High-contrast **Black and White** (1-bit style).
* **Palette:** Background `#000000`, Foreground `#FFFFFF`. Use minimal grays only if necessary for depth.
* **Glitch Effects:** Occasional "3D glitch" artifacts. Implement via temporary horizontal line shifts, RGB split simulations (using white/gray offsets), or frame-flicker on hits/UI transitions.
* **UI:** Hybrid approach.
    * **Combat/Flight:** Canvas-based, using vector-style line art for ships and asteroids to mimic wireframes.
    * **Stations/Menus:** Clean, brutalist HTML/CSS. Use monospace fonts (e.g., `Courier New`, `monospace`).

### **Coding Standards**
* **State Management:** Use a single source of truth (a `gameState` object) to track player credits, inventory, fuel, and location.
* **PWA Architecture:** * Manifest-driven `standalone` display.
    * Service Worker for offline play and asset caching.
    * Persistence via `localStorage` or `IndexedDB`.
* **Performance:** All game-loop logic must reside within `requestAnimationFrame`. Use off-screen canvases for static elements (like starfields) to save draw calls.

### **Gameplay Logic**
* **Flight:** Vertical scrolling. Player at the bottom, enemies enter from the top.
* **Economy:** Use the classic 17 Elite commodities. Price logic must be tied to a system's tech level and government type.
* **Procedural Generation:** Use a seed-based PRNG to generate the galaxy map so world data is consistent but not hard-coded.

### **Naming Conventions**
* Variables/Functions: `camelCase`
* Classes: `PascalCase`
* Constants: `SCREAMING_SNAKE_CASE`

### **Audio Playback**
Use `public/js/vendor/howler.js` for audio playback.
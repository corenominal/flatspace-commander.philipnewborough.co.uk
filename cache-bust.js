#!/usr/bin/env node

/**
 * cache-bust.js
 *
 * Applies a Date.now() timestamp as query strings (?v={timestamp}) for:
 *   - style.css and main.js  → in index.html and sw.js
 *   - index.html, combat.js, procedural.js, and howler.js → in sw.js
 *   - combat.js and procedural.js imports → in main.js
 * Also bumps the SW CACHE_NAME so stale caches are purged.
 *
 * Usage: node cache-bust.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HTML    = join(__dirname, 'public', 'index.html');
const SW      = join(__dirname, 'public', 'sw.js');
const MAIN_JS = join(__dirname, 'public', 'js', 'main.js');

// Files referenced in both index.html and sw.js
const TARGETS = [
  {
    htmlRef: /\/css\/style\.css(?:\?v=[a-zA-Z0-9]+)?/,
    swRef:   /\/css\/style\.css(?:\?v=[a-zA-Z0-9]+)?/,
    htmlNew: (t) => `/css/style.css?v=${t}`,
    swNew:   (t) => `/css/style.css?v=${t}`,
  },
  {
    htmlRef: /\/js\/main\.js(?:\?v=[a-zA-Z0-9]+)?/,
    swRef:   /\/js\/main\.js(?:\?v=[a-zA-Z0-9]+)?/,
    htmlNew: (t) => `/js/main.js?v=${t}`,
    swNew:   (t) => `/js/main.js?v=${t}`,
  },
];

// Imports referenced inside main.js
const MAIN_JS_TARGETS = [
  {
    ref: /\.\/procedural\.js(?:\?v=[a-zA-Z0-9]+)?/,
    new: (t) => `./procedural.js?v=${t}`,
  },
  {
    ref: /\.\/combat\.js(?:\?v=[a-zA-Z0-9]+)?/,
    new: (t) => `./combat.js?v=${t}`,
  },
];

// Files referenced only in sw.js
const SW_TARGETS = [
  {
    swRef: /\/js\/combat\.js(?:\?v=[a-zA-Z0-9]+)?/,
    swNew: (t) => `/js/combat.js?v=${t}`,
  },
  {
    swRef: /\/js\/procedural\.js(?:\?v=[a-zA-Z0-9]+)?/,
    swNew: (t) => `/js/procedural.js?v=${t}`,
  },
  {
    swRef: /\/js\/vendor\/howler\.js(?:\?v=[a-zA-Z0-9]+)?/,
    swNew: (t) => `/js/vendor/howler.js?v=${t}`,
  },
];

const ts = String(Date.now());

let html   = readFileSync(HTML, 'utf8');
let sw     = readFileSync(SW, 'utf8');
let mainJs = readFileSync(MAIN_JS, 'utf8');

// Phase 1: update html and sw for CSS/main.js targets
for (const { htmlRef, swRef, htmlNew, swNew } of TARGETS) {
  html = html.replace(htmlRef, htmlNew(ts));
  sw   = sw.replace(swRef, swNew(ts));
}

// Phase 2: update index.html version in sw
sw = sw.replace(/\/index\.html(?:\?v=[a-zA-Z0-9]+)?/, `/index.html?v=${ts}`);

// Phase 3: update sw for SW-only targets
for (const { swRef, swNew } of SW_TARGETS) {
  sw = sw.replace(swRef, swNew(ts));
}

// Phase 4: update imports inside main.js
for (const target of MAIN_JS_TARGETS) {
  mainJs = mainJs.replace(target.ref, target.new(ts));
}

console.log(`Applied timestamp: ?v=${ts}`);

// Bump the SW CACHE_NAME so stale caches are purged
sw = sw.replace(
  /(const CACHE_NAME\s*=\s*['"][^'"]+\.)(\d+)(['"]\s*;)/,
  (_, prefix, num, suffix) => `${prefix}${parseInt(num, 10) + 1}${suffix}`
);

writeFileSync(HTML, html, 'utf8');
console.log('Updated: public/index.html');

writeFileSync(MAIN_JS, mainJs, 'utf8');
console.log('Updated: public/js/main.js');

writeFileSync(SW, sw, 'utf8');
console.log('Updated: public/sw.js');

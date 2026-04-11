/**
 * FLATSPACE COMMANDER
 * main.js — core entry point
 *
 * Architecture:
 *   gameState   — single source of truth
 *   Starfield   — off-screen canvas scrolling background
 *   Player      — vector ship, keyboard + touch input
 *   GameLoop    — requestAnimationFrame driver
 */

import { GalaxyGenerator, getMarketPrices, COMMODITIES } from './procedural.js?v=1775932367507';
import { SHIP_CATALOG, generateCombatScenario, CombatEncounter } from './combat.js?v=1775932367507';

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAR_COUNT     = 150;
const STAR_SPEED_MIN = 0.5;
const STAR_SPEED_MAX = 3.0;
const PLAYER_SPEED   = 4;
const PLAYER_WIDTH   = 58;   // Cobra wingspan
const PLAYER_HEIGHT      = 40;   // Cobra front-to-rear depth
const HUD_HEIGHT         = 120;  // Touch-pad HUD strip at screen bottom
const CHART_PANEL_HEIGHT = 180;  // Galactic chart info panel height
const CHART_PADDING      = 20;   // Padding inside the galaxy map border
const CHART_MAX_RANGE    = 70;   // Max jump range in galaxy-map units at 100% fuel
const MAP_ZOOM_MIN       = 1;    // Minimum zoom level (full sector view)
const MAP_ZOOM_MAX       = 6;    // Maximum zoom level
const FUEL_PRICE_PER_PCT  = 2;    // Credits per 1% of fuel
const HULL_PRICE_PER_PCT  = 5;    // Credits per 1% of hull repair

const ASTEROID_SPAWN_MIN  = 8000;  // ms — minimum interval between asteroid spawns
const ASTEROID_SPAWN_MAX  = 22000; // ms — maximum interval
const ASTEROID_SPEED_MIN  = 45;    // px/s
const ASTEROID_SPEED_MAX  = 90;    // px/s
const ASTEROID_RADIUS_MIN = 16;    // px
const ASTEROID_RADIUS_MAX = 36;    // px
const ASTEROID_DMG_MIN    = 5;     // % hull damage on collision
const ASTEROID_DMG_MAX    = 20;    // % hull damage on collision

const MINING_LASER_TIME   = 3.0;   // seconds of continuous beam contact to mine an asteroid
const MINING_CARGO_POOL   = [12, 12, 12, 13, 13, 14];  // minerals (common), gold, platinum (rare)

/** Commodity IDs that are considered illegal contraband and trigger a security inspection on docking. */
const ILLEGAL_CARGO_IDS = new Set([3, 6, 10]);  // Labour Contracts, Narcotics, Firearms

// ─── Equipment Catalog ────────────────────────────────────────────────────────

/**
 * Equipment available at stations, gated by system tech level.
 * type 'single' — one-time install; type 'multi' — stackable up to maxOwn.
 */
const EQUIPMENT_CATALOG = [
  { id: 'missile',           name: 'MISSILE',              price: 30,   techMin: 1,  maxOwn: 3, type: 'multi'  },
  { id: 'escape_pod',        name: 'ESCAPE POD',           price: 1000, techMin: 1,  maxOwn: 1, type: 'single' },
  { id: 'extra_cargo',       name: 'CARGO BAY +4T',        price: 400,  techMin: 2,  maxOwn: 1, type: 'single' },
  { id: 'pulse_laser',       name: 'PULSE LASER',          price: 400,  techMin: 3,  maxOwn: 1, type: 'single' },
  { id: 'mining_laser',      name: 'MINING LASER',         price: 800,  techMin: 4,  maxOwn: 1, type: 'single' },
  { id: 'beam_laser',        name: 'BEAM LASER',           price: 2000, techMin: 5,  maxOwn: 1, type: 'single' },
  { id: 'military_laser',    name: 'MILITARY LASER',       price: 10000, techMin: 10, maxOwn: 1, type: 'single' },
  { id: 'shield_generator',  name: 'SHIELD GENERATOR',     price: 2500, techMin: 7,  maxOwn: 1, type: 'single' },
  { id: 'dock_computer',     name: 'DOCKING COMPUTERS',    price: 1500, techMin: 8,  maxOwn: 1, type: 'single' },
  { id: 'gal_hyperdrive',    name: 'GALACTIC HYPERDRIVE',  price: 5000, techMin: 10, maxOwn: 1, type: 'single' },
];

// ─── Game State ───────────────────────────────────────────────────────────────

const gameState = {
  commanderName: '',
  credits: 100,
  fuel: 100,
  inventory: {},
  cargoCapacity: 20,
  currentSystem: null,
  destinationSystem: null,
  visitedSystems: {},   // { [systemId: string]: visitCount }
  commanderLog: [],     // Array<LogEntry> — persistent mission log
  equipment: {},        // { [itemId: string]: quantity }
  hull: 100,            // 0–100; damaged in combat, repaired at stations
  shields: 0,           // 0 = no shields; 1–100 = current shield strength (requires shield_generator)
  pendingBounties: [],  // [{ name, bounty }] — pirate kills awaiting claim at next station
  screen: 'intro',   // 'intro' | 'flight' | 'docking' | 'station' | 'market' | 'map' | 'equipment'
  stats: {
    kills:             0,   // enemies/asteroids destroyed
    combatEncounters:  0,   // individual combat encounters entered
    flightsCompleted:  0,   // successful flight legs completed (docking reached)
    asteroidStrikes:   0,   // asteroid collisions sustained
  },
};

// ─── Flight State ─────────────────────────────────────────────────────────────

/** Mutable state for the current flight leg. Reset at the start of each flight. */
const flightState = {
  totalDist:     0,   // total distance units for this leg (set on flight start)
  distRemaining: 0,   // distance units remaining (counts down to 0)
  lastTimestamp:  0,  // used to compute per-frame delta
};

/** Combat-specific flight-session state (reset per leg). */
let _flightCombatSchedule = [];  // Array<number> — distRemaining values at which to trigger combat
let _activeCombat         = null; // CombatEncounter | null
let _combatPaused         = false; // true while modal is open; pauses distRemaining
let _combatStatusMsg      = null; // { text, until } — post-combat status overlay
let _flightKills          = 0;    // pirate/enemy kills this flight leg
let _flightEncounters     = 0;    // combat encounters entered this leg
let _encounterType        = null; // 'pirate' | 'trader' | 'alien' — type of current encounter
let _encounterShips       = [];   // Array<string> — ship names in the current encounter
let _encounterHullDmg     = 0;    // hull % damage taken this encounter
let _encounterCargo       = {};   // { [commodityId]: count } — cargo collected this encounter
let _playerDeathPending   = false; // guard to prevent duplicate death handling
let _deathStarfieldActive = false; // show only starfield after player destruction

// Missile swipe-up detection (touch)
let _swipeTouchStartX = 0;
let _swipeTouchStartY = 0;

const galaxy         = new GalaxyGenerator();
const GALAXY_SYSTEMS = galaxy.generateSector(512, 0);

const mapState = {
  selectedSystem: null,
  zoom: 1,
  panX: 127.5,   // galaxy-coord centre of the viewport (0–255)
  panY: 127.5,
};

// ─── Canvas Setup ─────────────────────────────────────────────────────────────

const stageEl  = document.getElementById('stage');
const canvas   = document.getElementById('game-canvas');
const ctx      = canvas.getContext('2d');
const uiLayer  = document.getElementById('ui-layer');

function resizeCanvas() {
  canvas.width  = stageEl.offsetWidth;
  canvas.height = stageEl.offsetHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── Starfield ────────────────────────────────────────────────────────────────

/**
 * Starfield scrolls downward during flight to simulate forward motion.
 * Stars are stored in a pool and recycled when they leave the bottom edge.
 */
class Starfield {
  constructor(width, height) {
    this.offscreen = document.createElement('canvas');
    this.offCtx    = this.offscreen.getContext('2d');
    this.stars     = [];
    this.resize(width, height);
  }

  resize(width, height) {
    this.width  = width;
    this.height = height;
    this.offscreen.width  = width;
    this.offscreen.height = height;
    this._generateStars();
  }

  _generateStars() {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x:     Math.random() * this.width,
        y:     Math.random() * this.height,
        size:  Math.random() * 1.5 + 0.5,
        speed: STAR_SPEED_MIN + Math.random() * (STAR_SPEED_MAX - STAR_SPEED_MIN),
      });
    }
  }

  update() {
    for (const star of this.stars) {
      star.y += star.speed;
      if (star.y > this.height) {
        star.y = 0;
        star.x = Math.random() * this.width;
      }
    }
  }

  draw(targetCtx) {
    const oc = this.offCtx;
    const w  = this.width;
    const h  = this.height;
    oc.clearRect(0, 0, w, h);
    oc.fillStyle = '#ffffff';
    for (const star of this.stars) {
      oc.globalAlpha = 0.4 + (star.speed / STAR_SPEED_MAX) * 0.6;
      oc.fillRect(star.x, star.y, star.size, star.size);
    }
    oc.globalAlpha = 1;
    targetCtx.drawImage(this.offscreen, 0, 0);
  }
}

// ─── Ship Drawing Utility ─────────────────────────────────────────────────────

/**
 * Draws the Cobra Mk III wireframe centred at (cx, cy).
 * Pass engineFlicker=true to render animated engine exhaust flames.
 */
function drawCobraShip(targetCtx, cx, cy, W, H, engineFlicker = false) {
  targetCtx.save();
  targetCtx.strokeStyle = '#ffffff';
  targetCtx.lineWidth   = 1.5;
  targetCtx.lineJoin    = 'round';
  targetCtx.lineCap     = 'round';

  // ── Outer hull (Cobra Mk III silhouette, nose points up) ──
  targetCtx.beginPath();
  targetCtx.moveTo(cx,              cy - H * 0.50);  // nose tip
  targetCtx.lineTo(cx + W * 0.11,  cy - H * 0.32);  // right nose shoulder
  targetCtx.lineTo(cx + W * 0.48,  cy - H * 0.04);  // right wing leading edge
  targetCtx.lineTo(cx + W * 0.48,  cy + H * 0.20);  // right wing tip
  targetCtx.lineTo(cx + W * 0.27,  cy + H * 0.50);  // right engine pod outer
  targetCtx.lineTo(cx + W * 0.15,  cy + H * 0.50);  // right engine pod inner
  targetCtx.lineTo(cx + W * 0.09,  cy + H * 0.28);  // rear centre-right
  targetCtx.lineTo(cx - W * 0.09,  cy + H * 0.28);  // rear centre-left
  targetCtx.lineTo(cx - W * 0.15,  cy + H * 0.50);  // left engine pod inner
  targetCtx.lineTo(cx - W * 0.27,  cy + H * 0.50);  // left engine pod outer
  targetCtx.lineTo(cx - W * 0.48,  cy + H * 0.20);  // left wing tip
  targetCtx.lineTo(cx - W * 0.48,  cy - H * 0.04);  // left wing leading edge
  targetCtx.lineTo(cx - W * 0.11,  cy - H * 0.32);  // left nose shoulder
  targetCtx.closePath();
  targetCtx.stroke();

  // ── Fuselage spine ──
  targetCtx.beginPath();
  targetCtx.moveTo(cx,             cy - H * 0.50);
  targetCtx.lineTo(cx + W * 0.09,  cy + H * 0.28);
  targetCtx.moveTo(cx,             cy - H * 0.50);
  targetCtx.lineTo(cx - W * 0.09,  cy + H * 0.28);
  targetCtx.stroke();

  // ── Wing panel lines ──
  targetCtx.beginPath();
  targetCtx.moveTo(cx + W * 0.11,  cy - H * 0.32);
  targetCtx.lineTo(cx + W * 0.48,  cy + H * 0.20);
  targetCtx.moveTo(cx - W * 0.11,  cy - H * 0.32);
  targetCtx.lineTo(cx - W * 0.48,  cy + H * 0.20);
  targetCtx.stroke();

  // ── Cockpit canopy ──
  targetCtx.beginPath();
  targetCtx.moveTo(cx,             cy - H * 0.36);
  targetCtx.lineTo(cx + W * 0.05,  cy - H * 0.24);
  targetCtx.lineTo(cx + W * 0.05,  cy - H * 0.10);
  targetCtx.lineTo(cx,             cy - H * 0.02);
  targetCtx.lineTo(cx - W * 0.05,  cy - H * 0.10);
  targetCtx.lineTo(cx - W * 0.05,  cy - H * 0.24);
  targetCtx.closePath();
  targetCtx.stroke();

  // ── Twin engine nozzles ──
  targetCtx.beginPath();
  targetCtx.moveTo(cx + W * 0.16,  cy + H * 0.50);
  targetCtx.lineTo(cx + W * 0.21,  cy + H * 0.62);
  targetCtx.lineTo(cx + W * 0.26,  cy + H * 0.50);
  targetCtx.moveTo(cx - W * 0.16,  cy + H * 0.50);
  targetCtx.lineTo(cx - W * 0.21,  cy + H * 0.62);
  targetCtx.lineTo(cx - W * 0.26,  cy + H * 0.50);
  targetCtx.stroke();

  // ── Engine exhaust flames (animated, optional) ──
  if (engineFlicker) {
    const fl = 0.30 + Math.random() * 0.35;
    targetCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    targetCtx.lineWidth   = 1;
    targetCtx.beginPath();
    targetCtx.moveTo(cx + W * 0.17,  cy + H * 0.52);
    targetCtx.lineTo(cx + W * 0.21,  cy + H * (0.62 + fl));
    targetCtx.lineTo(cx + W * 0.25,  cy + H * 0.52);
    targetCtx.moveTo(cx - W * 0.17,  cy + H * 0.52);
    targetCtx.lineTo(cx - W * 0.21,  cy + H * (0.62 + fl));
    targetCtx.lineTo(cx - W * 0.25,  cy + H * 0.52);
    targetCtx.stroke();
  }

  targetCtx.restore();
}

// ─── Player ───────────────────────────────────────────────────────────────────

class Player {
  constructor() {
    this.x        = canvas.width  / 2;
    this.y        = canvas.height - PLAYER_HEIGHT * 2;
    this.vx       = 0;
    this.keys     = { left: false, right: false };
    this.touchX   = null;   // null = no active touch
    this._bindInput();
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') this.keys.left  = true;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft'  || e.key === 'a') this.keys.left  = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = false;
    });

    // Touch: steer towards touch X position
    window.addEventListener('touchstart', (e) => {
      this.touchX = e.touches[0].clientX;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      this.touchX = e.touches[0].clientX;
    }, { passive: true });
    window.addEventListener('touchend', () => {
      this.touchX = null;
    });
  }

  update() {
    // Keyboard input
    if (this.keys.left)  this.vx = -PLAYER_SPEED;
    else if (this.keys.right) this.vx = PLAYER_SPEED;
    else this.vx = 0;

    // Touch override
    if (this.touchX !== null) {
      const diff = this.touchX - this.x;
      this.vx = Math.sign(diff) * Math.min(Math.abs(diff) * 0.1, PLAYER_SPEED);
    }

    this.x += this.vx;

    // Clamp to canvas bounds
    const half = PLAYER_WIDTH / 2;
    this.x = Math.max(half, Math.min(canvas.width - half, this.x));

    // Keep vertical position anchored above HUD, responsive to canvas changes
    this.y = canvas.height - HUD_HEIGHT - PLAYER_HEIGHT * 2;
  }

  draw(targetCtx) {
    drawCobraShip(targetCtx, this.x, this.y, PLAYER_WIDTH, PLAYER_HEIGHT);
  }
}

// ─── Asteroid ─────────────────────────────────────────────────────────────────

/**
 * An uncharted asteroid that drifts down the screen during normal flight.
 * The player cannot shoot it — only dodge. A collision causes hull damage.
 */
class Asteroid {
  constructor(canvasWidth, hasMiningLaser = true) {
    this.radius = ASTEROID_RADIUS_MIN + Math.random() * (ASTEROID_RADIUS_MAX - ASTEROID_RADIUS_MIN);
    this.x      = this.radius + Math.random() * (canvasWidth - this.radius * 2);
    this.y      = -this.radius - 10;
    const speedMult = hasMiningLaser ? 1.0 : 2.0;
    this.vy     = (ASTEROID_SPEED_MIN + Math.random() * (ASTEROID_SPEED_MAX - ASTEROID_SPEED_MIN)) * speedMult;
    this.vx     = (Math.random() - 0.5) * 50 * speedMult;
    this.rot    = Math.random() * Math.PI * 2;
    this.rotV   = (Math.random() - 0.5) * 2.0;  // rad/s
    this.hit    = false;  // set true once collision is processed
    this.mined  = false;  // set true when mining laser fully destroys this asteroid
    this.mineProgress = 0;  // 0–1 mining completion fraction

    // Pre-generate irregular polygon vertices (7–10 sides)
    const sides = 7 + Math.floor(Math.random() * 4);
    this.verts  = [];
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides;
      const r = this.radius * (0.55 + Math.random() * 0.45);
      this.verts.push({ a, r });
    }
  }

  update(dt, canvasWidth) {
    this.y   += this.vy  * dt;
    this.x   += this.vx  * dt;
    this.rot += this.rotV * dt;

    // Bounce off left/right edges
    if (this.x - this.radius < 0) {
      this.x  = this.radius;
      this.vx = Math.abs(this.vx);
    } else if (this.x + this.radius > canvasWidth) {
      this.x  = canvasWidth - this.radius;
      this.vx = -Math.abs(this.vx);
    }
  }

  isOffScreen(canvasHeight) {
    return this.y > canvasHeight + this.radius + 20;
  }

  /** Circle vs AABB collision against the player ship. */
  collidesWithPlayer(px, py) {
    const hw = PLAYER_WIDTH  / 2;
    const hh = PLAYER_HEIGHT / 2;
    const cx = Math.max(px - hw, Math.min(px + hw, this.x));
    const cy = Math.max(py - hh, Math.min(py + hh, this.y));
    return Math.hypot(cx - this.x, cy - this.y) < this.radius * 0.72;
  }

  draw(targetCtx) {
    targetCtx.save();
    targetCtx.translate(this.x, this.y);
    targetCtx.rotate(this.rot);

    // Outer rocky silhouette
    targetCtx.strokeStyle = '#ffffff';
    targetCtx.lineWidth   = 1.5;
    targetCtx.lineJoin    = 'round';
    targetCtx.beginPath();
    for (let i = 0; i < this.verts.length; i++) {
      const { a, r } = this.verts[i];
      i === 0
        ? targetCtx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        : targetCtx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    targetCtx.closePath();
    targetCtx.stroke();

    // Interior crack line for detail
    const mid = Math.floor(this.verts.length / 2);
    targetCtx.strokeStyle = 'rgba(255,255,255,0.30)';
    targetCtx.lineWidth   = 0.7;
    targetCtx.beginPath();
    targetCtx.moveTo(
      Math.cos(this.verts[0].a)   * this.verts[0].r   * 0.45,
      Math.sin(this.verts[0].a)   * this.verts[0].r   * 0.45,
    );
    targetCtx.lineTo(
      Math.cos(this.verts[mid].a) * this.verts[mid].r * 0.45,
      Math.sin(this.verts[mid].a) * this.verts[mid].r * 0.45,
    );
    targetCtx.stroke();

    // Mining progress arc (drawn in un-rotated local space so it stays upright)
    if (this.mineProgress > 0) {
      targetCtx.save();
      targetCtx.rotate(-this.rot);
      targetCtx.strokeStyle = 'rgba(255,255,255,0.85)';
      targetCtx.lineWidth   = 2;
      targetCtx.lineCap     = 'round';
      targetCtx.beginPath();
      targetCtx.arc(0, 0, this.radius + 5, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * this.mineProgress);
      targetCtx.stroke();
      targetCtx.restore();
    }

    targetCtx.restore();
  }
}

// ─── Mining Drop ─────────────────────────────────────────────────────────────

/**
 * A commodity pod ejected when an asteroid is destroyed by the mining laser.
 * The player collects it by flying over it before it drifts off-screen.
 */
class MiningDrop {
  constructor(x, y, commodityId) {
    this.x           = x;
    this.y           = y;
    this.vx          = (Math.random() - 0.5) * 60;
    this.vy          = 50 + Math.random() * 60;
    this.commodityId = commodityId;
    this.collected   = false;
    this.size        = 7;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  collidesWithPlayer(px, py) {
    return (
      Math.abs(this.x - px) < PLAYER_WIDTH  / 2 + this.size &&
      Math.abs(this.y - py) < PLAYER_HEIGHT / 2 + this.size
    );
  }

  isOffScreen(ch) { return this.y > ch + 24; }

  draw(targetCtx) {
    targetCtx.save();
    targetCtx.strokeStyle = '#ffffff';
    targetCtx.lineWidth   = 1;
    targetCtx.strokeRect(
      this.x - this.size / 2, this.y - this.size / 2,
      this.size, this.size,
    );
    targetCtx.save();
    targetCtx.globalAlpha = 0.55;
    targetCtx.beginPath();
    targetCtx.moveTo(this.x - this.size / 2, this.y);
    targetCtx.lineTo(this.x + this.size / 2, this.y);
    targetCtx.moveTo(this.x, this.y - this.size / 2);
    targetCtx.lineTo(this.x, this.y + this.size / 2);
    targetCtx.stroke();
    targetCtx.restore();
    targetCtx.restore();
  }
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

/**
 * A single spark particle ejected on an asteroid impact.
 * Rendered as a short bright line segment (velocity direction = streak angle).
 */
class Spark {
  constructor(x, y) {
    const speed   = 120 + Math.random() * 320;
    const angle   = Math.random() * Math.PI * 2;
    this.x        = x;
    this.y        = y;
    this.vx       = Math.cos(angle) * speed;
    this.vy       = Math.sin(angle) * speed - 60;  // slight upward bias
    this.life     = 0.35 + Math.random() * 0.45;   // seconds
    this.maxLife  = this.life;
    this.len      = 4 + Math.random() * 8;         // streak length in px
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vy   += 180 * dt;   // gravity pulls sparks down
    this.life -= dt;
  }

  get alive() { return this.life > 0; }

  draw(targetCtx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const nx    = this.vx / (Math.hypot(this.vx, this.vy) || 1);
    const ny    = this.vy / (Math.hypot(this.vx, this.vy) || 1);
    targetCtx.save();
    targetCtx.globalAlpha   = alpha;
    targetCtx.strokeStyle   = '#ffffff';
    targetCtx.lineWidth     = alpha > 0.5 ? 1.5 : 1.0;
    targetCtx.lineCap       = 'round';
    targetCtx.beginPath();
    targetCtx.moveTo(this.x,                  this.y);
    targetCtx.lineTo(this.x - nx * this.len,  this.y - ny * this.len);
    targetCtx.stroke();
    targetCtx.restore();
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function drawHUD() {
  const cw    = canvas.width;
  const ch    = canvas.height;
  const top   = ch - HUD_HEIGHT;
  const mid   = top + HUD_HEIGHT / 2;
  const third = cw / 3;
  const lx    = third / 2;          // left-zone centre
  const rx    = third * 2 + lx;     // right-zone centre
  const mx    = cw / 2;             // centre-zone centre
  const as    = 22;                 // chevron arrow size

  ctx.save();

  // ── Panel background ──
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, top, cw, HUD_HEIGHT);

  // ── Top border ──
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(cw, top);
  ctx.stroke();

  // ── Scanlines (CRT texture) ──
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = top + 3; y < ch; y += 4) {
    ctx.fillRect(0, y, cw, 1);
  }

  // ── Zone dividers (dashed) ──
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(third,     top + 8); ctx.lineTo(third,     ch - 8);
  ctx.moveTo(third * 2, top + 8); ctx.lineTo(third * 2, ch - 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── LEFT ZONE — steer left ──
  ctx.strokeStyle = 'rgba(255,255,255,0.60)';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(lx - as * 0.45, mid);
  ctx.lineTo(lx + as * 0.45, mid - as * 0.55);
  ctx.moveTo(lx - as * 0.45, mid);
  ctx.lineTo(lx + as * 0.45, mid + as * 0.55);
  ctx.stroke();
  // Decorative corner markers
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  const corner = 6;
  const lpad = 10; const rpad = third - 10;
  const tpad = top + 8; const bpad = ch - 8;
  // TL
  ctx.beginPath(); ctx.moveTo(lpad, tpad + corner); ctx.lineTo(lpad, tpad); ctx.lineTo(lpad + corner, tpad); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(lpad, bpad - corner); ctx.lineTo(lpad, bpad); ctx.lineTo(lpad + corner, bpad); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(rpad, tpad + corner); ctx.lineTo(rpad, tpad); ctx.lineTo(rpad - corner, tpad); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(rpad, bpad - corner); ctx.lineTo(rpad, bpad); ctx.lineTo(rpad - corner, bpad); ctx.stroke();

  ctx.fillStyle    = 'rgba(255,255,255,0.30)';
  ctx.font         = `8px 'Courier New', monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('STEER LEFT', lx, ch - 6);

  // ── RIGHT ZONE — steer right ──
  ctx.strokeStyle = 'rgba(255,255,255,0.60)';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(rx + as * 0.45, mid);
  ctx.lineTo(rx - as * 0.45, mid - as * 0.55);
  ctx.moveTo(rx + as * 0.45, mid);
  ctx.lineTo(rx - as * 0.45, mid + as * 0.55);
  ctx.stroke();
  // Decorative corner markers
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  const rlpad = third * 2 + 10; const rrpad = cw - 10;
  // TL
  ctx.beginPath(); ctx.moveTo(rlpad, tpad + corner); ctx.lineTo(rlpad, tpad); ctx.lineTo(rlpad + corner, tpad); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(rlpad, bpad - corner); ctx.lineTo(rlpad, bpad); ctx.lineTo(rlpad + corner, bpad); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(rrpad, tpad + corner); ctx.lineTo(rrpad, tpad); ctx.lineTo(rrpad - corner, tpad); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(rrpad, bpad - corner); ctx.lineTo(rrpad, bpad); ctx.lineTo(rrpad - corner, bpad); ctx.stroke();

  ctx.fillStyle    = 'rgba(255,255,255,0.30)';
  ctx.font         = `8px 'Courier New', monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('STEER RIGHT', rx, ch - 6);

  // ── CENTRE ZONE — status readouts ──
  // System name
  ctx.fillStyle    = '#ffffff';
  ctx.font         = `12px 'Courier New', monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const activeSystem = gameState.screen === 'flight'
    ? (gameState.destinationSystem || gameState.currentSystem)
    : gameState.currentSystem;
  const sysName = activeSystem ? activeSystem.name.toUpperCase() : 'DEEP SPACE';
  ctx.fillText(sysName, mx, top + 12);

  // Divider rule
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = 1;
  const ruleW = Math.min(third * 0.75, 130);
  ctx.beginPath();
  ctx.moveTo(mx - ruleW / 2, top + 30);
  ctx.lineTo(mx + ruleW / 2, top + 30);
  ctx.stroke();

  const barW = Math.min(third * 0.72, 120);
  const barH = 6;
  const barX = mx - barW / 2;

  // Adaptive vertical layout: add shields row if equipped
  const hasShields = gameState.shields > 0;
  let curBarY = top + (hasShields ? 46 : 56);

  // Shields bar (only when shield generator is installed)
  if (hasShields) {
    const shieldPct = Math.max(0, Math.min(1, gameState.shields / 100));
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(barX, curBarY, barW, barH);
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(barX + 1, curBarY + 1, Math.floor((barW - 2) * shieldPct), barH - 2);
    ctx.fillStyle    = 'rgba(255,255,255,0.50)';
    ctx.font         = `8px 'Courier New', monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(`SHLD  ${gameState.shields}%`, mx, curBarY + barH + 1);
    curBarY += barH + 12;
  }

  // Hull bar
  const hullPct = Math.max(0, Math.min(1, gameState.hull / 100));
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(barX, curBarY, barW, barH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(barX + 1, curBarY + 1, Math.floor((barW - 2) * hullPct), barH - 2);
  ctx.fillStyle    = 'rgba(255,255,255,0.50)';
  ctx.font         = `8px 'Courier New', monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(`HULL  ${gameState.hull}%`, mx, curBarY + barH + 1);

  ctx.restore();
}

// ─── Flight Distance HUD (top bar) ────────────────────────────────────────────

/**
 * Draws the distance-to-station countdown bar at the very top of the screen
 * during active flight. Shows the system name, a progress bar, and a numeric
 * distance readout.
 */
function drawFlightDistanceHUD() {
  const cw       = canvas.width;
  const barH     = 28;
  const padX     = 14;
  const frac     = flightState.totalDist > 0
    ? Math.max(0, flightState.distRemaining / flightState.totalDist)
    : 0;
  const distInt  = Math.max(0, Math.ceil(flightState.distRemaining));
  const destName = gameState.destinationSystem
    ? gameState.destinationSystem.name.toUpperCase()
    : 'UNKNOWN';

  ctx.save();

  // Background strip
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, cw, barH);

  // Bottom border
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH);
  ctx.lineTo(cw, barH);
  ctx.stroke();

  // Left label
  ctx.fillStyle    = 'rgba(255,255,255,0.55)';
  ctx.font         = `9px 'Courier New', monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('DIST TO STATION:', padX, barH / 2);

  // Progress bar (shrinks as distance decreases)
  const labelW  = 118;
  const rightW  = 80;
  const barW    = cw - labelW - rightW - padX * 2;
  const barX    = padX + labelW;
  const barY    = barH / 2 - 4;
  const barInH  = 8;

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(barX, barY, barW, barInH);

  // Filled portion — flash white when close
  const closeThresh = 0.12;
  const isClose     = frac < closeThresh;
  const flashOn     = isClose && (Math.floor(Date.now() / 250) % 2 === 0);
  ctx.fillStyle     = flashOn ? 'rgba(255,255,255,0.9)' : '#ffffff';
  ctx.fillRect(barX + 1, barY + 1, Math.floor((barW - 2) * frac), barInH - 2);

  // Numeric distance right-aligned
  ctx.fillStyle    = isClose ? (flashOn ? '#ffffff' : 'rgba(255,255,255,0.7)') : '#ffffff';
  ctx.font         = `10px 'Courier New', monospace`;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${distInt} LS`, cw - padX, barH / 2);

  // Destination name (faint, right of label)
  ctx.fillStyle    = 'rgba(255,255,255,0.38)';
  ctx.font         = `8px 'Courier New', monospace`;
  ctx.textAlign    = 'left';
  ctx.fillText(destName, padX + labelW - 4, barH / 2 + 9);

  ctx.restore();
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const SAVE_KEY          = 'flatspaceCommander_save';
const MAP_HELP_KEY      = 'flatspaceCommander_mapHelpSeen';
const MARKET_HELP_KEY   = 'flatspaceCommander_marketHelpSeen';
const DOCK_HELP_KEY     = 'flatspaceCommander_dockHelpSeen';
const PENDING_VISIT_KEY  = 'flatspaceCommander_pendingVisit';  // temp record cleared on log commit
const SHARE_MODAL_KEY    = 'flatspaceCommander_shareModalSeen';
const SFX_VOLUME_KEY     = 'flatspaceCommander_sfxVolume';

function saveGame() {
  const { commanderName, credits, fuel, hull, shields, pendingBounties, inventory, cargoCapacity, currentSystem, destinationSystem, visitedSystems, commanderLog, equipment, stats } = gameState;
  // Keep only the 50 most recent log entries to avoid bloating localStorage
  const logToSave = commanderLog.slice(-50);
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    commanderName,
    credits,
    fuel,
    inventory,
    cargoCapacity,
    currentSystem,
    destinationSystem,
    visitedSystems,
    commanderLog: logToSave,
    equipment,
    hull,
    stats,
  }));
  // Keep a temp record of the in-progress station visit so events survive a page reload.
  // Cleared automatically when the departure log entry is committed (at launch).
  if (_stationVisit) {
    localStorage.setItem(PENDING_VISIT_KEY, JSON.stringify(_stationVisit));
  } else {
    localStorage.removeItem(PENDING_VISIT_KEY);
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data.commanderName !== 'string' || !data.commanderName) return false;
    gameState.commanderName   = data.commanderName;
    gameState.credits         = typeof data.credits       === 'number' ? data.credits       : gameState.credits;
    gameState.fuel            = typeof data.fuel          === 'number' ? data.fuel          : gameState.fuel;
    gameState.inventory       = data.inventory && typeof data.inventory === 'object' ? data.inventory : {};
    gameState.cargoCapacity   = typeof data.cargoCapacity === 'number' ? data.cargoCapacity : gameState.cargoCapacity;
    gameState.currentSystem      = data.currentSystem     ?? null;
    gameState.destinationSystem   = data.destinationSystem ?? null;
    gameState.visitedSystems      = (data.visitedSystems && typeof data.visitedSystems === 'object' && !Array.isArray(data.visitedSystems)) ? data.visitedSystems : {};
    gameState.commanderLog        = Array.isArray(data.commanderLog) ? data.commanderLog : [];
    gameState.equipment           = (data.equipment && typeof data.equipment === 'object' && !Array.isArray(data.equipment)) ? data.equipment : {};
    gameState.hull                = typeof data.hull === 'number' ? Math.max(0, Math.min(100, data.hull)) : 100;
    gameState.shields             = typeof data.shields === 'number' ? Math.max(0, Math.min(100, data.shields)) : 0;
    gameState.pendingBounties     = Array.isArray(data.pendingBounties) ? data.pendingBounties : [];
    if (data.stats && typeof data.stats === 'object') {
      gameState.stats.kills            = typeof data.stats.kills            === 'number' ? data.stats.kills            : 0;
      gameState.stats.combatEncounters = typeof data.stats.combatEncounters === 'number' ? data.stats.combatEncounters : 0;
      gameState.stats.flightsCompleted = typeof data.stats.flightsCompleted === 'number' ? data.stats.flightsCompleted : 0;
      gameState.stats.asteroidStrikes  = typeof data.stats.asteroidStrikes  === 'number' ? data.stats.asteroidStrikes  : 0;
    }
    // Restore any in-progress station visit that was saved as a temp record
    try {
      const pendingRaw = localStorage.getItem(PENDING_VISIT_KEY);
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw);
        if (pending && pending.system && typeof pending.creditsOnArrival === 'number' && Array.isArray(pending.trades)) {
          _stationVisit = pending;
        }
      }
    } catch (_e) { /* ignore corrupt temp record */ }
    return true;
  } catch (_) {
    return false;
  }
}

function _markVisited(sys) {
  if (!sys) return;
  const key = String(sys.id);
  gameState.visitedSystems[key] = (gameState.visitedSystems[key] ?? 0) + 1;
}

// ─── UI Screens ───────────────────────────────────────────────────────────────

function showIntroModal() {
  uiLayer.innerHTML = `
    <div id="intro-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Commander name entry">
      <div class="modal-box panel">
        <h1>FLATSPACE COMMANDER</h1>
        <p class="modal-subtitle">YEAR 3200 &middot; SECTOR ALPHA</p>
        <form id="commander-form" autocomplete="off" novalidate>
          <label for="cdr-name-input" class="modal-label">ENTER COMMANDER NAME:</label>
          <div class="modal-input-row">
            <input type="text" id="cdr-name-input" maxlength="12"
                   autocomplete="off" spellcheck="false" autofocus />
            <button type="submit">OK</button>
          </div>
          <p id="cdr-name-error" class="modal-error hidden">NAME REQUIRED</p>
        </form>
      </div>
    </div>
  `;

  const form  = document.getElementById('commander-form');
  const input = document.getElementById('cdr-name-input');
  const error = document.getElementById('cdr-name-error');

  input.focus();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().toUpperCase();
    if (!name) {
      error.classList.remove('hidden');
      input.focus();
      return;
    }
    gameState.commanderName = name;
    gameState.equipment['pulse_laser'] = 1;
    _markVisited(GALAXY_SYSTEMS[0]);
    // Write the first-ever log entry for the new commander
    gameState.commanderLog.push(_createIntroLogEntry());
    // Snapshot this starting berth so the first departure also generates a log
    _stationVisit = {
      system:           GALAXY_SYSTEMS[0],
      creditsOnArrival: gameState.credits,
      trades:           [],
    };
    saveGame();
    showStationScreen();
  });
}

function showWelcomeBackModal() {
  uiLayer.innerHTML = `
    <div id="welcome-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Welcome back">
      <div class="modal-box panel">
        <canvas id="welcome-ship-canvas" width="160" height="110" style="display:block;margin:0 auto 1.25rem;"></canvas>
        <h1>WELCOME BACK</h1>
        <p id="welcome-cdr" class="modal-subtitle"></p>
        <div class="welcome-stats">
          <div class="welcome-stat-row">
            <span class="welcome-stat-label">STARDATE</span>
            <span id="welcome-stardate" class="welcome-stat-value"></span>
          </div>
          <div class="welcome-stat-row">
            <span class="welcome-stat-label">LOCATION</span>
            <span id="welcome-location" class="welcome-stat-value"></span>
          </div>
          <div class="welcome-stat-row">
            <span class="welcome-stat-label">CREDITS</span>
            <span id="welcome-credits" class="welcome-stat-value"></span>
          </div>
          <div class="welcome-stat-row">
            <span class="welcome-stat-label">HULL</span>
            <span id="welcome-hull" class="welcome-stat-value"></span>
          </div>
          <div class="welcome-stat-row">
            <span class="welcome-stat-label">RATING</span>
            <span id="welcome-rating" class="welcome-stat-value"></span>
          </div>
        </div>
        <div id="welcome-log-preview" class="welcome-log-preview"></div>
        <button id="welcome-continue" type="button" style="width:100%;margin-top:1.25rem;">&#9658;&nbsp; CONTINUE</button>
      </div>
    </div>
  `;

  document.getElementById('welcome-cdr').textContent = `COMMANDER ${gameState.commanderName}`;
  document.getElementById('welcome-stardate').textContent = _getStardate();
  document.getElementById('welcome-location').textContent = `${(gameState.currentSystem?.name ?? 'LAVE').toUpperCase()} STATION`;
  document.getElementById('welcome-credits').textContent = `${gameState.credits.toLocaleString()} CR`;
  document.getElementById('welcome-hull').textContent = `${gameState.hull}%`;
  document.getElementById('welcome-rating').textContent = _combatRating(gameState.stats.kills);

  const _lastLogEntry = gameState.commanderLog.length > 0
    ? gameState.commanderLog[gameState.commanderLog.length - 1]
    : null;
  if (_lastLogEntry) {
    const _snippet    = _lastLogEntry.body.split('\n\n')[0];
    const _truncated  = _snippet.length > 110 ? _snippet.slice(0, 110).trimEnd() + '\u2026' : _snippet;
    document.getElementById('welcome-log-preview').innerHTML =
      `<div class="welcome-log-label">LAST LOG</div>` +
      `<div class="welcome-log-title">${escapeHtml(_lastLogEntry.title)}</div>` +
      `<div class="welcome-log-snippet">${escapeHtml(_truncated)}</div>`;
  }

  const shipCanvas = document.getElementById('welcome-ship-canvas');
  const shipCtx    = shipCanvas.getContext('2d');
  let _shipAnimId  = null;

  function _animateWelcomeShip() {
    shipCtx.clearRect(0, 0, shipCanvas.width, shipCanvas.height);
    drawCobraShip(shipCtx, shipCanvas.width / 2, shipCanvas.height / 2, 90, 70, true);
    _shipAnimId = requestAnimationFrame(_animateWelcomeShip);
  }
  _animateWelcomeShip();

  document.getElementById('welcome-continue').addEventListener('click', () => {
    if (_shipAnimId !== null) cancelAnimationFrame(_shipAnimId);
    showStationScreen();
  });
}

function showStationScreen() {
  gameState.screen = 'station';
  saveGame();

  if (!stationAmbienceSound.playing()) stationAmbienceSound.play();

  const sysName = (gameState.currentSystem?.name ?? 'Lave').toUpperCase();

  uiLayer.innerHTML = `
    <div id="station-screen" class="station-panel">
      <div class="station-header">
        <span id="station-system" class="station-system"></span>
        <span id="station-commander" class="station-commander"></span>
      </div>
      <nav class="station-menu" aria-label="Station options">
        <button class="station-btn" data-action="sysinfo">&#9658;&nbsp; STATION INFO</button>
        <button class="station-btn" data-action="launch"${mapState.selectedSystem && mapState.selectedSystem.id !== gameState.currentSystem?.id ? '' : ' disabled'}>&#9658;&nbsp; LAUNCH</button>
        <button class="station-btn" data-action="market">&#9658;&nbsp; BUY / SELL CARGO</button>
        <button class="station-btn" data-action="equipment">&#9658;&nbsp; EQUIPMENT</button>
        <button class="station-btn" data-action="map">&#9658;&nbsp; GALACTIC CHART</button>
        <button class="station-btn" data-action="log">&#9658;&nbsp; COMMANDER'S LOG</button>
        <button class="station-btn" data-action="stats">&#9658;&nbsp; STATS</button>
      </nav>
      <nav class="station-util-menu" aria-label="Information">
        <button class="station-btn station-btn--util" data-action="settings">*&nbsp;&nbsp;SETTINGS</button>
        <button class="station-btn station-btn--util" data-action="help">?&nbsp;&nbsp;HOW TO PLAY</button>
        <button class="station-btn station-btn--util" data-action="about">?&nbsp;&nbsp;ABOUT</button>
      </nav>
      <div class="station-info">
        <div class="info-row">
          <span>CREDITS</span>
          <span id="station-credits"></span>
        </div>
        <div class="info-row">
          <span>HULL</span>
          <span id="station-hull"></span>
        </div>
        <div class="info-row">
          <span>FUEL</span>
          <span id="station-fuel"></span>
        </div>
      </div>
    </div>
  `;

  // Safely insert user-derived values via textContent
  document.getElementById('station-system').textContent   = `${sysName} STATION`;
  document.getElementById('station-commander').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('station-credits').textContent   = `${gameState.credits}.0 CR`;
  document.getElementById('station-hull').textContent      = `${gameState.hull}%`;
  document.getElementById('station-fuel').textContent      = `${gameState.fuel}%`;

  document.querySelectorAll('.station-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'launch') {
        // Generate a departure log entry before leaving the station
        if (_stationVisit) {
          gameState.commanderLog.push(_generateDepartureLog(_stationVisit));
          _stationVisit = null;
          saveGame();
        }
        uiLayer.innerHTML  = '';
        gameState.screen   = 'launching';
        const dest = mapState.selectedSystem?.name?.toUpperCase() ?? 'DEEP SPACE';
        if (mapState.selectedSystem) {
          gameState.destinationSystem = mapState.selectedSystem;
        }
        stationAmbienceSound.stop();
        stationExitSound.play();
        launchSequence = new LaunchSequence(dest, () => {
          flightState.lastTimestamp = 0;   // ensure fresh init for new leg
          gameState.screen = 'flight';
          launchSequence   = null;
          spaceFlyingSound.play();
        });
      } else if (action === 'sysinfo') {
        showStationInfoScreen();
      } else if (action === 'market') {
        showMarketScreen();
      } else if (action === 'equipment') {
        showEquipmentScreen();
      } else if (action === 'map') {
        showGalacticChart();
      } else if (action === 'log') {
        showCommanderLogScreen();
      } else if (action === 'stats') {
        showStatsScreen();
      } else if (action === 'help') {
        showHelpScreen();
      } else if (action === 'about') {
        showAboutScreen();
      } else if (action === 'settings') {
        showSettingsScreen();
      }
    });
  });
}

// ─── Station Info Screen ─────────────────────────────────────────────────────

function showStationInfoScreen() {
  const sys = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  if (!sys) { showStationScreen(); return; }

  uiLayer.innerHTML = `
    <div id="sysinfo-screen" class="sysinfo-screen">
      <div class="sysinfo-header">
        <span class="sysinfo-title">STATION INFO</span>
        <span id="sysinfo-header-cdr" class="sysinfo-header-cdr"></span>
      </div>
      <div class="sysinfo-body">
        <section class="sysinfo-section">
          <h2 class="sysinfo-section-title">SYSTEM</h2>
          <table class="sysinfo-table">
            <tr><th>NAME</th><td id="si-name"></td></tr>
            <tr><th>ECONOMY</th><td id="si-economy"></td></tr>
            <tr><th>GOVERNMENT</th><td id="si-gov"></td></tr>
            <tr><th>TECH LEVEL</th><td id="si-tech"></td></tr>
            <tr><th>COORDINATES</th><td id="si-coords"></td></tr>
            <tr><th>VISITS</th><td id="si-visits"></td></tr>
            <tr><th>EXPLORED</th><td id="si-explored"></td></tr>
          </table>
        </section>
        <section class="sysinfo-section">
          <h2 class="sysinfo-section-title">DESCRIPTION</h2>
          <p class="sysinfo-desc" id="si-desc"></p>
        </section>
      </div>
      <div class="sysinfo-footer">
        <button id="sysinfo-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('sysinfo-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('si-name').textContent    = sys.name.toUpperCase();
  document.getElementById('si-economy').textContent = sys.economyName;
  document.getElementById('si-gov').textContent     = sys.govName;
  document.getElementById('si-tech').textContent    = String(sys.techLevel);
  document.getElementById('si-coords').textContent   = `${sys.x}, ${sys.y}`;
  document.getElementById('si-visits').textContent   = String(gameState.visitedSystems[String(sys.id)] ?? 0);
  const _totalVisited = Object.keys(gameState.visitedSystems).length;
  document.getElementById('si-explored').textContent = `${_totalVisited} OF ${GALAXY_SYSTEMS.length}`;
  document.getElementById('si-desc').textContent     = sys.description;

  document.getElementById('sysinfo-back-btn').addEventListener('click', showStationScreen);
}

// ─── Help Screen ──────────────────────────────────────────────────────────────

function showAboutScreen() {
  uiLayer.innerHTML = `
    <div id="about-screen" class="about-screen">
      <div class="about-header">
        <span class="about-title">ABOUT</span>
        <span id="about-header-cdr" class="about-header-cdr"></span>
      </div>
      <div class="about-body">
        <p class="about-intro">It&rsquo;s one thing to play a game, it&rsquo;s another to remember the glow of a CRT monitor in a dark room and the mechanical clack of a Commodore 64 keyboard. For me, this project isn&rsquo;t just about building a PWA, it&rsquo;s about capturing that specific feeling of 1985 &mdash; the mystery of a wireframe universe that felt infinite, even if it only lived on a floppy disk. I wanted to strip away the modern noise and get back to the raw tension of being a &ldquo;Harmless&rdquo; commander with 100 credits and a single pulse laser. Flatspace Commander is my digital letter to that kid sitting on the floor in front of a television, staring at the stars and wondering what was waiting in the next system.</p>
        <div class="about-author">
          <img src="/img/philip-newborough-yellow-512x512-rounded.png" alt="Philip Newborough" class="about-author-img" />
          <div class="about-author-info">
            <div class="about-author-name">Philip Newborough</div>
            <p class="about-author-bio">Web developer and tech enthusiast. When I&rsquo;m not coding, I can be found performing Grumpa duties, reading Warhammer 40,000 fiction, listening to tech podcasts or riding my bike.</p>
            <a class="about-author-link" href="https://philipnewborough.co.uk" target="_blank" rel="noopener noreferrer">philipnewborough.co.uk</a>
          </div>
        </div>
      </div>
      <div class="about-footer">
        <button id="about-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('about-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('about-back-btn').addEventListener('click', showStationScreen);
}

function showHelpScreen() {
  uiLayer.innerHTML = `
    <div id="help-screen" class="help-screen">
      <div class="help-header">
        <span class="help-title">HOW TO PLAY</span>
        <span id="help-header-cdr" class="help-header-cdr"></span>
      </div>
      <div class="help-body">
        <section class="help-section">
          <h2 class="help-section-title">FLIGHT</h2>
          <ul class="help-list">
            <li><strong>Keyboard:</strong> Arrow keys or A&nbsp;/&nbsp;D to steer your ship left and right.</li>
            <li><strong>Touch:</strong> Tap anywhere on the screen and drag to steer.</li>
            <li>Your ship flies forward automatically &mdash; avoid enemies and hazards approaching from above.</li>
          </ul>
        </section>
        <section class="help-section">
          <h2 class="help-section-title">COMBAT &amp; MISSILES</h2>
          <ul class="help-list">
            <li>Your laser fires automatically during combat encounters.</li>
            <li><strong>Keyboard:</strong> Press <strong>M</strong> to fire a missile.</li>
            <li><strong>Touch:</strong> Swipe up on the screen to fire a missile.</li>
            <li>Missiles must be purchased at a station before use and are consumed on launch.</li>
          </ul>
        </section>
        <section class="help-section">
          <h2 class="help-section-title">STATIONS</h2>
          <ul class="help-list">
            <li>Dock at a space station between jumps to trade, refit, and plan your next route.</li>
            <li>Your current credits and fuel level are shown at the bottom of the station menu.</li>
          </ul>
        </section>
        <section class="help-section">
          <h2 class="help-section-title">TRADING</h2>
          <ul class="help-list">
            <li>Buy commodities cheaply in one system and sell them at a profit in another.</li>
            <li>Prices vary by each system&rsquo;s tech level and government type.</li>
            <li>Your cargo hold has a limited capacity &mdash; plan your trades carefully.</li>
          </ul>
        </section>
        <section class="help-section">
          <h2 class="help-section-title">GALACTIC CHART</h2>
          <ul class="help-list">
            <li>Open the chart to browse systems and select a destination before you launch.</li>
            <li>Your jump range is limited by your current fuel level.</li>
            <li>Use the +&nbsp;/&nbsp;&minus; controls to zoom the map, or pinch on touch devices.</li>
          </ul>
        </section>
      </div>
      <div class="help-footer">
        <button id="help-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('help-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('help-back-btn').addEventListener('click', showStationScreen);
}

// ─── Settings Screen ──────────────────────────────────────────────────────────

function showSettingsScreen() {
  uiLayer.innerHTML = `
    <div id="settings-screen" class="settings-screen">
      <div class="settings-header">
        <span class="settings-title">SETTINGS</span>
        <span id="settings-header-cdr" class="settings-header-cdr"></span>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h2 class="settings-section-title">AUDIO</h2>
          <div class="settings-volume-row">
            <label class="settings-volume-label" for="sfx-volume-slider">GAME VOLUME</label>
            <div class="settings-volume-control">
              <input type="range" id="sfx-volume-slider" class="settings-volume-slider"
                min="0" max="1" step="0.05" value="${sfxVolume}">
              <span id="sfx-volume-value" class="settings-volume-value">${Math.round(sfxVolume * 100)}%</span>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <h2 class="settings-section-title">GAME DATA</h2>
          <p class="settings-desc">Permanently delete your save data and start a new game. This cannot be undone.</p>
          <button id="settings-reset-btn" class="station-btn settings-reset-btn">&#9658;&nbsp; RESET GAME</button>
        </section>
      </div>
      <div class="settings-footer">
        <button id="settings-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('settings-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('settings-back-btn').addEventListener('click', showStationScreen);

  const slider = document.getElementById('sfx-volume-slider');
  const volDisplay = document.getElementById('sfx-volume-value');
  slider.addEventListener('input', () => {
    setSfxVolume(parseFloat(slider.value));
    volDisplay.textContent = `${Math.round(sfxVolume * 100)}%`;
  });

  document.getElementById('settings-reset-btn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Confirm game reset');
    overlay.innerHTML = `
      <div class="modal-box panel">
        <h2>RESET GAME</h2>
        <p class="modal-subtitle">WARNING — THIS CANNOT BE UNDONE</p>
        <p>All save data will be permanently erased. Your commander, credits, cargo, equipment, and log will be lost.</p>
        <p style="margin-top:0.75rem;">Are you sure you want to reset?</p>
        <div class="settings-reset-actions">
          <button class="station-btn" id="settings-reset-confirm" style="width:100%;margin-top:1.25rem;">&#9658;&nbsp; CONFIRM RESET</button>
          <button class="station-btn" id="settings-reset-cancel" style="width:100%;margin-top:0.5rem;opacity:0.6;">&#9658;&nbsp; CANCEL</button>
        </div>
      </div>
    `;
    uiLayer.appendChild(overlay);

    document.getElementById('settings-reset-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    document.getElementById('settings-reset-confirm').addEventListener('click', () => {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(MAP_HELP_KEY);
      localStorage.removeItem(MARKET_HELP_KEY);
      localStorage.removeItem(DOCK_HELP_KEY);
      localStorage.removeItem(PENDING_VISIT_KEY);
      localStorage.removeItem(SHARE_MODAL_KEY);
      location.reload();
    });
  });
}

// ─── Commander's Log Screen ───────────────────────────────────────────────────

function showCommanderLogScreen() {
  gameState.screen = 'log';

  // Render entries newest-first
  const entries = [...gameState.commanderLog].reverse();

  const entriesHtml = entries.length === 0
    ? '<p class="log-empty">No log entries recorded yet.</p>'
    : entries.map(entry => {
        const profitHtml = entry.creditsChange !== null
          ? `<div class="log-entry-profit ${entry.creditsChange >= 0 ? 'log-profit--gain' : 'log-profit--loss'}">${entry.creditsChange >= 0 ? '+' : ''}${entry.creditsChange}&nbsp;CR</div>`
          : '';
        return `
          <div class="log-entry">
            <div class="log-entry-header">
              <span class="log-entry-title">${escapeHtml(entry.title)}</span>
              <span class="log-entry-stardate">${escapeHtml(entry.stardate)}</span>
            </div>
            <div class="log-entry-body">${_renderLogBody(entry.body)}</div>
            ${profitHtml}
            <div class="log-entry-actions">
              <button class="log-entry-share-btn" data-log-id="${entry.id}" aria-label="Share log entry">&#9650;&nbsp; SHARE</button>
            </div>
          </div>`;
      }).join('');

  uiLayer.innerHTML = `
    <div id="log-screen" class="log-screen">
      <div class="log-header">
        <span class="log-title">COMMANDER'S LOG</span>
        <span id="log-header-cdr" class="log-header-cdr"></span>
      </div>
      <div class="log-body">
        ${entriesHtml}
      </div>
      <div class="log-footer">
        <button id="log-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('log-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('log-back-btn').addEventListener('click', showStationScreen);

  document.querySelector('.log-body').addEventListener('click', e => {
    const btn = e.target.closest('.log-entry-share-btn');
    if (!btn) return;
    const entryId = parseInt(btn.dataset.logId, 10);
    const entry   = gameState.commanderLog.find(en => en.id === entryId);
    if (!entry) return;
    const text = _buildShareText(entry);
    navigator.clipboard.writeText(text).then(() => {
      if (!localStorage.getItem(SHARE_MODAL_KEY)) {
        _showShareCopiedModal();
      }
    }).catch(() => {
      _showShareCopiedModal();
    });
  });
}

// ─── Stats Screen ─────────────────────────────────────────────────────────────

/** Translate kill count to an Elite-style combat rating label. */
function _combatRating(kills) {
  if (kills >= 6400) return 'ELITE';
  if (kills >= 2560) return 'DEADLY';
  if (kills >= 512)  return 'DANGEROUS';
  if (kills >= 128)  return 'COMPETENT';
  if (kills >= 64)   return 'ABOVE AVERAGE';
  if (kills >= 32)   return 'AVERAGE';
  if (kills >= 16)   return 'POOR';
  if (kills >= 8)    return 'MOSTLY HARMLESS';
  if (kills >= 1)    return 'MOSTLY HARMLESS';
  return 'HARMLESS';
}

/**
 * Commander level: rises with flights, systems visited, and kills.
 * Capped display at 99 so the field never overflows.
 */
function _commanderLevel() {
  const { kills, flightsCompleted } = gameState.stats;
  const systemsVisited = Object.keys(gameState.visitedSystems).length;
  return Math.min(99, 1 + Math.floor(kills / 5 + flightsCompleted / 3 + systemsVisited / 5));
}

function showStatsScreen() {
  gameState.screen = 'stats';

  const { kills, combatEncounters, flightsCompleted, asteroidStrikes } = gameState.stats;
  const systemsVisited  = Object.keys(gameState.visitedSystems).length;
  const totalSystems    = GALAXY_SYSTEMS.length;
  const rating          = _combatRating(kills);
  const level           = _commanderLevel();

  // Count installed equipment items
  const installedItems = EQUIPMENT_CATALOG
    .filter(item => (gameState.equipment[item.id] ?? 0) > 0)
    .map(item => {
      const qty = gameState.equipment[item.id];
      return item.type === 'multi' && qty > 1 ? `${item.name} x${qty}` : item.name;
    });

  const equipHtml = installedItems.length
    ? installedItems.map(name => `<div class="stats-equip-item">${escapeHtml(name)}</div>`).join('')
    : `<div class="stats-equip-item stats-equip-none">NONE INSTALLED</div>`;

  uiLayer.innerHTML = `
    <div id="stats-screen" class="stats-screen">
      <div class="stats-header">
        <span class="stats-title">COMMANDER STATS</span>
        <span id="stats-header-cdr" class="stats-header-cdr"></span>
      </div>
      <div class="stats-body">
        <section class="stats-section">
          <h2 class="stats-section-title">PROFILE</h2>
          <table class="stats-table">
            <tr><th>COMMANDER</th><td id="stats-name"></td></tr>
            <tr><th>LEVEL</th><td id="stats-level"></td></tr>
            <tr><th>RATING</th><td id="stats-rating"></td></tr>
            <tr><th>WEALTH</th><td id="stats-credits"></td></tr>
            <tr><th>HULL</th><td id="stats-hull"></td></tr>
          </table>
        </section>
        <section class="stats-section">
          <h2 class="stats-section-title">CAREER</h2>
          <table class="stats-table">
            <tr><th>FLIGHTS</th><td id="stats-flights"></td></tr>
            <tr><th>SYSTEMS VISITED</th><td id="stats-systems"></td></tr>
            <tr><th>COMBAT ENCOUNTERS</th><td id="stats-encounters"></td></tr>
            <tr><th>SHIPS DESTROYED</th><td id="stats-kills"></td></tr>
            <tr><th>ASTEROID STRIKES</th><td id="stats-asteroid-strikes"></td></tr>
          </table>
        </section>
        <section class="stats-section">
          <h2 class="stats-section-title">EQUIPMENT</h2>
          <div class="stats-equip-list">${equipHtml}</div>
        </section>
      </div>
      <div class="stats-footer">
        <button id="stats-back-btn" class="station-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('stats-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;
  document.getElementById('stats-name').textContent        = gameState.commanderName;
  document.getElementById('stats-level').textContent       = String(level);
  document.getElementById('stats-rating').textContent      = rating;
  document.getElementById('stats-credits').textContent     = `${gameState.credits} CR`;
  document.getElementById('stats-hull').textContent        = `${gameState.hull}%`;
  document.getElementById('stats-flights').textContent     = String(flightsCompleted);
  document.getElementById('stats-systems').textContent     = `${systemsVisited} OF ${totalSystems}`;
  document.getElementById('stats-encounters').textContent       = String(combatEncounters);
  document.getElementById('stats-kills').textContent            = String(kills);
  document.getElementById('stats-asteroid-strikes').textContent = String(asteroidStrikes);

  document.getElementById('stats-back-btn').addEventListener('click', showStationScreen);
}

// ─── Market Screen ────────────────────────────────────────────────────────────

/** Cached market items for the currently docked system (qty is mutable). */
let _marketCache = null;  // { systemId: number, items: Array }

/** Per-station-visit snapshot, set on docking and cleared on launch. */
let _stationVisit = null;  // { system, creditsOnArrival, trades: [] }

// ─── Commander's Log Utilities ────────────────────────────────────────────────

/**
 * Returns a compact stardate string based on the current real date, mapped
 * to Year 3200 (real 2026 ≡ game 3200).
 * Format: "SD 3200.095"  (year.dayOfYear)
 */
function _getStardate() {
  const now        = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear  = Math.ceil((now - startOfYear) / 86_400_000);
  const gameYear   = 3200 + (now.getFullYear() - 2026);
  return `SD ${gameYear}.${String(dayOfYear).padStart(3, '0')}`;
}

/**
 * Build plain-text content for sharing a single log entry.
 * @param {object} entry
 * @returns {string}
 */
function _buildShareText(entry) {
  const lines = [
    `COMMANDER'S LOG \u2014 ${entry.title}`,
    entry.stardate,
    '',
    entry.body,
  ];
  if (entry.creditsChange !== null) {
    const sign = entry.creditsChange >= 0 ? '+' : '';
    lines.push('', `${sign}${entry.creditsChange} CR`);
  }
  lines.push('', 'https://flatspace-commander.philipnewborough.co.uk');
  return lines.join('\n');
}

/** Show confirmation modal after a log entry has been copied to clipboard. */
function _showShareCopiedModal() {
  const overlay = document.createElement('div');
  overlay.id        = 'share-copied-overlay';
  overlay.className = 'modal-overlay map-help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Log entry copied');
  overlay.innerHTML = `
    <div class="modal-box panel map-help-box">
      <h2>LOG TRANSMITTED</h2>
      <p class="map-help-body">Log entry copied to clipboard. Share it with the galaxy.</p>
      <div class="map-help-footer">
        <label class="map-help-check-label">
          <span class="map-help-checkbox-wrap">
            <input type="checkbox" id="share-no-show" class="map-help-checkbox">
            <span class="map-help-checkbox-custom" aria-hidden="true"></span>
          </span>
          DON'T SHOW AGAIN
        </label>
        <button id="share-ok-btn" class="station-btn map-help-ok-btn">&#9658;&nbsp; OK</button>
      </div>
    </div>
  `;
  uiLayer.appendChild(overlay);
  document.getElementById('share-ok-btn').addEventListener('click', () => {
    if (document.getElementById('share-no-show').checked) {
      localStorage.setItem(SHARE_MODAL_KEY, '1');
    }
    overlay.remove();
  });
}

/**
 * Render a log entry body string (newline-separated) into safe HTML paragraphs.
 * Body text is escaped; '\n\n' splits paragraphs, '\n' becomes <br>.
 */
function _renderLogBody(body) {
  return body.split('\n\n').map(para =>
    `<p class="log-entry-para">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`
  ).join('');
}

/**
 * Build the introductory commissioning log entry for a brand-new commander.
 * @returns {object} log entry
 */
function _createIntroLogEntry() {
  const sys  = GALAXY_SYSTEMS[0];  // always Lave on a fresh game
  const body = [
    `Commissioning papers signed and vessel transfer complete at ${sys.name.toUpperCase()} Station. I am now the registered commander of this Cobra Mark III — a well-worn but capable ship, currently on berth in the ${sys.name.toUpperCase()} system. ${sys.economyName} economy. ${sys.govName} government. Tech level ${sys.techLevel}.`,
    `The ship is exactly what the manifest says it is: twin drive nacelles, a standard hyperdrive rated for approximately seven light years per jump, and twenty tonnes of cargo capacity. Previous owner's logs have been wiped — standard procedure on a resale vessel. The galaxy charts cover this sector. I will extend them as I travel further out.`,
    `Starting capital: 100 credits. The trade lanes here look unremarkable, but every route starts somewhere. A few potential runs identified. The only thing left is to find out whether I have the instincts for this game.`,
  ].join('\n\n');

  return {
    id:           gameState.commanderLog.length + 1,
    stardate:     _getStardate(),
    title:        'COMMISSIONING \u2014 COBRA MK III',
    body,
    creditsChange: null,
  };
}

/**
 * Generate a departure log entry from the current station visit snapshot.
 * Call immediately before launching; all trade facts are known at this point.
 * @param {{ system, creditsOnArrival, trades: Array }} visitData
 * @returns {object} log entry
 */
function _generateDepartureLog(visitData) {
  const sys    = visitData.system;
  const profit = gameState.credits - visitData.creditsOnArrival;

  // Aggregate individual trade events into per-commodity totals
  const bought = {};  // id → { name, qty, spent }
  const sold   = {};  // id → { name, qty, earned }
  for (const t of visitData.trades) {
    if (t.action === 'buy') {
      if (!bought[t.id]) bought[t.id] = { name: t.name, qty: 0, spent: 0 };
      bought[t.id].qty++;
      bought[t.id].spent += t.price;
    } else {
      if (!sold[t.id])   sold[t.id]   = { name: t.name, qty: 0, earned: 0 };
      sold[t.id].qty++;
      sold[t.id].earned += t.price;
    }
  }

  const boughtList = Object.values(bought);
  const soldList   = Object.values(sold);
  const hasTraded  = boughtList.length > 0 || soldList.length > 0;

  // ── Para 1: system context ──────────────────────────────────────────────
  const para1 = `Cleared ${sys.name.toUpperCase()} Station. ${sys.economyName} economy \u2014 ${sys.govName} government, tech level ${sys.techLevel}.`;

  // ── Para 2: trade activity ──────────────────────────────────────────────
  let para2;
  if (!hasTraded) {
    para2 = 'No cargo exchanged this visit. Credits unchanged.';
  } else {
    const parts = [];
    if (boughtList.length > 0) {
      const items = boughtList.map(b => `${b.qty}t ${b.name.toLowerCase()} (${b.spent} CR)`).join(', ');
      parts.push(`Acquired: ${items}.`);
    }
    if (soldList.length > 0) {
      const items = soldList.map(s => `${s.qty}t ${s.name.toLowerCase()} (${s.earned} CR)`).join(', ');
      parts.push(`Offloaded: ${items}.`);
    }
    if (profit > 0) {
      parts.push(`Net gain this stop: +${profit} CR.`);
      if (profit >= 300) parts.push('Solid margins on this run.');
    } else if (profit < 0) {
      parts.push(`Net cost this stop: ${Math.abs(profit)} CR.`);
      parts.push('Tight margins — review cargo selection before the next leg.');
    } else {
      parts.push('Net change in credits: zero.');
    }
    para2 = parts.join(' ');
  }

  return {
    id:           gameState.commanderLog.length + 1,
    stardate:     _getStardate(),
    title:        `DEPARTED ${sys.name.toUpperCase()} STATION`,
    body:         [para1, para2].join('\n\n'),
    creditsChange: profit,
  };
}

/**
 * Handle player ship destruction (hull ≤ 0).
 * If escape_pod is equipped: strip cargo/equipment, transport to Lave, show rescue modal.
 * Otherwise: clear save data and show game-over modal.
 */
function _handlePlayerDeath() {
  if (_playerDeathPending) return;
  _playerDeathPending   = true;
  _deathStarfieldActive = true;
  miningLaserSound.stop();
  spaceFlyingSound.stop();

  // Stop asteroids and pause flight to prevent further triggers
  _flightAsteroids = [];
  _combatPaused    = true;

  if (gameState.equipment.escape_pod) {
    // ── Escape Pod Rescue ────────────────────────────────────────────────────
    gameState.inventory         = {};
    gameState.equipment         = {};   // pod consumed; all kit lost with the ship
    gameState.equipment['pulse_laser'] = 1; // rescued ship fitted with basic armament
    gameState.currentSystem     = GALAXY_SYSTEMS[0]; // Lave
    gameState.destinationSystem = null;
    gameState.hull              = 100;
    gameState.shields           = 0;
    gameState.fuel              = 70;
    gameState.pendingBounties   = [];
    gameState.screen            = 'station';

    gameState.commanderLog.push({
      id:           gameState.commanderLog.length + 1,
      stardate:     _getStardate(),
      title:        'SHIP DESTROYED \u2014 ESCAPE POD ACTIVATED',
      body:         'Hull integrity failed. Escape pod ejected automatically before total structural collapse.\n\nPod recovered by a passing trader and deposited at Lave Station. All ship cargo and equipment lost. A pulse laser was fitted to the replacement vessel. Credits intact.',
      creditsChange: null,
    });
    saveGame();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Escape pod activated');
    overlay.innerHTML = `
      <div class="modal-box panel">
        <h2>ESCAPE POD ACTIVATED</h2>
        <p class="modal-subtitle">SHIP DESTROYED</p>
        <p>Hull integrity failed. Your escape pod ejected automatically.</p>
        <p>A passing trader recovered your pod and dropped you off at <strong>LAVE STATION</strong>.</p>
        <p>All ship cargo and equipment has been lost. A pulse laser has been fitted to your replacement vessel. Your credits are intact.</p>
        <button class="station-btn" id="escape-pod-continue" style="margin-top:1.25rem;width:100%;">&#9658;&nbsp; ACKNOWLEDGED</button>
      </div>
    `;
    uiLayer.appendChild(overlay);

    document.getElementById('escape-pod-continue').addEventListener('click', () => {
      overlay.remove();
      _playerDeathPending   = false;
      _deathStarfieldActive = false;
      _combatPaused         = false;
      _stationVisit = {
        system:           GALAXY_SYSTEMS[0],
        creditsOnArrival: gameState.credits,
        trades:           [],
      };
      showStationScreen();
    });

  } else {
    // ── Game Over ────────────────────────────────────────────────────────────
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(PENDING_VISIT_KEY);

    const cdrName = gameState.commanderName;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Game over');
    overlay.innerHTML = `
      <div class="modal-box panel">
        <h2>SHIP DESTROYED</h2>
        <p class="modal-subtitle" id="game-over-cdr-name"></p>
        <p>Your ship has been destroyed. With no escape pod, there was no way out.</p>
        <p>Commander <span id="game-over-cdr-inline"></span> has been lost to the void.</p>
        <button class="station-btn" id="game-over-new-game" style="margin-top:1.25rem;width:100%;">&#9658;&nbsp; NEW GAME</button>
      </div>
    `;
    uiLayer.appendChild(overlay);

    // Populate name via textContent to avoid any injection
    overlay.querySelector('#game-over-cdr-name').textContent     = `GAME OVER, COMMANDER ${cdrName}`;
    overlay.querySelector('#game-over-cdr-inline').textContent    = cdrName;

    document.getElementById('game-over-new-game').addEventListener('click', () => {
      overlay.remove();

      // Full game state reset
      gameState.commanderName      = '';
      gameState.credits            = 100;
      gameState.fuel               = 100;
      gameState.inventory          = {};
      gameState.cargoCapacity      = 20;
      gameState.currentSystem      = null;
      gameState.destinationSystem  = null;
      gameState.visitedSystems     = {};
      gameState.commanderLog       = [];
      gameState.equipment          = {};
      gameState.hull               = 100;
      gameState.shields            = 0;
      gameState.pendingBounties    = [];
      gameState.screen             = 'intro';
      gameState.stats              = { kills: 0, combatEncounters: 0, flightsCompleted: 0, asteroidStrikes: 0 };

      // Reset flight globals
      _activeCombat            = null;
      _combatPaused            = false;
      _playerDeathPending      = false;
      _deathStarfieldActive    = false;
      _stationVisit            = null;
      flightState.distRemaining = 0;
      flightState.lastTimestamp = 0;

      showIntroModal();
    });
  }
}

/**
 * Log an asteroid collision immediately to the Commander's Log.
 * Called at the moment of impact during flight.
 */
function _logAsteroidStrike(damage) {
  const sys     = gameState.destinationSystem ?? gameState.currentSystem;
  const transit = sys ? `en route to ${sys.name.toUpperCase()}` : 'in deep space';
  const hullNow = gameState.hull;
  let severity;
  if      (hullNow <= 0)  severity = 'Hull integrity critical — immediate repair required.';
  else if (hullNow <= 20) severity = 'Hull integrity dangerously low. Recommend immediate docking for repairs.';
  else if (hullNow <= 50) severity = 'Significant structural damage. Repairs advised at next station.';
  else                    severity = 'Hull still serviceable. Will inspect on arrival.';

  const body = `Uncharted asteroid crossed flight path ${transit}. Collision registered before evasive action could be taken. Structural damage: ${damage}%. Hull integrity now at ${hullNow}%.\n\n${severity}`;

  gameState.commanderLog.push({
    id:           gameState.commanderLog.length + 1,
    stardate:     _getStardate(),
    title:        'ASTEROID STRIKE',
    body,
    creditsChange: null,
  });
  saveGame();
}

/**
 * Append a combat encounter entry to the Commander's Log.
 * Called on fight completion (victory / playerDestroyed) or cargo surrender.
 * @param {'pirate'|'trader'|'alien'} type
 * @param {string[]} ships — names of ships engaged
 * @param {'victory'|'playerDestroyed'|'surrender'} outcome
 * @param {number} hullDmg — hull % damage taken
 * @param {Record<number,number>} cargoMap — commodityId → qty collected
 */
function _logCombatEncounter(type, ships, outcome, hullDmg, cargoMap) {
  const sys     = gameState.destinationSystem ?? gameState.currentSystem;
  const transit = sys ? `near ${sys.name.toUpperCase()}` : 'in deep space';

  // Aggregate duplicate ship names (e.g. 2× SIDEWINDER)
  const shipCounts = {};
  for (const name of ships) shipCounts[name] = (shipCounts[name] ?? 0) + 1;
  const shipList = Object.entries(shipCounts)
    .map(([name, n]) => n > 1 ? `${n}\u00d7 ${name}` : name)
    .join(', ');

  // ── Para 1: encounter description ──
  let typeLabel;
  if      (type === 'pirate')  typeLabel = ships.length > 1 ? 'pirate vessels' : 'a pirate vessel';
  else if (type === 'trader')  typeLabel = 'a trade vessel';
  else                         typeLabel = 'a Thargoid craft';
  const para1 = `Contact logged ${transit}: ${typeLabel} on intercept vector. Ship${ships.length > 1 ? 's' : ''} identified as ${shipList}.`;

  // ── Para 2: outcome ──
  let para2;
  if (outcome === 'victory') {
    para2 = 'Engagement concluded. All hostile contacts destroyed.';
  } else if (outcome === 'playerDestroyed') {
    para2 = 'Hull integrity failed under sustained fire. Emergency systems activated — ship returned to station on minimum power.';
  } else {
    para2 = 'Cargo surrendered under duress to clear the engagement. Pirates withdrew after transfer confirmed.';
  }

  // ── Para 3: damage and salvage ──
  const parts = [];
  parts.push(
    hullDmg > 0
      ? `Hull damage sustained: ${hullDmg}%. Integrity now at ${gameState.hull}%.`
      : 'Hull integrity maintained — no damage sustained.',
  );
  const cargoEntries = Object.entries(cargoMap).filter(([, qty]) => qty > 0);
  if (cargoEntries.length > 0) {
    const names = cargoEntries.map(([id, qty]) => {
      const c = COMMODITIES.find(c => c.id === Number(id));
      const cname = c ? c.name.toLowerCase() : `commodity ${id}`;
      return qty > 1 ? `${qty}t ${cname}` : `${qty}t ${cname}`;
    }).join(', ');
    parts.push(`Salvage collected: ${names}.`);
  }
  const para3 = parts.join(' ');

  let title;
  if (outcome === 'surrender') {
    title = 'COMBAT \u2014 CARGO SURRENDERED';
  } else if (type === 'pirate') {
    title = 'COMBAT \u2014 PIRATE ATTACK';
  } else if (type === 'trader') {
    title = 'COMBAT \u2014 TRADER ATTACK';
  } else {
    title = 'COMBAT \u2014 ALIEN CONTACT';
  }

  gameState.commanderLog.push({
    id:            gameState.commanderLog.length + 1,
    stardate:      _getStardate(),
    title,
    body:          [para1, para2, para3].join('\n\n'),
    creditsChange: null,
  });
  saveGame();
}

/** Minimal HTML escaping to safely insert strings into innerHTML. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Return total tonnes currently in the cargo hold. */
function _usedCargo() {
  return Object.values(gameState.inventory).reduce((sum, n) => sum + n, 0);
}

/** Build the HTML for a single market table row. */
function _marketRow(item) {
  const held    = gameState.inventory[item.id] ?? 0;
  const canBuy  = item.qty > 0;
  const canSell = held > 0;

  return `<tr>
    <td class="mkt-name">${escapeHtml(item.name)}</td>
    <td class="mkt-price">${item.price}&nbsp;CR</td>
    <td class="mkt-qty">${item.qty > 0 ? item.qty + item.unit : '&mdash;'}</td>
    <td class="mkt-hold">${held > 0 ? held + item.unit : '&mdash;'}</td>
    <td><button class="mkt-btn mkt-btn--buy" id="buy-${item.id}"${canBuy ? '' : ' disabled'}>+</button></td>
    <td><button class="mkt-btn mkt-btn--sell" id="sell-${item.id}"${canSell ? '' : ' disabled'}>&minus;</button></td>
  </tr>`;
}

/** Render (or re-render) the full market screen with current state. */
function _renderMarketScreen(system, items) {
  const used = _usedCargo();

  uiLayer.innerHTML = `
    <div id="market-screen" class="market-screen">
      <div class="market-header">
        <span class="market-title">MARKET</span>
        <span class="market-system">&mdash;&nbsp;${escapeHtml(system.name.toUpperCase())}</span>
        <span class="market-header-cdr"></span>
      </div>
      <div class="market-table-wrap">
        <table class="market-table">
          <thead>
            <tr>
              <th>COMMODITY</th>
              <th>PRICE</th>
              <th>QTY</th>
              <th>HOLD</th>
              <th colspan="2"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(_marketRow).join('')}
          </tbody>
        </table>
      </div>
      <div class="market-footer">
        <div class="market-status">
          <span>CREDITS:&nbsp;<span id="mkt-credits">${gameState.credits}</span>&nbsp;CR</span>
          <span>CARGO:&nbsp;<span id="mkt-cargo">${used}</span>/${gameState.cargoCapacity}t</span>
        </div>
        <button id="market-back-btn" class="station-btn mkt-back-btn">&#9658;&nbsp;BACK</button>
      </div>
    </div>
  `;

  // Insert commander name safely via textContent
  document.querySelector('.market-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;

  // Attach buy/sell listeners
  items.forEach(item => {
    document.getElementById(`buy-${item.id}`)
      ?.addEventListener('click', () => _handleBuy(item, system, items));
    document.getElementById(`sell-${item.id}`)
      ?.addEventListener('click', () => _handleSell(item, system, items));
  });

  document.getElementById('market-back-btn')
    .addEventListener('click', showStationScreen);
}

/** Attempt to buy one unit of an item. */
function _handleBuy(item, system, items) {
  const used = _usedCargo();
  if (gameState.credits < item.price)            { buttonErrorSound.play(); return; }  // not enough credits
  if (used >= gameState.cargoCapacity)           { buttonErrorSound.play(); return; }  // hold full
  if (item.qty <= 0)                             { buttonErrorSound.play(); return; }  // sold out

  buttonClickSound.play();
  gameState.credits              -= item.price;
  gameState.inventory[item.id]    = (gameState.inventory[item.id] ?? 0) + 1;
  item.qty                       -= 1;

  if (_stationVisit) {
    _stationVisit.trades.push({ action: 'buy', id: item.id, name: item.name, price: item.price });
  }

  saveGame();
  _renderMarketScreen(system, items);
}

/** Attempt to sell one unit of an item. */
function _handleSell(item, system, items) {
  const held = gameState.inventory[item.id] ?? 0;
  if (held <= 0) { buttonErrorSound.play(); return; }

  buttonClickSound.play();
  gameState.credits              += item.price;
  gameState.inventory[item.id]   -= 1;
  if (gameState.inventory[item.id] === 0) delete gameState.inventory[item.id];
  item.qty                       += 1;

  if (_stationVisit) {
    _stationVisit.trades.push({ action: 'sell', id: item.id, name: item.name, price: item.price });
  }

  saveGame();
  _renderMarketScreen(system, items);
}

/** Open the market screen for the current system. */
function showMarketScreen() {
  gameState.screen = 'market';
  const system = gameState.currentSystem ?? GALAXY_SYSTEMS[0];

  // Reuse cached prices (with any qty changes) if still in the same system;
  // otherwise generate a fresh market.
  if (!_marketCache || _marketCache.systemId !== system.id) {
    _marketCache = { systemId: system.id, items: getMarketPrices(system) };
  }

  _renderMarketScreen(system, _marketCache.items);

  if (!localStorage.getItem(MARKET_HELP_KEY)) {
    _showMarketHelpModal();
  }
}

/** Show the Trading (Market) help modal overlay. */
function _showMarketHelpModal() {
  const overlay = document.createElement('div');
  overlay.id        = 'market-help-overlay';
  overlay.className = 'modal-overlay map-help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Trading screen help');
  overlay.innerHTML = `
    <div class="modal-box panel map-help-box">
      <h2>TRADING</h2>
      <p class="map-help-body">Buy and sell commodities to profit from price differences between star systems. Each system's economy and government type influences local prices — buy low, sell high.</p>
      <ul class="map-help-list">
        <li>&#9658; <strong>PRICE</strong> is the current buy and sell rate in credits.</li>
        <li>&#9658; <strong>QTY</strong> is the station's available stock in tonnes.</li>
        <li>&#9658; <strong>HOLD</strong> is how much you're currently carrying.</li>
        <li>&#9658; Use <strong>+</strong> to buy one tonne and <strong>&minus;</strong> to sell one tonne.</li>
        <li>&#9658; Your cargo hold has a limited capacity — watch the <strong>CARGO</strong> gauge.</li>
      </ul>
      <div class="map-help-footer">
        <label class="map-help-check-label">
          <span class="map-help-checkbox-wrap">
            <input type="checkbox" id="market-help-no-show" class="map-help-checkbox">
            <span class="map-help-checkbox-custom" aria-hidden="true"></span>
          </span>
          DON'T SHOW AGAIN
        </label>
        <button id="market-help-ok" class="station-btn map-help-ok-btn">&#9658;&nbsp; GOT IT</button>
      </div>
    </div>
  `;

  uiLayer.appendChild(overlay);

  document.getElementById('market-help-ok').addEventListener('click', () => {
    if (document.getElementById('market-help-no-show').checked) {
      localStorage.setItem(MARKET_HELP_KEY, '1');
    }
    overlay.remove();
  });
}

// ─── Equipment Screen ────────────────────────────────────────────────────────

function showEquipmentScreen() {
  gameState.screen = 'equipment';
  const sys = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  _renderEquipmentScreen(sys);
}

function _renderEquipmentScreen(sys) {
  const fuelPct    = gameState.fuel;
  const fuelFill   = 100 - fuelPct;
  const f10cost    = Math.min(10, fuelFill) * FUEL_PRICE_PER_PCT;
  const f25cost    = Math.min(25, fuelFill) * FUEL_PRICE_PER_PCT;
  const ffcost     = fuelFill * FUEL_PRICE_PER_PCT;
  const fuelBarPct = fuelPct;

  const hullPct    = gameState.hull;
  const hullDmg    = 100 - hullPct;
  const h10cost    = Math.min(10, hullDmg) * HULL_PRICE_PER_PCT;
  const h25cost    = Math.min(25, hullDmg) * HULL_PRICE_PER_PCT;
  const hfcost     = hullDmg * HULL_PRICE_PER_PCT;

  const availItems = EQUIPMENT_CATALOG.filter(item => item.techMin <= sys.techLevel);

  const LASER_TIER = { pulse_laser: 1, beam_laser: 2, military_laser: 3 };
  const equippedLaserTier = Math.max(0,
    ...Object.keys(LASER_TIER).map(id => (gameState.equipment[id] ?? 0) > 0 ? LASER_TIER[id] : 0)
  );

  const itemRowsHtml = availItems.map(item => {
    const owned   = gameState.equipment[item.id] ?? 0;
    const isLowerLaser = item.id in LASER_TIER && LASER_TIER[item.id] < equippedLaserTier;
    const canBuy  = gameState.credits >= item.price && owned < item.maxOwn && !isLowerLaser;
    const refund  = Math.floor(item.price * 0.5);
    let statusText;
    if (item.type === 'single') {
      statusText = owned ? '&#10003;' : '&mdash;';
    } else {
      statusText = `${owned}/${item.maxOwn}`;
    }
    const statusClass = owned ? 'equip-status--owned' : '';
    const canUnequip = owned && item.id !== 'pulse_laser';
    let actionCell;
    if (item.type === 'multi') {
      if (owned >= item.maxOwn) {
        actionCell = `<button class="equip-btn--buy" disabled>&mdash;</button>`;
      } else {
        actionCell = `<button class="equip-btn--buy" id="equip-buy-${escapeHtml(item.id)}"${canBuy ? '' : ' disabled'}>BUY</button>`;
      }
    } else {
      actionCell = owned
        ? (canUnequip
            ? `<button class="equip-btn--unequip" id="equip-unequip-${escapeHtml(item.id)}">UNEQUIP<br><span class="equip-btn-refund">+${refund}&nbsp;CR</span></button>`
            : `<button class="equip-btn--buy" disabled>&mdash;</button>`)
        : `<button class="equip-btn--buy" id="equip-buy-${escapeHtml(item.id)}"${canBuy ? '' : ' disabled'}>BUY</button>`;
    }
    return `<tr>
      <td class="equip-name">${escapeHtml(item.name)}</td>
      <td class="equip-price">${item.price}&nbsp;CR</td>
      <td class="equip-status ${statusClass}">${statusText}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');

  uiLayer.innerHTML = `
    <div id="equipment-screen" class="equip-screen">
      <div class="equip-header">
        <span class="equip-title">EQUIPMENT</span>
        <span class="equip-header-system">&mdash;&nbsp;${escapeHtml(sys.name.toUpperCase())}</span>
        <span id="equip-header-cdr" class="equip-header-cdr"></span>
      </div>
      <div class="equip-body">
        <section class="equip-section">
          <h2 class="equip-section-title">FUEL</h2>
          <div class="equip-fuel-row">
            <div class="equip-fuel-bar-wrap">
              <div class="equip-fuel-bar" style="width:${fuelBarPct}%"></div>
            </div>
            <span class="equip-fuel-label">${fuelPct}%</span>
          </div>
          <div class="equip-fuel-btns">
            <button class="equip-fuel-btn" id="equip-fuel-10"${fuelFill <= 0 ? ' disabled' : ''}>
              +10%<br><span class="equip-fuel-cost">${Math.min(10, fuelFill) * FUEL_PRICE_PER_PCT}&nbsp;CR</span>
            </button>
            <button class="equip-fuel-btn" id="equip-fuel-25"${fuelFill <= 0 ? ' disabled' : ''}>
              +25%<br><span class="equip-fuel-cost">${Math.min(25, fuelFill) * FUEL_PRICE_PER_PCT}&nbsp;CR</span>
            </button>
            <button class="equip-fuel-btn" id="equip-fuel-fill"${fuelFill <= 0 ? ' disabled' : ''}>
              FILL<br><span class="equip-fuel-cost">${ffcost}&nbsp;CR</span>
            </button>
          </div>
        </section>
        <section class="equip-section">
          <h2 class="equip-section-title">HULL</h2>
          <div class="equip-fuel-row">
            <div class="equip-fuel-bar-wrap">
              <div class="equip-hull-bar" style="width:${hullPct}%"></div>
            </div>
            <span class="equip-fuel-label">${hullPct}%</span>
          </div>
          <div class="equip-fuel-btns">
            <button class="equip-fuel-btn" id="equip-hull-10"${hullDmg <= 0 ? ' disabled' : ''}>
              +10%<br><span class="equip-fuel-cost">${Math.min(10, hullDmg) * HULL_PRICE_PER_PCT}&nbsp;CR</span>
            </button>
            <button class="equip-fuel-btn" id="equip-hull-25"${hullDmg <= 0 ? ' disabled' : ''}>
              +25%<br><span class="equip-fuel-cost">${Math.min(25, hullDmg) * HULL_PRICE_PER_PCT}&nbsp;CR</span>
            </button>
            <button class="equip-fuel-btn" id="equip-hull-full"${hullDmg <= 0 ? ' disabled' : ''}>
              FULL<br><span class="equip-fuel-cost">${hfcost}&nbsp;CR</span>
            </button>
          </div>
        </section>
        <section class="equip-section">
          <h2 class="equip-section-title">EQUIPMENT &amp; UPGRADES</h2>
          <div class="equip-table-wrap">
            <table class="equip-table">
              <thead>
                <tr>
                  <th>ITEM</th>
                  <th>PRICE</th>
                  <th>STATUS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${itemRowsHtml}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div class="equip-footer">
        <span class="equip-credits">CREDITS:&nbsp;<span id="equip-credits-val">${gameState.credits}</span>&nbsp;CR</span>
        <button id="equip-back-btn" class="station-btn equip-back-btn">&#9658;&nbsp; BACK</button>
      </div>
    </div>
  `;

  document.getElementById('equip-header-cdr').textContent = `COMDR. ${gameState.commanderName}`;

  document.getElementById('equip-fuel-10').addEventListener('click', () => _buyFuel(10, sys));
  document.getElementById('equip-fuel-25').addEventListener('click', () => _buyFuel(25, sys));
  document.getElementById('equip-fuel-fill').addEventListener('click', () => _buyFuel(100, sys));

  document.getElementById('equip-hull-10').addEventListener('click', () => _repairHull(10, sys));
  document.getElementById('equip-hull-25').addEventListener('click', () => _repairHull(25, sys));
  document.getElementById('equip-hull-full').addEventListener('click', () => _repairHull(100, sys));

  availItems.forEach(item => {
    document.getElementById(`equip-buy-${item.id}`)
      ?.addEventListener('click', () => _buyEquipment(item, sys));
    document.getElementById(`equip-unequip-${item.id}`)
      ?.addEventListener('click', () => _unequipItem(item, sys));
  });

  document.getElementById('equip-back-btn').addEventListener('click', showStationScreen);
}

function _buyFuel(requestedPct, sys) {
  const fuelFill  = 100 - gameState.fuel;
  const actualPct = Math.min(requestedPct, fuelFill);
  if (actualPct <= 0) return;
  const cost = actualPct * FUEL_PRICE_PER_PCT;
  if (gameState.credits < cost) { buttonErrorSound.play(); return; }
  buttonClickSound.play();
  gameState.credits -= cost;
  gameState.fuel    += actualPct;
  saveGame();
  _renderEquipmentScreen(sys);
}

function _repairHull(requestedPct, sys) {
  const hullDmg   = 100 - gameState.hull;
  const actualPct = Math.min(requestedPct, hullDmg);
  if (actualPct <= 0) return;
  const cost = actualPct * HULL_PRICE_PER_PCT;
  if (gameState.credits < cost) { buttonErrorSound.play(); return; }
  buttonClickSound.play();
  gameState.credits -= cost;
  gameState.hull    += actualPct;
  saveGame();
  _renderEquipmentScreen(sys);
}

// Laser upgrade chain: pulse_laser → beam_laser → military_laser
const LASER_TRADE_IN = {
  beam_laser:     'pulse_laser',
  military_laser: 'beam_laser',
};

function _buyEquipment(item, sys) {
  const owned = gameState.equipment[item.id] ?? 0;
  if (owned >= item.maxOwn) return;
  if (gameState.credits < item.price) { buttonErrorSound.play(); return; }
  // Trade in the previous laser tier if equipped
  const tradeInId = LASER_TRADE_IN[item.id];
  if (tradeInId && (gameState.equipment[tradeInId] ?? 0) > 0) {
    const tradeItem = EQUIPMENT_CATALOG.find(e => e.id === tradeInId);
    gameState.credits += Math.floor(tradeItem.price * 0.5);
    gameState.equipment[tradeInId] = 0;
  }
  gameState.credits -= item.price;
  gameState.equipment[item.id] = owned + 1;
  if (item.id === 'extra_cargo') {
    gameState.cargoCapacity += 4;
  }
  if (item.id === 'shield_generator') {
    gameState.shields = 100;  // activate shields immediately on purchase
  }
  saveGame();
  _renderEquipmentScreen(sys);
}

function _unequipItem(item, sys) {
  const owned = gameState.equipment[item.id] ?? 0;
  if (owned <= 0) return;
  const refund = Math.floor(item.price * 0.5);
  gameState.credits += refund;
  gameState.equipment[item.id] = owned - 1;
  if (item.id === 'extra_cargo') {
    gameState.cargoCapacity -= 4;
  }
  if (item.id === 'shield_generator') {
    gameState.shields = 0;
  }
  // Restore the previous laser tier that was traded in on purchase
  const tradeInId = LASER_TRADE_IN[item.id];
  if (tradeInId) {
    gameState.equipment[tradeInId] = 1;
  }
  saveGame();
  _renderEquipmentScreen(sys);
}

// ─── Galactic Chart ───────────────────────────────────────────────────────────

/**
 * Return the fuel cost (0–100+) to jump from the current system to `sys`.
 * Cost is proportional to euclidean distance in galaxy-map units.
 */
function _effectiveMaxRange() {
  const hasHyperdrive = (gameState.equipment?.['gal_hyperdrive'] ?? 0) > 0;
  return hasHyperdrive ? CHART_MAX_RANGE * 2 : CHART_MAX_RANGE;
}

function _fuelCostTo(sys) {
  const origin = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  if (sys.id === origin.id) return 0;
  const dist = Math.hypot(sys.x - origin.x, sys.y - origin.y);
  return Math.ceil(dist / _effectiveMaxRange() * 100);
}

/**
 * Convert a system's galaxy coordinates (0–255) to canvas pixel coordinates,
 * accounting for the current zoom level and pan position.
 */
function _getMapCoords(sys) {
  const mapW = canvas.width  - CHART_PADDING * 2;
  const mapH = canvas.height - CHART_PANEL_HEIGHT - CHART_PADDING * 2;
  const cx   = CHART_PADDING + mapW / 2;
  const cy   = CHART_PADDING + mapH / 2;
  const sx   = cx + (sys.x / 255 - mapState.panX / 255) * mapState.zoom * mapW;
  const sy   = cy + (sys.y / 255 - mapState.panY / 255) * mapState.zoom * mapH;
  return { sx, sy };
}

/** Convert a canvas pixel position to galaxy coordinates (0–255). */
function _canvasToGalaxy(mx, my) {
  const mapW = canvas.width  - CHART_PADDING * 2;
  const mapH = canvas.height - CHART_PANEL_HEIGHT - CHART_PADDING * 2;
  const cx   = CHART_PADDING + mapW / 2;
  const cy   = CHART_PADDING + mapH / 2;
  return {
    gx: mapState.panX + (mx - cx) * 255 / (mapState.zoom * mapW),
    gy: mapState.panY + (my - cy) * 255 / (mapState.zoom * mapH),
  };
}

/** Clamp pan so the viewport never drifts entirely off the galaxy. */
function _clampMapPan() {
  const hw = 127.5 / mapState.zoom;
  mapState.panX = Math.max(hw, Math.min(255 - hw, mapState.panX));
  mapState.panY = Math.max(hw, Math.min(255 - hw, mapState.panY));
}

/**
 * Zoom the map by `factor`, keeping galaxy point (pivotGx, pivotGy) fixed on screen.
 * Pass mapState.panX/panY as pivot to zoom towards the current centre.
 */
function _applyMapZoom(factor, pivotGx, pivotGy) {
  const newZoom  = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, mapState.zoom * factor));
  const zRatio   = mapState.zoom / newZoom;
  mapState.panX  = pivotGx - (pivotGx - mapState.panX) * zRatio;
  mapState.panY  = pivotGy - (pivotGy - mapState.panY) * zRatio;
  mapState.zoom  = newZoom;
  _clampMapPan();
}

/** Populate the chart info panel with data from a star system object. */
function _updateChartInfo(sys) {
  const nameEl = document.getElementById('chart-sys-name');
  const metaEl = document.getElementById('chart-sys-meta');
  const descEl = document.getElementById('chart-sys-desc');
  if (!nameEl || !metaEl || !descEl) return;
  if (!sys) {
    nameEl.textContent = 'GALACTIC CHART';
    metaEl.textContent = '';
    descEl.textContent = 'SELECT A DESTINATION';
    return;
  }
  nameEl.textContent = `GALACTIC CHART: ${sys.name.toUpperCase()}`;
  const cost    = _fuelCostTo(sys);
  const origin  = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  const isCurrent = sys.id === origin.id;
  const inRange   = cost <= gameState.fuel;
  const fuelStr   = isCurrent ? '(CURRENT SYSTEM)'
                  : inRange   ? `FUEL REQUIRED: ${cost}%`
                  :             'OUT OF RANGE';
  const _visitCount = gameState.visitedSystems[String(sys.id)] ?? 0;
  const _visitedStr  = _visitCount > 0 ? 'VISITED' : 'UNVISITED';
  metaEl.textContent =
    `${sys.economyName.toUpperCase()}  ·  ${sys.govName.toUpperCase()}  ·  TECH ${sys.techLevel}`;
  descEl.textContent = isCurrent ? `(CURRENT SYSTEM)  ·  VISITED` : `${fuelStr}  ·  ${_visitedStr}`;
}

/**
 * Selection logic — find the nearest in-range system within `threshold`
 * canvas pixels and mark it as destination.
 * Touch calls pass a larger threshold (22 px); mouse uses 14 px.
 */
function _selectNearestSystem(mx, my, threshold = 14) {
  // Ignore taps inside the info panel strip
  if (my > canvas.height - CHART_PANEL_HEIGHT) return;

  let closest = null;
  let minDist = threshold;

  for (const sys of GALAXY_SYSTEMS) {
    const { sx, sy } = _getMapCoords(sys);
    const d = Math.hypot(mx - sx, my - sy);
    if (d < minDist) { minDist = d; closest = sys; }
  }

  if (closest) {
    const cost = _fuelCostTo(closest);
    if (cost > gameState.fuel) return;
    mapState.selectedSystem = closest;
    buttonSelectSound.play();
    _updateChartInfo(closest);
  }
}

// ── Shared coord helpers ────────────────────────────────────────────────────

/** DPI-corrected canvas coordinates from a MouseEvent or Touch object. */
function _mapClientToCanvas(clientX, clientY) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    mx: (clientX - rect.left) * scaleX,
    my: (clientY - rect.top)  * scaleY,
  };
}

// ── Touch-first handlers ────────────────────────────────────────────────────
// Single-finger drag → pan
// Two-finger pinch   → zoom (midpoint is the zoom pivot + simultaneous pan)
// Single-finger tap  → select nearest system

/** Active touch interaction state (null when no fingers on canvas). */
let _mapTouchState = null;  // { type: 'pan'|'pinch', ... }

function handleMapTouchStart(e) {
  e.preventDefault();
  const touches = e.touches;

  if (touches.length === 1) {
    const { mx, my } = _mapClientToCanvas(touches[0].clientX, touches[0].clientY);
    if (my > canvas.height - CHART_PANEL_HEIGHT) return;
    _mapTouchState = {
      type:      'pan',
      startX:    touches[0].clientX,
      startY:    touches[0].clientY,
      startPanX: mapState.panX,
      startPanY: mapState.panY,
      moved:     false,
    };
  } else if (touches.length >= 2) {
    const dist   = Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    const midCX  = (touches[0].clientX + touches[1].clientX) / 2;
    const midCY  = (touches[0].clientY + touches[1].clientY) / 2;
    const { mx, my } = _mapClientToCanvas(midCX, midCY);
    const { gx, gy } = _canvasToGalaxy(mx, my);
    _mapTouchState = {
      type:      'pinch',
      startDist: dist,
      startZoom: mapState.zoom,
      pivotGx:   gx,
      pivotGy:   gy,
      startMidCX: midCX,
      startMidCY: midCY,
      startPanX:  mapState.panX,
      startPanY:  mapState.panY,
    };
  }
}

function handleMapTouchMove(e) {
  e.preventDefault();
  if (!_mapTouchState) return;
  const touches = e.touches;

  if (_mapTouchState.type === 'pan' && touches.length === 1) {
    const dx = touches[0].clientX - _mapTouchState.startX;
    const dy = touches[0].clientY - _mapTouchState.startY;

    if (!_mapTouchState.moved && Math.hypot(dx, dy) > 6) {
      _mapTouchState.moved = true;
    }

    if (_mapTouchState.moved) {
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const mapW   = canvas.width  - CHART_PADDING * 2;
      const mapH   = canvas.height - CHART_PANEL_HEIGHT - CHART_PADDING * 2;
      mapState.panX = _mapTouchState.startPanX - dx * scaleX * 255 / (mapState.zoom * mapW);
      mapState.panY = _mapTouchState.startPanY - dy * scaleY * 255 / (mapState.zoom * mapH);
      _clampMapPan();
    }

  } else if (_mapTouchState.type === 'pinch' && touches.length >= 2) {
    const dist    = Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    const newZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX,
                      _mapTouchState.startZoom * (dist / _mapTouchState.startDist)));

    // Pan with midpoint translation simultaneously
    const midCX  = (touches[0].clientX + touches[1].clientX) / 2;
    const midCY  = (touches[0].clientY + touches[1].clientY) / 2;
    const dmx    = midCX - _mapTouchState.startMidCX;
    const dmy    = midCY - _mapTouchState.startMidCY;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mapW   = canvas.width  - CHART_PADDING * 2;
    const mapH   = canvas.height - CHART_PANEL_HEIGHT - CHART_PADDING * 2;
    const zRatio = _mapTouchState.startZoom / newZoom;

    mapState.panX = _mapTouchState.pivotGx
                  - (_mapTouchState.pivotGx - _mapTouchState.startPanX) * zRatio
                  - dmx * scaleX * 255 / (newZoom * mapW);
    mapState.panY = _mapTouchState.pivotGy
                  - (_mapTouchState.pivotGy - _mapTouchState.startPanY) * zRatio
                  - dmy * scaleY * 255 / (newZoom * mapH);
    mapState.zoom = newZoom;
    _clampMapPan();
  }
}

function handleMapTouchEnd(e) {
  e.preventDefault();
  if (!_mapTouchState) return;

  // Tap: single finger, no significant movement → select
  if (_mapTouchState.type === 'pan' && !_mapTouchState.moved && e.changedTouches.length > 0) {
    const t = e.changedTouches[0];
    const { mx, my } = _mapClientToCanvas(t.clientX, t.clientY);
    _selectNearestSystem(mx, my, 22);  // larger touch target
  }

  // If one finger remains after a pinch, start a new pan from that finger
  if (e.touches.length === 1 && _mapTouchState.type === 'pinch') {
    _mapTouchState = {
      type:      'pan',
      startX:    e.touches[0].clientX,
      startY:    e.touches[0].clientY,
      startPanX: mapState.panX,
      startPanY: mapState.panY,
      moved:     false,
    };
  } else if (e.touches.length === 0) {
    _mapTouchState = null;
  }
}

// ── Mouse / wheel / keyboard fallbacks (desktop) ───────────────────────────

/** Mouse drag-pan state (desktop only). */
let _mapMouseDragState = null;

function handleMapMouseDown(e) {
  if (e.button !== 0) return;
  const { mx, my } = _mapClientToCanvas(e.clientX, e.clientY);
  if (my > canvas.height - CHART_PANEL_HEIGHT) return;
  _mapMouseDragState = {
    startX:    e.clientX,
    startY:    e.clientY,
    startPanX: mapState.panX,
    startPanY: mapState.panY,
    moved:     false,
  };
  canvas.style.cursor = 'grabbing';
}

function handleMapMouseMove(e) {
  if (!_mapMouseDragState) return;
  const dx = e.clientX - _mapMouseDragState.startX;
  const dy = e.clientY - _mapMouseDragState.startY;

  if (!_mapMouseDragState.moved && Math.hypot(dx, dy) > 4) {
    _mapMouseDragState.moved = true;
  }

  if (_mapMouseDragState.moved) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mapW   = canvas.width  - CHART_PADDING * 2;
    const mapH   = canvas.height - CHART_PANEL_HEIGHT - CHART_PADDING * 2;
    mapState.panX = _mapMouseDragState.startPanX - dx * scaleX * 255 / (mapState.zoom * mapW);
    mapState.panY = _mapMouseDragState.startPanY - dy * scaleY * 255 / (mapState.zoom * mapH);
    _clampMapPan();
  }
}

function handleMapMouseUp(e) {
  if (!_mapMouseDragState) return;
  const wasMoved     = _mapMouseDragState.moved;
  _mapMouseDragState = null;
  canvas.style.cursor = 'crosshair';
  if (!wasMoved) {
    const { mx, my } = _mapClientToCanvas(e.clientX, e.clientY);
    _selectNearestSystem(mx, my);
  }
}

/** Mouse-wheel zoom, centred on the cursor position. */
function handleMapWheel(e) {
  e.preventDefault();
  const { mx, my } = _mapClientToCanvas(e.clientX, e.clientY);
  if (my > canvas.height - CHART_PANEL_HEIGHT) return;
  const { gx, gy } = _canvasToGalaxy(mx, my);
  _applyMapZoom(e.deltaY < 0 ? 1.25 : 0.8, gx, gy);
}

/** Keyboard zoom (+/-/0) and arrow-key pan while the chart is open. */
function handleMapKeyDown(e) {
  if (gameState.screen !== 'map') return;
  const PAN_STEP = 20 / mapState.zoom;
  const _playerSys = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  switch (e.key) {
    case '+': case '=':
      e.preventDefault();
      _applyMapZoom(1.25, _playerSys.x, _playerSys.y);
      break;
    case '-':
      e.preventDefault();
      _applyMapZoom(0.8, _playerSys.x, _playerSys.y);
      break;
    case '0':
      e.preventDefault();
      mapState.zoom = MAP_ZOOM_MIN;
      mapState.panX = _playerSys.x;
      mapState.panY = _playerSys.y;
      _clampMapPan();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      mapState.panX -= PAN_STEP;
      _clampMapPan();
      break;
    case 'ArrowRight':
      e.preventDefault();
      mapState.panX += PAN_STEP;
      _clampMapPan();
      break;
    case 'ArrowUp':
      e.preventDefault();
      mapState.panY -= PAN_STEP;
      _clampMapPan();
      break;
    case 'ArrowDown':
      e.preventDefault();
      mapState.panY += PAN_STEP;
      _clampMapPan();
      break;
  }
}

/** Render the galaxy dot-map onto the canvas each frame. */
function drawGalacticChart() {
  const cw        = canvas.width;
  const ch        = canvas.height;
  const mapBottom = ch - CHART_PANEL_HEIGHT;
  const p         = CHART_PADDING;
  const currentId = gameState.currentSystem?.id ?? 0;  // default to Lave

  ctx.save();

  // Map border
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(p, p, cw - p * 2, mapBottom - p * 2);

  // Clip all subsequent drawing to the map area
  ctx.beginPath();
  ctx.rect(p, p, cw - p * 2, mapBottom - p * 2);
  ctx.clip();

  // Fuel range ellipse centred on current system
  const origin       = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  const { sx: ox, sy: oy } = _getMapCoords(origin);
  const mapW  = cw - p * 2;
  const mapHpx = mapBottom - p * 2;
  const rxPx  = (gameState.fuel / 100) * _effectiveMaxRange() * (mapW  / 255) * mapState.zoom;
  const ryPx  = (gameState.fuel / 100) * _effectiveMaxRange() * (mapHpx / 255) * mapState.zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.ellipse(ox, oy, rxPx, ryPx, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Star systems
  for (const sys of GALAXY_SYSTEMS) {
    const { sx, sy } = _getMapCoords(sys);
    const isSelected = mapState.selectedSystem?.id === sys.id;
    const isCurrent  = sys.id === currentId;
    const inRange    = _fuelCostTo(sys) <= gameState.fuel;

    // Selection ring + crosshair ticks (drawn behind the dot)
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 0.75;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy); ctx.lineTo(sx - 6, sy);
      ctx.moveTo(sx + 6, sy); ctx.lineTo(sx + 9, sy);
      ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy - 6);
      ctx.moveTo(sx, sy + 6); ctx.lineTo(sx, sy + 9);
      ctx.stroke();
    }

    // Visited ring: dim circle around in-range visited systems (not current, not selected)
    const isVisited = (gameState.visitedSystems[String(sys.id)] ?? 0) > 0;
    if (isVisited && !isCurrent && inRange) {
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Current location: rotated diamond; other systems: 2×2 square dot
    if (isCurrent) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1;
      ctx.strokeRect(-3, -3, 6, 6);
      ctx.restore();
    } else if (!inRange) {
      // Out-of-range: dimmed 2×2 dot
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(sx, sy, 2, 2);
    } else {
      // Vary dot size and brightness by tech level for an organic, non-uniform look.
      // Tech 1–5: dim 2×2 point; 6–10: mid 2×2; 11–15: bright 2×2.
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      } else if (sys.techLevel >= 11) {
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      } else if (sys.techLevel >= 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.70)';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }
  }

  // Zoom level indicator (shown when zoomed in)
  if (mapState.zoom > 1) {
    ctx.fillStyle    = 'rgba(255,255,255,0.45)';
    ctx.font         = `9px 'Courier New', monospace`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`ZOOM ×${mapState.zoom.toFixed(1)}`, cw - p - 4, p + 4);
  }

  ctx.restore();
}

/** Build the galactic chart screen: canvas map + HTML info panel. */
function showGalacticChart() {
  gameState.screen = 'map';

  // Reset view each time the chart opens, centred on the player's location
  const _initSys = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
  mapState.zoom = MAP_ZOOM_MIN;
  mapState.panX = _initSys.x;
  mapState.panY = _initSys.y;
  _clampMapPan();

  uiLayer.innerHTML = `
    <div id="chart-panel" class="chart-panel">
      <div class="chart-panel-nav">
        <span id="chart-sys-name" class="chart-sys-name"></span>
        <div class="chart-zoom-btns" aria-label="Zoom controls">
          <button id="chart-zoom-in"    class="chart-zoom-btn" title="Zoom in (+)">+</button>
          <button id="chart-zoom-out"   class="chart-zoom-btn" title="Zoom out (&minus;)">&minus;</button>
          <button id="chart-zoom-reset" class="chart-zoom-btn" title="Reset zoom (0)">&#8635;</button>
        </div>
      </div>
      <div id="chart-sys-meta" class="chart-sys-meta"></div>
      <div id="chart-sys-desc" class="chart-sys-desc"></div>
      <button id="chart-back" class="station-btn chart-back-btn">&#9658;&nbsp; BACK</button>
    </div>
  `;

  _updateChartInfo(mapState.selectedSystem);

  // Zoom buttons
  document.getElementById('chart-zoom-in').addEventListener('click', () => {
    const _ps = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
    _applyMapZoom(1.5, _ps.x, _ps.y);
  });
  document.getElementById('chart-zoom-out').addEventListener('click', () => {
    const _ps = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
    _applyMapZoom(1 / 1.5, _ps.x, _ps.y);
  });
  document.getElementById('chart-zoom-reset').addEventListener('click', () => {
    const _ps = gameState.currentSystem ?? GALAXY_SYSTEMS[0];
    mapState.zoom = MAP_ZOOM_MIN;
    mapState.panX = _ps.x;
    mapState.panY = _ps.y;
    _clampMapPan();
  });

  document.getElementById('chart-back').addEventListener('click', () => {
    // Touch
    canvas.removeEventListener('touchstart', handleMapTouchStart);
    canvas.removeEventListener('touchmove',  handleMapTouchMove);
    canvas.removeEventListener('touchend',   handleMapTouchEnd);
    // Mouse (desktop fallback)
    canvas.removeEventListener('mousedown', handleMapMouseDown);
    window.removeEventListener('mousemove', handleMapMouseMove);
    window.removeEventListener('mouseup',   handleMapMouseUp);
    canvas.removeEventListener('wheel',     handleMapWheel);
    window.removeEventListener('keydown',   handleMapKeyDown);
    canvas.style.cursor = '';
    _mapTouchState     = null;
    _mapMouseDragState = null;
    showStationScreen();
  });

  // Touch (primary)
  canvas.addEventListener('touchstart', handleMapTouchStart, { passive: false });
  canvas.addEventListener('touchmove',  handleMapTouchMove,  { passive: false });
  canvas.addEventListener('touchend',   handleMapTouchEnd,   { passive: false });
  // Mouse drag + wheel (desktop fallback)
  canvas.style.cursor = 'crosshair';
  canvas.addEventListener('mousedown', handleMapMouseDown);
  window.addEventListener('mousemove', handleMapMouseMove);
  window.addEventListener('mouseup',   handleMapMouseUp);
  canvas.addEventListener('wheel',     handleMapWheel, { passive: false });
  window.addEventListener('keydown',   handleMapKeyDown);

  if (!localStorage.getItem(MAP_HELP_KEY)) {
    _showMapHelpModal();
  }
}

/** Show the Galactic Chart help modal overlay. */
function _showMapHelpModal() {
  const overlay = document.createElement('div');
  overlay.id        = 'map-help-overlay';
  overlay.className = 'modal-overlay map-help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Galactic Chart help');
  overlay.innerHTML = `
    <div class="modal-box panel map-help-box">
      <h2>GALACTIC CHART</h2>
      <p class="map-help-body">The Galactic Chart shows all known star systems in this sector. Tap a system dot to select it as your destination — its name, economy and government will appear below the map.</p>
      <ul class="map-help-list">
        <li>&#9658; Your current location is shown as a <strong>filled square</strong>.</li>
        <li>&#9658; The dashed circle shows your <strong>maximum jump range</strong> at current fuel.</li>
        <li>&#9658; Systems within range are <strong>bright white</strong>; out-of-range systems are dimmed.</li>
        <li>&#9658; Use <strong>+</strong> / <strong>&minus;</strong> buttons or mouse wheel to <strong>zoom</strong>. Drag to <strong>pan</strong>.</li>
        <li>&#9658; Once a destination is selected, return to the station and hit <strong>LAUNCH</strong>.</li>
      </ul>
      <div class="map-help-footer">
        <label class="map-help-check-label">
          <span class="map-help-checkbox-wrap">
            <input type="checkbox" id="map-help-no-show" class="map-help-checkbox">
            <span class="map-help-checkbox-custom" aria-hidden="true"></span>
          </span>
          DON'T SHOW AGAIN
        </label>
        <button id="map-help-ok" class="station-btn map-help-ok-btn">&#9658;&nbsp; GOT IT</button>
      </div>
    </div>
  `;

  // Append inside ui-layer so it sits above the chart panel
  uiLayer.appendChild(overlay);

  document.getElementById('map-help-ok').addEventListener('click', () => {
    if (document.getElementById('map-help-no-show').checked) {
      localStorage.setItem(MAP_HELP_KEY, '1');
    }
    overlay.remove();
  });
}

// ─── Launch Sequence ──────────────────────────────────────────────────────────

/**
 * Plays the animated cutscene when the player hits LAUNCH:
 *   Phase 1 — Docked: wireframe docking bay tunnel with ship engines burning
 *   Phase 2 — Undocking: tunnel rings rush outward as ship accelerates and shrinks
 *   Phase 3 — Hyperspace: classic star-streak warp radiating from centre + glitch
 *   Phase 4 — Flash: white flash transitions into active flight
 */
class LaunchSequence {
  constructor(destinationName, onComplete) {
    this.destination = destinationName;
    this.onComplete  = onComplete;
    this.startTime   = null;
    this.done        = false;

    // Phase end timestamps (ms from sequence start)
    this.T_UNDOCK     = 1900;
    this.T_HYPERSPACE = 3400;
    this.T_FLASH      = 4700;
    this.T_TOTAL      = 5400;

    // Warp star field — angle, speed, and seed per particle
    this.warpStars = Array.from({ length: 140 }, () => ({
      angle : Math.random() * Math.PI * 2,
      speed : 0.4 + Math.random() * 3.0,
      seed  : Math.random(),
    }));
  }

  // ── Phase 1: Docking bay ──────────────────────────────────────────────────
  _phase1_bay(ctx, w, h, t) {
    ctx.save();
    const cx = w / 2;

    // CRT scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    for (let scanY = 0; scanY < h; scanY += 5) ctx.fillRect(0, scanY, w, 1);

    // Tunnel: 8 nested rectangles all centred at (cx, CY).
    // i=0 is the tiny far exit opening; i=7 is the corridor wall around the player.
    const CY  = h * 0.42;
    const NUM = 8;
    for (let i = 0; i < NUM; i++) {
      const frac  = i / (NUM - 1);         // 0 (inner/exit) → 1 (outer/wall)
      const scale = 0.07 + frac * 0.84;
      const rw    = w * scale;
      const rh    = h * scale * 0.88;
      ctx.globalAlpha = 0.12 + frac * 0.52;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 0.8;
      ctx.strokeRect(cx - rw / 2, CY - rh / 2, rw, rh);
    }
    ctx.globalAlpha = 1;

    // Corner guide lines: outermost corners → innermost corners (1-point perspective)
    const ow = w * 0.91;  const oh = h * 0.91 * 0.88;
    const iw = w * 0.07;  const ih = h * 0.07 * 0.88;
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth   = 0.6;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * ow / 2, CY + sy * oh / 2);
      ctx.lineTo(cx + sx * iw / 2, CY + sy * ih / 2);
      ctx.stroke();
    });

    // Horizontal struts
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 0.5;
    for (let si = 1; si < 5; si++) {
      ctx.beginPath();
      ctx.moveTo(0, h * si / 5);
      ctx.lineTo(w, h * si / 5);
      ctx.stroke();
    }

    // Ship — parked in lower bay, engines burning
    drawCobraShip(ctx, cx, CY + oh * 0.28, PLAYER_WIDTH, PLAYER_HEIGHT, true);

    // Text
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Blinking clearance line (~4 blinks total across the phase)
    if (Math.floor(t * 8) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font      = `12px 'Courier New', monospace`;
      ctx.fillText('LAUNCH CLEARANCE: GRANTED', cx, h * 0.05);
    }

    // Destination
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font      = `10px 'Courier New', monospace`;
    ctx.fillText(`BEARING FOR: ${this.destination}`, cx, h * 0.94);

    // "Engines engaged" fades in during the final 40% of the phase
    if (t > 0.60) {
      ctx.globalAlpha = Math.min(1, (t - 0.60) * 2.5);
      ctx.fillStyle   = '#ffffff';
      ctx.font        = `11px 'Courier New', monospace`;
      ctx.fillText('ENGINES ENGAGED', cx, h * 0.17);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── Phase 2: Undocking ───────────────────────────────────────────────────
  _phase2_undock(ctx, w, h, t) {
    ctx.save();
    const cx = w / 2;
    const cy = h * 0.42;

    // Tunnel rings scroll outward — looped using modulo so they stream continuously
    const NUM = 12;
    for (let i = 0; i < NUM; i++) {
      const frac = ((i / NUM) + t * 1.7) % 1.0;
      const rw   = w * (0.07 + frac * 0.84);
      const rh   = h * (0.07 + frac * 0.84) * 0.88;
      ctx.globalAlpha = Math.max(0, (1 - frac) * 0.85);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = Math.max(0.3, 1 - frac * 0.8);
      ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
    }
    ctx.globalAlpha = 1;

    // Stars visible through the exit opening, fading in
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, t)})`;
    for (const s of this.warpStars.slice(0, 70)) {
      const r = s.seed * Math.min(w, h) * 0.38;
      ctx.fillRect(cx + Math.cos(s.angle) * r, cy + Math.sin(s.angle) * r, 1, 1);
    }

    // Ship rushes forward (upward on screen) toward the exit hole, then vanishes into it.
    // The exit hole centre is exactly cy; clamp so the ship never travels past it.
    const startY  = cy + h * 0.91 * 0.88 * 0.28;
    const exitY   = cy;
    const shipY   = Math.max(exitY, startY - t * (startY - exitY));
    const travel  = (startY - shipY) / (startY - exitY);  // 0 → 1 as ship reaches exit
    const alpha   = travel < 0.65 ? 1 : Math.max(0, 1 - (travel - 0.65) / 0.35);
    const shrink  = Math.max(0.10, 1 - travel * 0.88);
    ctx.globalAlpha = alpha;
    drawCobraShip(ctx, cx, shipY, PLAYER_WIDTH * shrink, PLAYER_HEIGHT * shrink, true);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ── Phase 3: Hyperspace ──────────────────────────────────────────────────
  _phase3_hyperspace(ctx, w, h, t) {
    ctx.save();
    const cx = w / 2;
    const cy = h / 2;

    // Star streaks radiate from the centre
    for (const s of this.warpStars) {
      const dist0 = s.seed * 0.06 * Math.min(w, h);
      const dist1 = dist0 + s.speed * Math.min(w, h) * (0.12 + t * 0.55);
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.2 + t * 0.8)})`;
      ctx.lineWidth   = t > 0.5 ? 1.5 : 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(s.angle) * dist0, cy + Math.sin(s.angle) * dist0);
      ctx.lineTo(cx + Math.cos(s.angle) * dist1, cy + Math.sin(s.angle) * dist1);
      ctx.stroke();
    }

    // Edge vignette darkens toward corners as warp intensity builds
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.55);
    grad.addColorStop(0,    'rgba(0,0,0,0)');
    grad.addColorStop(0.60, 'rgba(0,0,0,0)');
    grad.addColorStop(1,    `rgba(0,0,0,${0.2 + t * 0.5})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Glitch line artifacts — horizontal strips shifted sideways
    if (t > 0.2 && Math.random() < 0.10) {
      const ly    = Math.floor(Math.random() * h);
      const lh2   = 1 + Math.floor(Math.random() * 3);
      const shift = Math.round((Math.random() - 0.5) * 14 * t);
      ctx.drawImage(canvas, 0, ly, w, lh2, shift, ly, w, lh2);
    }

    // HUD text fades in
    if (t > 0.15) {
      ctx.globalAlpha  = Math.min(1, (t - 0.15) / 0.20);
      ctx.fillStyle    = '#ffffff';
      ctx.font         = `13px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HYPERSPACE ENGAGED', cx, h * 0.10);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font      = `10px 'Courier New', monospace`;
      ctx.fillText(`JUMPING TO: ${this.destination}`, cx, h * 0.90);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── Phase 4: Flash ───────────────────────────────────────────────────────
  _phase4_flash(ctx, w, h, t) {
    const alpha = t < 0.4 ? t / 0.4 : Math.max(0, 1 - (t - 0.4) / 0.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ── Main update ──────────────────────────────────────────────────────────
  update(ctx, w, h, timestamp) {
    if (this.done) return;
    if (this.startTime === null) this.startTime = timestamp;

    const elapsed = timestamp - this.startTime;
    if (elapsed >= this.T_TOTAL) {
      this.done = true;
      this.onComplete();
      return;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    if (elapsed < this.T_UNDOCK) {
      this._phase1_bay(ctx, w, h, elapsed / this.T_UNDOCK);

    } else if (elapsed < this.T_HYPERSPACE) {
      const t = (elapsed - this.T_UNDOCK) / (this.T_HYPERSPACE - this.T_UNDOCK);
      this._phase2_undock(ctx, w, h, t);

    } else if (elapsed < this.T_FLASH) {
      const t = (elapsed - this.T_HYPERSPACE) / (this.T_FLASH - this.T_HYPERSPACE);
      this._phase3_hyperspace(ctx, w, h, t);

    } else {
      this._phase3_hyperspace(ctx, w, h, 1.0);
      const t = (elapsed - this.T_FLASH) / (this.T_TOTAL - this.T_FLASH);
      this._phase4_flash(ctx, w, h, t);
    }
  }
}

// ─── Docking Computer Autopilot Animation ────────────────────────────────────

/**
 * DockingComputerAnimation — Plays a 10-second automated docking cutscene
 * when the Docking Computer is installed. Calls onSuccess on completion.
 */
class DockingComputerAnimation {
  constructor(onSuccess) {
    this.onSuccess       = onSuccess;
    this.startTime       = null;
    this.done            = false;
    this.stationRotation = 0;

    // Phase end timestamps (ms from sequence start)
    this.T_ENGAGE   =  2000;   // station + ship appear, banner
    this.T_APPROACH =  7500;   // autopilot approach
    this.T_ENTER    =  9000;   // ship enters docking port
    this.T_COMPLETE = 10000;   // flash + callback

    // Status messages cycling during approach phase
    this._STATUS = [
      'APPROACH VECTOR LOCKED',
      'VELOCITY ADJUSTMENT IN PROGRESS',
      'ATTITUDE CONTROL: NOMINAL',
      'DOCKING CORRIDOR ACQUIRED',
      'AIRLOCK ALIGNMENT CONFIRMED',
      'FINAL APPROACH SEQUENCE ACTIVE',
      'REDUCING THRUST...',
    ];
    this._statusIdx    = 0;
    this._nextStatus   = 0;   // timestamp
  }

  _hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  _drawStation(ctx, cx, cy, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    this._hexPath(ctx, cx, cy, r);
    ctx.stroke();

    // Rotating inner hex
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2 + this.stationRotation;
      const x = cx + r * 0.54 * Math.cos(a);
      const y = cy + r * 0.54 * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Spokes
    ctx.globalAlpha = alpha * 0.22;
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      ctx.stroke();
    }

    // Centre hub dot
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawHUD(ctx, cw, ch, msg, rangeKm) {
    const top = ch - HUD_HEIGHT;
    const mx  = cw / 2;
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, top, cw, HUD_HEIGHT);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(cw, top); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = top + 3; y < ch; y += 4) ctx.fillRect(0, y, cw, 1);

    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.font         = `11px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(msg, mx, top + 9);

    if (rangeKm !== undefined) {
      ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.font      = `9px 'Courier New', monospace`;
      ctx.fillText(`RANGE: ${rangeKm} km`, mx, top + 25);
    }

    // Blinking AUTO badge
    if (Math.floor(Date.now() / 600) % 2 === 0) {
      ctx.fillStyle    = '#ffffff';
      ctx.font         = `9px 'Courier New', monospace`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('[AUTO]', cw * 0.05, top + 9);
    }
    ctx.restore();
  }

  update(ts) {
    if (this.done) return;
    if (this.startTime === null) {
      this.startTime   = ts;
      this._nextStatus = ts + 1800;
    }

    const elapsed = ts - this.startTime;
    const cw      = canvas.width;
    const ch      = canvas.height;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);
    starfield.draw(ctx);

    if (elapsed >= this.T_COMPLETE) {
      this.done = true;
      this.onSuccess();
      return;
    }

    // Station rotates throughout
    this.stationRotation = (elapsed / 1000 * 0.35) % (Math.PI * 2);

    const stCx    = cw / 2;
    const stCy    = (ch - HUD_HEIGHT) * 0.15;
    const stR     = Math.min(cw, ch - HUD_HEIGHT) * 0.038;
    const shipStartY = (ch - HUD_HEIGHT) * 0.83;
    const shipEntryY = stCy + stR * 0.5;

    if (elapsed < this.T_ENGAGE) {
      // ── Phase 1: Appear ──────────────────────────────────────────────────
      const t     = elapsed / this.T_ENGAGE;
      const eased = 1 - Math.pow(1 - t, 3);

      this._drawStation(ctx, stCx, stCy, stR * eased, eased);

      if (t > 0.3) {
        const sa = Math.min(1, (t - 0.3) / 0.4);
        ctx.save();
        ctx.globalAlpha = sa;
        drawCobraShip(ctx, stCx, shipStartY, PLAYER_WIDTH, PLAYER_HEIGHT, false);
        ctx.restore();
      }

      if (t > 0.45) {
        const ba = Math.min(1, (t - 0.45) / 0.35);
        ctx.save();
        ctx.globalAlpha  = ba;
        ctx.fillStyle    = '#ffffff';
        ctx.font         = `14px 'Courier New', monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DOCKING COMPUTER ENGAGED', stCx, (ch - HUD_HEIGHT) * 0.5);
        ctx.font         = `9px 'Courier New', monospace`;
        ctx.fillStyle    = 'rgba(255,255,255,0.55)';
        ctx.fillText('AUTOPILOT ACTIVE — STAND BY', stCx, (ch - HUD_HEIGHT) * 0.5 + 22);
        ctx.restore();
      }

      this._drawHUD(ctx, cw, ch, 'ENGAGING AUTOPILOT...');

    } else if (elapsed < this.T_APPROACH) {
      // ── Phase 2: Autopilot approach ──────────────────────────────────────
      const t     = (elapsed - this.T_ENGAGE) / (this.T_APPROACH - this.T_ENGAGE);
      const eased = 1 - Math.pow(1 - t, 2);

      this._drawStation(ctx, stCx, stCy, stR, 1);

      // Docking guide lines (dashed corridor)
      const corridorW = stR * 0.6;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${(0.06 + eased * 0.08).toFixed(2)})`;
      ctx.setLineDash([4, 8]);
      ctx.lineWidth   = 0.5;
      for (const sx of [-corridorW, corridorW]) {
        ctx.beginPath();
        ctx.moveTo(stCx + sx, stCy);
        ctx.lineTo(stCx + sx, shipStartY + PLAYER_HEIGHT / 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();

      // Ship moves toward station entrance
      const shipY  = shipStartY + (shipEntryY - shipStartY) * eased;
      const scale  = Math.max(0.35, 1 - eased * 0.55);
      drawCobraShip(ctx, stCx, shipY, PLAYER_WIDTH * scale, PLAYER_HEIGHT * scale, true);

      // Cycle status messages
      if (ts >= this._nextStatus) {
        this._statusIdx  = (this._statusIdx + 1) % this._STATUS.length;
        this._nextStatus = ts + 900 + Math.random() * 700;
      }

      const rangeKm = Math.round((1 - eased) * 5000);
      this._drawHUD(ctx, cw, ch, this._STATUS[this._statusIdx], rangeKm);

    } else if (elapsed < this.T_ENTER) {
      // ── Phase 3: Ship enters docking port ───────────────────────────────
      const t     = (elapsed - this.T_APPROACH) / (this.T_ENTER - this.T_APPROACH);
      const eased = 1 - Math.pow(1 - t, 2);

      this._drawStation(ctx, stCx, stCy, stR, 1);

      const shipY  = shipEntryY - eased * stR * 0.8;
      const scale  = Math.max(0.03, 0.35 - eased * 0.32);
      const alpha  = Math.max(0, 1 - t * 1.3);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCobraShip(ctx, stCx, shipY, PLAYER_WIDTH * scale, PLAYER_HEIGHT * scale, false);
      ctx.restore();

      this._drawHUD(ctx, cw, ch, 'ENTERING DOCKING PORT...');

    } else {
      // ── Phase 4: Flash + "DOCKING COMPLETE" ─────────────────────────────
      const t = (elapsed - this.T_ENTER) / (this.T_COMPLETE - this.T_ENTER);

      this._drawStation(ctx, stCx, stCy, stR, 1 - t * 0.5);

      const fa = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.65);
      ctx.save();
      ctx.globalAlpha  = fa * 0.92;
      ctx.fillStyle    = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha  = 1;
      ctx.fillStyle    = '#000000';
      ctx.font         = `16px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DOCKING COMPLETE', cw / 2, ch / 2);
      ctx.restore();

      this._drawHUD(ctx, cw, ch, 'DOCKING COMPLETE');
    }

    // Subtle CRT scanlines over the whole scene
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.012)';
    for (let y = 0; y < ch - HUD_HEIGHT; y += 5) ctx.fillRect(0, y, cw, 1);
    ctx.restore();

    // Occasional glitch line
    if (Math.random() < 0.04) {
      const ly    = Math.floor(Math.random() * (ch - HUD_HEIGHT));
      const shift = Math.round((Math.random() - 0.5) * 10);
      ctx.drawImage(canvas, 0, ly, cw, 2, shift, ly, cw, 2);
    }
  }
}

// ─── Docking Mini-Game ────────────────────────────────────────────────────────

/**
 * DockingMinigame — Pulse-catch docking challenge.
 *
 * The station sits near the top of the screen and emits expanding hexagonal
 * pulse rings at a steady tempo. A static target ring marks the docking
 * corridor at the distance of the player's ship. The player must press SPACE
 * or tap the screen precisely as a pulse ring passes through the target zone.
 *
 * Catch 3 pulses in a row (consecutive) to dock successfully.
 *
 * Controls:
 *   SPACE or tap anywhere — attempt to catch the current pulse
 */
class DockingMinigame {
  constructor(onSuccess, onFail) {
    this.onSuccess = onSuccess;
    this.onFail    = onFail;

    // ── Tunables ──────────────────────────────────────────────────────────
    this.PULSE_SPEED    = 210;    // px / s — expansion rate of hex rings
    this.PULSE_INTERVAL = 1900;   // ms  — time between new pulse spawns
    this.TOLERANCE      = 26;     // ±px — hit window centred on target ring
    this.HITS_NEEDED    = 3;      // consecutive catches required to dock
    this.APPROACH_MS    = 1700;   // ms  — station entrance animation
    this.SUCCESS_FLASH  = 1500;   // ms  — success overlay duration
    this.FAIL_FLASH     = 1400;   // ms  — failure overlay duration
    this.TIME_LIMIT_MS  = 28000;  // ms  — time before automatic failure

    // ── Runtime state ─────────────────────────────────────────────────────
    this.phase            = 'approach';
    this.startTime        = null;
    this.phaseStart       = null;
    this.lastTs           = null;
    this.done             = false;
    this.pulses           = [];      // [{ radius, flashUntil }]
    this.lastPulse        = null;    // ts of last spawn
    this.streak           = 0;
    this.feedback         = null;    // { msg, ts, type }
    this.inputLockedUntil = 0;
    this.stationRotation  = 0;       // slow-spin inner hex (radians)

    this._bindInput();
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      if (gameState.screen !== 'docking') return;
      if (e.code === 'Space') { e.preventDefault(); this._attempt(); }
    };
    this._onTouchStart = () => {
      if (gameState.screen !== 'docking') return;
      this._attempt();
    };
    window.addEventListener('keydown',    this._onKeyDown);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
  }

  _unbindInput() {
    window.removeEventListener('keydown',    this._onKeyDown);
    canvas.removeEventListener('touchstart', this._onTouchStart);
  }

  // Circumradius of the target hex (= distance from station centre to ship).
  _targetRadius(ch) {
    return (ch - HUD_HEIGHT) * 0.66;
  }

  _attempt() {
    if (this.phase !== 'playing' || this.done) return;
    const now = performance.now();
    if (now < this.inputLockedUntil) return;
    this.inputLockedUntil = now + 350;

    const targetR = this._targetRadius(canvas.height);
    let hit      = false;
    let hitPulse = null;

    for (const p of this.pulses) {
      if (Math.abs(p.radius - targetR) <= this.TOLERANCE) {
        hit      = true;
        hitPulse = p;
        break;
      }
    }

    if (hit) {
      hitPulse.flashUntil = (this.lastTs ?? 0) + 500;
      this.streak++;
      const label = this.streak >= this.HITS_NEEDED
        ? 'DOCKING...'
        : `SYNC  [${this.streak}/${this.HITS_NEEDED}]`;
      this.feedback = { msg: label, ts: this.lastTs ?? 0, type: 'hit' };
      if (this.streak >= this.HITS_NEEDED) this._succeed();
    } else {
      let closestDist  = Infinity;
      let closestPulse = null;
      for (const p of this.pulses) {
        const d = Math.abs(p.radius - targetR);
        if (d < closestDist) { closestDist = d; closestPulse = p; }
      }
      const earlyLate = closestPulse
        ? (closestPulse.radius < targetR ? 'TOO EARLY' : 'TOO LATE')
        : 'NO SIGNAL';
      this.streak   = 0;
      this.feedback = { msg: earlyLate, ts: this.lastTs ?? 0, type: 'miss' };
    }
  }

  _succeed() {
    this.phase      = 'success';
    this.phaseStart = this.lastTs;
    this._unbindInput();
  }

  _fail() {
    this.phase      = 'fail';
    this.phaseStart = this.lastTs;
    this._unbindInput();
  }

  // Build a pointy-top hexagon path (vertex pointing straight up).
  _hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;  // −90° = top vertex
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // Draw the hexagonal space station icon.
  _drawStation(ctx, cx, cy, stationR, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer hex
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    this._hexPath(ctx, cx, cy, stationR);
    ctx.stroke();

    // Slowly rotating inner hex
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2 + this.stationRotation;
      const x = cx + stationR * 0.54 * Math.cos(a);
      const y = cy + stationR * 0.54 * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Spokes from centre to outer vertices
    ctx.globalAlpha = alpha * 0.22;
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + stationR * Math.cos(a), cy + stationR * Math.sin(a));
      ctx.stroke();
    }

    // Centre hub dot
    ctx.globalAlpha = alpha * 0.90;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Draw the static docking corridor rings centred on the station.
  _drawTargetZone(ctx, cx, cy, targetR, nearFactor) {
    const baseAlpha = 0.18 + nearFactor * 0.52;
    ctx.save();

    // Tolerance band — dashed inner / outer hex outlines
    ctx.strokeStyle = `rgba(255,255,255,${(0.10 + nearFactor * 0.28).toFixed(2)})`;
    ctx.lineWidth   = 0.8;
    ctx.setLineDash([4, 6]);
    this._hexPath(ctx, cx, cy, targetR - this.TOLERANCE);
    ctx.stroke();
    this._hexPath(ctx, cx, cy, targetR + this.TOLERANCE);
    ctx.stroke();
    ctx.setLineDash([]);

    // Centre target ring (solid)
    ctx.strokeStyle = `rgba(255,255,255,${baseAlpha.toFixed(2)})`;
    ctx.lineWidth   = nearFactor > 0.9 ? 2 : 1.2;
    this._hexPath(ctx, cx, cy, targetR);
    ctx.stroke();

    ctx.restore();
  }

  // Draw all active expanding pulse rings.
  _drawPulses(ctx, cx, cy, targetR, ts) {
    for (const p of this.pulses) {
      if (p.radius <= 0) continue;
      const dist     = Math.abs(p.radius - targetR);
      const inWindow = dist <= this.TOLERANCE;
      const flashing = p.flashUntil > ts;

      let alpha;
      if (flashing) {
        alpha = (Math.floor(ts / 110) % 2 === 0) ? 1.0 : 0.60;
      } else if (inWindow) {
        alpha = 0.88;
      } else {
        const proximity = Math.max(0, 1 - dist / (this.TOLERANCE * 5));
        alpha = 0.28 + proximity * 0.38;
      }

      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
      ctx.lineWidth   = flashing ? 2.5 : (inWindow ? 1.8 : 1.2);
      this._hexPath(ctx, cx, cy, p.radius);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Returns 0–1: how close the nearest pulse is to the target ring.
  _nearestPulseFactor(targetR) {
    let nearest = Infinity;
    for (const p of this.pulses) {
      const d = Math.abs(p.radius - targetR);
      if (d < nearest) nearest = d;
    }
    if (nearest <= this.TOLERANCE)     return 1.0;
    if (nearest <= this.TOLERANCE * 5) return Math.max(0, 1 - (nearest - this.TOLERANCE) / (this.TOLERANCE * 4));
    return 0;
  }

  // Compose the full scene: station + target ring + pulses + ship.
  _drawScene(ctx, cw, ch, stCx, stCy, targetR, scaleIn, ts) {
    const stationR = Math.min(cw, ch - HUD_HEIGHT) * 0.038 * scaleIn;
    const shipCx   = stCx;
    const shipCy   = stCy + targetR;   // ship sits at bottom vertex of target hex

    // Target zone fades in after station is mostly arrived
    if (scaleIn >= 0.35) {
      const alpha  = Math.min(1, (scaleIn - 0.35) / 0.5);
      const nearby = this._nearestPulseFactor(targetR);
      ctx.save();
      ctx.globalAlpha = alpha;
      this._drawTargetZone(ctx, stCx, stCy, targetR, nearby);
      ctx.restore();
    }

    // Pulse rings only render once fully in
    if (scaleIn >= 1) this._drawPulses(ctx, stCx, stCy, targetR, ts);

    // Station
    this._drawStation(ctx, stCx, stCy, stationR, scaleIn);

    // Player ship at bottom vertex of target zone hex
    if (scaleIn >= 0.3) {
      const shipAlpha = Math.min(1, (scaleIn - 0.3) / 0.45);
      ctx.save();
      ctx.globalAlpha = shipAlpha;
      ctx.translate(shipCx, shipCy);
      drawCobraShip(ctx, 0, 0, PLAYER_WIDTH, PLAYER_HEIGHT, false);
      ctx.restore();
    }
  }

  _drawHUD(ctx, cw, ch, msg, timeLeft) {
    const top = ch - HUD_HEIGHT;
    const mid = top + HUD_HEIGHT / 2;
    const mx  = cw / 2;

    ctx.save();

    // Panel background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, top, cw, HUD_HEIGHT);

    // Top border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, top); ctx.lineTo(cw, top);
    ctx.stroke();

    // CRT scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = top + 3; y < ch; y += 4) ctx.fillRect(0, y, cw, 1);

    // Status message
    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.font         = `11px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(msg, mx, top + 10);

    // Streak dots  ○ ○ ○ → ● ● ●
    const dotR   = 5;
    const dotGap = 24;
    const dotY   = mid - 4;
    for (let i = 0; i < this.HITS_NEEDED; i++) {
      const dx     = mx + (i - (this.HITS_NEEDED - 1) / 2) * dotGap;
      const filled = i < this.streak;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = filled ? 0 : 1.5;
      ctx.fillStyle   = filled ? '#ffffff' : 'transparent';
      ctx.beginPath();
      ctx.arc(dx, dotY, dotR, 0, Math.PI * 2);
      ctx.stroke();
      if (filled) ctx.fill();
    }

    // Time-limit bar
    if (timeLeft !== undefined) {
      const barW  = Math.min(cw * 0.6, 200);
      const barH  = 3;
      const barX  = mx - barW / 2;
      const barY  = mid + 14;
      const ratio = timeLeft / this.TIME_LIMIT_MS;

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(barX, barY, barW, barH);
      if (ratio > 0) {
        ctx.fillStyle = ratio > 0.35 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.88)';
        ctx.fillRect(barX + 1, barY + 1, (barW - 2) * ratio, barH - 2);
      }
    }

    // Tap / key prompt
    ctx.fillStyle    = 'rgba(255,255,255,0.38)';
    ctx.font         = `8px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('PRESS SPACE / TAP TO CATCH PULSE', mx, ch - 8);

    ctx.restore();
  }

  _drawFeedback(ctx, cw, stCy, targetR, elapsed, type, msg) {
    const alpha = Math.max(0, 1 - elapsed / 600);
    const y     = stCy + targetR * 0.48;
    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.fillStyle    = '#ffffff';
    ctx.font         = `${type === 'hit' ? 13 : 11}px 'Courier New', monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, cw / 2, y);
    ctx.restore();
  }

  _drawSuccessFlash(ctx, cw, ch, elapsed) {
    const t     = elapsed / this.SUCCESS_FLASH;
    const alpha = t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 0.3) / 0.7);
    ctx.save();
    ctx.globalAlpha = alpha * 0.88;
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#000000';
    ctx.font        = `16px 'Courier New', monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DOCKING SUCCESSFUL', cw / 2, ch / 2);
    ctx.restore();
  }

  _drawFailFlash(ctx, cw, ch, elapsed) {
    const t       = elapsed / this.FAIL_FLASH;
    const flicker = Math.floor(Date.now() / 80) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = Math.max(0, (1 - t) * 0.65) * (flicker ? 1 : 0.6);
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.fillStyle   = flicker ? '#000000' : 'rgba(0,0,0,0.7)';
    ctx.font        = `14px 'Courier New', monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DOCKING FAILED', cw / 2, ch * 0.46);
    ctx.font = `10px 'Courier New', monospace`;
    ctx.fillText('CARRIER SIGNAL LOST', cw / 2, ch * 0.54);
    ctx.restore();
  }

  update(ts) {
    if (this.done) return;
    if (this.startTime === null) {
      this.startTime  = ts;
      this.phaseStart = ts;
      this.lastPulse  = ts;
    }

    const dt      = this.lastTs !== null ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs   = ts;
    const elapsed = ts - this.startTime;
    const cw      = canvas.width;
    const ch      = canvas.height;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);
    starfield.draw(ctx);

    // Station inner hex rotates slowly
    this.stationRotation = (this.stationRotation + 0.35 * dt) % (Math.PI * 2);

    const stCx    = cw / 2;
    const stCy    = (ch - HUD_HEIGHT) * 0.12;
    const targetR = this._targetRadius(ch);

    if (this.phase === 'approach') {
      const t     = Math.min(1, elapsed / this.APPROACH_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this._drawScene(ctx, cw, ch, stCx, stCy, targetR, eased, ts);
      this._drawHUD(ctx, cw, ch, 'APPROACHING STATION');
      if (t >= 1) {
        this.phase      = 'playing';
        this.phaseStart = ts;
        // First pulse arrives ~500 ms after approach completes
        this.lastPulse  = ts - this.PULSE_INTERVAL + 500;
      }

    } else if (this.phase === 'playing') {
      // Spawn pulses on interval
      if (ts - this.lastPulse >= this.PULSE_INTERVAL) {
        this.pulses.push({ radius: 0, flashUntil: 0 });
        this.lastPulse = ts;
      }

      // Advance and cull spent pulses
      for (const p of this.pulses) p.radius += this.PULSE_SPEED * dt;
      const maxR = targetR + this.TOLERANCE * 2 + 80;
      this.pulses = this.pulses.filter(p => p.radius < maxR);

      if (ts - this.phaseStart > this.TIME_LIMIT_MS) this._fail();

      this._drawScene(ctx, cw, ch, stCx, stCy, targetR, 1, ts);

      // Feedback overlay (hit / miss text)
      if (this.feedback) {
        const fElapsed = ts - this.feedback.ts;
        if (fElapsed < 600) {
          this._drawFeedback(ctx, cw, stCy, targetR, fElapsed, this.feedback.type, this.feedback.msg);
        }
      }

      const timeLeft = Math.max(0, this.TIME_LIMIT_MS - (ts - this.phaseStart));
      this._drawHUD(ctx, cw, ch, `CATCH THE PULSE  [${this.streak}/${this.HITS_NEEDED}]`, timeLeft);

    } else if (this.phase === 'success') {
      this._drawScene(ctx, cw, ch, stCx, stCy, targetR, 1, ts);
      this._drawSuccessFlash(ctx, cw, ch, ts - this.phaseStart);
      if (ts - this.phaseStart > this.SUCCESS_FLASH) { this.done = true; this.onSuccess(); }

    } else if (this.phase === 'fail') {
      this._drawScene(ctx, cw, ch, stCx, stCy, targetR, 1, ts);
      this._drawFailFlash(ctx, cw, ch, ts - this.phaseStart);
      if (ts - this.phaseStart > this.FAIL_FLASH) { this.done = true; this.onFail(); }
    }
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

const starfield      = new Starfield(canvas.width, canvas.height);
const player         = new Player();
let   launchSequence      = null;
let   dockingMinigame     = null;
let   dockingComputerAnim = null;

// ── Missile input: swipe-up (touch) + M key (keyboard) ───────────────────────
// Track swipe start on the canvas; fire if swipe was upward (dy > 60 px, small dx).
canvas.addEventListener('touchstart', (e) => {
  _swipeTouchStartX = e.touches[0].clientX;
  _swipeTouchStartY = e.touches[0].clientY;
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  const t   = e.changedTouches[0];
  const dx  = Math.abs(t.clientX - _swipeTouchStartX);
  const dy  = _swipeTouchStartY - t.clientY;   // positive = swiped upward
  if (dy > 60 && dx < 50) _tryFireMissile();
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') _tryFireMissile();
});

/** Howler sound instances for laser fire during combat. */
const laserSounds = {
  pulse_laser:    new Howl({ src: ['/audio/laser-pulse.mp3'],    volume: 0.7 }),
  beam_laser:     new Howl({ src: ['/audio/laser-beam.mp3'],     volume: 0.7 }),
  military_laser: new Howl({ src: ['/audio/laser-military.mp3'], volume: 0.7 }),
  alien:          new Howl({ src: ['/audio/laser-alien.mp3'],    volume: 0.7 }),
  pirates:        new Howl({ src: ['/audio/laser-pirates.mp3'],  volume: 0.7 }),
};

/** Howler sound instances for ship/asteroid explosions. */
const explosionSounds = {
  player:   new Howl({ src: ['/audio/explosion-player.mp3'],   volume: 0.9 }),
  alien:    new Howl({ src: ['/audio/explosion-alien.mp3'],    volume: 0.8 }),
  asteroid: new Howl({ src: ['/audio/explosion-asteroid.mp3'], volume: 0.7 }),
  pirates:  new Howl({ src: ['/audio/explosion-pirates.mp3'],  volume: 0.8 }),
};

/** Howler sound instance for the Blue Danube docking music. */
const blueDanubeSound = new Howl({
  src:    ['/audio/blue-danube.mp3'],
  loop:   true,
  volume: 0.6,
});

/** Howler sound instance for station ambience (loops while the player is docked). */
const stationAmbienceSound = new Howl({
  src:    ['/audio/station-ambience.mp3'],
  loop:   true,
  volume: 0.4,
});

/** Howler sound instance for the station-exit / launch sound effect. */
const stationExitSound = new Howl({
  src:    ['/audio/station-exit.mp3'],
  volume: 1.0,
});

/** Howler sound instance for the mining laser beam (loops while actively mining an asteroid). */
const miningLaserSound = new Howl({
  src:    ['/audio/laser-mining.mp3'],
  loop:   true,
  volume: 0.6,
});

/** Howler sound instance for in-flight background music (flight, mining, combat). */
const spaceFlyingSound = new Howl({
  src:    ['/audio/space-flying.mp3'],
  loop:   true,
  volume: 0.5,
});

/** Howler sound instance for UI button clicks. */
const buttonClickSound = new Howl({
  src:    ['/audio/button1.mp3'],
  volume: 0.8,
});

/** Howler sound instance for failed/blocked UI actions (e.g. insufficient funds). */
const buttonErrorSound = new Howl({
  src:    ['/audio/button2.mp3'],
  volume: 0.8,
});

/** Howler sound instance for selecting a planet on the galactic map. */
const buttonSelectSound = new Howl({
  src:    ['/audio/button3.mp3'],
  volume: 0.8,
});

/** Howler sound instance for combat warning when a combat encounter modal opens. */
const warningCombatSound = new Howl({
  src:    ['/audio/warning-combat.mp3'],
  volume: 1.0,
});

/** Howler sound instance played when collecting cargo from destroyed ships or asteroids. */
const collectSound = new Howl({
  src:    ['/audio/collect.mp3'],
  volume: 0.8,
});

const missileLaunchSound = new Howl({
  src:    ['/audio/missile-launch.mp3'],
  volume: 0.9,
});

const missileWarningSound = new Howl({
  src:    ['/audio/missile-warning.mp3'],
  volume: 1.0,
});

/** All sounds with their base volumes, used to scale against the user's game volume setting. */
const SFX_SOUNDS = [
  [laserSounds.pulse_laser,    0.7],
  [laserSounds.beam_laser,     0.7],
  [laserSounds.military_laser, 0.7],
  [laserSounds.alien,          0.7],
  [laserSounds.pirates,        0.7],
  [explosionSounds.player,     0.9],
  [explosionSounds.alien,      0.8],
  [explosionSounds.asteroid,   0.7],
  [explosionSounds.pirates,    0.8],
  [blueDanubeSound,            0.6],
  [stationAmbienceSound,       0.4],
  [stationExitSound,           1.0],
  [miningLaserSound,           0.6],
  [spaceFlyingSound,           0.5],
  [buttonClickSound,           0.8],
  [buttonErrorSound,           0.8],
  [buttonSelectSound,          0.8],
  [warningCombatSound,         1.0],
  [collectSound,               0.8],
  [missileLaunchSound,         0.9],
  [missileWarningSound,        1.0],
];

let sfxVolume = parseFloat(localStorage.getItem(SFX_VOLUME_KEY) ?? '1');

function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  SFX_SOUNDS.forEach(([sound, base]) => sound.volume(base * sfxVolume));
  localStorage.setItem(SFX_VOLUME_KEY, String(sfxVolume));
}

// Apply persisted volume on startup.
setSfxVolume(sfxVolume);

// Play button click sound for any button in the UI layer via event delegation.
// Market buy/sell buttons (.mkt-btn) and equipment fuel/hull buttons (.equip-fuel-btn)
// manage their own sounds inside their respective handlers.
document.getElementById('ui-layer').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn && !btn.disabled && !btn.classList.contains('mkt-btn') && !btn.classList.contains('equip-fuel-btn')) {
    buttonClickSound.play();
  }
});

/** Asteroids active during the current flight leg. */
let _flightAsteroids   = [];
let _asteroidSpawnTimer = 0;   // ms until next spawn
let _asteroidHitFlash  = 0;    // ms remaining for white-flash hit effect
let _asteroidHitMsg    = null; // { text, until } — on-screen damage notification
let _sparks            = [];   // Spark particles from asteroid impacts
let _miningDrops       = [];   // MiningDrop pods ejected from mined asteroids

window.addEventListener('resize', () => {
  starfield.resize(canvas.width, canvas.height);
});

/** Initialise a new flight leg. Called once when flight screen starts. */
function _initFlightState() {
  // 30–60 s flight duration; distRemaining is drained by dt (ms) each frame
  const baseDist  = 45000;  // midpoint 45 s (ms units)
  const variance  = Math.floor((Math.random() * 2 - 1) * 15000);  // ±15 s
  flightState.totalDist     = baseDist + variance;
  flightState.distRemaining = flightState.totalDist;
  flightState.lastTimestamp  = 0;

  // Reset asteroid hazard state for the new leg
  _flightAsteroids   = [];
  _asteroidSpawnTimer = ASTEROID_SPAWN_MIN + Math.random() * (ASTEROID_SPAWN_MAX - ASTEROID_SPAWN_MIN);
  _asteroidHitFlash  = 0;
  _asteroidHitMsg    = null;
  _sparks            = [];
  _miningDrops       = [];

  // Reset combat state for the new leg
  _activeCombat     = null;
  _combatPaused     = false;
  _combatStatusMsg  = null;
  _flightKills      = 0;
  _flightEncounters = 0;

  // Schedule 0–3 combat encounters at random points (between 12% and 88% of flight)
  const numCombats = Math.floor(Math.random() * 4);  // 0, 1, 2, or 3
  _flightCombatSchedule = [];
  const minDist = flightState.totalDist * 0.12;
  const maxDist = flightState.totalDist * 0.88;
  for (let i = 0; i < numCombats; i++) {
    // distRemaining decreases, so trigger when it falls below a threshold
    const threshold = minDist + Math.random() * (maxDist - minDist);
    _flightCombatSchedule.push(threshold);
  }
  // Sort descending so we can pop() the next trigger (smallest distRemaining first)
  _flightCombatSchedule.sort((a, b) => b - a);
}

/** Return the best laser equipped by the player, or null if none. */
function _getActiveLaser() {
  if (gameState.equipment.military_laser) return 'military_laser';
  if (gameState.equipment.beam_laser)    return 'beam_laser';
  if (gameState.equipment.pulse_laser)   return 'pulse_laser';
  return null;
}

/** Return true if the player has a mining laser installed. */
function _hasMiningLaser() {
  return (gameState.equipment.mining_laser ?? 0) > 0;
}

/**
 * Draw a continuous mining laser beam from (x1,y1) to (x2,y2).
 * Uses a glow + core layer to simulate a solid energy beam.
 */
function _drawMiningBeam(targetCtx, x1, y1, x2, y2) {
  const flicker = 0.70 + Math.random() * 0.30;

  targetCtx.save();
  targetCtx.lineCap = 'round';

  // Outer soft glow
  targetCtx.strokeStyle = `rgba(255,255,255,0.12)`;
  targetCtx.lineWidth   = 8;
  targetCtx.beginPath();
  targetCtx.moveTo(x1, y1);
  targetCtx.lineTo(x2, y2);
  targetCtx.stroke();

  // Mid halo
  targetCtx.strokeStyle = `rgba(255,255,255,0.22)`;
  targetCtx.lineWidth   = 4;
  targetCtx.beginPath();
  targetCtx.moveTo(x1, y1);
  targetCtx.lineTo(x2, y2);
  targetCtx.stroke();

  // Bright core
  targetCtx.strokeStyle = `rgba(255,255,255,${flicker.toFixed(2)})`;
  targetCtx.lineWidth   = 1.5;
  targetCtx.beginPath();
  targetCtx.moveTo(x1, y1);
  targetCtx.lineTo(x2, y2);
  targetCtx.stroke();

  // Impact glow at asteroid
  targetCtx.fillStyle = `rgba(255,255,255,${(flicker * 0.75).toFixed(2)})`;
  targetCtx.beginPath();
  targetCtx.arc(x2, y2, 2 + Math.random() * 3, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.restore();
}

/**
 * Show the HTML combat-imminent modal, then invoke onChoice with the
 * player's decision.
 * @param {{ type: string, ships: string[] }} scenario
 * @param {function} onChoice — called with { action: 'fight'|'surrender'|'ignore' }
 */
function _showCombatModal(scenario, onChoice) {
  warningCombatSound.play();
  const type = scenario.type;

  // Build ship name list
  const shipNames = scenario.ships
    .map(id => SHIP_CATALOG[id]?.name ?? id)
    .join(', ');

  let titleText, bodyText;
  if (type === 'pirate') {
    titleText = 'HOSTILE CONTACT';
    bodyText  = `PROXIMITY ALERT: PIRATE VESSEL${scenario.ships.length > 1 ? 'S' : ''} DETECTED.\n${shipNames}\nTHEY ARE MOVING TO INTERCEPT.`;
  } else if (type === 'trader') {
    titleText = 'VESSEL DETECTED';
    bodyText  = `A TRADE VESSEL HAS ENTERED SCANNER RANGE.\n${shipNames}`;
  } else {
    titleText = '!! ALIEN CONTACT !!';
    bodyText  = `THARGOID INVASION CRAFT INCOMING.\nEVASION NOT POSSIBLE.`;
  }

  const hasCargo    = _usedCargo() > 0;
  const showSurrender = type === 'pirate' && hasCargo;
  const showIgnore    = type === 'trader';

  const overlay = document.createElement('div');
  overlay.id        = 'combat-modal-overlay';
  overlay.className = 'modal-overlay combat-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Combat encounter');
  overlay.innerHTML = `
    <div class="modal-box panel combat-modal-box">
      <div class="combat-modal-type combat-type--${type}">${titleText}</div>
      <p class="combat-modal-body" id="combat-modal-body-text"></p>
      <div class="combat-modal-btns">
        <button class="station-btn combat-modal-btn" id="combat-btn-fight">&#9658;&nbsp; ${type === 'trader' ? 'ATTACK' : 'FIGHT'}</button>
        ${showSurrender ? `<button class="station-btn combat-modal-btn" id="combat-btn-surrender">&#9658;&nbsp; SURRENDER CARGO</button>` : ''}
        ${showIgnore    ? `<button class="station-btn combat-modal-btn combat-modal-btn--dim" id="combat-btn-ignore">&#9658;&nbsp; IGNORE</button>` : ''}
      </div>
    </div>
  `;

  // Insert body text safely
  document.getElementById && uiLayer.appendChild(overlay);
  document.getElementById('combat-modal-body-text').textContent = bodyText;

  const dismiss = (action) => {
    overlay.remove();
    onChoice({ action });
  };

  document.getElementById('combat-btn-fight')?.addEventListener('click', () => dismiss('fight'));
  document.getElementById('combat-btn-surrender')?.addEventListener('click', () => dismiss('surrender'));
  document.getElementById('combat-btn-ignore')?.addEventListener('click', () => dismiss('ignore'));
}

/**
 * Trigger a combat encounter during flight.
 * Pauses distance drain, shows modal, then either starts canvas combat or
 * resolves non-combat outcomes directly.
 */
/** Fire a missile if the player has one and combat is active. */
function _tryFireMissile() {
  if (!_activeCombat || _activeCombat.phase !== 'fighting' || _activeCombat.playerBlownUp) return;
  const count = gameState.equipment.missile ?? 0;
  if (count <= 0) { buttonErrorSound.play(); return; }
  gameState.equipment.missile = count - 1;
  _activeCombat.fireMissile(player.x, player.y);
  missileLaunchSound.play();
  saveGame();
}

function _triggerCombatEncounter(scenarioOverride = null) {
  _combatPaused     = true;
  _flightEncounters += 1;
  gameState.stats.combatEncounters += 1;
  miningLaserSound.stop();

  // Clear asteroids when combat starts — they'd be distracting
  _flightAsteroids = [];
  _sparks          = [];
  _miningDrops     = [];
  _asteroidHitFlash = 0;

  const system   = gameState.destinationSystem ?? gameState.currentSystem;
  const scenario = scenarioOverride ?? generateCombatScenario(system);

  _encounterType    = scenario.type;
  _encounterShips   = scenario.ships.map(id => SHIP_CATALOG[id]?.name ?? id);
  _encounterHullDmg = 0;
  _encounterCargo   = {};

  _showCombatModal(scenario, ({ action }) => {
    if (action === 'fight') {
      // Start canvas combat
      _activeCombat = new CombatEncounter(scenario, {
        onPlayerDamaged(damage) {
          // Absorb with shields first, then hull
          let remaining = damage;
          if (gameState.shields > 0) {
            const absorbed = Math.min(gameState.shields, remaining);
            gameState.shields = Math.max(0, gameState.shields - absorbed);
            remaining -= absorbed;
          }
          if (remaining > 0) {
            _encounterHullDmg += remaining;
            gameState.hull   = Math.max(0, gameState.hull - remaining);
            _asteroidHitFlash = 320;
            _asteroidHitMsg   = {
              text:  `HULL HIT  \u2212${remaining}%`,
              until: performance.now() + 2000,
            };
          } else {
            _asteroidHitMsg = {
              text:  'SHIELDS ABSORB HIT',
              until: performance.now() + 1200,
            };
          }
          if (gameState.hull <= 0) {
            _activeCombat?.playerDestroyed();
          }
          saveGame();
        },
        onCargoCollected(commodityId) {
          const used = _usedCargo();
          if (used < gameState.cargoCapacity) {
            gameState.inventory[commodityId] = (gameState.inventory[commodityId] ?? 0) + 1;
            _encounterCargo[commodityId] = (_encounterCargo[commodityId] ?? 0) + 1;
            _combatStatusMsg = { text: 'CARGO COLLECTED', until: performance.now() + 1500 };
            collectSound.play();
            saveGame();
          }
        },
        onShipDestroyed(shipData) {
          gameState.stats.kills += 1;
          _flightKills          += 1;
          if (shipData.type === 'pirate' && shipData.bounty > 0) {
            gameState.pendingBounties.push({ name: shipData.name, bounty: shipData.bounty });
          }
          saveGame();
        },
        onPlayerFire(laserType) {
          laserSounds[laserType]?.play();
        },
        onEnemyFire(enemyType, weaponType) {
          if (enemyType === 'alien') {
            laserSounds.alien.play();
          } else {
            laserSounds[weaponType]?.play();
          }
        },
        onEnemyMissileWarning() {
          missileWarningSound.play();
        },
        onEnemyMissileLaunch() {
          missileLaunchSound.play();
        },
        onPlayerExplode() {
          explosionSounds.player.play();
        },
        onEnemyExplode(enemyType) {
          if (enemyType === 'alien') {
            explosionSounds.alien.play();
          } else {
            explosionSounds.pirates.play();
          }
        },
        onComplete(outcome) {
          // Handled each frame in the game loop by checking _activeCombat.done
        },
      });
      _activeCombat.start(canvas.width, canvas.height);
      _combatPaused = false;  // flight resumes (distance still paused while combat active)

    } else if (action === 'surrender') {
      // Transfer a portion of cargo to the pirates
      const totalCargo  = _usedCargo();
      const transferAmt = Math.max(1, Math.min(totalCargo, Math.ceil(totalCargo / 3)));
      let   removed     = 0;
      for (const itemId of Object.keys(gameState.inventory)) {
        if (removed >= transferAmt) break;
        const qty      = gameState.inventory[itemId];
        const toRemove = Math.min(qty, transferAmt - removed);
        gameState.inventory[itemId] -= toRemove;
        if (gameState.inventory[itemId] <= 0) delete gameState.inventory[itemId];
        removed += toRemove;
      }
      saveGame();
      _logCombatEncounter(scenario.type, _encounterShips, 'surrender', 0, {});
      _combatStatusMsg = { text: 'CARGO SURRENDERED \u2014 PIRATES WITHDRAWING', until: performance.now() + 3200 };
      _combatPaused    = false;

    } else {
      // Ignore trader / no action
      _combatStatusMsg = { text: 'VESSEL ACKNOWLEDGED \u2014 PASSING', until: performance.now() + 2400 };
      _combatPaused    = false;
    }
  });
}

// ─── RPG Event System ─────────────────────────────────────────────────────────

/**
 * Generic RPG dice-roll modal. Designed for reuse across all future RPG events.
 *
 * @param {object}   config
 * @param {string}   config.title       — modal heading
 * @param {string}   [config.subtitle]  — optional subtitle / flavour line
 * @param {string}   config.narrative   — body text (use \n for line breaks; programmer-controlled only)
 * @param {number}   [config.diceCount=2] — number of dice to roll
 * @param {number}   [config.diceSides=6] — faces per die
 * @param {string}   [config.rollLabel='ROLL DICE'] — roll button label
 * @param {function} config.onRoll(total, rolls) — called with result; must return
 *                   { outcome: 'success'|'failure', message: string }
 * @param {function} config.onClose()   — called after the player dismisses the result
 */
function showRpgDiceModal(config) {
  const diceCount = config.diceCount ?? 2;
  const diceSides = config.diceSides ?? 6;
  const rollLabel = config.rollLabel ?? 'ROLL DICE';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay rpg-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const diceHtml = Array.from({ length: diceCount }, (_, i) =>
    `<div class="rpg-die" id="rpg-die-${i}" aria-label="Die ${i + 1}">?</div>`
  ).join('');

  // NOTE: narrative, title, and subtitle are always programmer-controlled strings — no user data.
  overlay.innerHTML = `
    <div class="modal-box panel rpg-modal-box">
      <h2 class="rpg-modal-title"></h2>
      <p class="modal-subtitle rpg-modal-subtitle"></p>
      <p class="rpg-narrative" id="rpg-narrative"></p>
      <div class="rpg-dice-row">${diceHtml}</div>
      <div class="rpg-dice-total hidden" id="rpg-dice-total"></div>
      <p class="rpg-result-msg hidden" id="rpg-result-msg"></p>
      <button class="station-btn rpg-roll-btn" id="rpg-roll-btn">&#9658;&nbsp; <span id="rpg-roll-label"></span></button>
      <button class="station-btn rpg-close-btn hidden" id="rpg-close-btn">&#9658;&nbsp; ACKNOWLEDGED</button>
    </div>
  `;

  uiLayer.appendChild(overlay);

  // Populate via textContent to ensure safety for any future caller that might pass user-derived text
  overlay.querySelector('.rpg-modal-title').textContent = config.title;
  const subtitleEl = overlay.querySelector('.rpg-modal-subtitle');
  if (config.subtitle) {
    subtitleEl.textContent = config.subtitle;
  } else {
    subtitleEl.classList.add('hidden');
  }
  // Narrative: split on \n and insert as text nodes with <br> separators
  const narrativeEl = document.getElementById('rpg-narrative');
  config.narrative.split('\n').forEach((line, idx, arr) => {
    narrativeEl.appendChild(document.createTextNode(line));
    if (idx < arr.length - 1) narrativeEl.appendChild(document.createElement('br'));
  });
  document.getElementById('rpg-roll-label').textContent = rollLabel;

  const rollBtn  = document.getElementById('rpg-roll-btn');
  const closeBtn = document.getElementById('rpg-close-btn');
  const totalEl  = document.getElementById('rpg-dice-total');
  const resultEl = document.getElementById('rpg-result-msg');
  const diceEls  = Array.from({ length: diceCount }, (_, i) => document.getElementById(`rpg-die-${i}`));

  rollBtn.addEventListener('click', () => {
    rollBtn.disabled = true;
    diceEls.forEach(el => el.classList.add('rpg-die--rolling'));

    const ANIM_DURATION = 1600;  // ms total animation
    const ANIM_INTERVAL = 75;    // ms between rapid-cycle frames
    const startTime = performance.now();

    const animId = setInterval(() => {
      diceEls.forEach(el => {
        el.textContent = Math.ceil(Math.random() * diceSides);
      });

      if (performance.now() - startTime >= ANIM_DURATION) {
        clearInterval(animId);

        // Settle on final values
        const rolls = Array.from({ length: diceCount }, () =>
          Math.floor(Math.random() * diceSides) + 1
        );
        diceEls.forEach((el, i) => {
          el.textContent = rolls[i];
          el.classList.remove('rpg-die--rolling');
          el.classList.add('rpg-die--settled');
        });

        const total = rolls.reduce((s, v) => s + v, 0);
        totalEl.textContent = `TOTAL: ${total}`;
        totalEl.classList.remove('hidden');

        const result = config.onRoll(total, rolls);
        resultEl.textContent = result.message;
        resultEl.classList.remove('hidden');
        resultEl.classList.add(
          result.outcome === 'success' ? 'rpg-result--success' : 'rpg-result--failure'
        );

        rollBtn.classList.add('hidden');
        closeBtn.classList.remove('hidden');
      }
    }, ANIM_INTERVAL);
  });

  closeBtn.addEventListener('click', () => {
    overlay.remove();
    config.onClose();
  });
}

/**
 * Check if the player is carrying illegal cargo and, if so, run the Station Security
 * inspection RPG event. Calls onComplete when done regardless of outcome.
 *
 * @param {function} onComplete — called after the modal is dismissed (or immediately if no contraband)
 */
function _checkContrabandInspection(onComplete) {
  const illegalItems = Object.entries(gameState.inventory)
    .filter(([id, qty]) => qty > 0 && ILLEGAL_CARGO_IDS.has(Number(id)))
    .map(([id, qty]) => ({ id: Number(id), qty: Number(qty) }));

  if (illegalItems.length === 0) {
    onComplete();
    return;
  }

  const totalUnits = illegalItems.reduce((s, item) => s + item.qty, 0);
  const itemNames  = illegalItems.map(item => {
    const c = COMMODITIES.find(c => c.id === item.id);
    return c ? c.name : 'Unknown';
  }).join(', ');

  showRpgDiceModal({
    title:    'SECURITY INSPECTION',
    subtitle: 'STATION AUTHORITY — CONTRABAND DETECTION UNIT',
    narrative: `Your ship has been boarded by the Station's Security Team.\n\nA full search and inspection of your cargo hold is now underway.\n\nFlagged items detected: ${itemNames} (${totalUnits}t).\n\nRoll 2d6 — a score of 7 or higher means the inspection team find nothing of interest.`,
    diceCount: 2,
    diceSides: 6,
    rollLabel: 'ROLL DICE',
    onRoll: (total) => {
      const sys = gameState.currentSystem;
      const sysName = sys ? sys.name.toUpperCase() : 'UNKNOWN STATION';
      if (total <= 6) {
        const fine = Math.floor(gameState.credits / 2);
        illegalItems.forEach(item => { delete gameState.inventory[item.id]; });
        gameState.credits = Math.max(0, gameState.credits - fine);
        gameState.commanderLog.push({
          id:           gameState.commanderLog.length + 1,
          stardate:     _getStardate(),
          title:        'SECURITY INSPECTION — CONTRABAND SEIZED',
          body:         `Boarded by the Station Authority Contraband Detection Unit on arrival at ${sysName}. A search of the hold uncovered ${totalUnits}t of prohibited goods (${itemNames}).\n\nCargo confiscated. A fine of ${fine} CR levied against the ship's account — half of available funds. Current credits: ${Math.max(0, gameState.credits)} CR.\n\nNote to self: travel clean next time, or roll better.`,
          creditsChange: -fine,
        });
        saveGame();
        const creditsEl = document.getElementById('station-credits');
        if (creditsEl) creditsEl.textContent = `${gameState.credits}.0 CR`;
        return {
          outcome: 'failure',
          message: `CONTRABAND FOUND. ${totalUnits}t confiscated. Fine issued: ${fine} CR. New balance: ${gameState.credits} CR.`,
        };
      } else {
        gameState.commanderLog.push({
          id:           gameState.commanderLog.length + 1,
          stardate:     _getStardate(),
          title:        'SECURITY INSPECTION — CLEARED',
          body:         `Station Authority boarded at ${sysName} and conducted a full search of the cargo hold. Inspection team found nothing of interest. All ${totalUnits}t of flagged cargo remained undetected.\n\nFree to proceed. No fine issued. Credits unaffected.`,
          creditsChange: null,
        });
        saveGame();
        return {
          outcome: 'success',
          message: 'INSPECTION COMPLETE. Nothing of interest found. You are free to proceed.',
        };
      }
    },
    onClose: onComplete,
  });
}

// ─── Bounty Modal ─────────────────────────────────────────────────────────────

/**
 * Show a bounty-claim modal after docking.
 * Credits have already been added to gameState before this is called.
 */
function _showBountyModal(bounties, totalCr, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Bounty reward');

  const rowsHtml = bounties.map(b => `
    <div class="bounty-row">
      <span class="bounty-name"></span>
      <span class="bounty-amount">${b.bounty}&nbsp;CR</span>
    </div>`).join('');

  overlay.innerHTML = `
    <div class="modal-box panel bounty-modal-box">
      <h2>BOUNTIES CLAIMED</h2>
      <p class="modal-subtitle">PIRATE KILLS VERIFIED BY NAVCOM</p>
      <div class="bounty-list" id="bounty-list-rows">${rowsHtml}</div>
      <div class="bounty-total">TOTAL REWARD: <span>${totalCr}</span>&nbsp;CR</div>
      <button id="bounty-ok-btn" class="station-btn">&#9658;&nbsp; CLAIM REWARD</button>
    </div>
  `;

  uiLayer.appendChild(overlay);

  // Set names safely via textContent
  const nameEls = overlay.querySelectorAll('.bounty-name');
  bounties.forEach((b, i) => { nameEls[i].textContent = b.name; });

  document.getElementById('bounty-ok-btn').addEventListener('click', () => {
    overlay.remove();
    onClose();
  });
}

/** Show the docking tutorial modal, then invoke onDismiss once the player closes it. */
function _showDockingHelpModal(onDismiss) {
  const overlay = document.createElement('div');
  overlay.id        = 'dock-help-overlay';
  overlay.className = 'modal-overlay map-help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Docking help');
  overlay.innerHTML = `
    <div class="modal-box panel map-help-box">
      <h2>DOCKING PROCEDURE</h2>
      <p class="map-help-body">The station emits expanding hexagonal pulse rings. Catch three pulses in a row to dock.</p>
      <ul class="map-help-list">
        <li>&#9658; Watch the <strong>station</strong> at the top — it pulses rings outward toward your ship.</li>
        <li>&#9658; A <strong>target zone</strong> (white hexagonal outline) marks the docking corridor around your ship.</li>
        <li>&#9658; Press <strong>SPACE</strong> or <strong>tap</strong> exactly when a pulse ring passes through the target zone.</li>
        <li>&#9658; Catch <strong>3 pulses in a row</strong> to dock. A missed catch resets your streak.</li>
        <li>&#9658; You have <strong>28 seconds</strong> before the docking window closes.</li>
      </ul>
      <div class="map-help-footer">
        <label class="map-help-check-label">
          <span class="map-help-checkbox-wrap">
            <input type="checkbox" id="dock-help-no-show" class="map-help-checkbox">
            <span class="map-help-checkbox-custom" aria-hidden="true"></span>
          </span>
          DON'T SHOW AGAIN
        </label>
        <button id="dock-help-ok" class="station-btn map-help-ok-btn">&#9658;&nbsp; UNDERSTOOD</button>
      </div>
    </div>
  `;

  uiLayer.appendChild(overlay);

  document.getElementById('dock-help-ok').addEventListener('click', () => {
    if (document.getElementById('dock-help-no-show').checked) {
      localStorage.setItem(DOCK_HELP_KEY, '1');
    }
    overlay.remove();
    onDismiss();
  });
}

/** Begin the docking mini-game, transitioning from flight. */
function _startDocking() {
  gameState.screen  = 'docking';
  uiLayer.innerHTML = '';
  miningLaserSound.stop();
  spaceFlyingSound.stop();
  blueDanubeSound.play();

  // If the docking computer is installed, skip the mini-game and play the
  // automated docking animation instead.
  if (gameState.equipment.dock_computer) {
    dockingComputerAnim = new DockingComputerAnimation(() => {
      blueDanubeSound.stop();
      gameState.currentSystem     = gameState.destinationSystem ?? gameState.currentSystem;
      gameState.destinationSystem = null;
      gameState.fuel              = Math.max(0, gameState.fuel - 10);
      if (gameState.equipment.shield_generator) gameState.shields = 100;
      gameState.stats.flightsCompleted += 1;
      dockingComputerAnim = null;
      _markVisited(gameState.currentSystem);

      const pendingBounties = [...(gameState.pendingBounties ?? [])];
      gameState.pendingBounties = [];
      const totalBounty = pendingBounties.reduce((s, b) => s + b.bounty, 0);
      if (totalBounty > 0) gameState.credits += totalBounty;

      saveGame();
      _stationVisit = {
        system:              gameState.currentSystem,
        creditsOnArrival:    gameState.credits,
        trades:              [],
        flightKills:         _flightKills,
        flightEncounters:    _flightEncounters,
      };

      showStationScreen();
      if (pendingBounties.length > 0) {
        _showBountyModal(pendingBounties, totalBounty, () => {
          _checkContrabandInspection(() => {});
        });
      } else {
        _checkContrabandInspection(() => {});
      }
    });
    return;
  }

  const launchGame = () => {
    dockingMinigame = new DockingMinigame(
      // onSuccess
      () => {
        blueDanubeSound.stop();
        gameState.currentSystem    = gameState.destinationSystem ?? gameState.currentSystem;
        gameState.destinationSystem = null;
        // Deduct fuel for the jump (cost already shown at launch; apply a nominal amount)
        gameState.fuel = Math.max(0, gameState.fuel - 10);
        // Recharge shields on docking if shield generator is installed
        if (gameState.equipment.shield_generator) gameState.shields = 100;
        gameState.stats.flightsCompleted += 1;
        dockingMinigame = null;
        _markVisited(gameState.currentSystem);

        // Collect and clear pirate bounties
        const pendingBounties = [...(gameState.pendingBounties ?? [])];
        gameState.pendingBounties = [];
        const totalBounty = pendingBounties.reduce((s, b) => s + b.bounty, 0);
        if (totalBounty > 0) gameState.credits += totalBounty;

        saveGame();
        // Snapshot this docking so trade activity here is recorded in the departure log
        _stationVisit = {
          system:              gameState.currentSystem,
          creditsOnArrival:    gameState.credits,
          trades:              [],
          flightKills:         _flightKills,
          flightEncounters:    _flightEncounters,
        };

        showStationScreen();
        if (pendingBounties.length > 0) {
          _showBountyModal(pendingBounties, totalBounty, () => {
            _checkContrabandInspection(() => {});
          });
        } else {
          _checkContrabandInspection(() => {});
        }
      },
      // onFail — failed docking collision (hull damage; lethal if hull already < 50%)
      () => {
        blueDanubeSound.stop();
        gameState.currentSystem     = gameState.destinationSystem ?? gameState.currentSystem;
        gameState.destinationSystem = null;
        dockingMinigame = null;
        _markVisited(gameState.currentSystem);

        // If hull is at or below 50% the impact is fatal (damage would reach 0)
        if (gameState.hull <= 50) {
          gameState.hull = 0;
          _handlePlayerDeath();
          return;
        }

        // Otherwise take 50% hull damage and proceed to station
        gameState.hull = Math.max(0, gameState.hull - 50);

        gameState.commanderLog.push({
          id:           gameState.commanderLog.length + 1,
          stardate:     _getStardate(),
          title:        'DOCKING COLLISION',
          body:         `Carrier signal lost during final approach to ${gameState.currentSystem?.name ?? 'station'}. Ship clipped the docking port before emergency systems could guide her in. Hull integrity reduced to ${gameState.hull}%. Structural repairs required.`,
          creditsChange: null,
        });

        // Recharge shields on docking even on fail
        if (gameState.equipment.shield_generator) gameState.shields = 100;
        gameState.stats.flightsCompleted += 1;

        // Collect and clear pirate bounties
        const pendingBounties = [...(gameState.pendingBounties ?? [])];
        gameState.pendingBounties = [];
        const totalBounty = pendingBounties.reduce((s, b) => s + b.bounty, 0);
        if (totalBounty > 0) gameState.credits += totalBounty;

        saveGame();
        // Snapshot even on failed docking (penalty already applied)
        _stationVisit = {
          system:           gameState.currentSystem,
          creditsOnArrival: gameState.credits,
          trades:           [],
          flightKills:      _flightKills,
          flightEncounters: _flightEncounters,
        };

        showStationScreen();

        // Show collision damage warning before bounty/inspection flow
        const dockFailOverlay = document.createElement('div');
        dockFailOverlay.className = 'modal-overlay';
        dockFailOverlay.setAttribute('role', 'dialog');
        dockFailOverlay.setAttribute('aria-modal', 'true');
        dockFailOverlay.setAttribute('aria-label', 'Docking collision');
        dockFailOverlay.innerHTML = `
          <div class="modal-box panel">
            <h2>DOCKING COLLISION</h2>
            <p class="modal-subtitle">CARRIER SIGNAL LOST</p>
            <p>Your ship clipped the docking port during approach. Station emergency systems guided you in, but not before significant structural damage was sustained.</p>
            <p>Hull integrity reduced to <strong>${gameState.hull}%</strong>. Repairs are strongly advised before your next jump.</p>
            <button class="station-btn" id="dock-fail-continue" style="margin-top:1.25rem;width:100%;">&#9658;&nbsp; ACKNOWLEDGED</button>
          </div>
        `;
        uiLayer.appendChild(dockFailOverlay);

        document.getElementById('dock-fail-continue').addEventListener('click', () => {
          dockFailOverlay.remove();
          if (pendingBounties.length > 0) {
            _showBountyModal(pendingBounties, totalBounty, () => {
              _checkContrabandInspection(() => {});
            });
          } else {
            _checkContrabandInspection(() => {});
          }
        });
      },
    );
  };

  if (!localStorage.getItem(DOCK_HELP_KEY)) {
    _showDockingHelpModal(launchGame);
  } else {
    launchGame();
  }
}

function gameLoop(timestamp) {
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Launch animation sequence
  if (gameState.screen === 'launching' && launchSequence) {
    launchSequence.update(ctx, canvas.width, canvas.height, timestamp);
  }

  // Starfield + player + HUD only during active flight
  if (gameState.screen === 'flight') {
    // Initialise flightState on first frame of this leg
    if (flightState.lastTimestamp === 0) {
      _initFlightState();
      flightState.lastTimestamp = timestamp;
    }

    const dt = timestamp - flightState.lastTimestamp;
    flightState.lastTimestamp = timestamp;

    // Only drain distance when not paused (modal open) and no active combat
    if (!_combatPaused && !_activeCombat) {
      flightState.distRemaining = Math.max(0, flightState.distRemaining - dt);
    }

    starfield.update();
    starfield.draw(ctx);

    // After player destruction: show only the scrolling starfield until the
    // death modal is dismissed and the screen transitions.
    if (_deathStarfieldActive) {
      // starfield already drawn above — nothing else to render
    } else {

    const _dtSec = dt / 1000;

    if (!_activeCombat) {
      // ── Normal flight: asteroids and collision detection ─────────────────

      _asteroidSpawnTimer -= dt;
      if (_asteroidSpawnTimer <= 0 && !_combatPaused && _flightAsteroids.length < 3) {
        const count = 1 + Math.floor(Math.random() * 3);  // 1–3
        const toSpawn = Math.min(count, 3 - _flightAsteroids.length);
        for (let i = 0; i < toSpawn; i++) {
          _flightAsteroids.push(new Asteroid(canvas.width, _hasMiningLaser()));
        }
        _asteroidSpawnTimer = ASTEROID_SPAWN_MIN + Math.random() * (ASTEROID_SPAWN_MAX - ASTEROID_SPAWN_MIN);
      }
      // ── Mining laser: beam fires straight ahead; player must line up ────────
      // The beam travels vertically upward from the ship's nose. An asteroid is
      // "hit" only when the player's x is within the asteroid's radius of its
      // centre. Progress resets if the player steers away.
      let _miningTarget = null;
      if (_hasMiningLaser() && !_combatPaused) {
        let _minDist = Infinity;
        for (const ast of _flightAsteroids) {
          if (ast.hit || ast.mined) continue;
          if (ast.y >= player.y) continue;                              // must be above player
          if (Math.abs(ast.x - player.x) > ast.radius * 0.9) continue; // beam misses horizontally
          const _dy = player.y - ast.y;
          if (_dy < _minDist) { _minDist = _dy; _miningTarget = ast; }
        }
        // Reset progress on any asteroid that is no longer in the beam path
        for (const ast of _flightAsteroids) {
          if (ast !== _miningTarget && ast.mineProgress > 0) ast.mineProgress = 0;
        }
        if (_miningTarget) {
          if (!miningLaserSound.playing()) miningLaserSound.play();
          const _newProg = _miningTarget.mineProgress + _dtSec / MINING_LASER_TIME;
          if (_newProg >= 1) {
            _miningTarget.mineProgress = 1;
            _miningTarget.mined        = true;
            explosionSounds.asteroid.play();
            // Spawn 1–3 resource pods at the asteroid's position
            const _dropCount = 1 + Math.floor(Math.random() * 3);
            for (let _mi = 0; _mi < _dropCount; _mi++) {
              const _cid = MINING_CARGO_POOL[Math.floor(Math.random() * MINING_CARGO_POOL.length)];
              _miningDrops.push(new MiningDrop(_miningTarget.x, _miningTarget.y, _cid));
            }
            // Destruction sparks
            const _spCnt = 24 + Math.floor(Math.random() * 14);
            for (let _mi = 0; _mi < _spCnt; _mi++) {
              _sparks.push(new Spark(_miningTarget.x, _miningTarget.y));
            }
            _asteroidHitFlash = 200;
            _miningTarget = null;   // no beam termination point this frame — beam fires to top
          } else {
            _miningTarget.mineProgress = _newProg;
          }
        } else {
          if (miningLaserSound.playing()) miningLaserSound.stop();
        }
      }

      for (const ast of _flightAsteroids) {
        ast.update(_dtSec, canvas.width);
        if (!ast.mined) ast.draw(ctx);
      }

      // Mining drops: advance position and render beneath the player ship
      for (const drop of _miningDrops) drop.update(_dtSec);
      for (const drop of _miningDrops) drop.draw(ctx);

      // Draw mining beam only when locked on to a target asteroid
      if (_hasMiningLaser() && !_combatPaused && _miningTarget) {
        _drawMiningBeam(ctx,
          player.x, player.y - PLAYER_HEIGHT * 0.5,
          player.x, _miningTarget.y);
      }

      player.update();
      player.draw(ctx);

      // Collision detection (asteroids vs player) — only when not paused
      if (!_combatPaused) {
        for (const ast of _flightAsteroids) {
          if (!ast.hit && !ast.mined && ast.collidesWithPlayer(player.x, player.y)) {
            ast.hit = true;
            explosionSounds.asteroid.play();
            const dmg = ASTEROID_DMG_MIN + Math.floor(Math.random() * (ASTEROID_DMG_MAX - ASTEROID_DMG_MIN + 1));
            gameState.hull    = Math.max(0, gameState.hull - dmg);
            gameState.stats.asteroidStrikes += 1;
            _asteroidHitFlash = 400;
            _asteroidHitMsg   = { text: `HULL DAMAGE  \u2212${dmg}%`, until: timestamp + 2500 };
            _logAsteroidStrike(dmg);
            const sparkCount = 28 + Math.floor(Math.random() * 18);
            for (let _i = 0; _i < sparkCount; _i++) {
              _sparks.push(new Spark(player.x, player.y));
            }
            if (gameState.hull <= 0) {
              _handlePlayerDeath();
            }
          }
        }
        _flightAsteroids = _flightAsteroids.filter(a => !a.isOffScreen(canvas.height) && !a.mined);

        // Collect mining drops the player flies over
        for (const drop of _miningDrops) {
          if (drop.collected) continue;
          if (drop.collidesWithPlayer(player.x, player.y)) {
            drop.collected = true;
            if (_usedCargo() < gameState.cargoCapacity) {
              gameState.inventory[drop.commodityId] =
                (gameState.inventory[drop.commodityId] ?? 0) + 1;
              const _com   = COMMODITIES.find(c => c.id === drop.commodityId);
              const _cName = _com ? _com.name.toUpperCase() : 'MINERALS';
              _asteroidHitMsg = { text: `${_cName} COLLECTED`, until: performance.now() + 1500 };
              collectSound.play();
              saveGame();
            }
          }
        }
        _miningDrops = _miningDrops.filter(d => !d.collected && !d.isOffScreen(canvas.height));

        // Check combat schedule: trigger when distRemaining drops below threshold,
        // but only when no asteroid is on screen
        if (
          _flightCombatSchedule.length > 0 &&
          _flightAsteroids.length === 0 &&
          flightState.distRemaining > 0
        ) {
          const nextThreshold = _flightCombatSchedule[_flightCombatSchedule.length - 1];
          if (flightState.distRemaining <= nextThreshold) {
            _flightCombatSchedule.pop();
            _triggerCombatEncounter();
          }
        }
      }

    } else {
      // ── Active canvas combat ─────────────────────────────────────────────

      // Player can still steer during combat (hidden once destroyed)
      player.update();
      if (!_activeCombat.playerBlownUp) player.draw(ctx);

      const laserType = _getActiveLaser();
      _activeCombat.update(
        _dtSec,
        player.x, player.y,
        PLAYER_WIDTH, PLAYER_HEIGHT,
        canvas.width, canvas.height,
        laserType,
      );
      _activeCombat.draw(ctx, canvas.width, canvas.height, timestamp, laserType, gameState.equipment.missile ?? 0);

      if (_activeCombat.done) {
        const outcome = _activeCombat.outcome;
        _activeCombat = null;
        _combatPaused = false;
        // Give a grace period before new asteroids spawn
        _asteroidSpawnTimer = Math.max(_asteroidSpawnTimer, 6000);
        if (outcome === 'playerDestroyed') {
          _logCombatEncounter(_encounterType, _encounterShips, outcome, _encounterHullDmg, { ..._encounterCargo });
          saveGame();
          _handlePlayerDeath();
        } else {
          if (outcome === 'victory') {
            _combatStatusMsg = { text: 'HOSTILES ELIMINATED', until: performance.now() + 2200 };
          }
          _logCombatEncounter(_encounterType, _encounterShips, outcome, _encounterHullDmg, { ..._encounterCargo });
          saveGame();
        }
      }
    }

    // ── Sparks ───────────────────────────────────────────────────────────────
    for (const sp of _sparks) { sp.update(_dtSec); sp.draw(ctx); }
    _sparks = _sparks.filter(sp => sp.alive);

    // ── Hit flash overlay ────────────────────────────────────────────────────
    if (_asteroidHitFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${(_asteroidHitFlash / 400) * 0.42})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      _asteroidHitFlash = Math.max(0, _asteroidHitFlash - dt);
    }

    // ── Damage / status notification text ────────────────────────────────────
    const _notifMsg = _combatStatusMsg ?? _asteroidHitMsg;
    if (_notifMsg && performance.now() < _notifMsg.until) {
      const fade = Math.min(1, (_notifMsg.until - performance.now()) / 600);
      ctx.save();
      ctx.globalAlpha  = fade;
      ctx.fillStyle    = '#ffffff';
      ctx.font         = `13px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(_notifMsg.text, canvas.width / 2, (canvas.height - HUD_HEIGHT) * 0.38);
      ctx.restore();
    }

    drawHUD();
    // Only draw flight distance HUD when not in combat (combat has its own top HUD)
    if (!_activeCombat) drawFlightDistanceHUD();

    // Trigger docking when distance reaches zero (and no combat active)
    if (!_activeCombat && !_combatPaused && flightState.distRemaining <= 0) {
      flightState.lastTimestamp = 0;
      _startDocking();
    }
    } // end else (_deathStarfieldActive)
  }

  // Docking mini-game
  if (gameState.screen === 'docking' && dockingMinigame) {
    dockingMinigame.update(timestamp);
  }

  // Docking computer autopilot animation
  if (gameState.screen === 'docking' && dockingComputerAnim) {
    dockingComputerAnim.update(timestamp);
  }

  // Galaxy map
  if (gameState.screen === 'map') {
    drawGalacticChart();
  }

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

if (loadSave()) {
  showWelcomeBackModal();
} else {
  showIntroModal();
}

// ─── Debug Console API ────────────────────────────────────────────────────────
// Exposed on window.__flatspace for browser console debugging only.
window.__flatspace = {
  /** Trigger the contraband security inspection modal immediately. */
  triggerInspection() {
    _checkContrabandInspection(() => {});
  },
  /** Add illegal cargo to the hold for inspection testing. */
  addContraband(id = 6, qty = 5) {
    gameState.inventory[id] = (gameState.inventory[id] ?? 0) + qty;
    console.log(`[flatspace] Added ${qty}t of commodity ${id} to inventory.`);
  },
  /** Open the RPG dice modal with a custom config for testing. */
  testRpgModal(overrides = {}) {
    showRpgDiceModal({
      title:     'TEST EVENT',
      subtitle:  'DEBUG MODE',
      narrative: 'This is a test RPG event.\nRoll to see success or failure.',
      diceCount: 2,
      diceSides: 6,
      onRoll:    (total) => total >= 7
        ? { outcome: 'success', message: `Rolled ${total} — SUCCESS.` }
        : { outcome: 'failure', message: `Rolled ${total} — FAILURE.` },
      onClose:   () => {},
      ...overrides,
    });
  },
  /**
   * Launch the docking mini-game directly from any screen.
   * Temporarily sets destinationSystem to currentSystem so the callbacks
   * have a valid target, and sets hull to the supplied value (default 100).
   */
  triggerDocking(hull = 100) {
    gameState.hull              = Math.max(1, Math.min(100, hull));
    gameState.destinationSystem = gameState.destinationSystem ?? gameState.currentSystem;
    _startDocking();
    console.log(`[flatspace] Docking mini-game triggered (hull: ${gameState.hull}%).`);
  },
  /**
   * Trigger a combat encounter directly from any screen.
   * @param {object} [opts]
   * @param {number}  [opts.shipCount] - Number of pirate ships (1–3). Ignored for alien encounters.
   * @param {boolean} [opts.alien]     - Force an alien (Thargoid) encounter instead of pirates.
   */
  triggerCombat({ shipCount, alien } = {}) {
    const piratePool = ['sidewinder', 'sidewinder', 'krait', 'krait', 'mamba', 'mamba',
                        'moray', 'aspMkII', 'ferdeLance'];
    let scenario;
    if (alien) {
      scenario = { type: 'alien', ships: ['thargoid'] };
    } else {
      const count = typeof shipCount === 'number'
        ? Math.max(1, Math.min(3, Math.floor(shipCount)))
        : 1 + Math.floor(Math.random() * 3);
      const ships = Array.from({ length: count }, () => piratePool[Math.floor(Math.random() * piratePool.length)]);
      scenario = { type: 'pirate', ships };
    }
    _triggerCombatEncounter(scenario);
    console.log(`[flatspace] Combat triggered: ${scenario.type} — ${scenario.ships.join(', ')}`);
  },
  /** Inspect the current game state. */
  get state() { return gameState; },
};

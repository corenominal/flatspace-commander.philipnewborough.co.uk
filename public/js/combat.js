/**
 * FLATSPACE COMMANDER
 * combat.js — combat system
 *
 * Exports:
 *   SHIP_CATALOG             — all ship definitions
 *   generateCombatScenario() — random encounter generator
 *   CombatEncounter          — manages one combat engagement on the canvas
 */

'use strict';

// ─── Shared Constants (must match main.js) ────────────────────────────────────

const HUD_HEIGHT  = 120;
const LASER_SPEED = 480;  // px/s

const LASER_INTERVALS = {
  pulse_laser:    1200,
  beam_laser:     1200,
  military_laser: 1200,
};

const LASER_DAMAGE = {
  pulse_laser:    [10, 15],
  beam_laser:     [15, 20],
  military_laser: [20, 30],
};

// Commodity ids that each ship class can drop (matches COMMODITIES in procedural.js)
const PIRATE_CARGO = [5, 6, 10, 11, 13, 14, 15]; // luxuries, narcotics, firearms, furs, gold, platinum, gems
const TRADER_CARGO = [0, 1, 2, 4, 8, 9, 12, 13]; // food, textiles, radioactives, liquor, machinery, alloys, minerals, gold
const ALIEN_CARGO  = [16];                         // alien items

// ─── Ship Wireframe Drawing Functions ─────────────────────────────────────────
// All functions: pure geometry only — caller sets strokeStyle/lineWidth.
// Ships face down (nose at cy + h * 0.5) — they approach from the top.

function drawSidewinder(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.20);  // right wing tip
  ctx.lineTo(cx + w * 0.28,  cy - h * 0.50);  // right engine
  ctx.lineTo(cx - w * 0.28,  cy - h * 0.50);  // left engine
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.20);  // left wing tip
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.50);
  ctx.lineTo(cx, cy - h * 0.50);
  ctx.stroke();
}

function drawMamba(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.10,  cy + h * 0.10);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.30);  // right boom tip
  ctx.lineTo(cx + w * 0.42,  cy - h * 0.50);
  ctx.lineTo(cx + w * 0.12,  cy - h * 0.50);
  ctx.lineTo(cx,             cy - h * 0.28);
  ctx.lineTo(cx - w * 0.12,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.42,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.30);  // left boom tip
  ctx.lineTo(cx - w * 0.10,  cy + h * 0.10);
  ctx.closePath();
  ctx.stroke();
}

function drawKrait(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.50);  // right corner
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.50);  // left corner
  ctx.closePath();
  ctx.stroke();
  // Cross-brace interior detail
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);
  ctx.lineTo(cx,             cy - h * 0.10);
  ctx.moveTo(cx - w * 0.25,  cy - h * 0.25);
  ctx.lineTo(cx + w * 0.25,  cy - h * 0.25);
  ctx.stroke();
}

function drawFerDeLance(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.12,  cy + h * 0.18);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.08);  // right wing tip
  ctx.lineTo(cx + w * 0.36,  cy - h * 0.50);  // right engine
  ctx.lineTo(cx + w * 0.12,  cy - h * 0.50);
  ctx.lineTo(cx,             cy - h * 0.28);
  ctx.lineTo(cx - w * 0.12,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.36,  cy - h * 0.50);  // left engine
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.08);  // left wing tip
  ctx.lineTo(cx - w * 0.12,  cy + h * 0.18);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.50);
  ctx.lineTo(cx, cy - h * 0.28);
  ctx.stroke();
}

function drawAspMkII(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.50,  cy + h * 0.10);  // right wing forward
  ctx.lineTo(cx + w * 0.46,  cy - h * 0.22);  // right wing swept back
  ctx.lineTo(cx + w * 0.20,  cy - h * 0.50);  // right engine
  ctx.lineTo(cx - w * 0.20,  cy - h * 0.50);  // left engine
  ctx.lineTo(cx - w * 0.46,  cy - h * 0.22);
  ctx.lineTo(cx - w * 0.50,  cy + h * 0.10);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.50);
  ctx.lineTo(cx, cy - h * 0.15);
  ctx.stroke();
}

function drawMoray(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.48,  cy + h * 0.08);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.14);
  ctx.lineTo(cx + w * 0.22,  cy - h * 0.50);  // tail fin right
  ctx.lineTo(cx + w * 0.10,  cy - h * 0.28);
  ctx.lineTo(cx,             cy - h * 0.38);
  ctx.lineTo(cx - w * 0.10,  cy - h * 0.28);
  ctx.lineTo(cx - w * 0.22,  cy - h * 0.50);  // tail fin left
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.14);
  ctx.lineTo(cx - w * 0.48,  cy + h * 0.08);
  ctx.closePath();
  ctx.stroke();
}

function drawAdder(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // blunt nose centre
  ctx.lineTo(cx + w * 0.16,  cy + h * 0.50);  // nose right
  ctx.lineTo(cx + w * 0.35,  cy + h * 0.22);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx + w * 0.38,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.38,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx - w * 0.35,  cy + h * 0.22);
  ctx.lineTo(cx - w * 0.16,  cy + h * 0.50);
  ctx.closePath();
  ctx.stroke();
  // Engine nozzles
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.28,  cy - h * 0.50);
  ctx.lineTo(cx + w * 0.28,  cy - h * 0.65);
  ctx.moveTo(cx - w * 0.28,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.28,  cy - h * 0.65);
  ctx.stroke();
}

function drawPython(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // blunt nose centre
  ctx.lineTo(cx + w * 0.13,  cy + h * 0.50);
  ctx.lineTo(cx + w * 0.24,  cy + h * 0.22);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.40);
  ctx.lineTo(cx + w * 0.22,  cy - h * 0.50);  // engine right outer
  ctx.lineTo(cx + w * 0.10,  cy - h * 0.50);
  ctx.lineTo(cx + w * 0.06,  cy - h * 0.22);
  ctx.lineTo(cx - w * 0.06,  cy - h * 0.22);
  ctx.lineTo(cx - w * 0.10,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.22,  cy - h * 0.50);  // engine left outer
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.40);
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx - w * 0.24,  cy + h * 0.22);
  ctx.lineTo(cx - w * 0.13,  cy + h * 0.50);
  ctx.closePath();
  ctx.stroke();
}

function drawAnaconda(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.14,  cy + h * 0.35);
  ctx.lineTo(cx + w * 0.40,  cy + h * 0.10);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.05);
  ctx.lineTo(cx + w * 0.48,  cy - h * 0.30);
  ctx.lineTo(cx + w * 0.32,  cy - h * 0.46);
  ctx.lineTo(cx + w * 0.20,  cy - h * 0.50);
  ctx.lineTo(cx + w * 0.10,  cy - h * 0.36);
  ctx.lineTo(cx,             cy - h * 0.24);
  ctx.lineTo(cx - w * 0.10,  cy - h * 0.36);
  ctx.lineTo(cx - w * 0.20,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.32,  cy - h * 0.46);
  ctx.lineTo(cx - w * 0.48,  cy - h * 0.30);
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.05);
  ctx.lineTo(cx - w * 0.40,  cy + h * 0.10);
  ctx.lineTo(cx - w * 0.14,  cy + h * 0.35);
  ctx.closePath();
  ctx.stroke();
}

function drawBoa(ctx, cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx,             cy + h * 0.50);  // nose
  ctx.lineTo(cx + w * 0.22,  cy + h * 0.30);
  ctx.lineTo(cx + w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx + w * 0.44,  cy - h * 0.45);
  ctx.lineTo(cx + w * 0.18,  cy - h * 0.50);
  ctx.lineTo(cx + w * 0.08,  cy - h * 0.20);
  ctx.lineTo(cx - w * 0.08,  cy - h * 0.20);
  ctx.lineTo(cx - w * 0.18,  cy - h * 0.50);
  ctx.lineTo(cx - w * 0.44,  cy - h * 0.45);
  ctx.lineTo(cx - w * 0.50,  cy - h * 0.08);
  ctx.lineTo(cx - w * 0.22,  cy + h * 0.30);
  ctx.closePath();
  ctx.stroke();
}

function drawThargoid(ctx, cx, cy, w, h) {
  // Outer octagon
  const rx = w * 0.50;
  const ry = h * 0.50;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 / 8) * i - Math.PI / 8;
    i === 0
      ? ctx.moveTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
      : ctx.lineTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  ctx.closePath();
  ctx.stroke();
  // Inner octagon (rotated 22.5°) at reduced opacity
  ctx.save();
  ctx.globalAlpha *= 0.50;
  const rx2 = rx * 0.55;
  const ry2 = ry * 0.55;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 / 8) * i + Math.PI / 8;
    i === 0
      ? ctx.moveTo(cx + rx2 * Math.cos(a), cy + ry2 * Math.sin(a))
      : ctx.lineTo(cx + rx2 * Math.cos(a), cy + ry2 * Math.sin(a));
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  // Cardinal cross
  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
  ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry);
  ctx.stroke();
  ctx.restore();
}

function drawThargon(ctx, cx, cy, w, h) {
  const hw = w * 0.50;
  const hh = h * 0.50;
  ctx.beginPath();
  ctx.moveTo(cx,      cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx,      cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Ship Catalog ─────────────────────────────────────────────────────────────

export const SHIP_CATALOG = {
  // ── Trade ships ───────────────────────────────────────────────────────────
  adder: {
    name: 'ADDER',        type: 'trader', shields: 0,   hull: 30,
    fireInterval: 4000,   fireDmgMin: 5,  fireDmgMax: 10,  speed: 60,
    cargoDrop: [1, 3],    cargoPool: TRADER_CARGO,  bounty: 0,
    width: 44, height: 34, drawFn: drawAdder,
  },
  python: {
    name: 'PYTHON',       type: 'trader', shields: 0,   hull: 80,
    fireInterval: 5000,   fireDmgMin: 8,  fireDmgMax: 12,  speed: 30,
    cargoDrop: [4, 8],    cargoPool: TRADER_CARGO,  bounty: 0,
    width: 72, height: 50, drawFn: drawPython,
  },
  anaconda: {
    name: 'ANACONDA',     type: 'trader', shields: 40,  hull: 120,
    fireInterval: 2500,   fireDmgMin: 12, fireDmgMax: 18,  speed: 20,
    cargoDrop: [6, 12],   cargoPool: TRADER_CARGO,  bounty: 0,
    width: 82, height: 54, drawFn: drawAnaconda,
  },
  boa: {
    name: 'BOA',          type: 'trader', shields: 0,   hull: 70,
    fireInterval: 4500,   fireDmgMin: 8,  fireDmgMax: 12,  speed: 25,
    cargoDrop: [4, 10],   cargoPool: TRADER_CARGO,  bounty: 0,
    width: 66, height: 44, drawFn: drawBoa,
  },
  // ── Pirate ships ──────────────────────────────────────────────────────────
  sidewinder: {
    name: 'SIDEWINDER',   type: 'pirate', shields: 10,  hull: 40,
    fireInterval: 2500,   fireDmgMin: 5,  fireDmgMax: 10,  speed: 90,
    cargoDrop: [0, 2],    cargoPool: PIRATE_CARGO,  bounty: 50,
    width: 38, height: 32, drawFn: drawSidewinder,
  },
  mamba: {
    name: 'MAMBA',        type: 'pirate', shields: 10,  hull: 50,
    fireInterval: 2000,   fireDmgMin: 8,  fireDmgMax: 12,  speed: 130,
    cargoDrop: [0, 2],    cargoPool: PIRATE_CARGO,  bounty: 75,
    width: 46, height: 28, drawFn: drawMamba,
  },
  krait: {
    name: 'KRAIT',        type: 'pirate', shields: 0,   hull: 45,
    fireInterval: 2800,   fireDmgMin: 5,  fireDmgMax: 9,   speed: 85,
    cargoDrop: [0, 1],    cargoPool: PIRATE_CARGO,  bounty: 60,
    width: 36, height: 34, drawFn: drawKrait,
  },
  ferdeLance: {
    name: 'FER-DE-LANCE', type: 'pirate', shields: 60,  hull: 100,
    fireInterval: 1500,   fireDmgMin: 12, fireDmgMax: 18,  speed: 110,
    cargoDrop: [1, 3],    cargoPool: PIRATE_CARGO,  bounty: 200,
    width: 52, height: 36, drawFn: drawFerDeLance,
  },
  aspMkII: {
    name: 'ASP MK II',    type: 'pirate', shields: 40,  hull: 80,
    fireInterval: 2000,   fireDmgMin: 10, fireDmgMax: 15,  speed: 95,
    cargoDrop: [1, 3],    cargoPool: PIRATE_CARGO,  bounty: 150,
    width: 56, height: 34, drawFn: drawAspMkII,
  },
  moray: {
    name: 'MORAY',        type: 'pirate', shields: 20,  hull: 70,
    fireInterval: 2200,   fireDmgMin: 8,  fireDmgMax: 13,  speed: 80,
    cargoDrop: [0, 2],    cargoPool: PIRATE_CARGO,  bounty: 100,
    width: 50, height: 32, drawFn: drawMoray,
  },
  // ── Alien ships ───────────────────────────────────────────────────────────
  thargoid: {
    name: 'THARGOID',     type: 'alien',  shields: 120, hull: 300,
    fireInterval: 1200,   fireDmgMin: 15, fireDmgMax: 22,  speed: 70,
    cargoDrop: [0, 0],    cargoPool: ALIEN_CARGO,   bounty: 0,
    width: 68, height: 68, drawFn: drawThargoid,
  },
  thargon: {
    name: 'THARGON',      type: 'alien',  shields: 0,   hull: 20,
    fireInterval: 3000,   fireDmgMin: 8,  fireDmgMax: 12,  speed: 120,
    cargoDrop: [0, 0],    cargoPool: ALIEN_CARGO,   bounty: 0,
    width: 20, height: 20, drawFn: drawThargon,
  },
};

// ─── Scenario Generator ───────────────────────────────────────────────────────

/**
 * Generate a random combat scenario.
 * Pirate probability scales with gov anarchy (higher gov index = more pirates).
 * @param {object|null} system — current system (for difficulty tuning)
 * @returns {{ type: 'pirate'|'trader'|'alien', ships: string[] }}
 */
export function generateCombatScenario(system) {
  const govIndex   = system?.government ?? 4;
  const alienProb  = 0.10;
  const pirateProb = Math.min(0.72, 0.42 + (govIndex / 7) * 0.30);

  const roll = Math.random();
  if (roll < alienProb) {
    return { type: 'alien', ships: ['thargoid'] };
  }
  if (roll < alienProb + pirateProb) {
    // Pirate encounter: 1–3 ships, weighted toward lighter classes
    const pool  = ['sidewinder', 'sidewinder', 'krait', 'krait', 'mamba', 'mamba',
                   'moray', 'aspMkII', 'ferdeLance'];
    const count = 1 + Math.floor(Math.random() * 3);
    const ships = Array.from({ length: count }, () => pool[Math.floor(Math.random() * pool.length)]);
    return { type: 'pirate', ships };
  }
  // Trader: single ship
  const traderPool = ['adder', 'adder', 'python', 'boa', 'anaconda'];
  return { type: 'trader', ships: [traderPool[Math.floor(Math.random() * traderPool.length)]] };
}

// ─── Weapon Assignment ───────────────────────────────────────────────────────

/**
 * Pick a weapon type for an enemy ship (non-alien).
 * Pulse laser is most common; military laser is rare.
 */
function _pickEnemyWeapon() {
  const r = Math.random();
  if (r < 0.60) return 'pulse_laser';
  if (r < 0.90) return 'beam_laser';
  return 'military_laser';
}

// ─── LaserBolt ────────────────────────────────────────────────────────────────

class LaserBolt {
  constructor(x, y, vx, vy, isEnemy, damage, weaponType = null) {
    this.x          = x;
    this.y          = y;
    this.vx         = vx;
    this.vy         = vy;
    this.isEnemy    = isEnemy;
    this.damage     = damage;
    this.weaponType = weaponType;
    this.alive      = true;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}

// ─── Spark ───────────────────────────────────────────────────────────────────

class Spark {
  constructor(x, y) {
    const speed  = 120 + Math.random() * 320;
    const angle  = Math.random() * Math.PI * 2;
    this.x       = x;
    this.y       = y;
    this.vx      = Math.cos(angle) * speed;
    this.vy      = Math.sin(angle) * speed - 60;  // slight upward bias
    this.life    = 0.35 + Math.random() * 0.45;
    this.maxLife = this.life;
    this.len     = 4 + Math.random() * 8;
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vy   += 180 * dt;
    this.life -= dt;
  }

  get alive() { return this.life > 0; }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const nx    = this.vx / (Math.hypot(this.vx, this.vy) || 1);
    const ny    = this.vy / (Math.hypot(this.vx, this.vy) || 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = alpha > 0.5 ? 1.5 : 1.0;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(this.x,                 this.y);
    ctx.lineTo(this.x - nx * this.len, this.y - ny * this.len);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── CargoBox ─────────────────────────────────────────────────────────────────

class CargoBox {
  constructor(x, y, commodityId) {
    this.x           = x;
    this.y           = y;
    this.vx          = (Math.random() - 0.5) * 80;
    this.vy          = 70 + Math.random() * 70;
    this.commodityId = commodityId;
    this.collected   = false;
    this.size        = 7;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  collidesWithPlayer(px, py, pw, ph) {
    return (
      Math.abs(this.x - px) < pw / 2 + this.size &&
      Math.abs(this.y - py) < ph / 2 + this.size
    );
  }

  isOffScreen(ch) { return this.y > ch + 24; }

  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.strokeRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(this.x - this.size / 2, this.y);
    ctx.lineTo(this.x + this.size / 2, this.y);
    ctx.moveTo(this.x, this.y - this.size / 2);
    ctx.lineTo(this.x, this.y + this.size / 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
}

// ─── Explosion ───────────────────────────────────────────────────────────────

class Explosion {
  constructor(x, y, shipW, shipH, { duration = 900 } = {}) {
    this.x        = x;
    this.y        = y;
    this.life     = 0;      // elapsed ms
    this.duration = duration;
    const radius  = Math.max(shipW, shipH) * 0.65;
    this.radius   = radius;

    // Debris fragments — short line segments flung outward
    const fragCount = 8 + Math.floor(Math.random() * 6);
    this.frags = [];
    for (let i = 0; i < fragCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;
      this.frags.push({
        x:     x + (Math.random() - 0.5) * shipW * 0.25,
        y:     y + (Math.random() - 0.5) * shipH * 0.25,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed,
        len:   5 + Math.random() * radius * 0.55,
        angle: Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 7,
      });
    }

    // Spark burst reusing existing Spark class
    this.sparks = [];
    const sparkCount = 20 + Math.floor(Math.random() * 14);
    for (let i = 0; i < sparkCount; i++) {
      this.sparks.push(new Spark(x, y));
    }
  }

  get alive() { return this.life < this.duration; }

  update(dt) {
    this.life += dt * 1000;
    for (const f of this.frags) {
      f.x     += f.vx * dt;
      f.y     += f.vy * dt;
      f.angle += f.spin * dt;
      f.vx    *= Math.pow(0.94, dt * 60);
      f.vy    *= Math.pow(0.94, dt * 60);
    }
    for (const sp of this.sparks) sp.update(dt);
  }

  draw(ctx) {
    const t = this.life / this.duration;

    // Initial flash burst (first 100 ms)
    if (this.life < 100) {
      const flashT = 1 - this.life / 100;
      ctx.save();
      ctx.globalAlpha = flashT * 0.90;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * (0.35 + flashT * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Primary shockwave ring (fades over 450 ms)
    {
      const maxAge = 450;
      if (this.life < maxAge) {
        const r     = (this.life / maxAge) * this.radius * 1.6;
        const alpha = Math.pow(1 - this.life / maxAge, 1.2);
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = Math.max(0.5, 2.5 * (1 - this.life / maxAge));
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Secondary dashed ring (delayed 120 ms)
    {
      const age    = this.life - 120;
      const maxAge = 380;
      if (age > 0 && age < maxAge) {
        const r     = (age / maxAge) * this.radius * 1.1;
        const alpha = Math.pow(1 - age / maxAge, 1.5) * 0.55;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Debris fragments
    const fragAlpha = Math.max(0, 1 - t * 1.3);
    if (fragAlpha > 0) {
      for (const f of this.frags) {
        ctx.save();
        ctx.globalAlpha = fragAlpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.lineCap     = 'round';
        ctx.translate(f.x, f.y);
        ctx.rotate(f.angle);
        ctx.beginPath();
        ctx.moveTo(-f.len * 0.5, 0);
        ctx.lineTo( f.len * 0.5, 0);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Sparks
    for (const sp of this.sparks) {
      if (sp.alive) sp.draw(ctx);
    }
  }
}

// ─── EnemyShip ────────────────────────────────────────────────────────────────

class EnemyShip {
  constructor(typeId, homeX, homeY) {
    const d        = SHIP_CATALOG[typeId];
    this.typeId    = typeId;
    this.name      = d.name;
    this.type      = d.type;
    this.shields   = d.shields;
    this.maxShields = d.shields;
    this.hull      = d.hull;
    this.maxHull   = d.hull;
    this.fireInterval = d.fireInterval;
    this.fireDmgMin   = d.fireDmgMin;
    this.fireDmgMax   = d.fireDmgMax;
    this.speed        = d.speed;
    this.bounty       = d.bounty;
    this.cargoDrop    = d.cargoDrop;
    this.cargoPool    = d.cargoPool;
    this.width        = d.width;
    this.height       = d.height;
    this.drawFn       = d.drawFn;

    this.weaponType = (d.type === 'alien') ? null : _pickEnemyWeapon();

    this.homeX     = homeX;
    this.homeY     = homeY;
    this.x         = homeX;
    this.y         = homeY - this.height * 3;  // start above screen
    this.oscPhase  = Math.random() * Math.PI * 2;
    this.fireTimer = this.fireInterval * (0.3 + Math.random() * 0.7);
    this.hitFlash  = 0;   // ms remaining
    this.dead      = false;

    // ── Movement mode ('osc' | 'solo_sweep' | 'd_shape' | 'center_sweep' | 'flank_lissajous')
    this.moveMode  = 'osc';  // default; overridden by CombatEncounter.start() for non-alien ships

    // Solo sweep state
    this.swMinX    = 0;
    this.swMaxX    = 0;
    this.swTargetX = 0;
    this.swSpeed   = 0;
    this.swPause   = 0;   // ms of pause remaining at each reversal
    this.swYPhase  = Math.random() * Math.PI * 2;  // vertical oscillation phase
    this.swYAmp    = 0;   // vertical oscillation amplitude

    // D-shape loop state (2-ship formation)
    this.dPhase      = 0;
    this.dSpeed      = 0;   // rad/s
    this.dCenterX    = 0;
    this.dCenterY    = 0;
    this.dRx         = 0;  // horizontal radius
    this.dRy         = 0;  // vertical radius
    this.dFlatX      = 0;  // x-clip for the flat side of the D
    this.dUseLeftClip = true;  // true = flat on left (D), false = flat on right (reversed D)

    // Lissajous state (3-ship flank ships)
    this.lissPhase     = Math.random() * Math.PI * 2;
    this.lissXAmp      = 0;
    this.lissYAmp      = 0;
    this.lissYFreqMult = 1.3;
    this.lissYPhase    = 0;

    // Alien orbit direction: +1 = clockwise, -1 = counter-clockwise
    this.orbitDir = 1;
  }

  isAlive() { return !this.dead; }

  shouldFire() {
    if (this.dead || this.fireTimer > 0) return false;
    this.fireTimer = this.fireInterval * (0.9 + Math.random() * 0.2);
    return true;
  }

  fireDamageRoll() {
    return this.fireDmgMin + Math.floor(Math.random() * (this.fireDmgMax - this.fireDmgMin + 1));
  }

  takeDamage(amount) {
    this.hitFlash = 200;
    if (this.shields > 0) {
      const absorbed = Math.min(this.shields, amount);
      this.shields  -= absorbed;
      amount        -= absorbed;
    }
    if (amount > 0) {
      this.hull = Math.max(0, this.hull - amount);
    }
    if (this.hull <= 0) this.dead = true;
  }

  update(dtMs, canvasW) {
    if (this.dead) return;
    this.fireTimer -= dtMs;
    if (this.hitFlash > 0) this.hitFlash -= dtMs;

    const marginL = this.width / 2 + 8;
    const marginR = canvasW - this.width / 2 - 8;

    // ── Solo sweep: full-width back-and-forth with random speed, pauses & vertical drift ──
    if (this.moveMode === 'solo_sweep') {
      if (this.swPause > 0) {
        this.swPause -= dtMs;
      } else {
        const dx   = this.swTargetX - this.x;
        const step = Math.sign(dx) * this.swSpeed * (dtMs / 1000);
        if (Math.abs(dx) <= Math.abs(step) + 1) {
          this.x      = this.swTargetX;
          this.swPause = 100 + Math.random() * 320;
          this.swSpeed = 100 + Math.random() * 100;
          // Next target near the opposite edge with slight random offset
          const range = this.swMaxX - this.swMinX;
          if (this.swTargetX < this.swMinX + range * 0.5) {
            this.swTargetX = this.swMaxX - Math.random() * range * 0.12;
          } else {
            this.swTargetX = this.swMinX + Math.random() * range * 0.12;
          }
        } else {
          this.x += step;
        }
      }
      // Slow vertical oscillation — biased upward, hard-capped so ship stays near top
      this.swYPhase += dtMs * 0.00075;
      const yRaw = this.homeY + this.swYAmp * Math.sin(this.swYPhase);
      this.y = Math.max(60, Math.min(this.homeY + 18, yRaw));
      return;
    }

    // ── D-shape loop: leader and follower trace a D-shaped path together ──
    if (this.moveMode === 'd_shape') {
      this.dPhase += this.dSpeed * (dtMs / 1000);
      const rawX = this.dCenterX + this.dRx * Math.cos(this.dPhase);
      const rawY = this.dCenterY + this.dRy * Math.sin(this.dPhase);
      // Clip one side to create the flat stroke of the D (left or right depending on encounter)
      this.x = this.dUseLeftClip
        ? Math.max(this.dFlatX, Math.min(marginR, rawX))
        : Math.max(marginL, Math.min(this.dFlatX, rawX));
      this.y = Math.max(60, rawY);
      return;
    }

    // ── Center sweep (3-ship centre slot): L-R oscillation only ──
    if (this.moveMode === 'center_sweep') {
      this.oscPhase += dtMs * 0.0014;
      const amp = this.speed * 0.45;
      this.x = Math.max(marginL, Math.min(marginR, this.homeX + Math.sin(this.oscPhase) * amp));
      return;
    }

    // ── Flank Lissajous (3-ship flanks): L-R + U-D via two oscillators ──
    if (this.moveMode === 'flank_lissajous') {
      this.lissPhase += dtMs * 0.0012;
      this.x = Math.max(marginL, Math.min(marginR,
        this.homeX + this.lissXAmp * Math.sin(this.lissPhase)));
      this.y = Math.max(60,
        this.homeY + this.lissYAmp * Math.sin(this.lissPhase * this.lissYFreqMult + this.lissYPhase));
      return;
    }

    // ── Alien wave (Thargoid): Lissajous horizontal + upward-biased vertical ──
    if (this.moveMode === 'alien_wave') {
      this.oscPhase += dtMs * 0.0012;
      const hAmp = canvasW * 0.22;
      const vAmp = this.lissYAmp;
      // Vertical: sin shifted so motion is mostly upward; cap at homeY + 18px below
      const yRaw = this.homeY + vAmp * Math.sin(this.oscPhase * 0.58 + Math.PI * 0.5);
      this.x = Math.max(marginL, Math.min(marginR, this.homeX + Math.sin(this.oscPhase) * hAmp));
      this.y = Math.max(60, Math.min(this.homeY + 18, yRaw));
      return;
    }

    // ── Alien orbit (Thargon escorts): elliptical orbit around home position ──
    if (this.moveMode === 'alien_orbit') {
      this.lissPhase += this.orbitDir * 0.0016 * dtMs;
      this.x = Math.max(marginL, Math.min(marginR,
        this.homeX + this.lissXAmp * Math.cos(this.lissPhase)));
      this.y = Math.max(60, this.homeY + this.lissYAmp * Math.sin(this.lissPhase));
      return;
    }

    // ── Default 'osc': simple sinusoidal horizontal wobble (traders) ──
    this.oscPhase += dtMs * 0.0014;
    const amp = this.speed * 0.38;
    this.x = Math.max(marginL, Math.min(marginR, this.homeX + Math.sin(this.oscPhase) * amp));
  }

  render(ctx) {
    if (this.dead) return;
    ctx.save();

    // Shield ring (dashed ellipse when shields > 0)
    if (this.maxShields > 0 && this.shields > 0) {
      const frac = this.shields / this.maxShields;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.2;
      ctx.globalAlpha = 0.10 + frac * 0.14;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.width * 0.66, this.height * 0.66, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (this.hitFlash > 0 && this.shields > 0) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2.5;
        ctx.globalAlpha = (this.hitFlash / 200) * 0.55;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, this.width * 0.66, this.height * 0.66, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Ship wireframe
    const flashIntensity = this.hitFlash > 0 ? this.hitFlash / 200 : 0;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle   = '#ffffff';
    ctx.lineWidth   = 1.5 + flashIntensity * 0.8;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    if (flashIntensity > 0) ctx.globalAlpha = Math.min(1, 0.85 + flashIntensity * 0.5);

    this.drawFn(ctx, this.x, this.y, this.width, this.height);

    ctx.restore();
  }
}

// ─── CombatEncounter ──────────────────────────────────────────────────────────

/**
 * Manages one complete canvas combat engagement from intro through to result.
 * Main.js calls start() once, then update() + draw() each frame.
 *
 * Callbacks:
 *   onPlayerDamaged(damage)       — called when an enemy bolt hits the player
 *   onCargoCollected(commodityId) — called when cargo box is collected
 *   onShipDestroyed(shipData)     — called when an enemy is destroyed
 *   onComplete(outcome)           — called when encounter fully ends
 *                                   outcome: 'victory' | 'playerDestroyed'
 */
export class CombatEncounter {
  constructor(scenario, callbacks) {
    this.scenario    = scenario;
    this.callbacks   = callbacks;

    this.enemies     = [];
    this.playerBolts        = [];
    this.enemyBolts         = [];
    this.pendingPlayerBolts = [];  // { bolt, delay } — burst queue
    this.pendingEnemyBolts  = [];  // { bolt, delay } — enemy burst queue
    this.cargoPods          = [];
    this.sparks             = [];
    this.explosions         = [];

    this.playerFireTimer = 500;  // ms until first player shot

    this.done    = false;
    this.outcome = null;

    this.playerBlownUp    = false;  // true once the player ship is destroyed
    this._lastPlayerPos   = { x: 0, y: 0, w: 0, h: 0 };  // cached each update

    this._thargoidMother = null;  // reference to the Thargoid mothership (alien encounters)
    this._storedCanvasW  = 0;     // canvas width cached for mid-combat Thargon spawning

    this.phase      = 'intro';   // 'intro' | 'fighting' | 'result'
    this.phaseTimer = 0;         // ms elapsed within the current phase

    this.INTRO_MS  = 1300;
    this.RESULT_MS = 2400;
  }

  /** Call once with canvas dimensions to position and create enemies. */
  start(canvasW, canvasH) {
    this._storedCanvasW = canvasW;
    const count   = this.scenario.ships.length;
    const homeY   = (canvasH - HUD_HEIGHT) * 0.22;
    const homePos = _getEnemyPositions(count, canvasW, homeY);

    this.enemies = this.scenario.ships.map((typeId, i) =>
      new EnemyShip(typeId, homePos[i].x, homePos[i].y),
    );

    // ── Assign movement modes for non-alien ships ──────────────────────────
    if (this.scenario.type !== 'alien') {
      if (count === 1) {
        // Full-width random sweep with vertical drift
        const e      = this.enemies[0];
        const margin = e.width / 2 + 8;
        e.moveMode   = 'solo_sweep';
        e.swMinX     = margin;
        e.swMaxX     = canvasW - margin;
        e.swTargetX  = e.swMaxX;  // first sweep goes right
        e.swSpeed    = 110 + Math.random() * 80;
        e.swPause    = 0;
        e.swYAmp     = 42;  // vertical oscillation amplitude (px)

      } else if (count === 2) {
        // Both ships trace a D-shaped loop; direction chosen randomly each encounter
        const dUseLeftClip = Math.random() < 0.5;
        const dCenterX = canvasW / 2;
        const dCenterY = homeY;
        const dRx      = canvasW * 0.36;
        const dRy      = 38;
        // Flat side is on whichever side was chosen (left ~17% or right ~83%)
        const dFlatX   = dUseLeftClip ? canvasW * 0.17 : canvasW * 0.83;
        const dSpeed   = 0.72 + Math.random() * 0.22;
        for (let i = 0; i < 2; i++) {
          const e         = this.enemies[i];
          e.moveMode      = 'd_shape';
          e.dCenterX      = dCenterX;
          e.dCenterY      = dCenterY;
          e.dRx           = dRx;
          e.dRy           = dRy;
          e.dFlatX        = dFlatX;
          e.dUseLeftClip  = dUseLeftClip;
          e.dSpeed        = dSpeed;
          // Leader starts at top of arc; follower is 1.3 rad behind
          e.dPhase        = (i === 0) ? Math.PI * 1.5 : Math.PI * 1.5 - 1.3;
        }

      } else if (count === 3) {
        // Centre: left-right sweep only
        this.enemies[1].moveMode = 'center_sweep';

        // Flanks: Lissajous — independent L-R and U-D oscillators
        const xAmp = canvasW * 0.13;
        [[this.enemies[0], 0], [this.enemies[2], Math.PI * 0.55]].forEach(([e, yPhase]) => {
          e.moveMode      = 'flank_lissajous';
          e.lissXAmp      = xAmp;
          e.lissYAmp      = 44;
          e.lissYFreqMult = 1.3 + Math.random() * 0.15;
          e.lissYPhase    = yPhase;
          e.lissPhase     = Math.random() * Math.PI * 2;
        });
      }
    }

    // Thargoid mothership: spawn an initial wave of 2 Thargons alongside it
    const mother = this.enemies.find(e => e.typeId === 'thargoid');
    if (mother) {
      this._thargoidMother = mother;
      // Thargoid: wave movement combining horizontal and vertical oscillation
      mother.moveMode = 'alien_wave';
      mother.lissYAmp = 52;
      // Randomise Thargon orbit direction once per encounter
      this._thargonOrbitDir = Math.random() < 0.5 ? 1 : -1;
      this._spawnThargons(false);  // intro mode — Thargons slide in with the mothership
    }
  }

  /** Called from main.js when the player's hull reaches 0. */
  playerDestroyed() {
    if (this.phase !== 'fighting') return;
    this.playerBlownUp = true;
    const { x, y, w, h } = this._lastPlayerPos;
    // Large, long-lived explosion centred on the player ship
    this.explosions.push(new Explosion(x, y, w * 2.4, h * 2.4, { duration: 1500 }));
    this.callbacks.onPlayerExplode?.();
    this._enterResult('playerDestroyed');
  }

  /**
   * Advance the encounter by one frame.
   * @param {number} dt         — delta time in seconds
   * @param {number} playerX    — player ship centre X
   * @param {number} playerY    — player ship centre Y
   * @param {number} playerW    — player ship bounding width
   * @param {number} playerH    — player ship bounding height
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {string|null} laserType — active laser id from gameState.equipment
   */
  update(dt, playerX, playerY, playerW, playerH, canvasW, canvasH, laserType) {
    if (this.done) return;

    this.phaseTimer += dt * 1000;

    // Cache player position for use in playerDestroyed()
    this._lastPlayerPos = { x: playerX, y: playerY, w: playerW, h: playerH };

    // ── Intro: enemies slide down into position ──
    if (this.phase === 'intro') {
      const t = Math.min(1, this.phaseTimer / this.INTRO_MS);
      const eased = 1 - Math.pow(1 - t, 2);
      for (const e of this.enemies) {
        e.y = e.homeY - e.height * 2.5 * (1 - eased);
      }
      if (t >= 1) {
        this.phase      = 'fighting';
        this.phaseTimer = 0;
      }
      return;
    }

    // ── Result phase: finish animating then end ──
    if (this.phase === 'result') {
      this._updateCargo(dt, playerX, playerY, playerW, playerH, canvasH);
      for (const ex of this.explosions) ex.update(dt);
      this.explosions = this.explosions.filter(ex => ex.alive);
      if (this.phaseTimer >= this.RESULT_MS) {
        this.done = true;
        this.callbacks.onComplete?.(this.outcome);
      }
      return;
    }

    // ── Fighting ──

    // Update enemy positions and fire timers
    for (const e of this.enemies) e.update(dt * 1000, canvasW);

    // Enemy auto-fire
    for (const e of this.enemies) {
      if (!e.isAlive() || !e.shouldFire()) continue;
      const dx   = playerX - e.x;
      const dy   = playerY - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const trackVx = (dx / dist) * 110;  // slight horizontal tracking

      if (e.weaponType === 'military_laser') {
        // Three bolts in quick succession (80 ms apart)
        const BURST_GAP = 80;
        for (let i = 0; i < 3; i++) {
          const offX = (i - 1) * 10;
          const bolt = new LaserBolt(
            e.x + offX,
            e.y + e.height * 0.5,
            trackVx + offX * 0.05,
            LASER_SPEED,
            true,
            e.fireDamageRoll(),
            e.weaponType,
          );
          if (i === 0) {
            this.enemyBolts.push(bolt);
          } else {
            this.pendingEnemyBolts.push({ bolt, delay: BURST_GAP * i });
          }
        }
      } else if (e.weaponType === 'beam_laser') {
        // Two bolts in quick succession (100 ms apart)
        this.enemyBolts.push(new LaserBolt(
          e.x, e.y + e.height * 0.5, trackVx, LASER_SPEED, true, e.fireDamageRoll(), e.weaponType,
        ));
        this.pendingEnemyBolts.push({
          bolt:  new LaserBolt(e.x, e.y + e.height * 0.5, trackVx, LASER_SPEED, true, e.fireDamageRoll(), e.weaponType),
          delay: 100,
        });
      } else {
        this.enemyBolts.push(new LaserBolt(
          e.x,
          e.y + e.height * 0.5,
          trackVx,
          LASER_SPEED,
          true,
          e.fireDamageRoll(),
          e.weaponType,
        ));
      }
      this.callbacks.onEnemyFire?.(e.type, e.weaponType);
    }

    // Player auto-fire
    if (laserType) {
      const interval = LASER_INTERVALS[laserType] ?? LASER_INTERVALS.pulse_laser;
      this.playerFireTimer -= dt * 1000;
      if (this.playerFireTimer <= 0) {
        this.playerFireTimer = interval;
        const targets = this.enemies.filter(e => e.isAlive());
        if (targets.length > 0) {
          this.callbacks.onPlayerFire?.(laserType);
          const [dMin, dMax] = LASER_DAMAGE[laserType] ?? LASER_DAMAGE.pulse_laser;
          const dmg = () => dMin + Math.floor(Math.random() * (dMax - dMin + 1));

          if (laserType === 'military_laser') {
            // Three bolts in quick succession (80 ms apart)
            const BURST_GAP = 80;
            for (let i = 0; i < 3; i++) {
              const tgt  = targets[i % targets.length];
              const offX = (i - 1) * 10;
              const bolt = new LaserBolt(
                playerX + offX, playerY,
                (tgt.x - playerX - offX) * 0.08,
                -LASER_SPEED,
                false, dmg(),
              );
              if (i === 0) {
                this.playerBolts.push(bolt);
              } else {
                this.pendingPlayerBolts.push({ bolt, delay: BURST_GAP * i });
              }
            }
          } else if (laserType === 'beam_laser') {
            // Two bolts in quick succession (100 ms apart)
            const tgt = targets[Math.floor(Math.random() * targets.length)];
            const vx  = (tgt.x - playerX) * 0.09;
            this.playerBolts.push(new LaserBolt(playerX, playerY, vx, -LASER_SPEED, false, dmg()));
            this.pendingPlayerBolts.push({
              bolt:  new LaserBolt(playerX, playerY, vx, -LASER_SPEED, false, dmg()),
              delay: 100,
            });
          } else {
            const tgt = targets[Math.floor(Math.random() * targets.length)];
            this.playerBolts.push(new LaserBolt(
              playerX, playerY,
              (tgt.x - playerX) * 0.09,
              -LASER_SPEED,
              false, dmg(),
            ));
          }
        }
      }
    }

    // Flush pending burst bolts
    const dtMs = dt * 1000;
    for (const p of this.pendingPlayerBolts) p.delay -= dtMs;
    const ready = this.pendingPlayerBolts.filter(p => p.delay <= 0);
    for (const p of ready) this.playerBolts.push(p.bolt);
    this.pendingPlayerBolts = this.pendingPlayerBolts.filter(p => p.delay > 0);

    for (const p of this.pendingEnemyBolts) p.delay -= dtMs;
    const enemyReady = this.pendingEnemyBolts.filter(p => p.delay <= 0);
    for (const p of enemyReady) this.enemyBolts.push(p.bolt);
    this.pendingEnemyBolts = this.pendingEnemyBolts.filter(p => p.delay > 0);

    // Move bolts
    for (const b of this.playerBolts) b.update(dt);
    for (const b of this.enemyBolts)  b.update(dt);

    // Player bolts hit enemies
    for (const bolt of this.playerBolts) {
      if (!bolt.alive) continue;
      for (const e of this.enemies) {
        if (!e.isAlive()) continue;
        if (
          bolt.y > e.y - e.height * 0.55 &&
          bolt.y < e.y + e.height * 0.55 &&
          Math.abs(bolt.x - e.x) < e.width * 0.50
        ) {
          bolt.alive = false;
          const sparkCount = 8 + Math.floor(Math.random() * 6);
          for (let _i = 0; _i < sparkCount; _i++) {
            this.sparks.push(new Spark(bolt.x, bolt.y));
          }
          const wasAlive = e.isAlive();
          e.takeDamage(bolt.damage);
          if (wasAlive && !e.isAlive()) {
            this.callbacks.onShipDestroyed?.(SHIP_CATALOG[e.typeId]);
            this.callbacks.onEnemyExplode?.(e.type);
            this._spawnCargo(e);
            this.explosions.push(new Explosion(e.x, e.y, e.width, e.height));

            // Thargon wave mechanic: when the last Thargon of a wave is destroyed,
            // spawn 2 more — but only while the Thargoid mothership is still alive.
            if (e.typeId === 'thargon' && this._thargoidMother?.isAlive()) {
              const liveThargons = this.enemies.filter(en => en.typeId === 'thargon' && en.isAlive());
              if (liveThargons.length === 0) {
                this._spawnThargons(true);
              }
            }
          }
          break;
        }
      }
    }

    // Enemy bolts hit player
    for (const bolt of this.enemyBolts) {
      if (!bolt.alive) continue;
      if (
        bolt.y > playerY - playerH * 0.50 &&
        bolt.y < playerY + playerH * 0.50 &&
        Math.abs(bolt.x - playerX) < playerW * 0.44
      ) {
        bolt.alive = false;
        this.callbacks.onPlayerDamaged?.(bolt.damage);
      }
    }

    // Cull bolts
    this.playerBolts = this.playerBolts.filter(b => b.alive && b.y > -60);
    this.enemyBolts  = this.enemyBolts.filter(b => b.alive && b.y < canvasH + 60);

    // Update sparks
    for (const sp of this.sparks) sp.update(dt);
    this.sparks = this.sparks.filter(sp => sp.alive);

    // Update explosions
    for (const ex of this.explosions) ex.update(dt);
    this.explosions = this.explosions.filter(ex => ex.alive);

    // Update cargo pods
    this._updateCargo(dt, playerX, playerY, playerW, playerH, canvasH);

    // Check victory — wait until enemies dead, explosions finished, and cargo gone
    if (this.enemies.every(e => !e.isAlive()) && this.explosions.length === 0 && this.cargoPods.length === 0) {
      this._enterResult('victory');
    }
  }

  /** Render the complete combat layer over the existing canvas content. */
  draw(ctx, canvasW, canvasH, ts, laserType) {
    // Enemy ships
    for (const e of this.enemies) e.render(ctx);

    // Laser bolts
    for (const b of this.playerBolts) _drawPlayerBolt(ctx, b, laserType);
    for (const b of this.enemyBolts)  _drawEnemyBolt(ctx, b);

    // Sparks from bolt impacts
    for (const sp of this.sparks) sp.draw(ctx);

    // Explosions
    for (const ex of this.explosions) ex.draw(ctx);

    // Cargo pods
    for (const box of this.cargoPods) box.draw(ctx);

    // Combat status HUD (replaces flight distance bar at top)
    this._drawCombatHUD(ctx, canvasW, canvasH, ts, laserType);

    // Result overlay
    if (this.phase === 'result') {
      const t = Math.min(1, this.phaseTimer / this.RESULT_MS);
      this._drawResultOverlay(ctx, canvasW, canvasH, t);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _enterResult(outcome) {
    this.phase      = 'result';
    this.outcome    = outcome;
    this.phaseTimer = 0;
  }

  /**
   * Spawn 2 Thargon escorts flanking the Thargoid mothership.
   * @param {boolean} midCombat — true when spawning during the fighting phase
   *                              (enemies appear instantly); false during intro
   *                              (enemies slide in from above with the mothership).
   */
  _spawnThargons(midCombat) {
    const mother = this._thargoidMother;
    if (!mother || !mother.isAlive()) return;
    const cw   = this._storedCanvasW;
    const offX = cw * 0.16;
    const xs   = [
      Math.max(24, mother.homeX - offX),
      Math.min(cw - 24, mother.homeX + offX),
    ];
    for (const tx of xs) {
      const thargon      = new EnemyShip('thargon', tx, mother.homeY);
      thargon.moveMode   = 'alien_orbit';
      thargon.lissXAmp   = 42;
      thargon.lissYAmp   = 28;
      thargon.orbitDir   = this._thargonOrbitDir;
      thargon.lissPhase  = Math.random() * Math.PI * 2;  // stagger start angles
      if (midCombat) {
        thargon.y        = mother.homeY;  // appear at combat position immediately
        thargon.hitFlash = 350;           // brief flash-in effect
      }
      this.enemies.push(thargon);
    }
  }

  _spawnCargo(enemy) {
    const [minDrop, maxDrop] = enemy.cargoDrop;
    const count = minDrop + Math.floor(Math.random() * (maxDrop - minDrop + 1));
    for (let i = 0; i < count; i++) {
      const commodityId = enemy.cargoPool[Math.floor(Math.random() * enemy.cargoPool.length)];
      this.cargoPods.push(new CargoBox(
        enemy.x + (Math.random() - 0.5) * enemy.width,
        enemy.y,
        commodityId,
      ));
    }
  }

  _updateCargo(dt, playerX, playerY, playerW, playerH, canvasH) {
    for (const box of this.cargoPods) {
      if (box.collected) continue;
      box.update(dt);
      if (box.collidesWithPlayer(playerX, playerY, playerW, playerH)) {
        box.collected = true;
        this.callbacks.onCargoCollected?.(box.commodityId);
      }
    }
    this.cargoPods = this.cargoPods.filter(b => !b.collected && !b.isOffScreen(canvasH));
  }

  _drawCombatHUD(ctx, cw, ch, ts, laserType) {
    const barH = 46;
    const padX = 12;

    ctx.save();

    // Background strip
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, cw, barH);

    // Bottom border
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, barH); ctx.lineTo(cw, barH);
    ctx.stroke();

    // Scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let y = 3; y < barH; y += 4) ctx.fillRect(0, y, cw, 1);

    // "!! COMBAT !!" — flashes every 400 ms
    const flashOn = Math.floor(ts / 400) % 2 === 0;
    ctx.fillStyle    = flashOn ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.font         = `10px 'Courier New', monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('!! COMBAT !!', padX, 7);

    // Laser type label (right side)
    if (laserType) {
      const lbl = laserType === 'military_laser' ? 'MILITARY'
                : laserType === 'beam_laser'     ? 'BEAM' : 'PULSE';
      ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.font      = `9px 'Courier New', monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(`LASER: ${lbl}`, cw - padX, 7);
    }

    // Enemy health bars
    const alive = this.enemies.filter(e => e.isAlive());
    if (alive.length > 0) {
      const segW = (cw - padX * 2) / alive.length;
      const bw   = Math.min(64, segW - 8);
      const bh   = 5;

      for (let i = 0; i < alive.length; i++) {
        const e  = alive[i];
        const bx = padX + i * segW + (segW - bw) / 2;

        // Name label
        ctx.fillStyle    = 'rgba(255,255,255,0.60)';
        ctx.font         = `7px 'Courier New', monospace`;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(e.name, bx, 20);

        let curY = 29;

        // Shield bar (if applicable)
        if (e.maxShields > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.30)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(bx, curY, bw, bh);
          ctx.fillStyle   = 'rgba(180,200,255,0.72)';
          ctx.fillRect(bx + 1, curY + 1, Math.max(0, (bw - 2) * (e.shields / e.maxShields)), bh - 2);
          curY += bh + 2;
        }

        // Hull bar
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(bx, curY, bw, bh);
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(bx + 1, curY + 1, Math.max(0, (bw - 2) * (e.hull / e.maxHull)), bh - 2);
      }
    }

    ctx.restore();
  }

  _drawResultOverlay(ctx, cw, ch, t) {
    const isVictory = this.outcome === 'victory';
    const alpha = t < 0.35
      ? (t / 0.35) * 0.78
      : Math.max(0, (1 - (t - 0.35) / 0.65)) * 0.78;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#000000';
    ctx.font        = `15px 'Courier New', monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      isVictory ? 'HOSTILES ELIMINATED' : 'HULL CRITICAL',
      cw / 2, ch / 2,
    );
    ctx.restore();
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _getEnemyPositions(count, cw, y) {
  if (count === 1) return [{ x: cw / 2, y }];
  if (count === 2) return [{ x: cw * 0.33, y }, { x: cw * 0.67, y }];
  return [{ x: cw * 0.22, y }, { x: cw * 0.50, y }, { x: cw * 0.78, y }];
}

function _drawPlayerBolt(ctx, bolt, laserType) {
  const len = laserType === 'beam_laser' ? 34 : 18;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = laserType === 'military_laser' ? 2.5 : 1.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(bolt.x, bolt.y);
  ctx.lineTo(bolt.x + bolt.vx * 0.04, bolt.y + len);  // tail streaks toward origin
  ctx.stroke();
  ctx.restore();
}

function _drawEnemyBolt(ctx, bolt) {
  ctx.save();
  if (!bolt.weaponType) {
    // Alien bolt — dashed style
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(bolt.x, bolt.y);
    ctx.lineTo(bolt.x, bolt.y - 18);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Non-alien bolt — matches player bolt style, tail trails upward toward source
    const len = bolt.weaponType === 'beam_laser' ? 34 : 18;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth   = bolt.weaponType === 'military_laser' ? 2.5 : 1.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(bolt.x, bolt.y);
    ctx.lineTo(bolt.x + bolt.vx * 0.04, bolt.y - len);
    ctx.stroke();
  }
  ctx.restore();
}

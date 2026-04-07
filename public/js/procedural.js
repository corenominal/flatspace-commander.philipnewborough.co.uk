/**
 * FLATSPACE COMMANDER
 * procedural.js — seed-based galaxy generation
 *
 * Exports a single class, GalaxyGenerator, which uses a Linear Congruential
 * Generator (LCG) seeded at GALAXY_SEED to deterministically produce every
 * star system in the galaxy.  Math.random() is never used.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const GALAXY_SEED = 0x5A31;

/** Economy types — index 0 (Rich Industrial) … 7 (Poor Agricultural) */
const ECONOMY_NAMES = [
  'Rich Industrial',
  'Average Industrial',
  'Poor Industrial',
  'Mainly Industrial',
  'Mainly Agricultural',
  'Rich Agricultural',
  'Average Agricultural',
  'Poor Agricultural',
];

/** Government types — index 0 (Corporate State) … 7 (Anarchy) */
const GOVERNMENT_NAMES = [
  'Corporate State',
  'Democracy',
  'Confederacy',
  'Feudal',
  'Multi-Government',
  'Dictatorship',
  'Communist',
  'Anarchy',
];

/** Adjectives used in procedural descriptions */
const DESCRIPTION_ADJECTIVES = [
  'mostly harmless',
  'fabled',
  'notable',
  'ancient',
  'well known',
  'great',
  'particularly',
  'dull',
  'tedious',
  'turbulent',
  'fierce',
  'scary',
  'fun',
  'boring',
  'weird',
];

/** Nouns used in procedural descriptions */
const DESCRIPTION_NOUNS = [
  'agricultural world',
  'industrial planet',
  'mining colony',
  'feudal world',
  'trading hub',
  'frontier colony',
  'prison colony',
  'tourist trap',
  'research station',
  'religious colony',
];

/**
 * Syllable pairs used to construct planet names.
 * Classic Elite used a specific 2×26 table; this approximates that feel.
 */
const SYLLABLES_A = [
  'La', 'So', 'Ve', 'Ge', 'Za', 'Ce', 'Bi', 'Mo',
  'Re', 'Us', 'Es', 'Ar', 'Ma', 'In', 'Di', 'Le',
  'Or', 'An', 'Ra', 'Ti', 'On', 'En', 'At', 'Ed',
  'Al', 'Ri',
];

const SYLLABLES_B = [
  've', 'ti', 'ge', 'bi', 'za', 'ce', 'so', 'la',
  'or', 'an', 'us', 'es', 'ar', 'ma', 'ri', 'di',
  'on', 'ra', 'in', 'le', 'en', 'at', 'ed', 'al',
  're', 'mo',
];

// ─── Linear Congruential Generator ───────────────────────────────────────────

/**
 * A simple, fast LCG: xₙ₊₁ = (a·xₙ + c) mod m
 * Parameters from Numerical Recipes (32-bit variant).
 */
class LCG {
  /**
   * @param {number} seed  — integer seed value
   */
  constructor(seed) {
    this._state = seed >>> 0;  // force 32-bit unsigned
  }

  /** Advance the generator and return the raw 32-bit integer. */
  nextInt() {
    // Avoid floating-point drift by keeping arithmetic in 32-bit unsigned space.
    // Multiplier and increment from Knuth / Numerical Recipes.
    this._state = (Math.imul(1664525, this._state) + 1013904223) >>> 0;
    return this._state;
  }

  /**
   * Return a float in [0, 1).
   * @returns {number}
   */
  nextFloat() {
    return this.nextInt() / 0x100000000;
  }

  /**
   * Return an integer in [0, max).
   * @param {number} max
   * @returns {number}
   */
  nextRange(max) {
    return (this.nextInt() % max + max) % max;  // always positive
  }
}

// ─── GalaxyGenerator ─────────────────────────────────────────────────────────

export class GalaxyGenerator {
  /**
   * All generation is deterministic from GALAXY_SEED.
   * Construct once and call generateSystem(id) as needed.
   */
  constructor() {
    this._seed = GALAXY_SEED;
  }

  /**
   * Build a seeded LCG whose state is derived from the galaxy seed mixed
   * with the system id, so each system gets its own reproducible stream
   * without having to advance through all prior systems.
   *
   * @param {number} systemId
   * @returns {LCG}
   */
  _lcgForSystem(systemId) {
    // Use a non-linear bit-avalanche hash (fmix32 style) to derive the per-system
    // seed.  A simple linear mix — e.g. seed ^ (id * constant) — causes LCG seeds
    // for adjacent ids to be linearly spaced, which produces diagonal hyperplane
    // banding when the resulting x/y coordinates are plotted.
    let s = (systemId + 1) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0xac4d1c53) >>> 0;
    s = (s ^ (s >>> 15) ^ this._seed) >>> 0;
    if (s === 0) s = this._seed || 1;
    const lcg = new LCG(s);
    lcg.nextInt();
    lcg.nextInt();
    return lcg;
  }

  /**
   * Generate and return the data for a single star system.
   *
   * System 0 is always 'Lave', the classic Rich Agricultural starting world.
   *
   * @param {number} systemId  — non-negative integer identifying the system
   * @returns {{
   *   id:          number,
   *   name:        string,
   *   x:           number,
   *   y:           number,
   *   economy:     number,
   *   economyName: string,
   *   government:  number,
   *   govName:     string,
   *   techLevel:   number,
   *   description: string,
   * }}
   */
  generateSystem(systemId) {
    // ── The Lave Override ──────────────────────────────────────────────────
    if (systemId === 0) {
      return {
        id:          0,
        name:        'Lave',
        x:           20,
        y:           173,
        economy:     5,   // Rich Agricultural
        economyName: ECONOMY_NAMES[5],
        government:  4,   // Multi-Government
        govName:     GOVERNMENT_NAMES[4],
        techLevel:   5,
        description: 'Lave is a mostly harmless agricultural world.',
      };
    }

    // ── Procedural Generation ─────────────────────────────────────────────
    const lcg = this._lcgForSystem(systemId);

    // Name: one pair of syllables (A + B), occasionally three syllables.
    const nameA = SYLLABLES_A[lcg.nextRange(SYLLABLES_A.length)];
    const nameB = SYLLABLES_B[lcg.nextRange(SYLLABLES_B.length)];
    // ~25 % of systems get a third syllable for variety.
    const nameC = lcg.nextRange(4) === 0
      ? SYLLABLES_A[lcg.nextRange(SYLLABLES_A.length)]
      : '';
    const name = nameA + nameB + nameC;

    // Coordinates on the 2D galaxy map (0–255 inclusive each axis).
    // Use nextFloat() so all 32 bits contribute — nextRange(256) only reads the
    // low 8 bits of the LCG which have a period of just 256, causing visible
    // banding and clustering.
    const x = Math.floor(lcg.nextFloat() * 256);
    const y = Math.floor(lcg.nextFloat() * 256);

    // Economy (0–7).
    const economy = lcg.nextRange(8);

    // Government (0–7).
    const government = lcg.nextRange(8);

    // Tech level (1–15): higher economy index (poorer) and lower government
    // index (more ordered) push tech level down, matching Elite's convention.
    const rawTech = 15 - economy + (7 - government);
    const techLevel = Math.max(1, Math.min(15, Math.round(rawTech / 2)));

    // Description.
    const adj  = DESCRIPTION_ADJECTIVES[lcg.nextRange(DESCRIPTION_ADJECTIVES.length)];
    const noun = DESCRIPTION_NOUNS[lcg.nextRange(DESCRIPTION_NOUNS.length)];
    const description = `${name} is a ${adj} ${noun}.`;

    return {
      id: systemId,
      name,
      x,
      y,
      economy,
      economyName: ECONOMY_NAMES[economy],
      government,
      govName: GOVERNMENT_NAMES[government],
      techLevel,
      description,
    };
  }

  /**
   * Generate an array of `count` systems starting at `startId`.
   * Useful for populating galaxy map tiles on demand.
   *
   * @param {number} [count=256]
   * @param {number} [startId=0]
   * @returns {Array<object>}
   */
  generateSector(count = 256, startId = 0) {
    const systems = [];
    for (let i = 0; i < count; i++) {
      systems.push(this.generateSystem(startId + i));
    }
    return systems;
  }
}

// ─── Commodities ─────────────────────────────────────────────────────────────

/**
 * The 17 classic Elite commodities.
 *
 * econFactor — price delta per economy unit away from centre (3.5).
 *              Negative  → cheaper at agricultural worlds (economy 5–7).
 *              Positive  → cheaper at industrial worlds   (economy 0–2).
 * techFactor — price delta per tech-level unit above 8.
 *              Negative  → cheaper at high-tech systems.
 * govFactor  — price delta per government unit above 3.
 *              Negative  → cheaper in anarchic/lawless worlds (gov 5–7).
 * baseQty    — minimum units available before economy/random modifiers.
 */
export const COMMODITIES = [
  { id:  0, name: 'Food',         unit: 't',  basePrice:  19, econFactor: -2,  techFactor:  0,  govFactor:  0,  baseQty:  6 },
  { id:  1, name: 'Textiles',     unit: 't',  basePrice:  20, econFactor: -1,  techFactor:  0,  govFactor:  0,  baseQty:  8 },
  { id:  2, name: 'Radioactives', unit: 't',  basePrice:  65, econFactor:  3,  techFactor: -1,  govFactor:  0,  baseQty:  2 },
  { id:  3, name: 'Labour Contracts', unit: 't',  basePrice:  40, econFactor: -3,  techFactor:  0,  govFactor: -4,  baseQty:  0 },
  { id:  4, name: 'Liquor/Wines', unit: 't',  basePrice:  55, econFactor: -5,  techFactor:  0,  govFactor:  1,  baseQty:  4 },
  { id:  5, name: 'Luxuries',     unit: 't',  basePrice: 105, econFactor:  6,  techFactor: -2,  govFactor:  2,  baseQty:  0 },
  { id:  6, name: 'Narcotics',    unit: 't',  basePrice: 115, econFactor: -9,  techFactor:  0,  govFactor: -6,  baseQty:  0 },
  { id:  7, name: 'Computers',    unit: 't',  basePrice: 155, econFactor:  6,  techFactor: -4,  govFactor:  1,  baseQty:  0 },
  { id:  8, name: 'Machinery',    unit: 't',  basePrice: 117, econFactor:  4,  techFactor: -3,  govFactor:  0,  baseQty:  3 },
  { id:  9, name: 'Alloys',       unit: 't',  basePrice:  78, econFactor:  2,  techFactor: -2,  govFactor:  0,  baseQty:  5 },
  { id: 10, name: 'Firearms',     unit: 't',  basePrice: 124, econFactor:  4,  techFactor: -3,  govFactor: -3,  baseQty:  0 },
  { id: 11, name: 'Furs',         unit: 't',  basePrice: 176, econFactor: -9,  techFactor:  0,  govFactor:  0,  baseQty:  0 },
  { id: 12, name: 'Minerals',     unit: 't',  basePrice:  32, econFactor:  1,  techFactor:  1,  govFactor:  0,  baseQty: 10 },
  { id: 13, name: 'Gold',         unit: 'kg', basePrice:  97, econFactor:  1,  techFactor: -1,  govFactor:  0,  baseQty:  3 },
  { id: 14, name: 'Platinum',     unit: 'kg', basePrice: 171, econFactor:  2,  techFactor: -2,  govFactor:  0,  baseQty:  1 },
  { id: 15, name: 'Gem-Stones',   unit: 'g',  basePrice:  45, econFactor:  1,  techFactor: -1,  govFactor:  0,  baseQty:  2 },
  { id: 16, name: 'Alien Items',  unit: 't',  basePrice:  53, econFactor:  0,  techFactor:  0,  govFactor:  0,  baseQty:  0 },
];

/**
 * Generate deterministic market prices for a star system.
 * Prices and quantities incorporate economy type, tech level, and government.
 * Results are seeded from the system id — identical on every visit.
 *
 * @param {object} system — star system object from generateSystem()
 * @returns {Array<{id:number, name:string, unit:string, price:number, qty:number}>}
 */
export function getMarketPrices(system) {
  // Per-system LCG provides deterministic noise (same prices every visit).
  const seed = (Math.imul(system.id + 1, 0x9E3779B9) ^ 0x4A2B3C1D) >>> 0;
  const lcg  = new LCG(seed === 0 ? 1 : seed);
  lcg.nextInt(); lcg.nextInt();  // warm up

  return COMMODITIES.map(c => {
    // Economy modifier: economy 0 = Rich Industrial, 7 = Poor Agricultural.
    const econAdj = Math.round(c.econFactor * (system.economy - 3.5));
    // Tech modifier: cheapens high-tech goods at advanced systems.
    const techAdj = Math.round(c.techFactor * (system.techLevel - 8) * 0.5);
    // Government modifier: illegal goods cheaper in lawless worlds.
    const govAdj  = Math.round(c.govFactor  * (system.government - 3.5));
    // Small deterministic noise (±8 %).
    const noise   = Math.round((lcg.nextFloat() * 2 - 1) * c.basePrice * 0.08);
    const price   = Math.max(2, c.basePrice + econAdj + techAdj + govAdj + noise);

    // Quantity: agricultural goods more plentiful at agricultural worlds,
    // industrial goods more plentiful at industrial worlds.
    // Illegal goods (govFactor < 0) more plentiful in anarchic systems.
    const econQtyBoost = c.econFactor < 0
      ? Math.floor(-c.econFactor * Math.max(0, system.economy - 3) * 0.4)
      : Math.floor( c.econFactor * Math.max(0, 3 - system.economy) * 0.4);
    const govQtyBoost  = c.govFactor < 0
      ? Math.floor(-c.govFactor  * Math.max(0, system.government - 3) * 0.3)
      : 0;
    const qtyNoise     = Math.floor(lcg.nextFloat() * 7);
    const qty          = Math.max(0, c.baseQty + econQtyBoost + govQtyBoost + qtyNoise);

    return { id: c.id, name: c.name, unit: c.unit, price, qty };
  });
}

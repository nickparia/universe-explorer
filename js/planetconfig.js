// planetconfig.js — Per-planet terrain, atmosphere, and surface configuration
// Used by terrain system, atmosphere renderer, gas giant dive, and HUD

/**
 * @typedef {Object} TerrainConfig
 * @property {string} type — 'rocky' | 'gas' | 'ice' | 'none'
 * @property {number} heightScale — max terrain height in scene units
 * @property {number} craterDensity — 0-1, how many craters
 * @property {number} roughness — fractal roughness 0-1
 * @property {string[]} biomes — terrain biome types
 * @property {Object[]} macroFeatures — large-scale features (canyons, basins, volcanoes)
 */

/**
 * @typedef {Object} AtmosphereConfig
 * @property {boolean} hasAtmosphere
 * @property {number} density — relative to Earth (1.0)
 * @property {number} scaleHeight — in scene units (relative to planet radius)
 * @property {number[]} rayleighCoeff — [r, g, b] scattering coefficients
 * @property {number[]} mieCoeff — Mie scattering coefficient
 * @property {number} mieG — Mie scattering direction (-1 to 1)
 * @property {string} skyTint — hex color for simplified atmosphere
 * @property {Object[]} cloudLayers — altitude bands for clouds
 * @property {string} particleType — 'dust' | 'rain' | 'ice' | 'ash' | 'none'
 */

/**
 * @typedef {Object} GasGiantConfig
 * @property {number} crushDepthNorm — altitudeNorm at which ejection triggers
 * @property {string} bandColor1 — primary band color hex
 * @property {string} bandColor2 — secondary band color hex
 * @property {number} windIntensity — 0-1, drives horizontal camera shake
 * @property {boolean} lightning — whether lightning flashes occur
 * @property {string} desc — description for deep atmosphere phase
 */

export const PLANET_CONFIGS = {
  SUN: {
    terrain: { type: 'none' },
    atmosphere: { hasAtmosphere: false },
    info: {
      type: 'G-TYPE MAIN SEQUENCE STAR',
      facts: ['Diameter: 1,391,000 km', 'Surface temp: 5,500\u00b0C', 'Age: 4.6 billion years'],
      lore: 'Our star. It contains 99.86% of all mass in the solar system.',
    },
  },

  MERCURY: {
    terrain: {
      type: 'rocky',
      heightScale: 0.8,
      craterDensity: 0.9,
      roughness: 0.7,
      biomes: ['crater_field', 'smooth_plains', 'scarps'],
      macroFeatures: [
        { name: 'Caloris Basin', type: 'depression', lat: 30, lon: 170, radius: 0.15, depth: 0.6 },
      ],
    },
    atmosphere: { hasAtmosphere: false },
    surface: {
      skyColor: null,
      sunAppSize: 2.5,
      temperature: { day: 430, night: -180, unit: '\u00b0C' },
      pressure: 0,
    },
    info: {
      type: 'TERRESTRIAL PLANET',
      facts: ['Diameter: 4,879 km', 'Distance from Sun: 0.39 AU', 'Day length: 176 Earth days'],
      lore: 'The smallest planet. Its cratered surface resembles our Moon, unchanged for billions of years.',
    },
  },

  VENUS: {
    terrain: {
      type: 'rocky',
      heightScale: 0.5,
      craterDensity: 0.2,
      roughness: 0.4,
      biomes: ['volcanic_plains', 'shield_volcano', 'tessera'],
      macroFeatures: [
        { name: 'Maat Mons', type: 'volcano', lat: 0.5, lon: 194, radius: 0.05, height: 0.8 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 90,
      scaleHeight: 0.04, // relative to radius
      rayleighCoeff: [0.8, 0.5, 0.1],
      mieCoeff: [0.02],
      mieG: 0.76,
      skyTint: '#cc9933',
      cloudLayers: [
        { altNorm: 0.15, thickness: 0.05, opacity: 0.95, color: '#ddaa44' }, // sulfuric acid deck
      ],
      particleType: 'ash',
      visibility: 0.05, // fraction of normal (very low)
    },
    surface: {
      skyColor: '#aa7722',
      sunAppSize: 0.9,
      temperature: { value: 465, unit: '°C' },
      pressure: 92, // atm
      surfaceGlow: '#331100',
    },
    info: {
      type: 'TERRESTRIAL PLANET',
      facts: ['Diameter: 12,104 km', 'Surface temp: 465\u00b0C (hottest planet)', 'Day length: 243 Earth days (retrograde)'],
      lore: 'Shrouded in sulphuric acid clouds. A runaway greenhouse turned it into an inferno.',
    },
  },

  EARTH: {
    terrain: {
      type: 'rocky',
      heightScale: 1.0,
      craterDensity: 0.01,
      roughness: 0.5,
      biomes: ['ocean', 'mountain', 'plains', 'desert', 'ice_cap'],
      macroFeatures: [],
      oceanLevel: 0.4, // fraction of height range that is ocean
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 1.0,
      scaleHeight: 0.042, // ~8.5km / 200km radius in scene
      rayleighCoeff: [5.5e-6, 13.0e-6, 22.4e-6],
      mieCoeff: [21e-6],
      mieG: 0.758,
      skyTint: '#4488cc',
      cloudLayers: [
        { altNorm: 0.01, thickness: 0.005, opacity: 0.6, color: '#ffffff' },  // cumulus ~2km
        { altNorm: 0.05, thickness: 0.01, opacity: 0.3, color: '#eeeeff' },   // cirrus ~10km
      ],
      particleType: 'rain',
    },
    surface: {
      skyColor: '#6699cc',
      sunAppSize: 1.0,
      temperature: { value: 15, unit: '°C' },
      pressure: 1.0,
    },
    info: {
      type: 'TERRESTRIAL PLANET',
      facts: ['Diameter: 12,742 km', 'Only known world with liquid surface water', 'One natural satellite'],
      lore: 'The pale blue dot. Home to every human who has ever lived.',
    },
  },

  MOON: {
    terrain: {
      type: 'rocky',
      heightScale: 0.6,
      craterDensity: 0.85,
      roughness: 0.65,
      biomes: ['highland', 'mare', 'crater_field'],
      macroFeatures: [],
    },
    atmosphere: { hasAtmosphere: false },
    surface: {
      skyColor: null,
      sunAppSize: 1.0,
      temperature: { day: 127, night: -173, unit: '°C' },
      pressure: 0,
      earthVisible: true,
    },
    info: {
      type: 'NATURAL SATELLITE',
      facts: ['Diameter: 3,474 km', 'Distance: 384,400 km from Earth', 'Tidally locked (same face always visible)'],
      lore: 'Humanity\u2019s first destination beyond Earth. Twelve people have walked its surface.',
    },
  },

  MARS: {
    terrain: {
      type: 'rocky',
      heightScale: 1.2,
      craterDensity: 0.4,
      roughness: 0.6,
      biomes: ['red_desert', 'canyon', 'crater_field', 'polar_ice'],
      macroFeatures: [
        { name: 'Valles Marineris', type: 'canyon', lat: -14, lon: -70, radius: 0.2, depth: 1.0 },
        { name: 'Olympus Mons', type: 'volcano', lat: 18, lon: -134, radius: 0.08, height: 1.5 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 0.006,
      scaleHeight: 0.1, // ~11km / 110km scene radius... proportionally thicker
      rayleighCoeff: [19.918e-6, 13.57e-6, 5.75e-6], // inverted from Earth — blue sunsets
      mieCoeff: [40e-6], // dusty
      mieG: 0.65,
      skyTint: '#bb8855',
      cloudLayers: [
        { altNorm: 0.03, thickness: 0.02, opacity: 0.15, color: '#ddccaa' }, // thin dust
      ],
      particleType: 'dust',
    },
    surface: {
      skyColor: '#bb8855',
      sunAppSize: 0.65,
      temperature: { value: -63, unit: '°C' },
      pressure: 0.006,
      dustDevils: true,
    },
    info: {
      type: 'TERRESTRIAL PLANET',
      facts: ['Diameter: 6,779 km', 'Home to Olympus Mons (tallest volcano)', 'Valles Marineris: 4,000 km canyon'],
      lore: 'Named for the Roman god of war. Its rusty surface has fascinated observers for millennia.',
    },
  },

  JUPITER: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 1000, // effectively infinite
      scaleHeight: 0.02,
      rayleighCoeff: [3.0e-6, 5.0e-6, 8.0e-6],
      mieCoeff: [50e-6],
      mieG: 0.8,
      skyTint: '#aa8844',
      cloudLayers: [
        { altNorm: 0.3, thickness: 0.1, opacity: 0.7, color: '#ddaa66' },
        { altNorm: 0.15, thickness: 0.08, opacity: 0.85, color: '#aa7744' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.15,
      bandColor1: '#cc9955',
      bandColor2: '#884422',
      windIntensity: 0.6,
      lightning: true,
      desc: 'Hydrogen ocean beneath. Pressure exceeds 1 million atmospheres.',
    },
    info: {
      type: 'GAS GIANT',
      facts: ['Diameter: 139,820 km (11x Earth)', 'Great Red Spot: storm wider than Earth', '95 known moons including Europa'],
      lore: 'King of the planets. Its immense gravity shapes the architecture of the solar system.',
    },
  },

  SATURN: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 500,
      scaleHeight: 0.025,
      rayleighCoeff: [4.0e-6, 6.0e-6, 7.0e-6],
      mieCoeff: [30e-6],
      mieG: 0.75,
      skyTint: '#ccaa66',
      cloudLayers: [
        { altNorm: 0.25, thickness: 0.1, opacity: 0.5, color: '#eedd88' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.18,
      bandColor1: '#eedd88',
      bandColor2: '#aa9955',
      windIntensity: 0.4,
      lightning: false,
      desc: 'Metallic hydrogen mantle. Ring shadows dance across the clouds.',
    },
    info: {
      type: 'GAS GIANT',
      facts: ['Diameter: 116,460 km (9.5x Earth)', 'Ring system: 282,000 km wide, mostly ice', '146 known moons including Titan'],
      lore: 'The jewel of the solar system. Galileo first observed its rings in 1610.',
    },
  },

  URANUS: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 200,
      scaleHeight: 0.03,
      rayleighCoeff: [2.0e-6, 8.0e-6, 12.0e-6],
      mieCoeff: [15e-6],
      mieG: 0.7,
      skyTint: '#88ccdd',
      cloudLayers: [
        { altNorm: 0.2, thickness: 0.08, opacity: 0.4, color: '#99ddee' },
      ],
      particleType: 'ice',
    },
    gasGiant: {
      crushDepthNorm: 0.2,
      bandColor1: '#88ccdd',
      bandColor2: '#5599aa',
      windIntensity: 0.3,
      lightning: false,
      desc: 'Water-ammonia ocean. 98\u00b0 axial tilt creates extreme seasons.',
    },
    info: {
      type: 'ICE GIANT',
      facts: ['Diameter: 50,724 km (4x Earth)', 'Axial tilt: 98\u00b0 (rolls on its side)', '28 known moons'],
      lore: 'The sideways planet. Struck by a massive impact that tipped it on its axis.',
    },
  },

  NEPTUNE: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 300,
      scaleHeight: 0.025,
      rayleighCoeff: [1.0e-6, 4.0e-6, 15.0e-6],
      mieCoeff: [20e-6],
      mieG: 0.72,
      skyTint: '#3355aa',
      cloudLayers: [
        { altNorm: 0.22, thickness: 0.1, opacity: 0.6, color: '#4466bb' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.18,
      bandColor1: '#3355aa',
      bandColor2: '#222266',
      windIntensity: 1.0, // fastest winds in solar system
      lightning: true,
      desc: 'Supersonic methane winds. Diamond rain in the deep interior.',
    },
    info: {
      type: 'ICE GIANT',
      facts: ['Diameter: 49,528 km (3.9x Earth)', 'Fastest winds in solar system (2,100 km/h)', '16 known moons including Triton'],
      lore: 'The windswept blue world. So distant that light from the Sun takes 4 hours to arrive.',
    },
  },

  PLUTO: {
    terrain: {
      type: 'ice',
      heightScale: 0.3,
      craterDensity: 0.15,
      roughness: 0.3,
      biomes: ['nitrogen_ice', 'ice_mountains'],
      macroFeatures: [
        { name: 'Sputnik Planitia', type: 'basin', lat: 25, lon: -175, radius: 0.12, depth: 0.1 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 0.00001,
      scaleHeight: 0.15,
      rayleighCoeff: [1.0e-6, 1.5e-6, 2.0e-6],
      mieCoeff: [5e-6],
      mieG: 0.6,
      skyTint: '#111118',
      cloudLayers: [],
      particleType: 'none',
      visibility: 0.8,
    },
    surface: {
      skyColor: '#0a0a12',
      sunAppSize: 0.04,
      temperature: { value: -230, unit: '°C' },
      pressure: 0.00001,
    },
    info: {
      type: 'DWARF PLANET',
      facts: ['Diameter: 2,377 km', 'Distance: 39.5 AU from Sun', 'Heart-shaped nitrogen glacier (Sputnik Planitia)'],
      lore: 'Once the ninth planet. New Horizons revealed a complex, geologically active world in 2015.',
    },
  },

  // ── Spacecraft ──
  'VOYAGER 1': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'DEEP SPACE PROBE',
      facts: ['Launched: September 5, 1977', 'Distance: 163 AU (24.4 billion km)', 'Speed: 17 km/s relative to Sun'],
      lore: 'The farthest human-made object. Still transmitting from interstellar space. Carries the Golden Record — a message to the cosmos.' },
  },
  'VOYAGER 2': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'DEEP SPACE PROBE',
      facts: ['Launched: August 20, 1977', 'Distance: 137 AU (20.5 billion km)', 'Only craft to visit all 4 gas giants'],
      lore: 'Twin of Voyager 1. Its Grand Tour of Jupiter, Saturn, Uranus, and Neptune was a once-in-176-years alignment.' },
  },
  'NEW HORIZONS': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'DEEP SPACE PROBE',
      facts: ['Launched: January 19, 2006', 'Pluto flyby: July 14, 2015', 'Now exploring the Kuiper Belt'],
      lore: 'Carried a portion of Clyde Tombaugh\'s ashes — the man who discovered Pluto — to the world he found.' },
  },
  'JWST': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'SPACE TELESCOPE',
      facts: ['Launched: December 25, 2021', 'Location: Sun-Earth L2 (1.5 million km)', '6.5m gold-plated beryllium mirror'],
      lore: 'Seeing the universe in infrared light. Its first deep field image revealed galaxies formed just 600 million years after the Big Bang.' },
  },
  'ISS': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'SPACE STATION',
      facts: ['Altitude: 420 km above Earth', 'Speed: 7.66 km/s (orbits every 90 min)', 'Continuously crewed since Nov 2, 2000'],
      lore: 'A collaboration of 15 nations. The third brightest object in the night sky. Humanity\'s home in orbit.' },
  },
  'HUBBLE': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'SPACE TELESCOPE',
      facts: ['Launched: April 24, 1990', 'Altitude: 540 km above Earth', '2.4m primary mirror, observes UV/visible/near-IR'],
      lore: 'Changed our understanding of the universe. The Hubble Deep Field revealed thousands of galaxies in a patch of sky the size of a grain of sand.' },
  },

  // ── Notable moons ──
  'IO': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'JOVIAN MOON', facts: ['Diameter: 3,643 km', '400+ active volcanoes', 'Resurfaces itself every million years'], lore: 'The most volcanically active body in the solar system. Tidal forces from Jupiter keep its interior molten.' },
  },
  'EUROPA': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'JOVIAN MOON', facts: ['Diameter: 3,122 km', 'Ice shell: 15-25 km thick', 'Subsurface ocean: ~100 km deep'], lore: 'The prime candidate for extraterrestrial life. More water than all of Earth\'s oceans combined, hidden beneath ice.' },
  },
  'GANYMEDE': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'JOVIAN MOON', facts: ['Diameter: 5,268 km (larger than Mercury)', 'Has its own magnetic field', 'Subsurface ocean between ice layers'], lore: 'The largest moon in the solar system. The only moon known to generate its own magnetosphere.' },
  },
  'CALLISTO': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'JOVIAN MOON', facts: ['Diameter: 4,821 km', 'Most heavily cratered object known', 'Surface unchanged for 4 billion years'], lore: 'An ancient, battered world. Its distance from Jupiter makes it a candidate for a future human base.' },
  },
  'TITAN': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: true, density: 1.5 },
    info: { type: 'SATURNIAN MOON', facts: ['Diameter: 5,150 km (larger than Mercury)', 'Dense nitrogen atmosphere', 'Methane lakes, rivers, and rain'], lore: 'The only moon with a thick atmosphere. Huygens probe landed here in 2005, revealing an alien yet eerily Earth-like landscape.' },
  },
  'ENCELADUS': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'SATURNIAN MOON', facts: ['Diameter: 504 km', 'South pole geysers spray water ice', 'Subsurface ocean confirmed by Cassini'], lore: 'Tiny, brilliant white, and hiding a secret ocean. Its geysers feed Saturn\'s E ring with fresh ice particles.' },
  },
  'TRITON': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: { type: 'NEPTUNIAN MOON', facts: ['Diameter: 2,707 km', 'Retrograde orbit (orbits backwards)', 'Nitrogen geysers erupt 8 km high'], lore: 'A captured Kuiper Belt object. Orbiting backwards, it is slowly spiraling inward and will one day be torn apart by Neptune.' },
  },

  // ── Deep Space Landmarks ──
  'PILLARS OF CREATION': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Emission Nebula',
      facts: ['6,500 light-years from Earth', 'Part of the Eagle Nebula (M16)', 'Columns about 5 light-years tall', 'First photographed by Hubble in 1995'],
      lore: 'Towers of gas and dust where new stars are born at their tips. The pillars may have already been destroyed by a supernova, but the light showing their destruction won\'t reach us for another 1,000 years.',
    },
  },
  'CRAB NEBULA': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Supernova Remnant',
      facts: ['6,500 light-years from Earth', 'Remnant of supernova observed in 1054 AD', 'Central pulsar spins 30 times per second', 'Expanding at 1,500 km/s'],
      lore: 'Chinese and Arab astronomers recorded a "guest star" so bright it was visible in daylight for weeks. What they witnessed was the violent death of a massive star, leaving behind this ghostly, pulsating nebula.',
    },
  },
  'UY SCUTI': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Red Supergiant Star',
      facts: ['9,500 light-years from Earth', 'Radius: ~1,700 times the Sun', 'Would engulf Jupiter\'s orbit if placed at the Sun', 'Surface temperature: ~3,365 K'],
      lore: 'One of the largest known stars, so vast that light itself takes over five hours to circumnavigate it. A dying colossus, bloated and reddened, exhaling its outer layers into the void.',
    },
  },
  'CARINA NEBULA': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Emission Nebula',
      facts: ['8,500 light-years from Earth', 'Four times larger than the Orion Nebula', 'Contains over 14,000 known stars', 'Home to Eta Carinae and the Keyhole Nebula'],
      lore: 'A churning stellar nursery where massive stars are born, burn furiously, and die in spectacular explosions. JWST revealed hundreds of previously hidden newborn stars embedded in its dusty pillars.',
    },
  },
  'RING NEBULA': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Planetary Nebula',
      facts: ['2,300 light-years from Earth', 'Located in the constellation Lyra', 'About 1 light-year in diameter', 'Central white dwarf temperature: 120,000 K'],
      lore: 'The glowing shroud of a Sun-like star that exhausted its fuel. Its central white dwarf, smaller than Earth but denser than lead, illuminates the expanding shell of gas it once called its atmosphere.',
    },
  },
  'HORSEHEAD NEBULA': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Dark Nebula',
      facts: ['1,375 light-years from Earth', 'Located in the constellation Orion', 'About 3.5 light-years tall', 'Silhouetted against IC 434 emission nebula'],
      lore: 'A pillar of cold, dense dust sculpted by stellar winds into the unmistakable profile of a horse\'s head. Within its dark interior, new stars are secretly forming, hidden from view until they burn their way free.',
    },
  },
  'ETA CARINAE': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Luminous Blue Variable',
      facts: ['7,500 light-years from Earth', 'Mass: ~100 times the Sun', 'Luminosity: 5 million times the Sun', 'Great Eruption of 1843 made it the 2nd brightest star'],
      lore: 'A titanic binary star system teetering on the edge of annihilation. When it finally detonates as a hypernova, it will outshine its entire galaxy for weeks and may produce a gamma-ray burst visible across the universe.',
    },
  },
  'MAGNETAR': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Neutron Star',
      facts: ['Magnetic field: 10^15 gauss', 'Diameter: ~20 km', 'Density: 1 teaspoon weighs ~1 billion tons', 'Starquakes release more energy than the Sun emits in 100,000 years'],
      lore: 'The compressed corpse of a massive star, spinning and crackling with the strongest magnetic fields in the universe. At half the distance to the Moon, its field would erase every credit card on Earth.',
    },
  },
  'SAGITTARIUS A*': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Supermassive Black Hole',
      facts: ['26,000 light-years from Earth', 'Mass: 4 million times the Sun', 'Event horizon diameter: ~24 million km', 'First imaged by Event Horizon Telescope in 2022'],
      lore: 'The dark heart of our galaxy. Stars orbit it at thousands of kilometers per second, their paths tracing the invisible geometry of warped spacetime. Nothing that crosses its boundary will ever return.',
    },
  },
  'ANDROMEDA GALAXY': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Spiral Galaxy',
      facts: ['2.5 million light-years from Earth', 'Contains roughly 1 trillion stars', 'Approaching the Milky Way at 110 km/s', 'Diameter: ~220,000 light-years'],
      lore: 'The nearest large galaxy and our inevitable future partner. In 4.5 billion years, it will collide and merge with the Milky Way, reshaping both galaxies into a single elliptical giant sometimes called Milkomeda.',
    },
  },
  'SOMBRERO GALAXY': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Spiral Galaxy',
      facts: ['31 million light-years from Earth', 'Diameter: ~50,000 light-years', 'Prominent dust lane and bright nucleus', 'Contains ~100 billion stars'],
      lore: 'Named for its resemblance to a wide-brimmed hat, this galaxy\'s brilliant white core is surrounded by a dramatic ring of dust. A supermassive black hole one billion times the Sun\'s mass lurks at its center.',
    },
  },
  'BOOTES VOID': {
    terrain: { type: 'none' }, atmosphere: { hasAtmosphere: false },
    info: {
      type: 'Cosmic Void',
      facts: ['700 million light-years from Earth', '330 million light-years in diameter', 'Contains only ~60 galaxies', 'Discovered in 1981 by Robert Kirshner et al.'],
      lore: 'A sphere of almost perfect emptiness in the cosmic web. If the Milky Way were at its center, we would not have discovered other galaxies until the 1960s. Its existence challenges our understanding of how the universe\'s largest structures form.',
    },
  },
};

/**
 * Get config for a planet by name.
 * @param {string} name — planet name in uppercase (e.g. 'EARTH')
 * @returns {Object|null}
 */
export function getPlanetConfig(name) {
  return PLANET_CONFIGS[name] || null;
}

// catalog.js — the single source of truth for deep-space locations.
//
// Every system consumes this: deepspace.js builds the visuals, music.js
// picks the soundtrack, hud.js shows the info card, navigation.js and
// starmap.js list the destinations. Adding a location = adding one entry
// here (plus a visual: either an existing procedural renderer key, or a
// new one registered via registerVisualRenderer in deepspace.js).
//
// Schema per entry:
//   id      stable kebab-case identifier (also the R2 key prefix for
//           imagery: locations/<id>/...)
//   name    display name, uppercase — also the runtime lookup key used
//           by flyTo/warpTo and the carousel
//   tier    'interstellar' | 'intergalactic' — sets distance scale
//   dist    distance from origin in AU (before tier scaling)
//   angle   azimuth in radians (position on the sky sphere)
//   phi     elevation in radians
//   size    visual radius in scene units
//   color   base tint for glow/light
//   visual  procedural renderer key (see VISUAL_RENDERERS in deepspace.js)
//   imagery optional NASA imagery tiers served from R2, e.g.
//           { preview: 'locations/<id>/preview.jpg', close: 'locations/<id>/8k.jpg' }
//   music   playlist for the location's zone (first track plays on arrival)
//   desc    one-liner for carousel hover / arrival toast
//   info    full info card: { type, facts[], lore }

export const LOCATIONS = [
  // ─── Interstellar tier (stellar neighborhood) ───
  {
    id: 'pillars-of-creation',
    name: 'PILLARS OF CREATION',
    tier: 'interstellar', dist: 4000, angle: 1.8, phi: 0.4,
    size: 500, color: 0xffaa44, visual: 'pillars',
    imagery: null,
    music: ['audio/bach_air.mp3'],
    desc: 'Towering columns of interstellar gas in the Eagle Nebula, 6,500 light-years distant. Star-forming region immortalized by Hubble.',
    info: {
      type: 'Emission Nebula',
      facts: ['6,500 light-years from Earth', 'Part of the Eagle Nebula (M16)', 'Columns about 5 light-years tall', 'First photographed by Hubble in 1995'],
      lore: 'Towers of gas and dust where new stars are born at their tips. The pillars may have already been destroyed by a supernova, but the light showing their destruction won\'t reach us for another 1,000 years.',
    },
  },
  {
    id: 'crab-nebula',
    name: 'CRAB NEBULA',
    tier: 'interstellar', dist: 5000, angle: 3.5, phi: -0.3,
    size: 350, color: 0xff6644, visual: 'crab',
    imagery: null,
    music: ['audio/vivaldi_winter_largo.mp3'],
    desc: 'Supernova remnant from 1054 AD. A pulsar at its heart spins 30 times per second, powering the expanding filaments.',
    info: {
      type: 'Supernova Remnant',
      facts: ['6,500 light-years from Earth', 'Remnant of supernova observed in 1054 AD', 'Central pulsar spins 30 times per second', 'Expanding at 1,500 km/s'],
      lore: 'Chinese and Arab astronomers recorded a "guest star" so bright it was visible in daylight for weeks. What they witnessed was the violent death of a massive star, leaving behind this ghostly, pulsating nebula.',
    },
  },
  {
    id: 'uy-scuti',
    name: 'UY SCUTI',
    tier: 'interstellar', dist: 6000, angle: 0.8, phi: 0.15,
    size: 600, color: 0xff4422, visual: 'hypergiant',
    imagery: null,
    music: ['audio/barber_adagio.mp3'],
    desc: 'One of the largest known stars. If placed at the Sun, its surface would engulf Jupiter\'s orbit.',
    info: {
      type: 'Red Supergiant Star',
      facts: ['9,500 light-years from Earth', 'Radius: ~1,700 times the Sun', 'Would engulf Jupiter\'s orbit if placed at the Sun', 'Surface temperature: ~3,365 K'],
      lore: 'One of the largest known stars, so vast that light itself takes over five hours to circumnavigate it. A dying colossus, bloated and reddened, exhaling its outer layers into the void.',
    },
  },
  {
    id: 'carina-nebula',
    name: 'CARINA NEBULA',
    tier: 'interstellar', dist: 5500, angle: 4.8, phi: 0.7,
    size: 550, color: 0xff8855, visual: 'carina',
    imagery: null,
    music: ['audio/inner_clair_de_lune.mp3'],
    desc: 'A vast star-forming region four times larger than the Orion Nebula. Home to Eta Carinae and the Keyhole Nebula.',
    info: {
      type: 'Emission Nebula',
      facts: ['8,500 light-years from Earth', 'Four times larger than the Orion Nebula', 'Contains over 14,000 known stars', 'Home to Eta Carinae and the Keyhole Nebula'],
      lore: 'A churning stellar nursery where massive stars are born, burn furiously, and die in spectacular explosions. JWST revealed hundreds of previously hidden newborn stars embedded in its dusty pillars.',
    },
  },
  {
    id: 'ring-nebula',
    name: 'RING NEBULA',
    tier: 'interstellar', dist: 3500, angle: 2.5, phi: -0.6,
    size: 300, color: 0x44aaff, visual: 'ring',
    imagery: null,
    music: ['audio/albinoni_adagio.mp3'],
    desc: 'A planetary nebula in Lyra, the glowing shell of gas expelled by a dying Sun-like star 2,300 light-years away.',
    info: {
      type: 'Planetary Nebula',
      facts: ['2,300 light-years from Earth', 'Located in the constellation Lyra', 'About 1 light-year in diameter', 'Central white dwarf temperature: 120,000 K'],
      lore: 'The glowing shroud of a Sun-like star that exhausted its fuel. Its central white dwarf, smaller than Earth but denser than lead, illuminates the expanding shell of gas it once called its atmosphere.',
    },
  },
  {
    id: 'horsehead-nebula',
    name: 'HORSEHEAD NEBULA',
    tier: 'interstellar', dist: 4500, angle: 5.5, phi: -0.15,
    size: 400, color: 0xcc4422, visual: 'horsehead',
    imagery: null,
    music: ['audio/satie_gymnopedie.mp3'],
    desc: 'An iconic dark nebula in Orion, its silhouette shaped by dense dust blocking the glow of emission nebula IC 434.',
    info: {
      type: 'Dark Nebula',
      facts: ['1,375 light-years from Earth', 'Located in the constellation Orion', 'About 3.5 light-years tall', 'Silhouetted against IC 434 emission nebula'],
      lore: 'A pillar of cold, dense dust sculpted by stellar winds into the unmistakable profile of a horse\'s head. Within its dark interior, new stars are secretly forming, hidden from view until they burn their way free.',
    },
  },
  {
    id: 'eta-carinae',
    name: 'ETA CARINAE',
    tier: 'interstellar', dist: 5800, angle: 1.2, phi: 0.85,
    size: 450, color: 0xffcc33, visual: 'eta_carinae',
    imagery: null,
    music: ['audio/grieg_mountain_king.mp3'],
    desc: 'A massive binary star system on the brink of supernova. Its Great Eruption in 1843 briefly made it the second-brightest star.',
    info: {
      type: 'Luminous Blue Variable',
      facts: ['7,500 light-years from Earth', 'Mass: ~100 times the Sun', 'Luminosity: 5 million times the Sun', 'Great Eruption of 1843 made it the 2nd brightest star'],
      lore: 'A titanic binary star system teetering on the edge of annihilation. When it finally detonates as a hypernova, it will outshine its entire galaxy for weeks and may produce a gamma-ray burst visible across the universe.',
    },
  },
  {
    id: 'magnetar',
    name: 'MAGNETAR',
    tier: 'interstellar', dist: 3000, angle: 0.3, phi: -0.9,
    size: 200, color: 0xcc66ff, visual: 'magnetar',
    imagery: null,
    music: ['audio/paganini_caprice24.mp3'],
    desc: 'A neutron star with a magnetic field a quadrillion times stronger than Earth\'s. Occasional starquakes release enormous gamma-ray bursts.',
    info: {
      type: 'Neutron Star',
      facts: ['Magnetic field: 10^15 gauss', 'Diameter: ~20 km', 'Density: 1 teaspoon weighs ~1 billion tons', 'Starquakes release more energy than the Sun emits in 100,000 years'],
      lore: 'The compressed corpse of a massive star, spinning and crackling with the strongest magnetic fields in the universe. At half the distance to the Moon, its field would erase every credit card on Earth.',
    },
  },

  // ─── Intergalactic tier (galaxy scale) ───
  {
    id: 'sagittarius-a-star',
    name: 'SAGITTARIUS A*',
    tier: 'intergalactic', dist: 8000, angle: 4.0, phi: -0.2,
    size: 700, color: 0xff8800, visual: 'supermassive_bh',
    imagery: null,
    music: ['audio/moonlight_sonata.mp3'],
    desc: 'The supermassive black hole at the center of the Milky Way. Four million solar masses warping spacetime.',
    info: {
      type: 'Supermassive Black Hole',
      facts: ['26,000 light-years from Earth', 'Mass: 4 million times the Sun', 'Event horizon diameter: ~24 million km', 'First imaged by Event Horizon Telescope in 2022'],
      lore: 'The dark heart of our galaxy. Stars orbit it at thousands of kilometers per second, their paths tracing the invisible geometry of warped spacetime. Nothing that crosses its boundary will ever return.',
    },
  },
  {
    id: 'andromeda-galaxy',
    name: 'ANDROMEDA GALAXY',
    tier: 'intergalactic', dist: 120000, angle: 5.2, phi: 0.5,
    size: 800, color: 0x8899dd, visual: 'spiral_galaxy',
    imagery: null,
    music: ['audio/vivaldi_spring_largo.mp3'],
    desc: '2.5 million light-years away with one trillion stars. Approaching us at 110 km/s for a collision in 4.5 billion years.',
    info: {
      type: 'Spiral Galaxy',
      facts: ['2.5 million light-years from Earth', 'Contains roughly 1 trillion stars', 'Approaching the Milky Way at 110 km/s', 'Diameter: ~220,000 light-years'],
      lore: 'The nearest large galaxy and our inevitable future partner. In 4.5 billion years, it will collide and merge with the Milky Way, reshaping both galaxies into a single elliptical giant sometimes called Milkomeda.',
    },
  },
  {
    id: 'sombrero-galaxy',
    name: 'SOMBRERO GALAXY',
    tier: 'intergalactic', dist: 150000, angle: 2.0, phi: -0.7,
    size: 750, color: 0xddaa66, visual: 'sombrero_galaxy',
    imagery: null,
    music: ['audio/pachelbel_canon.mp3'],
    desc: 'A striking spiral galaxy with a bright nucleus and prominent dust lane, 31 million light-years away in Virgo.',
    info: {
      type: 'Spiral Galaxy',
      facts: ['31 million light-years from Earth', 'Diameter: ~50,000 light-years', 'Prominent dust lane and bright nucleus', 'Contains ~100 billion stars'],
      lore: 'Named for its resemblance to a wide-brimmed hat, this galaxy\'s brilliant white core is surrounded by a dramatic ring of dust. A supermassive black hole one billion times the Sun\'s mass lurks at its center.',
    },
  },
  {
    id: 'bootes-void',
    name: 'BOOTES VOID',
    tier: 'intergalactic', dist: 220000, angle: 3.2, phi: 0.3,
    size: 1200, color: 0x112233, visual: 'void',
    imagery: null,
    music: ['audio/part_spiegel.mp3'],
    desc: 'A supervoid 330 million light-years across containing almost no galaxies. One of the emptiest regions in the observable universe.',
    info: {
      type: 'Cosmic Void',
      facts: ['700 million light-years from Earth', '330 million light-years in diameter', 'Contains only ~60 galaxies', 'Discovered in 1981 by Robert Kirshner et al.'],
      lore: 'A sphere of almost perfect emptiness in the cosmic web. If the Milky Way were at its center, we would not have discovered other galaxies until the 1960s. Its existence challenges our understanding of how the universe\'s largest structures form.',
    },
  },
];

// Soundtrack for interstellar warp travel (between locations)
export const WARP_MUSIC = ['audio/bach_chaconne.mp3'];

const byName = new Map(LOCATIONS.map((l) => [l.name, l]));
const byId = new Map(LOCATIONS.map((l) => [l.id, l]));

export function getLocation(name) {
  return byName.get(name) || null;
}

export function getLocationById(id) {
  return byId.get(id) || null;
}

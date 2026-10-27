// Partida de ejemplo para colocar y probar los overlays sin RetroArch. Solo la
// ven el panel y su vista previa, nunca el directo.
import type { RawLocation } from '../shared/hoennMap.js';
import type { RawGame } from './gameWatch.js';
import type { BoxMon, PartyMon } from './gen3save.js';

const box = (species: number, nickname: string, experience: number, shiny = false, ball = 4): BoxMon => ({
  species,
  nickname,
  experience,
  heldItem: 0,
  isEgg: false,
  shiny,
  ball,
});

const mon = (species: number, nickname: string, level: number, hp: number, maxHp: number, extra: Partial<PartyMon> = {}): PartyMon => ({
  ...box(species, nickname, 0),
  level,
  hp,
  maxHp,
  status: 0,
  ...extra,
});

export function demoGame(now: number): RawGame {
  const emptyBox = () => Array.from({ length: 30 }, () => null);
  const boxes = Array.from({ length: 14 }, (_, i) => ({
    name: `CAJA ${i + 1}`,
    wallpaper: [3, 0, 1, 2][i % 4], // sabana primero, como la referencia
    mons: emptyBox() as (BoxMon | null)[],
  }));
  [box(263, 'ZIGZAGOON', 3000), box(265, 'WURMPLE', 500), box(25, 'Chispa', 9000), null, box(133, 'EEVEE', 15000, true), box(280, 'RALTS', 1200), box(255, 'TORCHIC', 400)].forEach(
    (m, i) => (boxes[0].mons[i] = m),
  );
  boxes[2].mons[7] = box(270, 'LOTAD', 800);
  boxes[2].mons[9] = box(252, 'TREECKO', 900);
  boxes[2].mons[14] = { ...box(1, 'Huevo', 0), isEgg: true };
  const seen = new Set<number>([252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 270, 279, 280, 281, 282, 286]);
  const owned = new Set<number>([252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 279, 280, 281, 282, 286]);
  return {
    player: { name: 'ALEX', gender: 'male' },
    party: [
      mon(260, 'SWAMPERT', 38, 121, 131),
      mon(262, 'Colmillos', 33, 40, 98, { ball: 3 }),
      mon(282, 'GARDEVOIR', 31, 85, 85, { shiny: true, ball: 2 }),
      mon(286, 'BRELOOM', 30, 14, 80, { status: 0x08, ball: 8 }),
      mon(279, 'PELIPPER', 29, 0, 79, { ball: 6 }),
      { ...mon(1, 'Huevo', 5, 20, 20), isEgg: true },
    ],
    badges: [true, true, true, true, true, false, false, false],
    money: 48250,
    pockets: {
      items: [13, 22, 14, 24, 68, 85, 86, 19].map((id, i) => ({ id, quantity: [7, 4, 2, 3, 1, 2, 5, 1][i] })),
      balls: [
        { id: 4, quantity: 15 },
        { id: 3, quantity: 6 },
        { id: 2, quantity: 4 },
        { id: 1, quantity: 1 },
      ],
      tmhm: [289, 339, 341].map((id) => ({ id, quantity: 1 })),
      berries: [
        { id: 133, quantity: 4 },
        { id: 139, quantity: 2 },
      ],
      key: [259, 265].map((id) => ({ id, quantity: 1 })),
    },
    seen,
    owned,
    storage: { currentBox: 0, boxes, readAt: now },
  };
}

/** Recorrido a pie (zona del mapa, tipo de mapa, tamaño y trayecto en casillas). */
const LEGS: Array<{ mapsec: number; type: number; w: number; h: number; from: [number, number]; to: [number, number]; ms: number }> = [
  { mapsec: 0, type: 1, w: 20, h: 20, from: [10, 14], to: [10, 0], ms: 2500 }, // Villa Raíz
  { mapsec: 16, type: 3, w: 20, h: 20, from: [10, 19], to: [10, 0], ms: 2500 }, // Ruta 101
  { mapsec: 1, type: 1, w: 20, h: 20, from: [10, 19], to: [0, 10], ms: 2500 }, // Pueblo Escaso
  { mapsec: 17, type: 3, w: 50, h: 20, from: [49, 10], to: [0, 10], ms: 3500 }, // Ruta 102
  { mapsec: 7, type: 2, w: 30, h: 30, from: [29, 15], to: [12, 12], ms: 2500 }, // Ciudad Petalia
  { mapsec: 7, type: 8, w: 0, h: 0, from: [0, 0], to: [0, 0], ms: 2000 }, // Gimnasio (interior)
  { mapsec: 7, type: 2, w: 30, h: 30, from: [12, 12], to: [15, 0], ms: 2000 },
  { mapsec: 19, type: 3, w: 30, h: 80, from: [15, 79], to: [15, 0], ms: 4500 }, // Ruta 104
  { mapsec: 10, type: 2, w: 40, h: 60, from: [20, 59], to: [20, 10], ms: 3500 }, // Ciudad Férrica
];
const TOTAL = LEGS.reduce((n, l) => n + l.ms, 0);

export function demoLocation(now: number): RawLocation {
  let t = now % TOTAL;
  for (const leg of LEGS) {
    if (t < leg.ms) {
      const f = t / leg.ms;
      return {
        mapsec: leg.mapsec,
        mapType: leg.type,
        width: leg.w,
        height: leg.h,
        x: Math.round(leg.from[0] + (leg.to[0] - leg.from[0]) * f),
        y: Math.round(leg.from[1] + (leg.to[1] - leg.from[1]) * f),
      };
    }
    t -= leg.ms;
  }
  return { mapsec: 0, mapType: 1, width: 20, height: 20, x: 10, y: 10 };
}

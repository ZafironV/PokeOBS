// Nivel a partir de la experiencia: los Pokémon de las cajas del PC no guardan su nivel.
// Los nombres son los de growth_rate en PokéAPI.

export type GrowthRate = 'fast' | 'medium' | 'medium-slow' | 'slow' | 'slow-then-very-fast' | 'fast-then-very-slow';

export function expForLevel(rate: GrowthRate, n: number): number {
  if (n <= 1) return 0;
  const n3 = n ** 3;
  switch (rate) {
    case 'fast':
      return Math.floor((4 * n3) / 5);
    case 'medium':
      return n3;
    case 'medium-slow':
      return Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140);
    case 'slow':
      return Math.floor((5 * n3) / 4);
    case 'slow-then-very-fast': // «errático»
      if (n <= 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n <= 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n <= 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case 'fast-then-very-slow': // «fluctuante»
      if (n <= 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n <= 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
  }
}

export function levelFromExp(rate: GrowthRate, exp: number): number {
  let level = 1;
  while (level < 100 && expForLevel(rate, level + 1) <= exp) level++;
  return level;
}

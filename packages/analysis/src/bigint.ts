/** Greatest common divisor of two integers, always >= 0. */
export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Divides all entries by their common divisor; a zero vector stays as it is. */
export function normalize(values: bigint[]): bigint[] {
  let g = 0n;
  for (const v of values) {
    g = gcd(g, v);
    if (g === 1n) return values;
  }
  return g <= 1n ? values : values.map((v) => v / g);
}

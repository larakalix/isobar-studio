const gradients = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

function fade(value: number) {
  // The quintic blend keeps the first and second derivatives smooth at cell boundaries.
  return value ** 3 * (value * (6 * value - 15) + 10);
}

function mix(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

export function createTerrainNoise(seed: number) {
  const gradient = (x: number, y: number, dx: number, dy: number) => {
    const hash = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
    const mixed = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const [a, b] = gradients[(mixed ^ (mixed >>> 16)) & 7];
    return a * dx + b * dy;
  };

  return (x: number, y: number) => {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const dx = x - cellX;
    const dy = y - cellY;
    const u = fade(dx);
    const v = fade(dy);
    const north = mix(gradient(cellX, cellY, dx, dy), gradient(cellX + 1, cellY, dx - 1, dy), u);
    const south = mix(
      gradient(cellX, cellY + 1, dx, dy - 1),
      gradient(cellX + 1, cellY + 1, dx - 1, dy - 1),
      u,
    );
    return mix(north, south, v);
  };
}

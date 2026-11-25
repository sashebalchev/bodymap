// Fewer points per stroke: the map stays small, and the file with it. Ramer-Douglas-Peucker on flat x,y lists.
export function simplify(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = points[a] as [number, number];
    const [bx, by] = points[b] as [number, number];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, farDist = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i] as [number, number];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > farDist) { farDist = d; far = i; }
    }
    if (far >= 0 && farDist > epsilon) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

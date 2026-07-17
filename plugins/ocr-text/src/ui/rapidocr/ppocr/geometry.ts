import type { Point } from './types'

/** Monotone chain convex hull. Returns hull points in CCW order. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length <= 2) return pts
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Minimum-area rectangle enclosing the given points (rotating-calipers over
 * the convex hull). Returns 4 corner points, or fewer for degenerate input.
 */
export function minAreaRect(points: Point[]): Point[] {
  const hull = convexHull(points)
  if (hull.length <= 2) {
    if (hull.length === 2) return [hull[0], hull[1], hull[1], hull[0]]
    if (hull.length === 1) return [hull[0], hull[0], hull[0], hull[0]]
    return []
  }
  let minArea = Infinity
  let best: Point[] = hull.slice(0, 4) as Point[]
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i]
    const p2 = hull[(i + 1) % hull.length]
    if (p1[0] === p2[0] && p1[1] === p2[1]) continue
    const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of hull) {
      const x = p[0] * cos - p[1] * sin
      const y = p[0] * sin + p[1] * cos
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const area = (maxX - minX) * (maxY - minY)
    if (area < minArea) {
      minArea = area
      const cosB = Math.cos(angle)
      const sinB = Math.sin(angle)
      const rot = (x: number, y: number): Point => [x * cosB - y * sinB, x * sinB + y * cosB]
      best = [rot(minX, minY), rot(maxX, minY), rot(maxX, maxY), rot(minX, maxY)]
    }
  }
  return best
}

/**
 * Order 4 rect corners as [top-left, top-right, bottom-right, bottom-left],
 * same convention as PaddleOCR's get_mini_boxes.
 */
export function orderBoxPoints(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0])
  let index1 = 0, index2 = 1, index3 = 2, index4 = 3
  if (pts[1][1] > pts[0][1]) {
    index1 = 0
    index4 = 1
  } else {
    index1 = 1
    index4 = 0
  }
  if (pts[3][1] > pts[2][1]) {
    index2 = 2
    index3 = 3
  } else {
    index2 = 3
    index3 = 2
  }
  return [pts[index1], pts[index2], pts[index3], pts[index4]]
}

export function polygonArea(points: Point[]): number {
  let area = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return area / 2
}

export function polygonLength(points: Point[]): number {
  let len = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    len += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  return len
}

/**
 * Expand a convex polygon outward by `distance` (DB "unclip"). Each edge is
 * shifted along its outward normal; new vertices are intersections of the
 * shifted edges. Exact for convex input, which is all we feed it
 * (min-area-rect corners). Equivalent to ClipperOffset with a round join for
 * our purposes.
 */
export function offsetConvexPolygon(points: Point[], distance: number): Point[] {
  const n = points.length
  if (n < 3) return [...points]
  // Ensure CCW winding so the outward normal is well-defined.
  const pts = polygonArea(points) >= 0 ? [...points] : [...points].reverse()
  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const curr = pts[i]
    const next = pts[(i + 1) % n]
    // Edge normals for edges (prev->curr) and (curr->next), pointing outward
    // (to the right of the edge direction for CCW polygons).
    const n1 = outwardNormal(prev, curr, distance)
    const n2 = outwardNormal(curr, next, distance)
    // Intersection of the two offset lines:
    //   line1 through prev+n1, curr+n1
    //   line2 through curr+n2, next+n2
    result.push(lineIntersection(
      [prev[0] + n1[0], prev[1] + n1[1]],
      [curr[0] + n1[0], curr[1] + n1[1]],
      [curr[0] + n2[0], curr[1] + n2[1]],
      [next[0] + n2[0], next[1] + n2[1]],
    ))
  }
  return result
}

function outwardNormal(a: Point, b: Point, d: number): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  // Right-hand side of a->b is outward for CCW polygons in screen coords
  // (y-down), where our CCW from shoelace is actually reversed. Using the
  // signed area from polygonArea (positive => CCW in y-up math) keeps this
  // consistent: for positive area the outward normal is (dy, -dx).
  return [(dy / len) * d, (-dx / len) * d]
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
  if (Math.abs(d) < 1e-9) {
    // Nearly parallel edges: fall back to the shared vertex pushed by the
    // average normal (already embedded in the inputs' offsets).
    return [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2]
  }
  const t =
    ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

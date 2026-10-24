// Measurement math. Points are projected onto a local plane using WGS84
// radii of curvature at the shape's latitude, which is accurate to well under
// 0.1% for anything up to a few kilometres across (driveways, lots, roofs).

export type LatLngTuple = [number, number];

const A = 6378137; // WGS84 semi-major axis (m)
const E2 = 0.00669437999014; // WGS84 first eccentricity squared
const RAD = Math.PI / 180;

export const SQFT_PER_SQM = 10.7639104;
export const FT_PER_M = 3.28083989501;

function radii(latDeg: number): { m: number; n: number } {
  const s = Math.sin(latDeg * RAD);
  const w = 1 - E2 * s * s;
  return { m: (A * (1 - E2)) / Math.pow(w, 1.5), n: A / Math.sqrt(w) };
}

function project(points: LatLngTuple[]): { x: number; y: number }[] {
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const { m, n } = radii(lat0);
  const kx = RAD * n * Math.cos(lat0 * RAD);
  const ky = RAD * m;
  return points.map(([lat, lng]) => ({ x: (lng - lng0) * kx, y: (lat - lat0) * ky }));
}

/** Area of a simple polygon in square metres. */
export function areaSqM(points: LatLngTuple[]): number {
  if (points.length < 3) return 0;
  const xy = project(points);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Distance between two points in metres. */
export function distanceM(a: LatLngTuple, b: LatLngTuple): number {
  const xy = project([a, b]);
  return Math.hypot(xy[1].x - xy[0].x, xy[1].y - xy[0].y);
}

/** Length of a path in metres; `closed` adds the segment back to the start. */
export function lengthM(points: LatLngTuple[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i]);
  if (closed && points.length > 2) total += distanceM(points[points.length - 1], points[0]);
  return total;
}

/** Area-weighted centroid, falling back to the vertex average for slivers. */
export function centroid(points: LatLngTuple[]): LatLngTuple {
  const n = points.length;
  let lat = 0;
  let lng = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const [y0, x0] = points[i];
    const [y1, x1] = points[(i + 1) % n];
    const f = x0 * y1 - x1 * y0;
    a2 += f;
    lng += (x0 + x1) * f;
    lat += (y0 + y1) * f;
  }
  if (Math.abs(a2) < 1e-14) {
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [lat / (3 * a2), lng / (3 * a2)];
}

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const fmtSqFt = (sqft: number): string => `${int.format(sqft)} sq ft`;
export const fmtFt = (ft: number): string => (ft < 100 ? `${one.format(ft)} ft` : `${int.format(ft)} ft`);
export const fmtMoney = (v: number): string => money.format(v);
export const fmtNum = (v: number, digits = 2): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v);

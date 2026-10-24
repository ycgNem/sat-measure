import { areaSqM, lengthM, FT_PER_M, SQFT_PER_SQM, type LatLngTuple } from "./geo";

export type Kind = "area" | "line";

export interface Measurement {
  id: string;
  name: string;
  kind: Kind;
  points: LatLngTuple[];
  color: string;
  /** $ per sq ft for areas, $ per linear ft for lines. */
  rate: number;
  /** Areas only: cut this area out of the total (planters, buildings, pools). */
  subtract: boolean;
}

export interface Job {
  id: string;
  name: string;
  address: string;
  center: LatLngTuple;
  zoom: number;
  areaRate: number;
  lineRate: number;
  minimum: number;
  notes: string;
  measurements: Measurement[];
  updatedAt: number;
}

export const PALETTE = ["#ffcc00", "#2ee6a6", "#3fa9ff", "#ff6b6b", "#c084fc", "#ff9f43", "#f472b6", "#a3e635"];

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newJob(center: LatLngTuple = [39.5, -98.35], zoom = 4): Job {
  return {
    id: uid(),
    name: "New job",
    address: "",
    center,
    zoom,
    areaRate: 0.25,
    lineRate: 1,
    minimum: 0,
    notes: "",
    measurements: [],
    updatedAt: Date.now(),
  };
}

/** Square feet for areas, linear feet for lines. */
export function quantity(m: Measurement): number {
  return m.kind === "area" ? areaSqM(m.points) * SQFT_PER_SQM : lengthM(m.points) * FT_PER_M;
}

export function perimeterFt(m: Measurement): number {
  return lengthM(m.points, m.kind === "area") * FT_PER_M;
}

export function price(m: Measurement): number {
  const p = quantity(m) * m.rate;
  return m.kind === "area" && m.subtract ? -p : p;
}

export interface Totals {
  netSqFt: number;
  grossSqFt: number;
  linearFt: number;
  subtotal: number;
  total: number;
}

export function totals(job: Job): Totals {
  let net = 0;
  let gross = 0;
  let linear = 0;
  let subtotal = 0;
  for (const m of job.measurements) {
    const q = quantity(m);
    if (m.kind === "area") {
      if (m.subtract) net -= q;
      else {
        net += q;
        gross += q;
      }
    } else linear += q;
    subtotal += price(m);
  }
  return { netSqFt: net, grossSqFt: gross, linearFt: linear, subtotal, total: Math.max(subtotal, job.minimum) };
}

// ---- persistence (browser storage, per device) ----

const KEY = "sat-measure.jobs.v1";
const CURRENT = "sat-measure.current.v1";

export function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(KEY);
    const jobs = raw ? (JSON.parse(raw) as Job[]) : [];
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: Job[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* storage full or blocked; keep working in memory */
  }
}

export function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string): void {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {
    /* ignore */
  }
}

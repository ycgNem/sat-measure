import type { LatLngTuple } from "./geo";
import type { Job } from "./job";

/** Fixed imagery used instead of live tiles (the shareable demo can't load other sites). */
export interface StaticImagery {
  url: string;
  bounds: [LatLngTuple, LatLngTuple];
  attribution: string;
}

export interface DemoConfig {
  imagery: StaticImagery;
  /** Builds a fresh copy of the sample job. */
  sampleJob(): Job;
}

/** Set by the demo entry before the app module loads; null in the normal app. */
export const config: { demo: DemoConfig | null } = { demo: null };

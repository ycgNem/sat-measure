import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { areaSqM, centroid, distanceM, fmtFt, fmtSqFt, FT_PER_M, lengthM, SQFT_PER_SQM, type LatLngTuple } from "./geo";
import { quantity, type Job, type Kind, type Measurement } from "./job";
import type { StaticImagery } from "./config";

export type Mode = "idle" | Kind;

export interface EditorCallbacks {
  /** Geometry of an existing measurement changed. */
  onChange(): void;
  /** Map was panned or zoomed. */
  onView(center: LatLngTuple, zoom: number): void;
  onSelect(id: string | null): void;
  onMode(mode: Mode): void;
  /** Live readout while drawing; empty string clears it. */
  onStatus(text: string): void;
  /** A drawing was finished; the caller adds it to the job. */
  onCreate(kind: Kind, points: LatLngTuple[]): Measurement;
}

const SNAP_PX = 12;
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const tup = (ll: L.LatLng): LatLngTuple => [ll.lat, ll.lng];
const icon = (className: string, html = ""): L.DivIcon => L.divIcon({ className, html, iconSize: [0, 0] });
const labelIcon = (html: string, extra = ""): L.DivIcon => icon(`m-label ${extra}`, `<span>${html}</span>`);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Point halfway along a path, for placing a line's label. */
function midpointAlong(points: LatLngTuple[]): LatLngTuple {
  const half = lengthM(points) / 2;
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceM(points[i - 1], points[i]);
    if (run + d >= half && d > 0) {
      const t = (half - run) / d;
      const [a, b] = [points[i - 1], points[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    run += d;
  }
  return points[0];
}

export class Editor {
  readonly map: L.Map;
  mode: Mode = "idle";
  selectedId: string | null = null;

  private job: Job | null = null;
  private readonly cb: EditorCallbacks;
  private readonly shapes = L.layerGroup();
  private readonly handles = L.layerGroup();
  private readonly draftGroup = L.layerGroup();
  private readonly guide: L.Polyline;
  private readonly layers = new Map<string, { shape: L.Polygon | L.Polyline; label: L.Marker }>();
  private segLabels: L.Marker[] = [];
  private midHandles: L.Marker[] = [];
  private draft: LatLngTuple[] = [];

  constructor(el: HTMLElement, cb: EditorCallbacks, imagery?: StaticImagery) {
    this.cb = cb;
    this.map = L.map(el, { zoomControl: false, maxZoom: 22, zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
    if (imagery) this.useStaticImagery(imagery);
    else this.useLiveTiles();
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(this.map);

    this.shapes.addTo(this.map);
    this.handles.addTo(this.map);
    this.draftGroup.addTo(this.map);
    this.guide = L.polyline([], { color: "#fff", weight: 2, dashArray: "6 6", interactive: false });

    this.map.on("click", (e) => this.onMapClick(e));
    this.map.on("mousemove", (e) => this.onMouseMove(e));
    this.map.on("dblclick", () => this.mode !== "idle" && this.finish());
    this.map.on("zoomend", () => this.renderHandles());
    this.map.on("moveend", () => {
      const c = this.map.getCenter();
      this.cb.onView([c.lat, c.lng], this.map.getZoom());
    });
  }

  private useStaticImagery(img: StaticImagery): void {
    const bounds = L.latLngBounds(img.bounds);
    L.imageOverlay(img.url, bounds, { attribution: img.attribution }).addTo(this.map);
    this.map.setMaxBounds(bounds.pad(0.05));
    this.map.setMinZoom(16.5);
  }

  private useLiveTiles(): void {
    const tile = { maxNativeZoom: 19, maxZoom: 22 };
    const imagery = L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
      ...tile,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    });
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      ...tile,
      attribution: "&copy; OpenStreetMap contributors",
    });
    const labels = L.layerGroup([
      L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { ...tile, zIndex: 5 }),
      L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { ...tile, zIndex: 6 }),
    ]);
    imagery.addTo(this.map);
    labels.addTo(this.map);
    L.control.layers({ Satellite: imagery, Streets: streets }, { "Road labels": labels }, { position: "topright" }).addTo(this.map);
  }

  setJob(job: Job, fly = false): void {
    this.cancel();
    this.job = job;
    this.selectedId = null;
    if (fly) this.map.flyTo(job.center, job.zoom, { duration: 0.8 });
    else this.map.setView(job.center, job.zoom);
    this.render();
  }

  // ---------------------------------------------------------------- drawing

  start(kind: Kind): void {
    this.cancel();
    this.select(null);
    this.mode = kind;
    this.draft = [];
    this.map.doubleClickZoom.disable();
    this.map.getContainer().classList.add("drawing");
    this.renderDraft();
    this.cb.onMode(kind);
    this.cb.onStatus(kind === "area" ? "Tap the corners of the area. Tap the first point or Finish to close." : "Tap along the edge. Tap the last point or Finish to end.");
  }

  cancel(): void {
    if (this.mode === "idle") return;
    this.mode = "idle";
    this.draft = [];
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove("drawing");
    this.draftGroup.clearLayers();
    this.cb.onMode("idle");
    this.cb.onStatus("");
  }

  undoPoint(): void {
    if (this.mode === "idle") return;
    this.draft.pop();
    this.renderDraft();
  }

  get draftCount(): number {
    return this.draft.length;
  }

  finish(): void {
    if (this.mode === "idle") return;
    const kind = this.mode;
    const pts = this.dedupe(this.draft);
    const min = kind === "area" ? 3 : 2;
    if (pts.length < min) {
      this.draft = pts;
      this.renderDraft();
      this.cb.onStatus(`Need at least ${min} points to finish.`);
      return;
    }
    this.cancel();
    const m = this.cb.onCreate(kind, pts);
    this.render();
    this.select(m.id);
  }

  /** Drops consecutive points that land within a few pixels (double clicks). */
  private dedupe(points: LatLngTuple[]): LatLngTuple[] {
    const out: LatLngTuple[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && this.map.latLngToContainerPoint(last).distanceTo(this.map.latLngToContainerPoint(p)) < 4) continue;
      out.push(p);
    }
    if (this.mode === "area" && out.length > 3) {
      const first = this.map.latLngToContainerPoint(out[0]);
      if (first.distanceTo(this.map.latLngToContainerPoint(out[out.length - 1])) < 4) out.pop();
    }
    return out;
  }

  /** Snap to an existing corner so neighbouring areas share edges cleanly. */
  private snap(ll: L.LatLng): LatLngTuple {
    const p = this.map.latLngToContainerPoint(ll);
    let best: LatLngTuple = tup(ll);
    let bestD = SNAP_PX;
    const candidates = [...(this.job?.measurements.flatMap((m) => m.points) ?? []), ...this.draft.slice(0, 1)];
    for (const c of candidates) {
      const d = this.map.latLngToContainerPoint(c).distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return [best[0], best[1]];
  }

  private onMapClick(e: L.LeafletMouseEvent): void {
    if (this.mode === "idle") {
      this.select(null);
      return;
    }
    this.draft.push(this.snap(e.latlng));
    this.renderDraft();
  }

  private onMouseMove(e: L.LeafletMouseEvent): void {
    if (this.mode === "idle" || this.draft.length === 0) return;
    const cur = this.snap(e.latlng);
    const last = this.draft[this.draft.length - 1];
    const path: LatLngTuple[] = [last, cur];
    if (this.mode === "area" && this.draft.length >= 2) path.push(this.draft[0]);
    this.guide.setLatLngs(path);
    this.status([...this.draft, cur], distanceM(last, cur) * FT_PER_M);
  }

  private status(points: LatLngTuple[], segFt?: number): void {
    const parts: string[] = [];
    if (segFt !== undefined) parts.push(`Segment ${fmtFt(segFt)}`);
    if (this.mode === "area") {
      if (points.length >= 3) parts.push(`Area ${fmtSqFt(areaSqM(points) * SQFT_PER_SQM)}`);
    } else if (points.length >= 2) parts.push(`Length ${fmtFt(lengthM(points) * FT_PER_M)}`);
    parts.push(`${this.draft.length} pt${this.draft.length === 1 ? "" : "s"}`);
    this.cb.onStatus(parts.join(" · "));
  }

  private renderDraft(): void {
    this.draftGroup.clearLayers();
    this.guide.setLatLngs([]);
    this.draftGroup.addLayer(this.guide);
    const pts = this.draft;
    if (pts.length === 0) {
      this.cb.onMode(this.mode);
      return;
    }
    const closed = this.mode === "area" && pts.length >= 3;
    const shape = closed
      ? L.polygon(pts, { color: "#fff", weight: 2, fillColor: "#fff", fillOpacity: 0.15, interactive: false })
      : L.polyline(pts, { color: "#fff", weight: 3, interactive: false });
    this.draftGroup.addLayer(shape);

    for (let i = 1; i < pts.length; i++) this.draftGroup.addLayer(this.segmentLabel(pts[i - 1], pts[i]));

    pts.forEach((p, i) => {
      const isEnd = (this.mode === "area" && i === 0 && pts.length >= 3) || (this.mode === "line" && i === pts.length - 1 && pts.length >= 2);
      // Only the closing point takes clicks; taps on other corners fall through to the map.
      const mk = L.marker(p, { icon: icon(isEnd ? "vtx vtx-close" : "vtx"), interactive: isEnd, bubblingMouseEvents: false, keyboard: false });
      if (isEnd) mk.on("click", () => this.finish());
      this.draftGroup.addLayer(mk);
    });
    this.status(pts);
    this.cb.onMode(this.mode);
  }

  // -------------------------------------------------------------- rendering

  render(): void {
    this.shapes.clearLayers();
    this.layers.clear();
    if (!this.job) return;
    for (const m of this.job.measurements) {
      const sel = m.id === this.selectedId;
      const style: L.PathOptions = {
        color: m.color,
        weight: m.kind === "line" ? (sel ? 6 : 4) : sel ? 3 : 2,
        fillColor: m.color,
        fillOpacity: m.subtract ? 0.08 : sel ? 0.4 : 0.28,
        dashArray: m.subtract ? "6 5" : undefined,
      };
      const shape = m.kind === "area" ? L.polygon(m.points, style) : L.polyline(m.points, style);
      shape.on("click", (ev) => {
        if (this.mode !== "idle") return;
        L.DomEvent.stopPropagation(ev);
        this.select(m.id);
      });
      const label = L.marker(this.labelPos(m), { icon: this.labelIcon(m), interactive: false, keyboard: false });
      this.shapes.addLayer(shape).addLayer(label);
      this.layers.set(m.id, { shape, label });
    }
    this.renderHandles();
  }

  private labelPos(m: Measurement): LatLngTuple {
    return m.kind === "area" ? centroid(m.points) : midpointAlong(m.points);
  }

  private labelIcon(m: Measurement): L.DivIcon {
    const q = quantity(m);
    const value = m.kind === "area" ? `${m.subtract ? "−" : ""}${fmtSqFt(q)}` : fmtFt(q);
    return labelIcon(`<b>${escapeHtml(m.name)}</b>${value}`, m.subtract ? "is-sub" : "");
  }

  private segmentLabel(a: LatLngTuple, b: LatLngTuple): L.Marker {
    const mid: LatLngTuple = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return L.marker(mid, { icon: labelIcon(fmtFt(distanceM(a, b) * FT_PER_M), "seg"), interactive: false, keyboard: false });
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.render();
    this.cb.onSelect(id);
  }

  fitTo(id?: string): void {
    const bounds = L.latLngBounds([]);
    for (const [mid, l] of this.layers) if (!id || mid === id) bounds.extend(l.shape.getBounds());
    if (bounds.isValid()) this.map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 20, duration: 0.6 });
  }

  /** Corner handles (drag to move, right-click / long-press to delete) and midpoint handles (drag to add). */
  private renderHandles(): void {
    this.handles.clearLayers();
    this.segLabels = [];
    this.midHandles = [];
    const m = this.job?.measurements.find((x) => x.id === this.selectedId);
    if (!m) return;
    const n = m.points.length;
    const segCount = m.kind === "area" ? n : n - 1;
    const min = m.kind === "area" ? 3 : 2;

    for (let i = 0; i < segCount; i++) {
      const a = m.points[i];
      const b = m.points[(i + 1) % n];
      // Skip labels and midpoint handles on segments too short to read at this zoom.
      const px = this.map.latLngToContainerPoint(a).distanceTo(this.map.latLngToContainerPoint(b));
      const lbl = this.segmentLabel(a, b);
      this.segLabels.push(lbl);
      if (px >= 56) this.handles.addLayer(lbl);
      if (px < 30) continue;

      const mid = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: icon("mid"), draggable: true, bubblingMouseEvents: false, keyboard: false });
      let inserted = false;
      const insert = (): void => {
        if (inserted) return;
        inserted = true;
        m.points.splice(i + 1, 0, tup(mid.getLatLng()));
      };
      mid.on("dragstart", insert);
      mid.on("drag", () => {
        m.points[i + 1] = tup(mid.getLatLng());
        this.liveUpdate(m);
      });
      mid.on("dragend", () => this.commitEdit());
      mid.on("click", () => {
        insert();
        this.commitEdit();
      });
      this.midHandles.push(mid);
      this.handles.addLayer(mid);
    }

    m.points.forEach((p, i) => {
      const v = L.marker(p, { icon: icon("vtx vtx-edit"), draggable: true, bubblingMouseEvents: false, keyboard: false });
      v.on("drag", () => {
        m.points[i] = tup(v.getLatLng());
        this.liveUpdate(m);
      });
      v.on("dragend", () => this.commitEdit());
      v.on("contextmenu", (ev) => {
        L.DomEvent.preventDefault(ev.originalEvent);
        if (m.points.length <= min) return;
        m.points.splice(i, 1);
        this.commitEdit();
      });
      this.handles.addLayer(v);
    });
  }

  /** Cheap redraw while a handle is being dragged (rebuilding would drop the drag). */
  private liveUpdate(m: Measurement): void {
    const l = this.layers.get(m.id);
    if (!l) return;
    l.shape.setLatLngs(m.points);
    l.label.setLatLng(this.labelPos(m)).setIcon(this.labelIcon(m));
    const n = m.points.length;
    this.segLabels.forEach((lbl, i) => {
      const a = m.points[i];
      const b = m.points[(i + 1) % n];
      if (!a || !b) return;
      lbl.setLatLng([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).setIcon(labelIcon(fmtFt(distanceM(a, b) * FT_PER_M), "seg"));
    });
    this.cb.onChange();
  }

  private commitEdit(): void {
    this.render();
    this.cb.onChange();
  }
}

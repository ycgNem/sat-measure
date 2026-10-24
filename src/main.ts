import "./style.css";
import { config } from "./config";
import { Editor, type Mode } from "./editor";
import { fmtFt, fmtMoney, fmtNum, fmtSqFt, type LatLngTuple } from "./geo";
import {
  loadCurrentId,
  loadJobs,
  newJob,
  PALETTE,
  perimeterFt,
  price,
  quantity,
  saveCurrentId,
  saveJobs,
  totals,
  uid,
  type Job,
  type Kind,
  type Measurement,
} from "./job";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const ui = {
  q: $<HTMLInputElement>("#q"),
  search: $<HTMLFormElement>("#search"),
  results: $<HTMLUListElement>("#results"),
  locate: $<HTMLButtonElement>("#locate"),
  toolbar: $<HTMLDivElement>("#toolbar"),
  status: $<HTMLDivElement>("#status"),
  jobSelect: $<HTMLSelectElement>("#job-select"),
  jobNew: $<HTMLButtonElement>("#job-new"),
  jobDel: $<HTMLButtonElement>("#job-del"),
  jobName: $<HTMLInputElement>("#job-name"),
  jobAddress: $<HTMLInputElement>("#job-address"),
  rateArea: $<HTMLInputElement>("#rate-area"),
  rateLine: $<HTMLInputElement>("#rate-line"),
  minimum: $<HTMLInputElement>("#minimum"),
  list: $<HTMLUListElement>("#list"),
  empty: $<HTMLParagraphElement>("#empty"),
  totals: $<HTMLElement>("#totals"),
  notes: $<HTMLTextAreaElement>("#notes"),
  fitAll: $<HTMLButtonElement>("#fit-all"),
  copy: $<HTMLButtonElement>("#copy"),
  print: $<HTMLButtonElement>("#print"),
  copyOut: $<HTMLTextAreaElement>("#copy-out"),
};

// ------------------------------------------------------------------ state

const demo = config.demo;
let jobs = demo ? [demo.sampleJob()] : loadJobs();
let job: Job = jobs.find((j) => j.id === loadCurrentId()) ?? jobs[0] ?? addJob(newJob());

function addJob(j: Job): Job {
  jobs.unshift(j);
  return j;
}

let saveTimer = 0;
function persist(): void {
  job.updatedAt = Date.now();
  if (demo) return; // every visitor starts from the same sample
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveJobs(jobs);
    saveCurrentId(job.id);
  }, 250);
}

// ----------------------------------------------------------------- editor

const editor = new Editor($("#map"), {
  onChange() {
    refreshNumbers();
    persist();
  },
  onView(center, zoom) {
    job.center = center;
    job.zoom = zoom;
    persist();
  },
  onSelect(id) {
    for (const li of ui.list.querySelectorAll<HTMLLIElement>("li[data-id]")) li.classList.toggle("selected", li.dataset.id === id);
    ui.list.querySelector(`li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
  onMode: setModeUi,
  onStatus(text) {
    ui.status.hidden = !text;
    ui.status.textContent = text;
  },
  onCreate(kind, points) {
    const count = job.measurements.filter((m) => m.kind === kind).length + 1;
    const m: Measurement = {
      id: uid(),
      name: kind === "area" ? `Area ${count}` : `Line ${count}`,
      kind,
      points,
      color: PALETTE[job.measurements.length % PALETTE.length],
      rate: kind === "area" ? job.areaRate : job.lineRate,
      subtract: false,
    };
    job.measurements.push(m);
    renderList();
    persist();
    // Jump straight to naming it.
    requestAnimationFrame(() => {
      const input = ui.list.querySelector<HTMLInputElement>(`li[data-id="${m.id}"] input[data-f="name"]`);
      input?.focus();
      input?.select();
    });
    return m;
  },
}, demo?.imagery);

function setModeUi(mode: Mode): void {
  ui.toolbar.classList.toggle("is-drawing", mode !== "idle");
  for (const b of ui.toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.classList.toggle("active", b.dataset.tool === mode);
  const finish = ui.toolbar.querySelector<HTMLButtonElement>('[data-act="finish"]');
  if (finish) finish.disabled = editor.draftCount < (mode === "area" ? 3 : 2);
  const undo = ui.toolbar.querySelector<HTMLButtonElement>('[data-act="undo"]');
  if (undo) undo.disabled = editor.draftCount === 0;
}

ui.toolbar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!btn) return;
  const tool = btn.dataset.tool as Kind | undefined;
  if (tool) {
    if (editor.mode === tool) editor.cancel();
    else editor.start(tool);
    return;
  }
  if (btn.dataset.act === "undo") editor.undoPoint();
  if (btn.dataset.act === "finish") editor.finish();
  if (btn.dataset.act === "cancel") editor.cancel();
});

document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (e.key === "Escape") {
    if (typing) (e.target as HTMLElement).blur();
    editor.cancel();
    return;
  }
  if (typing) return;
  if (editor.mode !== "idle") {
    if (e.key === "Enter") editor.finish();
    if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      editor.undoPoint();
    }
    return;
  }
  if (e.key === "a" || e.key === "A") editor.start("area");
  if (e.key === "l" || e.key === "L") editor.start("line");
  if ((e.key === "Delete" || e.key === "Backspace") && editor.selectedId) removeMeasurement(editor.selectedId);
});

// ------------------------------------------------------------------ panel

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderJobFields(): void {
  ui.jobSelect.innerHTML = [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((j) => `<option value="${j.id}" ${j.id === job.id ? "selected" : ""}>${escapeAttr(j.name || "Untitled")}</option>`)
    .join("");
  ui.jobName.value = job.name;
  ui.jobAddress.value = job.address;
  ui.rateArea.value = String(job.areaRate);
  ui.rateLine.value = String(job.lineRate);
  ui.minimum.value = String(job.minimum);
  ui.notes.value = job.notes;
}

function renderList(): void {
  ui.empty.hidden = job.measurements.length > 0;
  ui.list.innerHTML = job.measurements
    .map((m) => {
      const unit = m.kind === "area" ? "/sq ft" : "/ft";
      return `<li data-id="${m.id}" class="${m.id === editor.selectedId ? "selected" : ""} ${m.subtract ? "is-sub" : ""}">
        <div class="row">
          <button class="dot" data-act="color" style="background:${m.color}" title="Change color" aria-label="Change color"></button>
          <input data-f="name" list="names" value="${escapeAttr(m.name)}" aria-label="Name" />
          <button class="btn icon small" data-act="zoom" title="Zoom to" aria-label="Zoom to"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></button>
          <button class="btn icon small danger" data-act="del" title="Delete">✕</button>
        </div>
        <div class="row meta"><b data-qty></b><span data-extra></span></div>
        <div class="row">
          <span class="unit-input">$<input data-f="rate" type="number" min="0" step="0.01" value="${m.rate}" aria-label="Rate" /><em>${unit}</em></span>
          ${m.kind === "area" ? `<label class="check"><input data-f="subtract" type="checkbox" ${m.subtract ? "checked" : ""}/>Subtract</label>` : ""}
          <span class="price" data-price></span>
        </div>
      </li>`;
    })
    .join("");
  refreshNumbers();
}

/** Updates figures in place so inputs keep focus while typing or dragging. */
function refreshNumbers(): void {
  for (const m of job.measurements) {
    const li = ui.list.querySelector<HTMLLIElement>(`li[data-id="${m.id}"]`);
    if (!li) continue;
    const q = quantity(m);
    li.querySelector("[data-qty]")!.textContent = m.kind === "area" ? fmtSqFt(q) : fmtFt(q);
    li.querySelector("[data-extra]")!.textContent =
      m.kind === "area" ? `${fmtNum(q / 9, 1)} sq yd · ${q >= 4356 ? `${fmtNum(q / 43560, 2)} ac · ` : ""}perimeter ${fmtFt(perimeterFt(m))}` : `${m.points.length} points`;
    li.querySelector("[data-price]")!.textContent = fmtMoney(price(m));
  }
  const t = totals(job);
  const hasSub = job.measurements.some((m) => m.subtract);
  ui.totals.innerHTML = `
    <div><span>${hasSub ? "Net area" : "Total area"}</span><b>${fmtSqFt(t.netSqFt)}</b></div>
    ${hasSub ? `<div class="muted"><span>Gross area</span><b>${fmtSqFt(t.grossSqFt)}</b></div>` : ""}
    ${t.linearFt > 0 ? `<div><span>Linear</span><b>${fmtFt(t.linearFt)}</b></div>` : ""}
    <div class="muted"><span>Subtotal</span><b>${fmtMoney(t.subtotal)}</b></div>
    ${job.minimum > 0 && t.subtotal < job.minimum ? `<div class="muted"><span>Minimum applied</span><b>${fmtMoney(job.minimum)}</b></div>` : ""}
    <div class="grand"><span>Estimate</span><b>${fmtMoney(t.total)}</b></div>`;
}

function removeMeasurement(id: string): void {
  job.measurements = job.measurements.filter((m) => m.id !== id);
  if (editor.selectedId === id) editor.select(null);
  editor.render();
  renderList();
  persist();
}

function findMeasurement(el: Element): Measurement | undefined {
  const id = el.closest<HTMLLIElement>("li[data-id]")?.dataset.id;
  return job.measurements.find((m) => m.id === id);
}

ui.list.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const m = findMeasurement(target);
  if (!m) return;
  const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "del") return removeMeasurement(m.id);
  if (act === "color") {
    m.color = PALETTE[(PALETTE.indexOf(m.color) + 1) % PALETTE.length];
    (target as HTMLElement).style.background = m.color;
    editor.render();
    persist();
    return;
  }
  editor.select(m.id);
  if (act === "zoom") editor.fitTo(m.id);
});

ui.list.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const m = findMeasurement(input);
  if (!m) return;
  if (input.dataset.f === "name") {
    m.name = input.value;
    // Picking an "Exclude: …" preset ticks Subtract.
    if (m.kind === "area" && !m.subtract && /^exclude\b/i.test(m.name)) {
      m.subtract = true;
      const li = input.closest("li");
      li?.classList.add("is-sub");
      const box = li?.querySelector<HTMLInputElement>('input[data-f="subtract"]');
      if (box) box.checked = true;
    }
  }
  if (input.dataset.f === "rate") m.rate = Math.max(0, Number(input.value) || 0);
  if (input.dataset.f === "subtract") {
    m.subtract = input.checked;
    input.closest("li")?.classList.toggle("is-sub", m.subtract);
  }
  editor.render();
  refreshNumbers();
  persist();
});

function bindJobInput(el: HTMLInputElement | HTMLTextAreaElement, apply: (v: string) => void): void {
  el.addEventListener("input", () => {
    apply(el.value);
    refreshNumbers();
    persist();
  });
}
bindJobInput(ui.jobName, (v) => {
  job.name = v;
  const opt = ui.jobSelect.selectedOptions[0];
  if (opt) opt.textContent = v || "Untitled";
});
bindJobInput(ui.jobAddress, (v) => (job.address = v));
bindJobInput(ui.notes, (v) => (job.notes = v));
bindJobInput(ui.minimum, (v) => (job.minimum = Math.max(0, Number(v) || 0)));
// Changing a default rate also updates measurements still using the old default.
bindJobInput(ui.rateArea, (v) => {
  const next = Math.max(0, Number(v) || 0);
  for (const m of job.measurements) if (m.kind === "area" && m.rate === job.areaRate) m.rate = next;
  job.areaRate = next;
  syncRateInputs();
});
bindJobInput(ui.rateLine, (v) => {
  const next = Math.max(0, Number(v) || 0);
  for (const m of job.measurements) if (m.kind === "line" && m.rate === job.lineRate) m.rate = next;
  job.lineRate = next;
  syncRateInputs();
});

function syncRateInputs(): void {
  for (const m of job.measurements) {
    const input = ui.list.querySelector<HTMLInputElement>(`li[data-id="${m.id}"] input[data-f="rate"]`);
    if (input && Number(input.value) !== m.rate) input.value = String(m.rate);
  }
}

function openJob(j: Job, fly = false): void {
  job = j;
  saveCurrentId(j.id);
  editor.setJob(j, fly);
  renderJobFields();
  renderList();
}

ui.jobSelect.addEventListener("change", () => {
  const j = jobs.find((x) => x.id === ui.jobSelect.value);
  if (j) openJob(j, true);
});

ui.jobNew.addEventListener("click", () => {
  // Start the new job where the map is now, with the same pricing.
  const c = editor.map.getCenter();
  const j = newJob([c.lat, c.lng], editor.map.getZoom());
  j.areaRate = job.areaRate;
  j.lineRate = job.lineRate;
  j.minimum = job.minimum;
  openJob(addJob(j));
  persist();
  ui.q.focus();
});

ui.jobDel.addEventListener("click", () => {
  if (!confirm(`Delete "${job.name || "Untitled"}" and its measurements?`)) return;
  jobs = jobs.filter((j) => j.id !== job.id);
  openJob(jobs[0] ?? addJob(newJob(job.center, job.zoom)));
  persist();
});

ui.fitAll.addEventListener("click", () => editor.fitTo());

// ----------------------------------------------------------------- search

interface Place {
  display_name: string;
  lat: string;
  lon: string;
}

function goTo(ll: LatLngTuple, label: string): void {
  ui.results.hidden = true;
  editor.map.flyTo(ll, 20, { duration: 1.2 });
  if (!job.address) {
    job.address = label;
    ui.jobAddress.value = label;
  }
  if (job.name === "New job" || !job.name) {
    job.name = label.split(",").slice(0, 2).join(",");
    renderJobFields();
  }
  persist();
}

ui.search.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = ui.q.value.trim();
  if (!q) return;
  const coords = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) return goTo([Number(coords[1]), Number(coords[2])], q);

  ui.results.hidden = false;
  ui.results.innerHTML = `<li class="muted">Searching…</li>`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const places = (await res.json()) as Place[];
    if (places.length === 0) {
      ui.results.innerHTML = `<li class="muted">No matches. Try adding the city and state.</li>`;
      return;
    }
    ui.results.innerHTML = places.map((p, i) => `<li><button type="button" data-i="${i}">${escapeAttr(p.display_name)}</button></li>`).join("");
    ui.results.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
      if (!b) return;
      const p = places[Number(b.dataset.i)];
      goTo([Number(p.lat), Number(p.lon)], p.display_name);
    };
    if (places.length === 1) goTo([Number(places[0].lat), Number(places[0].lon)], places[0].display_name);
  } catch {
    ui.results.innerHTML = `<li class="muted">Search failed. Check your connection, or paste coordinates.</li>`;
  }
});

document.addEventListener("click", (e) => {
  if (!ui.search.contains(e.target as Node)) ui.results.hidden = true;
});

ui.locate.addEventListener("click", () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => editor.map.flyTo([pos.coords.latitude, pos.coords.longitude], 20, { duration: 1 }),
    () => alert("Couldn't get your location."),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------------------------------------------------------------- exports

function summary(): string {
  const t = totals(job);
  const lines = [job.name || "Untitled job"];
  if (job.address) lines.push(job.address);
  lines.push("");
  for (const m of job.measurements) {
    const q = quantity(m);
    const qty = m.kind === "area" ? fmtSqFt(q) : fmtFt(q);
    const unit = m.kind === "area" ? "sq ft" : "ft";
    lines.push(`${m.subtract ? "(minus) " : ""}${m.name}: ${qty} × ${fmtMoney(m.rate)}/${unit} = ${fmtMoney(price(m))}`);
  }
  lines.push("");
  lines.push(`Total area: ${fmtSqFt(t.netSqFt)}`);
  if (t.linearFt > 0) lines.push(`Linear: ${fmtFt(t.linearFt)}`);
  if (job.minimum > 0 && t.subtotal < job.minimum) lines.push(`Minimum charge: ${fmtMoney(job.minimum)}`);
  lines.push(`Estimate: ${fmtMoney(t.total)}`);
  if (job.notes.trim()) lines.push("", `Notes: ${job.notes.trim()}`);
  return lines.join("\n");
}

ui.copy.addEventListener("click", async () => {
  const text = summary();
  ui.copyOut.hidden = true;
  try {
    await navigator.clipboard.writeText(text);
    ui.copy.textContent = "Copied ✓";
    setTimeout(() => (ui.copy.textContent = "Copy summary"), 1500);
  } catch {
    // Clipboard blocked: show the text selected so it can be copied by hand.
    ui.copyOut.value = text;
    ui.copyOut.rows = Math.min(14, text.split("\n").length + 1);
    ui.copyOut.hidden = false;
    ui.copyOut.focus();
    ui.copyOut.select();
  }
});

ui.print.addEventListener("click", () => {
  editor.select(null);
  editor.fitTo();
  setTimeout(() => window.print(), 900);
});

// ------------------------------------------------------------------- boot

if (demo) {
  // Address search, saved jobs and printing can't work on a shared page.
  ui.search.hidden = true;
  $("#panel .panel-head").hidden = true;
  ui.print.hidden = true;
  const banner = $<HTMLDivElement>("#demo-banner");
  banner.hidden = false;
  $<HTMLButtonElement>("#demo-reset").addEventListener("click", () => {
    jobs = [demo.sampleJob()];
    openJob(jobs[0], true);
  });
}

openJob(job);
setModeUi("idle");
if (!demo && jobs.length === 1 && job.measurements.length === 0 && job.zoom <= 4) ui.q.focus();

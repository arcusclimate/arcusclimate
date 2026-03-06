/* =========================================================
   Arcus Climate Map — script.js (drop-in replacement)
   - Fixes: filters/search not doing anything (wires UI)
   - Fixes: click state → persistent side panel with clickable links
   - Adds: fast highlight of matching states via feature-state (scales)
   - Works with your fetches:
       /data/us-states.geojson
       /data/iso-rto.geojson
       /api/states
       /api/entries
       /api/options
========================================================= */

/* -------------------------
   0) Token + hard fail early
-------------------------- */
const MAPBOX_TOKEN = (window.pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg || "").trim();
if (!MAPBOX_TOKEN) {
  console.warn("Mapbox token missing. Set window.MAPBOX_TOKEN in index.html.");
  // Don't proceed—Mapbox will fail noisily otherwise.
} else {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

/* -------------------------
   1) DOM helpers + UI refs
-------------------------- */
const $ = (sel) => document.querySelector(sel);

const ui = {
  map: $("#map"),

  // panel
  panel: $("#panel"),
  panelClose: $("#panelClose"),
  panelState: $("#panelState"),
  panelMeta: $("#panelMeta"),
  panelTopSignals: $("#panelTopSignals"),
  panelEntriesHint: $("#panelEntriesHint"),
  panelEntries: $("#panelEntries"),

  // topbar + filters (best-effort: may not exist in your HTML)
  // If your IDs differ, rename here ONLY.
  stateSearch: $("#stateSearch") || $("#search") || $("#topSearch"),
  filterCategory: $("#filterCategory"),
  filterImpact: $("#filterImpact"),
  filterType: $("#filterType"),
  filterDirection: $("#filterDirection"),
  filterSignalCategory: $("#filterSignalCategory"),
  btnClear: $("#btnClear") || $("#clearFilters"),
  btnModeState: $("#btnModeState") || $("#modeState"),
  btnModeIso: $("#btnModeIso") || $("#modeIso"),
};

function safeText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}

function showPanel() {
  if (!ui.panel) return;
  ui.panel.classList.remove("panel--hidden");
}

function hidePanel() {
  if (!ui.panel) return;
  ui.panel.classList.add("panel--hidden");
}

/* -------------------------
   2) Data holders
-------------------------- */
let map = null;
let statesGeo = null;
let isoGeo = null;

let airtableStates = [];   // from /api/states
let airtableEntries = [];  // from /api/entries
let airtableOptions = [];  // from /api/options

// Fast lookups
let stateByName = new Map();          // "Virginia" -> stateObj
let entriesByState = new Map();       // "Virginia" -> [entry,...]

// Feature-state performance
let hoveredStateId = null;
let hoveredIsoId = null;
let matchingStates = new Set();

/* -------------------------
   3) Utilities
-------------------------- */
function normalizeStateName(s) {
  if (!s) return "";
  return String(s).trim();
}

function toISODateYear(d) {
  // expects something parseable; returns YYYY or empty
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return String(dt.getUTCFullYear());
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureFeatureIds(geo) {
  // Feature-state requires feature ids. If none exist, assign stable-ish ids.
  // Prefer existing id; otherwise use properties (NAME) or index.
  geo.features.forEach((f, i) => {
    if (f.id !== undefined && f.id !== null) return;
    const name = f?.properties?.NAME || f?.properties?.name || f?.properties?.State || "";
    f.id = name ? `${name}` : `${i}`;
  });
  return geo;
}

function setFeatureStateSafe(sourceId, featureId, stateObj) {
  if (!map) return;
  try {
    map.setFeatureState({ source: sourceId, id: featureId }, stateObj);
  } catch (_) {
    // ignore
  }
}

/* -------------------------
   4) Fetch helpers
-------------------------- */
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  // If a 404 HTML page sneaks in, this gives a helpful error
  try {
    const json = JSON.parse(text);
    if (!res.ok) {
      throw new Error(json?.error || `Request failed: ${url} (${res.status})`);
    }
    return json;
  } catch (e) {
    const head = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`Non-JSON response from ${url} (${res.status}). Body starts: ${head}`);
  }
}

/* -------------------------
   5) Filter wiring + logic
-------------------------- */
function getCurrentFilters() {
  const val = (el) => (el ? String(el.value || "").trim() : "");
  const search = (ui.stateSearch ? String(ui.stateSearch.value || "").trim() : "");

  return {
    search,
    category: val(ui.filterCategory),
    impact: val(ui.filterImpact),
    type: val(ui.filterType),
    direction: val(ui.filterDirection),
    signalCategory: val(ui.filterSignalCategory),
  };
}

function matchesSelect(filterValue, recordValue) {
  if (!filterValue) return true;
  if (!recordValue) return false;
  return String(recordValue).trim() === String(filterValue).trim();
}

function entryMatchesFilters(entry, filters) {
  // Search: if user types something, match against title + summary + state
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const blob = `${entry.title || ""} ${entry.summary || ""} ${entry.state || ""}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }

  if (!matchesSelect(filters.category, entry.category)) return false;
  if (!matchesSelect(filters.impact, entry.impactLevel)) return false;
  if (!matchesSelect(filters.type, entry.signalType)) return false;
  if (!matchesSelect(filters.direction, entry.signalDirection)) return false;
  if (!matchesSelect(filters.signalCategory, entry.signalCategory)) return false;

  return true;
}

/* -------------------------
   6) Populate filter dropdowns from /api/options
-------------------------- */
function buildSelect(el, options, placeholder = "All") {
  if (!el) return;

  // preserve current selection if possible
  const prev = String(el.value || "");

  el.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  el.appendChild(opt0);

  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    el.appendChild(opt);
  }

  // restore selection if exists
  if (prev && options.includes(prev)) el.value = prev;
}

function wireOptionsIntoUI() {
  // /api/options should include groups like:
  // { option, filterGroup } or { Option, Filter Group } etc.
  const norm = airtableOptions.map((r) => ({
    option: r.option ?? r.Option ?? r.name ?? r.Name ?? r.value ?? r.Value,
    group: r.filterGroup ?? r.FilterGroup ?? r["Filter Group"] ?? r.group ?? r.Group,
    active: r.active ?? r.Active ?? true,
  }));

  const byGroup = new Map();
  for (const r of norm) {
    if (!r.option || !r.group) continue;
    if (r.active === false) continue;
    if (!byGroup.has(r.group)) byGroup.set(r.group, new Set());
    byGroup.get(r.group).add(String(r.option));
  }

  const list = (g) => Array.from(byGroup.get(g) || []).sort((a, b) => a.localeCompare(b));

  // These group names must match what you use in Filter Options table
  buildSelect(ui.filterCategory, list("Category"), "All Categories");
  buildSelect(ui.filterImpact, list("Impact Level"), "All Impact Levels");
  buildSelect(ui.filterType, list("Signal Type"), "All Signal Types");
  buildSelect(ui.filterDirection, list("Signal Direction"), "All Directions");
  buildSelect(ui.filterSignalCategory, list("Signal Category"), "All Signal Categories");
}

/* -------------------------
   7) Build state + entry indexes
-------------------------- */
function indexAirtableData() {
  stateByName = new Map();
  entriesByState = new Map();

  // Normalize states
  for (const s of airtableStates) {
    const name = normalizeStateName(s.state ?? s.State ?? s.name ?? s.NAME);
    if (!name) continue;
    stateByName.set(name, {
      state: name,
      calculatedRiskLevel: s.calculatedRiskLevel ?? s["Calculated Risk Level"] ?? s.riskLevel ?? s["Risk Level"],
      riskScoreTotal: s.riskScoreTotal ?? s["Risk Score Total"],
      entryCount: s.entryCount ?? s["Entry Count"],
      topRiskSignals: s.topRiskSignals ?? s["Top Risk Signals"] ?? [],
    });
  }

  // Normalize entries
  const normalizedEntries = [];
  for (const e of airtableEntries) {
    const state = normalizeStateName(e.state ?? e.State ?? e["State (from State)"] ?? e["State"]);
    if (!state) continue;

    const entry = {
      title: e.title ?? e.Title ?? "",
      summary: e.summary ?? e.Summary ?? "",
      link: e.link ?? e.Link ?? "",
      publishedDate: e.publishedDate ?? e["Published Date"] ?? e.date ?? e.Date ?? "",
      state,
      category: e.category ?? e["Category (linked)"] ?? e.Category ?? "",
      impactLevel: e.impactLevel ?? e["Impact Level (linked)"] ?? e["Impact Level"] ?? "",
      signalType: e.signalType ?? e["Signal Type (linked)"] ?? e["Signal Type"] ?? "",
      signalDirection: e.signalDirection ?? e["Signal Direction (linked)"] ?? e["Signal Direction"] ?? "",
      signalCategory: e.signalCategory ?? e["Signal Category"] ?? "",
      impactRank: e.impactRank ?? e["Impact Rank"] ?? "",
      sourceDomain: e.sourceDomain ?? e["Source Domain"] ?? domainFromUrl(e.link),
    };

    normalizedEntries.push(entry);
    if (!entriesByState.has(state)) entriesByState.set(state, []);
    entriesByState.get(state).push(entry);
  }

  // Sort entries within state for nicer panel (impactRank asc, then newest)
  for (const [state, arr] of entriesByState.entries()) {
    arr.sort((a, b) => {
      const ar = Number(a.impactRank || 999);
      const br = Number(b.impactRank || 999);
      if (ar !== br) return ar - br;

      const ad = new Date(a.publishedDate || 0).getTime() || 0;
      const bd = new Date(b.publishedDate || 0).getTime() || 0;
      return bd - ad;
    });
  }

  return normalizedEntries;
}

/* -------------------------
   8) Panel rendering (clickable links)
-------------------------- */
function renderTopSignalsList(stateName) {
  if (!ui.panelTopSignals) return;
  ui.panelTopSignals.innerHTML = "";

  const s = stateByName.get(stateName);
  const top = Array.isArray(s?.topRiskSignals) ? s.topRiskSignals : [];

  // If Airtable returns a single string with commas, handle it
  const items = Array.isArray(top) ? top : String(top || "").split(",").map((x) => x.trim()).filter(Boolean);

  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No top signals yet.";
    ui.panelTopSignals.appendChild(li);
    return;
  }

  for (const t of items.slice(0, 5)) {
    const li = document.createElement("li");
    li.textContent = t;
    ui.panelTopSignals.appendChild(li);
  }
}

function renderEntriesList(stateName) {
  if (!ui.panelEntries) return;
  ui.panelEntries.innerHTML = "";

  const filters = getCurrentFilters();
  const entries = (entriesByState.get(stateName) || []).filter((e) => entryMatchesFilters(e, filters));

  safeText(ui.panelEntriesHint, entries.length ? `${entries.length} matching entries` : "No matching entries");

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Try clearing filters.";
    ui.panelEntries.appendChild(li);
    return;
  }

  for (const e of entries.slice(0, 30)) {
    const li = document.createElement("li");
    li.className = "entry";

    const year = toISODateYear(e.publishedDate);
    const metaParts = [
      e.category ? e.category : null,
      e.impactLevel ? e.impactLevel : null,
      year ? year : null,
      e.sourceDomain ? e.sourceDomain : null,
    ].filter(Boolean);

    // Clickable title
    const titleHtml = e.link
      ? `<a href="${escapeHtml(e.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title || "Untitled")}</a>`
      : `${escapeHtml(e.title || "Untitled")}`;

    li.innerHTML = `
      <div class="entry__title">${titleHtml}</div>
      ${metaParts.length ? `<div class="entry__meta">${escapeHtml(metaParts.join(" • "))}</div>` : ""}
      ${e.summary ? `<div class="entry__summary">${escapeHtml(e.summary)}</div>` : ""}
    `;

    ui.panelEntries.appendChild(li);
  }
}

function renderPanelForState(stateName) {
  safeText(ui.panelState, stateName);

  const s = stateByName.get(stateName);
  const risk = s?.calculatedRiskLevel || s?.riskLevel || "";
  const score = (s?.riskScoreTotal ?? "").toString();
  const count = (s?.entryCount ?? "").toString();

  const meta = [
    risk ? `Risk: ${risk}` : null,
    score ? `Score: ${score}` : null,
    count ? `Entries: ${count}` : null,
  ].filter(Boolean).join(" • ");

  safeText(ui.panelMeta, meta);

  renderTopSignalsList(stateName);
  renderEntriesList(stateName);
  showPanel();
}

/* -------------------------
   9) Match-highlighting (fast, scalable)
-------------------------- */
function recomputeMatchesAndHighlight() {
  if (!map || !statesGeo) return;

  const filters = getCurrentFilters();
  const next = new Set();

  // Determine which states have any matching entries
  for (const e of airtableEntries) {
    const state = normalizeStateName(e.state ?? e.State ?? e["State (from State)"]);
    if (!state) continue;

    // Use normalized “view” of entry for filter checks
    const entry = {
      title: e.title ?? e.Title ?? "",
      summary: e.summary ?? e.Summary ?? "",
      state,
      category: e.category ?? e["Category (linked)"] ?? e.Category ?? "",
      impactLevel: e.impactLevel ?? e["Impact Level (linked)"] ?? e["Impact Level"] ?? "",
      signalType: e.signalType ?? e["Signal Type (linked)"] ?? e["Signal Type"] ?? "",
      signalDirection: e.signalDirection ?? e["Signal Direction (linked)"] ?? e["Signal Direction"] ?? "",
      signalCategory: e.signalCategory ?? e["Signal Category"] ?? "",
    };

    if (entryMatchesFilters(entry, filters)) next.add(state);
  }

  matchingStates = next;

  // Flip feature-state on state polygons (fast)
  for (const f of statesGeo.features) {
    const name = normalizeStateName(f?.properties?.NAME || f?.properties?.name || "");
    const has = matchingStates.has(name);
    setFeatureStateSafe("states", f.id, { hasMatch: has });
  }

  // If panel is open, rerender it so list reflects filters
  if (ui.panel && !ui.panel.classList.contains("panel--hidden")) {
    const current = (ui.panelState?.textContent || "").trim();
    if (current) renderPanelForState(current);
  }
}

/* -------------------------
   10) Map init + layers
-------------------------- */
function layerExists(id) {
  return !!map.getLayer(id);
}

function safeSetVisibility(layerId, visible) {
  if (!layerExists(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

let viewMode = "state"; // "state" or "iso"

function setLayerVisibility() {
  const showStates = viewMode === "state";
  const showIso = viewMode === "iso";

  safeSetVisibility("states-fill", showStates);
  safeSetVisibility("states-outline", showStates);

  safeSetVisibility("iso-fill", showIso);
  safeSetVisibility("iso-line", showIso);

  map.getCanvas().style.cursor = "";
}

function clearFeatureStates() {
  // clear hover on states
  if (hoveredStateId !== null) {
    setFeatureStateSafe("states", hoveredStateId, { hover: false });
  }
  hoveredStateId = null;

  // clear hover on iso
  if (hoveredIsoId !== null) {
    setFeatureStateSafe("iso", hoveredIsoId, { hover: false });
  }
  hoveredIsoId = null;
}

function initMap() {
  if (!MAPBOX_TOKEN) return;

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-98.5, 39.5],
    zoom: 3.4,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    // Sources
    statesGeo = ensureFeatureIds(statesGeo);
    isoGeo = ensureFeatureIds(isoGeo);

    map.addSource("states", { type: "geojson", data: statesGeo });
    map.addSource("iso", { type: "geojson", data: isoGeo });

    // STATES fill — uses existing properties if present; otherwise feature-state only
    map.addLayer({
      id: "states-fill",
      type: "fill",
      source: "states",
      paint: {
        "fill-color": [
          "case",
          // If you have a risk level property on the geojson already, prefer it
          ["match", ["get", "Calculated Risk Level"],
            "High Risk", "#ef4444",
            "Moderate Risk", "#f59e0b",
            "Emerging Risk", "#fb7185",
            "Low Risk", "#60a5fa",
            /* default */ "#d1d5db"
          ],
          // fallback if not present
          "#d1d5db"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.85,
          ["boolean", ["feature-state", "hasMatch"], false], 0.78,
          0.60
        ],
      },
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: {
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hasMatch"], false], 1.8,
          1.0
        ],
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hasMatch"], false], "#111827",
          "#9ca3af"
        ],
      },
    });

    // ISO layers
    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "fill-color": "#3b82f6",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.18,
          0.10
        ],
      },
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "line-width": 2,
        "line-color": "#1f2937",
      },
    });

    // Hover/click interactions for STATES
    map.on("mousemove", "states-fill", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;

      if (hoveredStateId !== null && hoveredStateId !== f.id) {
        setFeatureStateSafe("states", hoveredStateId, { hover: false });
      }
      hoveredStateId = f.id;
      setFeatureStateSafe("states", hoveredStateId, { hover: true });
    });

    map.on("mouseleave", "states-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId !== null) setFeatureStateSafe("states", hoveredStateId, { hover: false });
      hoveredStateId = null;
    });

    map.on("click", "states-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const stateName = normalizeStateName(f?.properties?.NAME || f?.properties?.name || "");
      if (!stateName) return;
      renderPanelForState(stateName);
    });

    // Hover/click for ISO
    map.on("mousemove", "iso-fill", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;

      if (hoveredIsoId !== null && hoveredIsoId !== f.id) {
        setFeatureStateSafe("iso", hoveredIsoId, { hover: false });
      }
      hoveredIsoId = f.id;
      setFeatureStateSafe("iso", hoveredIsoId, { hover: true });
    });

    map.on("mouseleave", "iso-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIsoId !== null) setFeatureStateSafe("iso", hoveredIsoId, { hover: false });
      hoveredIsoId = null;
    });

    map.on("click", "iso-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      // Simple: show name in panel title for now
      const isoName = normalizeStateName(f?.properties?.iso || f?.properties?.NAME || "ISO / RTO");
      safeText(ui.panelState, isoName);
      safeText(ui.panelMeta, "ISO/RTO view (click a state for details)");
      if (ui.panelTopSignals) ui.panelTopSignals.innerHTML = "";
      if (ui.panelEntries) ui.panelEntries.innerHTML = "";
      showPanel();
    });

    // Close panel
    if (ui.panelClose) ui.panelClose.addEventListener("click", hidePanel);

    // Mode buttons
    if (ui.btnModeState) {
      ui.btnModeState.addEventListener("click", () => {
        viewMode = "state";
        clearFeatureStates();
        setLayerVisibility();
      });
    }
    if (ui.btnModeIso) {
      ui.btnModeIso.addEventListener("click", () => {
        viewMode = "iso";
        clearFeatureStates();
        setLayerVisibility();
      });
    }

    // Wire UI listeners (search/filters)
    wireUI();

    // Initial compute
    recomputeMatchesAndHighlight();
  });
}

/* -------------------------
   11) UI wiring (this fixes “filters do nothing”)
-------------------------- */
function wireUI() {
  const onChange = () => recomputeMatchesAndHighlight();

  if (ui.stateSearch) ui.stateSearch.addEventListener("input", onChange);
  if (ui.filterCategory) ui.filterCategory.addEventListener("change", onChange);
  if (ui.filterImpact) ui.filterImpact.addEventListener("change", onChange);
  if (ui.filterType) ui.filterType.addEventListener("change", onChange);
  if (ui.filterDirection) ui.filterDirection.addEventListener("change", onChange);
  if (ui.filterSignalCategory) ui.filterSignalCategory.addEventListener("change", onChange);

  if (ui.btnClear) {
    ui.btnClear.addEventListener("click", () => {
      if (ui.stateSearch) ui.stateSearch.value = "";
      if (ui.filterCategory) ui.filterCategory.value = "";
      if (ui.filterImpact) ui.filterImpact.value = "";
      if (ui.filterType) ui.filterType.value = "";
      if (ui.filterDirection) ui.filterDirection.value = "";
      if (ui.filterSignalCategory) ui.filterSignalCategory.value = "";
      recomputeMatchesAndHighlight();
    });
  }
}

/* -------------------------
   12) Bootstrap: load everything then init
-------------------------- */
async function main() {
  try {
    const [
      statesG,
      isoG,
      statesApi,
      entriesApi,
      optionsApi
    ] = await Promise.all([
      fetchJson("/data/us-states.geojson"),
      fetchJson("/data/iso-rto.geojson"),
      fetchJson("/api/states"),
      fetchJson("/api/entries"),
      fetchJson("/api/options"),
    ]);

    statesGeo = statesG;
    isoGeo = isoG;
    airtableStates = Array.isArray(statesApi) ? statesApi : (statesApi?.states || statesApi?.data || []);
    airtableEntries = Array.isArray(entriesApi) ? entriesApi : (entriesApi?.entries || entriesApi?.data || []);
    airtableOptions = Array.isArray(optionsApi) ? optionsApi : (optionsApi?.options || optionsApi?.data || []);

    // Build indexes + filters
    indexAirtableData();
    wireOptionsIntoUI();

    // Optional: also bake calculated risk into state geojson properties if not present
    // so the fill-color match works
    const by = stateByName;
    statesGeo.features.forEach((f) => {
      const name = normalizeStateName(f?.properties?.NAME || f?.properties?.name || "");
      const s = by.get(name);
      if (s && (!f.properties["Calculated Risk Level"] || f.properties["Calculated Risk Level"] === "")) {
        f.properties["Calculated Risk Level"] = s.calculatedRiskLevel || "";
      }
    });

    // Start map
    initMap();
  } catch (err) {
    console.error(err);
    alert(String(err.message || err));
  }
}

main();

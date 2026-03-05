/* global mapboxgl */
const MAPBOX_TOKEN = window.MAPBOX_TOKEN;
if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg")) {
  console.warn("Mapbox token missing. Set window.MAPBOX_TOKEN in index.html.");
}

mapboxgl.accessToken = MAPBOX_TOKEN;

const RISK_COLORS = {
  "High Risk": "#b91c1c",
  "Moderate Risk": "#f97316",
  "Emerging Risk": "#facc15",
  "Low Risk": "#22c55e",
  "No Data": "#e5e7eb",
};

let viewMode = "state"; // "state" | "iso"
let statesGeo = null;
let isoGeo = null;

let airtableStates = [];
let airtableEntries = [];
let filterOptions = [];

let hoveredStateId = null;

const ui = {
  btnViewState: document.getElementById("btnViewState"),
  btnViewIso: document.getElementById("btnViewIso"),
  stateSearch: document.getElementById("stateSearch"),

  filterCategory: document.getElementById("filterCategory"),
  filterImpact: document.getElementById("filterImpact"),
  filterType: document.getElementById("filterType"),
  filterDirection: document.getElementById("filterDirection"),
  filterSignalCategory: document.getElementById("filterSignalCategory"),

  btnClear: document.getElementById("btnClear"),

  panel: document.getElementById("panel"),
  panelClose: document.getElementById("panelClose"),
  panelState: document.getElementById("panelState"),
  panelMeta: document.getElementById("panelMeta"),
  panelTopSignals: document.getElementById("panelTopSignals"),
  panelEntries: document.getElementById("panelEntries"),
  panelEntriesHint: document.getElementById("panelEntriesHint"),
};

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-98.5, 39.8],
  zoom: 3.25,
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");

function safeStr(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function normalizeStateName(name) {
  return (name || "").trim();
}

function parseTopSignals(value) {
  // Rollup could be an array or a comma-delimited string
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  // Airtable sometimes returns as "a, b, c"
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getCurrentFilters() {
  return {
    q: ui.stateSearch.value.trim().toLowerCase(),
    category: ui.filterCategory.value,
    impact: ui.filterImpact.value,
    type: ui.filterType.value,
    direction: ui.filterDirection.value,
    signalCategory: ui.filterSignalCategory.value,
  };
}

function entryMatchesFilters(entry, filters) {
  const fkeys = (entry.filterKeys || "").toLowerCase();

  if (filters.category && !fkeys.includes(filters.category.toLowerCase())) return false;
  if (filters.impact && !fkeys.includes(filters.impact.toLowerCase())) return false;
  if (filters.type && !fkeys.includes(filters.type.toLowerCase())) return false;
  if (filters.direction && !fkeys.includes(filters.direction.toLowerCase())) return false;

  if (filters.signalCategory) {
    // Signal Category is computed; we also include it in filtering directly
    if ((entry.signalCategory || "") !== filters.signalCategory) return false;
  }
  return true;
}

function buildOptionsSelect(selectEl, label, values) {
  selectEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = `All ${label}`;
  selectEl.appendChild(optAll);

  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

function applyViewMode() {
  const showStates = viewMode === "state";
  const showIso = viewMode === "iso";

  const vis = (layerId, on) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
  };

  vis("states-fill", showStates);
  vis("states-outline", showStates);

  vis("iso-fill", showIso);
  vis("iso-line", showIso);

  ui.btnViewState.classList.toggle("segmented__btn--active", showStates);
  ui.btnViewIso.classList.toggle("segmented__btn--active", showIso);
}

function openPanel() {
  ui.panel.classList.remove("panel--hidden");
}
function closePanel() {
  ui.panel.classList.add("panel--hidden");
}

function badge(text) {
  return `<span class="badge">${text}</span>`;
}

function renderPanelForState(stateName) {
  const filters = getCurrentFilters();
  const st = airtableStates.find((s) => s.state === stateName);

  const risk = st?.calculatedRiskLevel || "No Data";
  const count = st?.entryCount ?? 0;
  const score = st?.riskScoreTotal ?? 0;

  ui.panelState.textContent = stateName;
  ui.panelMeta.textContent = `Calculated risk: ${risk} • Signals: ${count} • Score: ${score}`;

  // Top signals (rollup)
  ui.panelTopSignals.innerHTML = "";
  const topSignals = st?.topRiskSignals || [];
  if (topSignals.length === 0) {
    ui.panelTopSignals.innerHTML = `<li class="hint">No top signals yet for this state.</li>`;
  } else {
    for (const s of topSignals) {
      const li = document.createElement("li");
      li.textContent = s;
      ui.panelTopSignals.appendChild(li);
    }
  }

  // Matching entries under filters
  const matching = airtableEntries
    .filter((e) => e.state === stateName)
    .filter((e) => entryMatchesFilters(e, filters))
    .sort((a, b) => {
      // Best-effort: Impact Rank asc, then date desc
      const ar = a.impactRank ?? 99;
      const br = b.impactRank ?? 99;
      if (ar !== br) return ar - br;
      return (b.publishedDate || "").localeCompare(a.publishedDate || "");
    });

  ui.panelEntriesHint.textContent =
    matching.length === 0
      ? "No entries match your current filters."
      : `${matching.length} entry(s) match your current filters.`;

  ui.panelEntries.innerHTML = "";
  for (const e of matching.slice(0, 50)) {
    const li = document.createElement("li");

    const top = [
      badge(e.category || "—"),
      badge(e.impact || "—"),
      badge(e.signalType || "—"),
      badge(e.signalDirection || "—"),
      badge(e.signalCategory || "—"),
    ].join(" ");

    li.innerHTML = `
      <div class="entry__top">${top}</div>
      <div><a href="${e.url}" target="_blank" rel="noopener">${e.title}</a></div>
      <div class="hint">${e.publishedDate || ""}</div>
    `;
    ui.panelEntries.appendChild(li);
  }

  openPanel();
}

function setStateFillByRisk() {
  if (!map.getLayer("states-fill")) return;

  map.setPaintProperty("states-fill", "fill-color", [
    "match",
    ["get", "riskLevel"],
    "High Risk", RISK_COLORS["High Risk"],
    "Moderate Risk", RISK_COLORS["Moderate Risk"],
    "Emerging Risk", RISK_COLORS["Emerging Risk"],
    "Low Risk", RISK_COLORS["Low Risk"],
    RISK_COLORS["No Data"],
  ]);

  map.setPaintProperty("states-fill", "fill-opacity", [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    0.85,
    0.70,
  ]);
}

async function loadAllData() {
  // Load geojsons
  const [statesRes, isoRes, stRes, enRes, optRes] = await Promise.all([
    fetch("./data/us-states.geojson"),
    fetch("./data/iso-rto.geojson"),
    fetch("/api/states"),
    fetch("/api/entries"),
    fetch("/api/options"),
  ]);

  statesGeo = await statesRes.json();
  isoGeo = await isoRes.json();

  const stJson = await stRes.json();
  const enJson = await enRes.json();
  const optJson = await optRes.json();

  airtableStates = stJson.states || [];
  airtableEntries = enJson.entries || [];
  filterOptions = optJson.options || [];

  // Build select filters from options table (preferred), else fallback to observed values.
  const group = (g) =>
    filterOptions
      .filter((o) => o.group === g && o.active)
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
      .map((o) => o.option);

  const categories = group("Category");
  const impacts = group("Impact Level");
  const types = group("Signal Type");
  const directions = group("Signal Direction");

  buildOptionsSelect(ui.filterCategory, "Categories", categories.length ? categories : [...new Set(airtableEntries.map(e => e.category).filter(Boolean))].sort());
  buildOptionsSelect(ui.filterImpact, "Impacts", impacts.length ? impacts : [...new Set(airtableEntries.map(e => e.impact).filter(Boolean))].sort());
  buildOptionsSelect(ui.filterType, "Types", types.length ? types : [...new Set(airtableEntries.map(e => e.signalType).filter(Boolean))].sort());
  buildOptionsSelect(ui.filterDirection, "Directions", directions.length ? directions : [...new Set(airtableEntries.map(e => e.signalDirection).filter(Boolean))].sort());

  buildOptionsSelect(ui.filterSignalCategory, "Signal Categories", ["Risk", "Neutral", "Positive"]);

  // Join state intelligence onto geojson features by NAME
  const byName = new Map(airtableStates.map((s) => [s.state, s]));

  for (const f of statesGeo.features) {
    const name = normalizeStateName(f.properties?.NAME);
    const st = byName.get(name);

    f.properties.riskLevel = st?.calculatedRiskLevel || "No Data";
    f.properties.riskScoreTotal = st?.riskScoreTotal ?? 0;
    f.properties.entryCount = st?.entryCount ?? 0;
    f.properties.topRiskSignals = (st?.topRiskSignals || []).join(" | ");
  }
}

function wireUI() {
  ui.btnViewState.addEventListener("click", () => {
    viewMode = "state";
    applyViewMode();
  });
  ui.btnViewIso.addEventListener("click", () => {
    viewMode = "iso";
    applyViewMode();
  });

  ui.btnClear.addEventListener("click", () => {
    ui.stateSearch.value = "";
    ui.filterCategory.value = "";
    ui.filterImpact.value = "";
    ui.filterType.value = "";
    ui.filterDirection.value = "";
    ui.filterSignalCategory.value = "";
    // panel refresh if open
    if (!ui.panel.classList.contains("panel--hidden")) {
      const current = ui.panelState.textContent;
      if (current) renderPanelForState(current);
    }
  });

  const refreshPanelIfOpen = () => {
    if (ui.panel.classList.contains("panel--hidden")) return;
    const current = ui.panelState.textContent;
    if (current) renderPanelForState(current);
  };

  ui.stateSearch.addEventListener("input", refreshPanelIfOpen);
  ui.filterCategory.addEventListener("change", refreshPanelIfOpen);
  ui.filterImpact.addEventListener("change", refreshPanelIfOpen);
  ui.filterType.addEventListener("change", refreshPanelIfOpen);
  ui.filterDirection.addEventListener("change", refreshPanelIfOpen);
  ui.filterSignalCategory.addEventListener("change", refreshPanelIfOpen);

  ui.panelClose.addEventListener("click", closePanel);
}

map.on("load", async () => {
  await loadAllData();

  // Sources
  map.addSource("states", { type: "geojson", data: statesGeo, generateId: true });
  map.addSource("iso", { type: "geojson", data: isoGeo });

  // States layers
  map.addLayer({
    id: "states-fill",
    type: "fill",
    source: "states",
    paint: {
      "fill-color": "#e5e7eb",
      "fill-opacity": 0.70,
    },
  });

  map.addLayer({
    id: "states-outline",
    type: "line",
    source: "states",
    paint: {
      "line-color": "#9ca3af",
      "line-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        2.5,
        1,
      ],
      "line-opacity": 0.9,
    },
  });

  // ISO/RTO layers (simple; you can enhance later)
  map.addLayer({
    id: "iso-fill",
    type: "fill",
    source: "iso",
    layout: { visibility: "none" },
    paint: {
      "fill-color": "#475569",
      "fill-opacity": 0.08,
    },
  });

  map.addLayer({
    id: "iso-line",
    type: "line",
    source: "iso",
    layout: { visibility: "none" },
    paint: {
      "line-color": "#475569",
      "line-width": 2,
      "line-opacity": 0.9,
    },
  });

  setStateFillByRisk();
  applyViewMode();
  wireUI();

  // Hover state
  map.on("mousemove", "states-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";
    if (!e.features?.length) return;

    const f = e.features[0];
    const id = f.id;

    if (hoveredStateId !== null && hoveredStateId !== id) {
      map.setFeatureState({ source: "states", id: hoveredStateId }, { hover: false });
    }
    hoveredStateId = id;
    map.setFeatureState({ source: "states", id }, { hover: true });
  });

  map.on("mouseleave", "states-fill", () => {
    map.getCanvas().style.cursor = "";
    if (hoveredStateId !== null) {
      map.setFeatureState({ source: "states", id: hoveredStateId }, { hover: false });
    }
    hoveredStateId = null;
  });

  // Click → panel
  map.on("click", "states-fill", (e) => {
    if (!e.features?.length) return;
    const f = e.features[0];
    const name = normalizeStateName(f.properties?.NAME);

    // mark selected (optional)
    // Clear all selected states by brute-force update: re-set selected on clicked only
    // (For large feature sets you’d track prevSelected)
    map.setFeatureState({ source: "states", id: f.id }, { selected: true });

    renderPanelForState(name);
  });
});

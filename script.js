const MAPBOX_TOKEN = typeof window !== "undefined" ? (window.MAPBOX_TOKEN || "").trim() : "";

if (!MAPBOX_TOKEN) {
  console.error("Mapbox token missing. Set window.MAPBOX_TOKEN in index.html.");
} else {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

const ui = {
  panel: document.getElementById("panel"),
  panelClose: document.getElementById("panelClose"),
  panelTitle: document.getElementById("panelTitle"),
  panelMeta: document.getElementById("panelMeta"),
  panelTopSignals: document.getElementById("panelTopSignals"),
  panelEntriesHint: document.getElementById("panelEntriesHint"),
  panelEntries: document.getElementById("panelEntries"),

  stateSearch: document.getElementById("stateSearch"),
  filterIso: document.getElementById("filterIso"),
  filterCategory: document.getElementById("filterCategory"),
  filterImpact: document.getElementById("filterImpact"),
  filterType: document.getElementById("filterType"),
  filterDirection: document.getElementById("filterDirection"),
  filterSignalCategory: document.getElementById("filterSignalCategory"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),

  viewStateBtn: document.getElementById("viewStateBtn"),
  viewIsoBtn: document.getElementById("viewIsoBtn"),
};

const RISK_COLORS = {
  "Low Risk": "#A8D5BA",
  "Moderate Risk": "#F3E6A3",
  "Emerging Risk": "#F7C6C7",
  "High Risk": "#E57373",
  "No Data": "#E5E7EB",
};

let map;
let statesGeo;
let isoGeo;

let statesData = [];
let entriesData = [];

let stateIndex = new Map();
let entriesByState = new Map();
let isoToStates = new Map();

let currentViewMode = "state";
let currentContext = null;
let hoveredStateId = null;
let hoveredIsoId = null;

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json.error || `Request failed: ${url}`);
    return json;
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120)}`);
  }
}

function normalizeStateName(value) {
  return String(value || "").trim();
}

function parseTopSignals(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function fillSelect(el, values, placeholder) {
  if (!el) return;
  el.innerHTML = "";
  const base = document.createElement("option");
  base.value = "";
  base.textContent = placeholder;
  el.appendChild(base);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function buildIndexes() {
  stateIndex = new Map();
  entriesByState = new Map();
  isoToStates = new Map();

  for (const s of statesData) {
    const name = normalizeStateName(s.state || s.State);
    if (!name) continue;

    const gridRegions = Array.isArray(s.gridRegions)
      ? s.gridRegions
      : (s.gridRegions ? [s.gridRegions] : []);

    const rec = {
      state: name,
      calculatedRiskLevel: s.calculatedRiskLevel || s["Calculated Risk Level"] || "",
      riskScoreTotal: Number(s.riskScoreTotal ?? s["Risk Score Total"] ?? 0),
      entryCount: Number(s.entryCount ?? s["Entry Count"] ?? 0),
      topRiskSignals: parseTopSignals(s.topRiskSignals ?? s["Top Risk Signals"]),
      gridRegions,
      summary: s.summary || s.Summary || "",
      lastUpdated: s.lastUpdated || s["Last Updated"] || "",
    };

    stateIndex.set(name, rec);

    gridRegions.forEach(iso => {
      if (!isoToStates.has(iso)) isoToStates.set(iso, []);
      isoToStates.get(iso).push(name);
    });
  }

  for (const e of entriesData) {
    const state = normalizeStateName(e.state || e.State);
    if (!state) continue;

    const entry = {
      title: e.title || e.Title || "",
      summary: e.summary || e.Summary || "",
      link: e.link || e.Link || "",
      publishedDate: e.publishedDate || e["Published Date"] || "",
      state,
      category: e.category || e["Category (linked)"] || e.Category || "",
      impactLevel: e.impactLevel || e["Impact Level (linked)"] || e["Impact Level"] || "",
      signalType: e.signalType || e["Signal Type (linked)"] || e["Signal Type"] || "",
      signalDirection: e.signalDirection || e["Signal Direction (linked)"] || e["Signal Direction"] || "",
      signalCategory: e.signalCategory || e["Signal Category"] || "",
      impactRank: Number(e.impactRank ?? e["Impact Rank"] ?? 999),
      sourceDomain: e.sourceDomain || e["Source Domain"] || "",
    };

    if (!entriesByState.has(state)) entriesByState.set(state, []);
    entriesByState.get(state).push(entry);
  }

  for (const [state, list] of entriesByState.entries()) {
    list.sort((a, b) => {
      if (a.impactRank !== b.impactRank) return a.impactRank - b.impactRank;
      return new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0);
    });
  }
}

function attachStateRiskToGeoJSON() {
  statesGeo.features.forEach((feature) => {
    const name = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
    const state = stateIndex.get(name);

    feature.properties.calculatedRiskLevel = state?.calculatedRiskLevel || "No Data";
    feature.properties.riskScoreTotal = state?.riskScoreTotal ?? 0;
    feature.properties.entryCount = state?.entryCount ?? 0;
  });
}

function fillFilters() {
  const allEntries = [...entriesByState.values()].flat();

  fillSelect(ui.filterIso, uniqueSorted([...isoToStates.keys()]), "All ISO / RTO");
  fillSelect(ui.filterCategory, uniqueSorted(allEntries.map(e => e.category)), "All Categories");
  fillSelect(ui.filterImpact, uniqueSorted(allEntries.map(e => e.impactLevel)), "All Impact");
  fillSelect(ui.filterType, uniqueSorted(allEntries.map(e => e.signalType)), "All Signal Types");
  fillSelect(ui.filterDirection, uniqueSorted(allEntries.map(e => e.signalDirection)), "All Directions");
  fillSelect(ui.filterSignalCategory, uniqueSorted(allEntries.map(e => e.signalCategory)), "All Signal Categories");
}

function getFilters() {
  return {
    search: String(ui.stateSearch?.value || "").trim().toLowerCase(),
    iso: String(ui.filterIso?.value || "").trim(),
    category: String(ui.filterCategory?.value || "").trim(),
    impact: String(ui.filterImpact?.value || "").trim(),
    type: String(ui.filterType?.value || "").trim(),
    direction: String(ui.filterDirection?.value || "").trim(),
    signalCategory: String(ui.filterSignalCategory?.value || "").trim(),
  };
}

function entryMatchesFilters(entry, filters) {
  if (filters.search) {
    const blob = `${entry.title} ${entry.summary} ${entry.state}`.toLowerCase();
    if (!blob.includes(filters.search)) return false;
  }

  if (filters.iso) {
    const state = stateIndex.get(entry.state);
    const gridRegions = state?.gridRegions || [];
    if (!gridRegions.includes(filters.iso)) return false;
  }

  if (filters.category && entry.category !== filters.category) return false;
  if (filters.impact && entry.impactLevel !== filters.impact) return false;
  if (filters.type && entry.signalType !== filters.type) return false;
  if (filters.direction && entry.signalDirection !== filters.direction) return false;
  if (filters.signalCategory && entry.signalCategory !== filters.signalCategory) return false;

  return true;
}

function renderTopSignals(items) {
  ui.panelTopSignals.innerHTML = "";
  if (!items.length) {
    ui.panelTopSignals.innerHTML = "<li>No top signals available.</li>";
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    ui.panelTopSignals.appendChild(li);
  });
}

function renderEntries(entries) {
  ui.panelEntries.innerHTML = "";

  if (!entries.length) {
    ui.panelEntriesHint.textContent = "No matching resources.";
    ui.panelEntries.innerHTML = "<li>No matching entries for the current filters.</li>";
    return;
  }

  ui.panelEntriesHint.textContent = `${entries.length} matching resource${entries.length === 1 ? "" : "s"}`;

  entries.forEach(entry => {
    const li = document.createElement("li");

    const year = entry.publishedDate ? new Date(entry.publishedDate).getFullYear() : "";
    const meta = [
      entry.category,
      entry.impactLevel,
      year || "",
      entry.sourceDomain || ""
    ].filter(Boolean).join(" • ");

    li.innerHTML = `
      <div class="entry__title">
        <a href="${entry.link}" target="_blank" rel="noopener noreferrer">${entry.title}</a>
      </div>
      <div class="entry__meta">${meta}</div>
      <div class="entry__summary">${entry.summary || ""}</div>
    `;

    ui.panelEntries.appendChild(li);
  });
}

function showPanel() {
  ui.panel.classList.remove("panel--hidden");
}

function hidePanel() {
  ui.panel.classList.add("panel--hidden");
}

function renderStatePanel(stateName) {
  const state = stateIndex.get(stateName);
  if (!state) return;

  currentContext = { type: "state", value: stateName };

  ui.panelTitle.textContent = stateName;
  ui.panelMeta.textContent = [
    state.calculatedRiskLevel ? `Risk: ${state.calculatedRiskLevel}` : "",
    Number.isFinite(state.riskScoreTotal) ? `Score: ${state.riskScoreTotal}` : "",
    Number.isFinite(state.entryCount) ? `Entries: ${state.entryCount}` : "",
   (state.gridRegions || []).length ? `ISO/RTO: ${state.gridRegions.join(", ")}` : ""
  ].filter(Boolean).join(" • ");

  renderTopSignals(state.topRiskSignals || []);

  const filters = getFilters();
  const entries = (entriesByState.get(stateName) || []).filter(e => entryMatchesFilters(e, filters));
  renderEntries(entries);

  showPanel();
}

function renderIsoPanel(isoName) {
  currentContext = { type: "iso", value: isoName };

  const stateNames = isoToStates.get(isoName) || [];
  const filters = getFilters();

  const allEntries = stateNames
    .flatMap(state => entriesByState.get(state) || [])
    .filter(e => entryMatchesFilters(e, filters));

  ui.panelTitle.textContent = isoName;
  ui.panelMeta.textContent = `${stateNames.length} state${stateNames.length === 1 ? "" : "s"} • ${allEntries.length} matching resource${allEntries.length === 1 ? "" : "s"}`;

  renderTopSignals(
    stateNames
      .flatMap(state => stateIndex.get(state)?.topRiskSignals || [])
      .slice(0, 5)
  );

  renderEntries(allEntries);
  showPanel();
}

function refreshCurrentPanel() {
  if (!currentContext) return;
  if (currentContext.type === "state") renderStatePanel(currentContext.value);
  if (currentContext.type === "iso") renderIsoPanel(currentContext.value);
}

function safeSetFeatureState(source, id, state) {
  if (!map || id === undefined || id === null) return;
  if (!map.getSource(source)) return;
  map.setFeatureState({ source, id }, state);
}

function setLayerVisibility() {
  const showStates = currentViewMode === "state";
  const showIso = currentViewMode === "iso";

  if (map.getLayer("states-fill")) map.setLayoutProperty("states-fill", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-outline")) map.setLayoutProperty("states-outline", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("iso-fill")) map.setLayoutProperty("iso-fill", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-line")) map.setLayoutProperty("iso-line", "visibility", showIso ? "visible" : "none");
}

function bindUI() {
  ui.panelClose.addEventListener("click", hidePanel);

  ui.viewStateBtn.addEventListener("click", () => {
    currentViewMode = "state";
    ui.viewStateBtn.classList.add("toggle__btn--active");
    ui.viewIsoBtn.classList.remove("toggle__btn--active");
    setLayerVisibility();
  });

  ui.viewIsoBtn.addEventListener("click", () => {
    currentViewMode = "iso";
    ui.viewIsoBtn.classList.add("toggle__btn--active");
    ui.viewStateBtn.classList.remove("toggle__btn--active");
    setLayerVisibility();
  });

  [
    ui.filterIso,
    ui.filterCategory,
    ui.filterImpact,
    ui.filterType,
    ui.filterDirection,
    ui.filterSignalCategory
  ].forEach(el => {
    el?.addEventListener("change", refreshCurrentPanel);
  });

  ui.stateSearch?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const query = ui.stateSearch.value.trim().toLowerCase();
    if (!query) return;

    if (currentViewMode === "state") {
      const match = [...stateIndex.keys()].find(name => name.toLowerCase().includes(query));
      if (match) renderStatePanel(match);
    } else {
      const match = [...isoToStates.keys()].find(name => name.toLowerCase().includes(query));
      if (match) renderIsoPanel(match);
    }
  });

  ui.clearFiltersBtn?.addEventListener("click", () => {
    ui.stateSearch.value = "";
    ui.filterIso.value = "";
    ui.filterCategory.value = "";
    ui.filterImpact.value = "";
    ui.filterType.value = "";
    ui.filterDirection.value = "";
    ui.filterSignalCategory.value = "";
    refreshCurrentPanel();
  });
}

function initMap() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-97.5, 39.5],
    zoom: 3.4
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("states", {
      type: "geojson",
      data: statesGeo,
      generateId: true
    });

    map.addSource("iso", {
      type: "geojson",
      data: isoGeo,
      generateId: true
    });

    map.addLayer({
      id: "states-fill",
      type: "fill",
      source: "states",
      paint: {
        "fill-color": [
          "match",
          ["get", "calculatedRiskLevel"],
          "Low Risk", "#A8D5BA",
          "Moderate Risk", "#F3E6A3",
          "Emerging Risk", "#F7C6C7",
          "High Risk", "#E57373",
          "#E5E7EB"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.85,
          0.72
        ]
      }
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#6B7280",
        "line-width": 1
      }
    });

    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "fill-color": "#BFD7EA",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.22,
          0.12
        ]
      }
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "line-color": "#315B7C",
        "line-width": 2
      }
    });

    map.on("mousemove", "states-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";

      if (hoveredStateId !== null && hoveredStateId !== feature.id) {
        safeSetFeatureState("states", hoveredStateId, { hover: false });
      }

      hoveredStateId = feature.id;
      safeSetFeatureState("states", hoveredStateId, { hover: true });
    });

    map.on("mouseleave", "states-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId !== null) safeSetFeatureState("states", hoveredStateId, { hover: false });
      hoveredStateId = null;
    });

    map.on("click", "states-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const stateName = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
      renderStatePanel(stateName);
    });

    map.on("mousemove", "iso-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";

      if (hoveredIsoId !== null && hoveredIsoId !== feature.id) {
        safeSetFeatureState("iso", hoveredIsoId, { hover: false });
      }

      hoveredIsoId = feature.id;
      safeSetFeatureState("iso", hoveredIsoId, { hover: true });
    });

    map.on("mouseleave", "iso-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIsoId !== null) safeSetFeatureState("iso", hoveredIsoId, { hover: false });
      hoveredIsoId = null;
    });

    map.on("click", "iso-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const isoName = String(feature.properties?.iso || "").trim();
      if (!isoName) return;
      renderIsoPanel(isoName);
    });

    setLayerVisibility();
  });
}

async function main() {
  try {
    const [rawStatesGeo, rawIsoGeo, rawStatesApi, rawEntriesApi] = await Promise.all([
      fetchJson("/data/us-states.geojson"),
      fetchJson("/data/iso-rto.geojson"),
      fetchJson("/api/states"),
      fetchJson("/api/entries")
    ]);

    statesGeo = rawStatesGeo;
    isoGeo = rawIsoGeo;
    statesData = rawStatesApi.states || rawStatesApi;
    entriesData = rawEntriesApi.entries || rawEntriesApi;

    buildIndexes();
    attachStateRiskToGeoJSON();
    fillFilters();
    bindUI();
    initMap();
  } catch (err) {
    console.error(err);
    alert(`Map failed to load: ${err.message}`);
  }
}

main();
